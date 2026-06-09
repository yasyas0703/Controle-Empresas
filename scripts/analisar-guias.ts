/**
 * Analisador de reconhecimento de guias (SÓ LEITURA do T:).
 *
 * Roda cada PDF pelo MESMO identificador do auto-envio (empresa por CNPJ/IE,
 * obrigação por validarGuia, competência) e reporta, por arquivo, o que o
 * sistema reconhece e — se falha — o motivo exato. Serve pra calibrar perfis.
 *
 * Uso:
 *   npx tsx scripts/analisar-guias.ts --dir "T:\Fiscal\EMPRESA\1-GUIAS A ENVIAR\_PENDENTES"
 *   npx tsx scripts/analisar-guias.ts --filtro "ISS" --limite 80
 *   npx tsx scripts/analisar-guias.ts            (varre tudo — pode demorar)
 *
 * Saída: scripts/output-analise-guias.csv (gitignored) + resumo no stdout.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, type Dirent } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import {
  identificarEmpresa, identificarObrigacao, competenciaDoPdf, type ConfigObrigacao,
} from '../src/app/api/checklist-fiscal/auto-enviar/_identificar';
import type { Empresa } from '../src/app/types';

const requireCJS = createRequire(import.meta.url);
const pdfjsLib = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = process.env.FISCAL_ROOT || 'T:\\Fiscal\\EMPRESA';

const argv = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const dirAlvo = flag('--dir') ?? T_ROOT;
// --dirs-file: arquivo com uma pasta por linha; varre só essas (permite paralelizar
// dividindo as ~393 empresas em fatias, cada processo numa fatia).
const dirsFile = flag('--dirs-file');
const filtro = flag('--filtro');
const filtroRe = filtro ? new RegExp(filtro, 'i') : null;
// Filtro por CAMINHO: --inclui só pega PDFs cujo caminho casa; --exclui pula.
// Default de --exclui remove ruído que não é guia de pagamento (NF, certificado,
// termo de ausência) pra a taxa refletir guias de verdade.
const incluiPath = flag('--inclui');
const incluiRe = incluiPath ? new RegExp(incluiPath, 'i') : null;
const excluiPath = flag('--exclui') ?? 'nota fiscal|certificad|termo de aus|ausencia de mov|comprovante';
const excluiRe = excluiPath ? new RegExp(excluiPath, 'i') : null;
const limite = Number(flag('--limite') ?? 0) || 0;
const outCsv = flag('--out') ?? resolve(__dirname, 'output-analise-guias.csv');

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  return env;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function extrair(filePath: string, maxPaginas = 3): Promise<string> {
  try {
    const data = new Uint8Array(readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data, useWorker: false, disableWorker: true, verbosity: 0 }).promise;
    const limitePg = Math.min(doc.numPages, maxPaginas);
    const partes: string[] = [];
    for (let p = 1; p <= limitePg; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
    }
    return partes.join('\n');
  } catch { return ''; }
}

function walk(dir: string, acc: string[] = []): string[] {
  if (limite > 0 && acc.length >= limite) return acc; // early-stop: nao varre 297k
  // withFileTypes evita 1 statSync por entrada — crucial em drive de rede (T:),
  // onde cada statSync é uma ida-e-volta. Reduz a varredura de minutos pra segundos.
  let entries: Dirent[] = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (limite > 0 && acc.length >= limite) return acc;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (/[\\/]_/.test(full) && !/_PENDENTES/i.test(dirAlvo)) continue; // pula "_" salvo se foi o alvo
      walk(full, acc);
    } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
      if (filtroRe && !filtroRe.test(e.name)) continue;
      if (incluiRe && !incluiRe.test(full)) continue;
      if (excluiRe && excluiRe.test(full)) continue;
      acc.push(full);
    }
  }
  return acc;
}

async function main() {
const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('Carregando empresas + configs do banco...');
const { data: empresasRows } = await admin.from('empresas').select('*').is('desligada_em', null);
const empresas = (empresasRows ?? []) as Empresa[];
// Pagina os configs — PostgREST devolve no máximo 1000 por página. Sem isso, o
// desempate por código de receita não roda pras empresas além da 1000ª linha e
// infla "obrigacao_ambigua" falsamente.
type ConfigRow = { empresa_id: string; obrigacao: string; ativa: boolean; codigos: string[] | null; nao_envia_cliente: boolean; motivo: string | null };
const configRows: ConfigRow[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('empresa_obrigacoes_config')
    .select('empresa_id, obrigacao, ativa, codigos, nao_envia_cliente, motivo')
    .range(from, from + 999);
  if (error || !data || data.length === 0) break;
  configRows.push(...(data as ConfigRow[]));
  if (data.length < 1000) break;
}
const configsPorEmpresa = new Map<string, Map<string, ConfigObrigacao>>();
for (const r of (configRows ?? []) as Array<{ empresa_id: string; obrigacao: string; ativa: boolean; codigos: string[] | null; nao_envia_cliente: boolean; motivo: string | null }>) {
  if (!configsPorEmpresa.has(r.empresa_id)) configsPorEmpresa.set(r.empresa_id, new Map());
  configsPorEmpresa.get(r.empresa_id)!.set(r.obrigacao, {
    ativa: r.ativa,
    codigos: Array.isArray(r.codigos) ? r.codigos : [],
    naoEnviaCliente: r.nao_envia_cliente,
    motivo: r.motivo,
  });
}
console.log(`  ${empresas.length} empresas, ${configRows?.length ?? 0} configs.`);

let pdfs: string[] = [];
if (dirsFile) {
  const dirs = readFileSync(dirsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  console.log(`Varrendo ${dirs.length} pastas de ${dirsFile} ${filtro ? `(filtro nome ~ /${filtro}/i)` : ''}...`);
  for (const d of dirs) walk(d, pdfs);
} else {
  console.log(`Varrendo ${dirAlvo} ${filtro ? `(filtro nome ~ /${filtro}/i)` : ''}...`);
  pdfs = walk(dirAlvo);
}
if (limite > 0) pdfs = pdfs.slice(0, limite);
console.log(`  ${pdfs.length} PDFs a analisar.\n`);

type Linha = {
  arquivo: string;
  empresa: string;
  tipoMatch: string;
  obrigacao: string;
  resultado: string;
  detalhe: string;
};
const linhas: Linha[] = [];
const contagem: Record<string, number> = {};
const bump = (k: string) => { contagem[k] = (contagem[k] ?? 0) + 1; };

let i = 0;
for (const f of pdfs) {
  i++;
  if (i % 25 === 0) console.log(`  ... ${i}/${pdfs.length}`);
  const rel = f.startsWith(T_ROOT) ? f.slice(T_ROOT.length) : f;
  const texto = await extrair(f);
  if (!texto.trim()) {
    bump('pdf_ilegivel');
    linhas.push({ arquivo: rel, empresa: '', tipoMatch: '', obrigacao: '', resultado: 'pdf_ilegivel', detalhe: 'sem texto (imagem/escaneado)' });
    continue;
  }
  const norm = normalizar(texto);
  const ie = identificarEmpresa(texto, empresas);
  const empNome = ie.empresa ? (ie.empresa.apelido || ie.empresa.razao_social || ie.empresa.codigo || ie.empresa.id) : '';

  if (!ie.empresa) {
    const r = ie.ambiguo ? 'empresa_ambigua' : 'empresa_nao_identificada';
    bump(r);
    linhas.push({ arquivo: rel, empresa: '', tipoMatch: '', obrigacao: '', resultado: r, detalhe: (ie.candidatos ?? []).map((c) => c.nome).join('; ') });
    continue;
  }
  if (!ie.forte) {
    bump('empresa_match_fraco');
    linhas.push({ arquivo: rel, empresa: empNome ?? '', tipoMatch: 'nome', obrigacao: '', resultado: 'empresa_match_fraco', detalhe: '' });
    continue;
  }

  const configs = configsPorEmpresa.get(ie.empresa.id) ?? new Map<string, ConfigObrigacao>();
  const ro = identificarObrigacao(texto, ie.empresa, configs);
  const comp = competenciaDoPdf(texto) ?? '';
  const cidade = (ie.empresa.cidade ?? '').trim();
  const cidadeNoTexto = cidade ? norm.includes(normalizar(cidade)) : null;

  if (!ro.obrigacao) {
    const r = ro.ambiguo ? 'obrigacao_ambigua' : 'obrigacao_nao_identificada';
    bump(r);
    linhas.push({
      arquivo: rel, empresa: empNome ?? '', tipoMatch: ie.tipoMatch ?? '', obrigacao: '',
      resultado: r,
      detalhe: `cand=[${(ro.candidatos ?? []).join(', ')}] comp=${comp} cidade="${cidade}" cidadeNoTexto=${cidadeNoTexto}`,
    });
    continue;
  }

  bump('OK:' + ro.obrigacao);
  linhas.push({
    arquivo: rel, empresa: empNome ?? '', tipoMatch: ie.tipoMatch ?? '', obrigacao: ro.obrigacao,
    resultado: 'reconhecida', detalhe: `comp=${comp}`,
  });
}

// CSV
const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const header = 'arquivo,empresa,tipoMatch,obrigacao,resultado,detalhe';
const body = linhas.map((l) => [l.arquivo, l.empresa, l.tipoMatch, l.obrigacao, l.resultado, l.detalhe].map(esc).join(',')).join('\n');
writeFileSync(outCsv, header + '\n' + body, 'utf8');

console.log('\n===== RESUMO =====');
const ordenado = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ordenado) console.log(`  ${v.toString().padStart(4)}  ${k}`);
const total = linhas.length;
const okCount = ordenado.filter(([k]) => k.startsWith('OK:')).reduce((s, [, v]) => s + v, 0);
console.log(`\n  TOTAL: ${total} | reconhecidas: ${okCount} | falhas/pendencias: ${total - okCount}`);
console.log(`\nCSV completo: ${outCsv}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
