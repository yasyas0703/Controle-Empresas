// Backfill da Gestão de Certidões: re-lê os PDFs que já estão no Storage e
// preenche validade_em / numero_certidao / orgao_emissor / codigo_autenticidade
// / link_validacao (e emissao_em quando faltava). Reusa o MESMO parser da rota.
//
// Pré-requisito: supabase-migration-gestao-certidoes.sql já rodada.
// Uso:
//   npx tsx scripts/backfill-gestao-certidoes.ts             # DRY-RUN (taxas por tipo)
//   npx tsx scripts/backfill-gestao-certidoes.ts --apply
//   npx tsx scripts/backfill-gestao-certidoes.ts --limit 50  # testa em poucos
//   npx tsx scripts/backfill-gestao-certidoes.ts --force     # re-parseia mesmo com validade já preenchida

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { extrairDetalhesCertidao, emissaoDoTexto } from '../src/app/api/checklist-cadastro/auto-registrar/_detectar';
import type { CadastroCertidao } from '../src/app/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireCJS = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjsLib: any = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const LIMIT = (() => { const i = args.indexOf('--limit'); const n = i >= 0 ? Number(args[i + 1]) : NaN; return Number.isFinite(n) && n > 0 ? n : Infinity; })();

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}
const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('ERRO: env do Supabase faltando'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function extrairTexto(buf: Buffer, maxPaginas = 3): Promise<string> {
  try {
    const data = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data, useWorker: false, disableWorker: true, verbosity: 0 }).promise;
    const lim = Math.min(doc.numPages, maxPaginas);
    const partes: string[] = [];
    for (let p = 1; p <= lim; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
    }
    return partes.join('\n');
  } catch { return ''; }
}

interface Row {
  id: string; certidao: string; emissao_em: string | null; validade_em: string | null; arquivo_url: string | null;
}

void (async () => {
// ─── carrega as certidões com PDF ───────────────────────────────────────────────
const rows: Row[] = [];
{
  let off = 0;
  for (;;) {
    const { data, error } = await sb.from('checklist_cadastro')
      .select('id,certidao,emissao_em,validade_em,arquivo_url')
      .not('arquivo_url', 'is', null).range(off, off + 999);
    if (error) { console.error('Erro ao ler (rode a migration?):', error.message); process.exit(1); }
    rows.push(...(data as Row[])); if (!data || data.length < 1000) break; off += 1000;
  }
}
const alvo = rows.filter((r) => FORCE || !r.validade_em).slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Backfill Gestão de Certidões — modo ${APPLY ? 'APLICAR' : 'DRY-RUN'}${FORCE ? ' (force)' : ''}`);
console.log('═══════════════════════════════════════════════════════');
console.log(`  Certidões com PDF:     ${rows.length}`);
console.log(`  A processar:           ${alvo.length}${LIMIT !== Infinity ? ` (limit ${LIMIT})` : ''}`);

const porTipo: Record<string, { total: number; comValidade: number; comNumero: number; comCodigo: number }> = {};
let processados = 0, comValidade = 0, falhasDownload = 0, erros = 0, gravados = 0;

for (const r of alvo) {
  const tipo = r.certidao;
  porTipo[tipo] ??= { total: 0, comValidade: 0, comNumero: 0, comCodigo: 0 };
  porTipo[tipo].total++;
  try {
    const dl = await sb.storage.from('documentos').download(r.arquivo_url!);
    if (dl.error || !dl.data) { falhasDownload++; continue; }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const texto = await extrairTexto(buf);
    const emissao = r.emissao_em ?? emissaoDoTexto(texto);
    const det = extrairDetalhesCertidao(texto, tipo as CadastroCertidao, emissao);
    processados++;
    if (det.validadeEm) { comValidade++; porTipo[tipo].comValidade++; }
    if (det.numeroCertidao) porTipo[tipo].comNumero++;
    if (det.codigoAutenticidade) porTipo[tipo].comCodigo++;

    if (APPLY) {
      const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (det.validadeEm) patch.validade_em = det.validadeEm;
      if (det.numeroCertidao) patch.numero_certidao = det.numeroCertidao;
      if (det.orgaoEmissor) patch.orgao_emissor = det.orgaoEmissor;
      if (det.codigoAutenticidade) patch.codigo_autenticidade = det.codigoAutenticidade;
      if (det.linkValidacao) patch.link_validacao = det.linkValidacao;
      if (!r.emissao_em && emissao) patch.emissao_em = emissao;
      if (Object.keys(patch).length > 1) {
        const { error } = await sb.from('checklist_cadastro').update(patch).eq('id', r.id);
        if (error) { erros++; if (erros <= 3) console.error('  ! update:', error.message); } else gravados++;
      }
    }
    if (processados % 100 === 0) console.log(`  … ${processados}/${alvo.length} (validade em ${comValidade})`);
  } catch (e) { erros++; if (erros <= 3) console.error('  !', (e as Error).message); }
}

console.log('');
console.log(`  Processados:           ${processados}`);
console.log(`  Com validade extraída: ${comValidade} (${processados ? Math.round(100 * comValidade / processados) : 0}%)`);
console.log(`  Falhas de download:    ${falhasDownload}`);
console.log(`  Erros:                 ${erros}`);
if (APPLY) console.log(`  Linhas gravadas:       ${gravados}`);
console.log('  Taxa por tipo (validade/total · nº · código):');
for (const [t, s] of Object.entries(porTipo).sort()) {
  console.log(`    ${t.padEnd(14)} ${String(s.comValidade).padStart(3)}/${String(s.total).padStart(3)}  ·  nº ${s.comNumero}  ·  cód ${s.comCodigo}`);
}
if (!APPLY) console.log('\n  DRY-RUN. Rode com --apply pra gravar.');
})();
