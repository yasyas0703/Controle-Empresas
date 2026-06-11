/**
 * Sincroniza as obrigações do sistema com o que EXISTE nas pastas do T:.
 *
 * Pra cada empresa cadastrada, varre a pasta dela em T:\Fiscal\EMPRESA:
 *   - FECHAMENTO/<ano>/        → guias detectadas pelo nome do arquivo
 *   - SIMPLES NACIONAL/<ano>/  → guias do Simples (DAS, etc.)
 *   - pastas soltas            → SINTEGRA, DESTDA, DAPI, DIME, GIA, REINF,
 *                                LIVROS FISCAIS, SPED (EFD-FISCAL/CONTRIBUIÇÕES/REINF), ISS
 *
 * Ano considerado: 2026 (se a pasta não tem NADA de 2026, cai pra 2025).
 * Pastas soltas contam se têm qualquer arquivo de 2025/2026.
 *
 * Com o conjunto "encontrado" de cada empresa:
 *   - ENVIO  (empresa_obrigacoes_config):     ativa=true nas encontradas,
 *     ativa=false nas demais do universo (só atualiza linha que JÁ existe e está ativa —
 *     sem linha o auto-envio já bloqueia por 'obrigacao_nao_configurada').
 *   - CHECKLIST (empresa_obrigacoes_habilitadas): habilitada=true nas encontradas,
 *     habilitada=false nas que apareceriam no grid (regra/override) mas NÃO estão na pasta.
 *     Só grava o delta — não cria override onde a regra já resolve.
 *     COM VIGÊNCIA: vale do mês da execução em diante; meses anteriores mantêm
 *     a visão antiga (pedido da Yasmin 2026-06-11 — junho muda, maio não).
 *
 * DEMONSTR. APURAÇÃO fica fora (sem sinal confiável nas pastas — não mexe).
 *
 * ATENÇÃO: SÓ LÊ do T:. Jamais grava, move ou apaga em T:.
 *
 * Uso:
 *   npx tsx scripts/sincronizar-obrigacoes-pastas.ts                 # dry-run (só relatório)
 *   npx tsx scripts/sincronizar-obrigacoes-pastas.ts --aplicar      # grava no banco
 *   npx tsx scripts/sincronizar-obrigacoes-pastas.ts --empresa "2GETHER"
 *
 * Saída: scripts/output-sincronizacao-pastas.csv (uma linha por ação por empresa).
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

import {
  obrigacaoAplicaParaEmpresa,
  obrigacaoSnAplicaParaEmpresa,
} from '../src/app/utils/regrasVencimentosFiscais';
import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES } from '../src/app/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = 'T:\\Fiscal\\EMPRESA';

// Usuário "Testes" (admin@triarcontabilidade.com.br) — autora das alterações no audit.
const AUDIT_USER_ID = '0dd329df-3ce7-403b-9bee-2768c33686a3';
const AUDIT_NOME = 'Testes (varredura pastas T:)';

const ANO_PREFERIDO = '2026';
const ANO_FALLBACK = '2025';
const ANOS_RECENTES = ['2025', '2026'];

// ─── Args ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const filtroIdx = argv.indexOf('--empresa');
const empresaFiltro = filtroIdx >= 0 && argv[filtroIdx + 1] ? argv[filtroIdx + 1].toLowerCase() : null;

// ─── env / supabase ───────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ─── Universo de obrigações gerenciadas por esta varredura ────────────────
// DEMONSTR. APURAÇÃO fora: não há pasta/arquivo padrão que indique a tarefa.
const UNIVERSO = new Set<string>([
  ...VENCIMENTOS_FISCAIS_NOMES.filter((n) => n !== 'DEMONSTR. APURAÇÃO'),
  ...VENCIMENTOS_FISCAIS_SN_NOMES,
]);

// ─── Detecção de obrigação pelo nome do arquivo ───────────────────────────
// Base: regras do auto-detectar-guias.ts, com nomes mapeados pros canônicos
// de types.ts (GIA→GIA-ST, DIFAL→DIFERENCIAL DE ALIQUOTA, declaração→DECLARAÇÃO DAS).
const SEP = '[\\s_.-]+';
const REGRAS_NOME: Array<{ obrigacao: string; padroes: RegExp[] }> = [
  { obrigacao: 'ICMS TDD', padroes: [/icms[\s_.-]*(a[\s_.-]*recolher[\s_.-]*-?[\s_.-]*)?t[td]d\b/i, /icms[\s_.-]+tdd/i, /icms[\s_.-]+ttd/i] },
  { obrigacao: 'ICMS-ST', padroes: [/icms[\s_.-]+st(?!\s*entrad)/i, /icms-st/i, /substituicao[\s_.-]+tributaria/i] },
  { obrigacao: 'ST ANTECIPADO', padroes: [/icms[\s_.-]+st[\s_.-]+entrada/i, /\bst[\s_.-]+antecip/i] },
  { obrigacao: 'ICMS ANTECIPADO', padroes: [/icms[\s_.-]+ant(ecip)?/i] },
  { obrigacao: 'ICMS NORMAL', padroes: [
    /icms[\s_.-]+normal/i,
    /icms[\s_.-]+a[\s_.-]+recolher(?!.*tdd)(?!.*ttd)(?!.*st)/i,
    new RegExp(`(?:^|[\\s_.-])icms\\b(?!.*tdd)(?!.*ttd)(?!.*\\bst\\b)(?!.*ant)(?!.*difal)(?!.*\\(m\\))(?!.*comercio${SEP}td)`, 'i'),
  ] },
  { obrigacao: 'IPI', padroes: [new RegExp(`(?:^|[\\s_.-])ipi(?!\\s*fiscal)(?!\\s*-?2)(?!.*\\(m\\))`, 'i')] },
  { obrigacao: 'PIS', padroes: [/\bpis\b/i] },
  { obrigacao: 'COFINS', padroes: [/\bcofins\b/i] },
  { obrigacao: 'IRPJ', padroes: [/\birpj\b/i] },
  { obrigacao: 'CSLL', padroes: [/\bcsll\b/i] },
  { obrigacao: 'REINF', padroes: [/\breinf\b/i, /r-?2099/i, /r2055/i] },
  { obrigacao: 'DARF-SERVIÇOS TOMADOS', padroes: [/darf.*serv.*tomad/i, /\birrf\b/i] },
  { obrigacao: 'DIFERENCIAL DE ALIQUOTA', padroes: [/dif[\s_-]*aliq/i, /diferencial[\s_-]*(de[\s_-]*)?aliqu?ota/i, /\bdifal\b/i] },
  { obrigacao: 'DAPI', padroes: [/\bdapi\b/i] },
  { obrigacao: 'GIA-ST', padroes: [/\bgia[\s_-]*st\b/i, /^gia\b/i, /\bgia\.pdf$/i] },
  { obrigacao: 'DIME', padroes: [/\bdime\b/i] },
  { obrigacao: 'ISS - PRESTAÇÃO DE SERVIÇOS', padroes: [/iss.*prestad/i, /issqn.*prest/i] },
  { obrigacao: 'ISS - SERVIÇOS TOMADOS', padroes: [/iss.*tomad/i, /issqn.*tomad/i, /iss.*retid/i] },
  { obrigacao: 'SINTEGRA', padroes: [/\bsintegra\b/i] },
  { obrigacao: 'DESTDA', padroes: [/\bdestda\b/i, /\bdesfis\b/i] },
  { obrigacao: 'DECLARAÇÃO DAS', padroes: [/declarac[aã]o(?!.*difal)(?!.*aliq)/i] },
  { obrigacao: 'RECIBO DAS', padroes: [/recibo.*das\b/i, /pgdas/i] },
  { obrigacao: 'EMISSÃO GUIA DAS', padroes: [/\bdas\b(?!.*recibo)/i] },
];

function detectarObrigacao(filename: string): string | null {
  const norm = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const regra of REGRAS_NOME) {
    if (regra.padroes.some((re) => re.test(norm))) return regra.obrigacao;
  }
  return null;
}

// ─── Helpers de filesystem (SÓ LEITURA) ───────────────────────────────────
function normalizar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bltda\b|\bme\b|\bs\.a\.?\b|\bsa\b|\beireli\b|\beirelli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ehDiretorio(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function listar(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

let pastasEmpresaCache: string[] | null = null;
function listarPastasEmpresa(): string[] {
  if (pastasEmpresaCache) return pastasEmpresaCache;
  pastasEmpresaCache = readdirSync(T_ROOT).filter((n) => ehDiretorio(join(T_ROOT, n)));
  return pastasEmpresaCache;
}

function acharPastaEmpresa(razaoSocial?: string | null, apelido?: string | null): string | null {
  const pastas = listarPastasEmpresa();
  const cands = [razaoSocial, apelido].filter(Boolean).map((s) => normalizar(s as string));
  for (const cand of cands) {
    const p = pastas.find((pa) => normalizar(pa) === cand);
    if (p) return p;
  }
  for (const cand of cands) {
    const p = pastas.find((pa) => normalizar(pa).startsWith(cand));
    if (p) return p;
  }
  for (const cand of cands) {
    const p = pastas.find((pa) => cand.startsWith(normalizar(pa)) && normalizar(pa).length >= 8);
    if (p) return p;
  }
  return null;
}

/** true se a pasta tem algum ARQUIVO de 2025/2026 (nome próprio ou de pasta-ancestral), até 3 níveis. */
function temArquivoRecente(dir: string, profundidade = 3, herdouAno = false): boolean {
  if (profundidade < 0) return false;
  for (const nome of listar(dir)) {
    const caminho = join(dir, nome);
    const nomeTemAno = ANOS_RECENTES.some((a) => nome.includes(a));
    if (ehDiretorio(caminho)) {
      if (temArquivoRecente(caminho, profundidade - 1, herdouAno || nomeTemAno)) return true;
    } else if (herdouAno || nomeTemAno) {
      return true;
    }
  }
  return false;
}

/**
 * Junta os PDFs de um contexto (FECHAMENTO ou SIMPLES NACIONAL): arquivos na
 * raiz do contexto + dentro de subpastas de ano. Cada arquivo é etiquetado com
 * o ano (do nome do arquivo, senão da subpasta). Usa 2026; se não há NADA de
 * 2026, cai pra 2025.
 */
function pdfsDoContexto(ctxDir: string): string[] {
  if (!existsSync(ctxDir)) return [];
  const porAno = new Map<string, string[]>();
  const registrar = (nomeArquivo: string, anoPasta: string | null) => {
    if (!nomeArquivo.toLowerCase().endsWith('.pdf')) return;
    const mAno = nomeArquivo.match(/20\d{2}/);
    const ano = mAno ? mAno[0] : anoPasta;
    if (!ano) return;
    if (!porAno.has(ano)) porAno.set(ano, []);
    porAno.get(ano)!.push(nomeArquivo);
  };
  for (const nome of listar(ctxDir)) {
    const caminho = join(ctxDir, nome);
    if (ehDiretorio(caminho)) {
      const mAnoPasta = nome.match(/20\d{2}/);
      for (const arq of listar(caminho)) {
        if (!ehDiretorio(join(caminho, arq))) registrar(arq, mAnoPasta ? mAnoPasta[0] : null);
      }
    } else {
      registrar(nome, null);
    }
  }
  return porAno.get(ANO_PREFERIDO) ?? porAno.get(ANO_FALLBACK) ?? [];
}

interface Evidencia { obrigacao: string; fonte: string }

/** Varre a pasta da empresa e devolve as obrigações encontradas + evidências. */
function varrerEmpresa(pastaEmpresa: string): { encontradas: Map<string, string>; temEstrutura: boolean } {
  const raiz = join(T_ROOT, pastaEmpresa);
  const encontradas = new Map<string, string>(); // obrigacao → fonte (primeira evidência)
  const add = (ev: Evidencia) => {
    if (UNIVERSO.has(ev.obrigacao) && !encontradas.has(ev.obrigacao)) encontradas.set(ev.obrigacao, ev.fonte);
  };

  const subpastas = listar(raiz).filter((n) => ehDiretorio(join(raiz, n)));
  const normMap = new Map(subpastas.map((n) => [normalizar(n), n]));
  const acharSub = (pred: (norm: string) => boolean): string | null => {
    for (const [norm, original] of normMap) if (pred(norm)) return original;
    return null;
  };

  let temEstrutura = false;

  // 1. Contextos com guias: FECHAMENTO e SIMPLES NACIONAL
  for (const ctxNome of ['fechamento', 'simples']) {
    const sub = acharSub((n) => ctxNome === 'fechamento' ? n === 'fechamento' : n.startsWith('simples'));
    if (!sub) continue;
    temEstrutura = true;
    for (const arq of pdfsDoContexto(join(raiz, sub))) {
      const obr = detectarObrigacao(arq);
      if (obr) add({ obrigacao: obr, fonte: `${sub}/${arq}` });
    }
  }

  // 2. Pastas soltas que são tarefas (contam se têm arquivo de 2025/2026)
  const soltas: Array<{ pred: (n: string) => boolean; obrigacao: string }> = [
    { pred: (n) => n === 'sintegra', obrigacao: 'SINTEGRA' },
    { pred: (n) => n === 'destda' || n === 'desfis', obrigacao: 'DESTDA' },
    { pred: (n) => n === 'dapi', obrigacao: 'DAPI' },
    { pred: (n) => n === 'dime', obrigacao: 'DIME' },
    { pred: (n) => n === 'gia' || n === 'gia st', obrigacao: 'GIA-ST' },
    { pred: (n) => n === 'reinf' || n === 'efd reinf', obrigacao: 'REINF' },
    { pred: (n) => n === 'livros fiscais' || n === 'livro fiscal' || n === 'livros', obrigacao: 'LIVROS FISCAIS' },
  ];
  for (const { pred, obrigacao } of soltas) {
    const sub = acharSub(pred);
    if (!sub) continue;
    temEstrutura = true;
    if (temArquivoRecente(join(raiz, sub))) add({ obrigacao, fonte: `pasta ${sub}/` });
  }

  // 3. SPED: subpastas EFD-FISCAL / EFD-CONTRIBUIÇÕES / EFD-REINF
  const spedSub = acharSub((n) => n === 'sped');
  if (spedSub) {
    temEstrutura = true;
    const spedDir = join(raiz, spedSub);
    for (const efd of listar(spedDir).filter((n) => ehDiretorio(join(spedDir, n)))) {
      const nn = normalizar(efd);
      if (!temArquivoRecente(join(spedDir, efd))) continue;
      if (nn.includes('contribu')) add({ obrigacao: 'SPED CONTRIBUIÇÕES', fonte: `${spedSub}/${efd}/` });
      else if (nn.includes('fiscal') || nn.includes('icms')) add({ obrigacao: 'SPED ICMS/IPI', fonte: `${spedSub}/${efd}/` });
      else if (nn.includes('reinf')) add({ obrigacao: 'REINF', fonte: `${spedSub}/${efd}/` });
    }
  }

  // 4. Pasta ISS solta: decide prestação/tomados pelos nomes de arquivo
  const issSub = acharSub((n) => n === 'iss' || n === 'issqn');
  if (issSub) {
    temEstrutura = true;
    const issDir = join(raiz, issSub);
    const arquivos: string[] = [];
    for (const nome of listar(issDir)) {
      const caminho = join(issDir, nome);
      if (ehDiretorio(caminho)) arquivos.push(...listar(caminho));
      else arquivos.push(nome);
    }
    for (const arq of arquivos) {
      if (!ANOS_RECENTES.some((a) => arq.includes(a))) continue;
      const obr = detectarObrigacao(arq);
      if (obr) add({ obrigacao: obr, fonte: `${issSub}/${arq}` });
    }
  }

  return { encontradas, temEstrutura };
}

// ─── Tipos de linha do banco ──────────────────────────────────────────────
interface EmpresaRow {
  id: string; codigo: string | null; razao_social: string | null; apelido: string | null;
  estado: string | null; cidade: string | null; desligada_em: string | null; cadastrada: boolean | null;
}
interface ConfigRow { empresa_id: string; obrigacao: string; ativa: boolean }
interface OverrideRow { empresa_id: string; obrigacao: string; habilitada: boolean }

async function paginar<T>(tabela: string, colunas: string): Promise<T[]> {
  const PAGE = 1000;
  const todas: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const lote = (data ?? []) as T[];
    todas.push(...lote);
    if (lote.length < PAGE) break;
    offset += PAGE;
    if (offset > 100_000) break;
  }
  return todas;
}

/** A obrigação apareceria no grid pela regra automática (qualquer aba)? */
function aplicaPorRegra(nome: string, e: EmpresaRow): boolean {
  const fiscal = (VENCIMENTOS_FISCAIS_NOMES as readonly string[]).includes(nome)
    && obrigacaoAplicaParaEmpresa(nome, e.estado, e.cidade);
  const sn = (VENCIMENTOS_FISCAIS_SN_NOMES as readonly string[]).includes(nome)
    && obrigacaoSnAplicaParaEmpresa(nome, e.estado, e.cidade);
  return fiscal || sn;
}

// ─── Main ─────────────────────────────────────────────────────────────────
interface Acao {
  empresaId: string; codigo: string; empresa: string; pasta: string;
  obrigacao: string; acao: 'envio_on' | 'envio_off' | 'checklist_on' | 'checklist_off';
  fonte: string;
}

async function main() {
  console.log(`Sincronização pastas T: → sistema ${APLICAR ? '(APLICAR)' : '(dry-run)'}\n`);

  let empresas: EmpresaRow[];
  try {
    empresas = await paginar<EmpresaRow>('empresas', 'id, codigo, razao_social, apelido, estado, cidade, desligada_em, cadastrada');
  } catch {
    // coluna cadastrada pode não existir em algum ambiente
    empresas = (await paginar<Omit<EmpresaRow, 'cadastrada'>>('empresas', 'id, codigo, razao_social, apelido, estado, cidade, desligada_em'))
      .map((e) => ({ ...e, cadastrada: true }));
  }
  const configs = await paginar<ConfigRow>('empresa_obrigacoes_config', 'empresa_id, obrigacao, ativa');
  const overrides = await paginar<OverrideRow>('empresa_obrigacoes_habilitadas', 'empresa_id, obrigacao, habilitada');

  const cfgMap = new Map<string, ConfigRow>();
  for (const c of configs) cfgMap.set(`${c.empresa_id}|${c.obrigacao}`, c);
  const ovMap = new Map<string, boolean>();
  for (const o of overrides) ovMap.set(`${o.empresa_id}|${o.obrigacao}`, o.habilitada);

  const ativas = empresas.filter((e) => !e.desligada_em && e.cadastrada !== false);
  console.log(`${empresas.length} empresas no banco; ${ativas.length} ativas/cadastradas.`);

  const acoes: Acao[] = [];
  const semPasta: string[] = [];
  const semEstrutura: string[] = [];
  const vazias: string[] = [];
  let comPasta = 0;

  for (const e of ativas) {
    const rotulo = `${e.codigo ?? '?'} ${e.razao_social ?? e.apelido ?? ''}`.trim();
    if (empresaFiltro) {
      const hay = `${e.codigo} ${e.razao_social} ${e.apelido}`.toLowerCase();
      if (!hay.includes(empresaFiltro)) continue;
    }
    const pasta = acharPastaEmpresa(e.razao_social, e.apelido);
    if (!pasta) { semPasta.push(rotulo); continue; }
    comPasta++;

    const { encontradas, temEstrutura } = varrerEmpresa(pasta);
    if (!temEstrutura) { semEstrutura.push(`${rotulo} → ${pasta}`); continue; }
    if (encontradas.size === 0) vazias.push(`${rotulo} → ${pasta}`);

    for (const [obrigacao, fonte] of encontradas) {
      // ENVIO: liga se não há linha ou se está inativa
      const cfg = cfgMap.get(`${e.id}|${obrigacao}`);
      if (!cfg || !cfg.ativa) {
        acoes.push({ empresaId: e.id, codigo: e.codigo ?? '', empresa: rotulo, pasta, obrigacao, acao: 'envio_on', fonte });
      }
      // CHECKLIST: garante habilitada (só se o estado efetivo atual não é true)
      const ov = ovMap.get(`${e.id}|${obrigacao}`);
      const efetivo = typeof ov === 'boolean' ? ov : aplicaPorRegra(obrigacao, e);
      if (!efetivo) {
        acoes.push({ empresaId: e.id, codigo: e.codigo ?? '', empresa: rotulo, pasta, obrigacao, acao: 'checklist_on', fonte });
      }
    }

    for (const obrigacao of UNIVERSO) {
      if (encontradas.has(obrigacao)) continue;
      // ENVIO: só desativa linha que JÁ existe e está ativa
      const cfg = cfgMap.get(`${e.id}|${obrigacao}`);
      if (cfg?.ativa) {
        acoes.push({ empresaId: e.id, codigo: e.codigo ?? '', empresa: rotulo, pasta, obrigacao, acao: 'envio_off', fonte: 'não está na pasta' });
      }
      // CHECKLIST: desabilita se hoje aparece no grid (override true ou regra true)
      const ov = ovMap.get(`${e.id}|${obrigacao}`);
      const efetivo = typeof ov === 'boolean' ? ov : aplicaPorRegra(obrigacao, e);
      if (efetivo) {
        acoes.push({ empresaId: e.id, codigo: e.codigo ?? '', empresa: rotulo, pasta, obrigacao, acao: 'checklist_off', fonte: 'não está na pasta' });
      }
    }
  }

  // ── Relatório CSV ──
  const csvPath = resolve(__dirname, 'output-sincronizacao-pastas.csv');
  const linhas = ['codigo,empresa,pasta,obrigacao,acao,fonte'];
  for (const a of acoes) {
    linhas.push([
      `"${a.codigo}"`, `"${a.empresa.replace(/"/g, "''")}"`, `"${a.pasta.replace(/"/g, "''")}"`,
      `"${a.obrigacao}"`, a.acao, `"${a.fonte.replace(/"/g, "''")}"`,
    ].join(','));
  }
  writeFileSync(csvPath, linhas.join('\n'), 'utf8');

  const conta = (tipo: Acao['acao']) => acoes.filter((a) => a.acao === tipo).length;
  console.log(`\nEmpresas com pasta no T:: ${comPasta}`);
  console.log(`Sem pasta correspondente: ${semPasta.length}`);
  console.log(`Pasta sem estrutura fiscal (puladas): ${semEstrutura.length}`);
  console.log(`Pasta com estrutura mas SEM guia detectada: ${vazias.length}`);
  console.log(`\nAções:`);
  console.log(`  envio_on      ${conta('envio_on')}`);
  console.log(`  envio_off     ${conta('envio_off')}`);
  console.log(`  checklist_on  ${conta('checklist_on')}`);
  console.log(`  checklist_off ${conta('checklist_off')}`);
  console.log(`\nDetalhe: ${csvPath}`);

  if (semPasta.length) console.log(`\nSem pasta (${semPasta.length}):\n  ` + semPasta.slice(0, 40).join('\n  ') + (semPasta.length > 40 ? `\n  ... +${semPasta.length - 40}` : ''));
  if (semEstrutura.length) console.log(`\nSem estrutura (${semEstrutura.length}):\n  ` + semEstrutura.slice(0, 40).join('\n  ') + (semEstrutura.length > 40 ? `\n  ... +${semEstrutura.length - 40}` : ''));
  if (vazias.length) console.log(`\nCom estrutura mas sem guia detectada (${vazias.length}):\n  ` + vazias.slice(0, 40).join('\n  ') + (vazias.length > 40 ? `\n  ... +${vazias.length - 40}` : ''));

  if (!APLICAR) {
    console.log('\nDry-run — nada gravado. Rode com --aplicar pra executar.');
    return;
  }

  // ── Aplicar ──
  const agora = new Date().toISOString();

  // Rede do escritório oscila — retry com backoff em toda escrita (idempotentes).
  async function comRetry<T extends { error: { message: string } | null }>(
    rotulo: string, fn: () => PromiseLike<T>, tentativas = 4,
  ): Promise<void> {
    for (let t = 1; t <= tentativas; t++) {
      try {
        const { error } = await fn();
        if (!error) return;
        if (t === tentativas) throw new Error(`${rotulo}: ${error.message}`);
      } catch (err) {
        if (t === tentativas) throw err instanceof Error ? err : new Error(`${rotulo}: ${String(err)}`);
      }
      await new Promise((r) => setTimeout(r, 1500 * t));
    }
  }

  // ENVIO on: upsert ativa=true SEM tocar codigos/nao_envia_cliente de linha existente.
  // Linha existente → UPDATE só de ativa+audit; linha nova → INSERT com defaults.
  const envioOn = acoes.filter((a) => a.acao === 'envio_on');
  const envioOnNovas = envioOn.filter((a) => !cfgMap.has(`${a.empresaId}|${a.obrigacao}`));
  const envioOnExistentes = envioOn.filter((a) => cfgMap.has(`${a.empresaId}|${a.obrigacao}`));
  for (let i = 0; i < envioOnNovas.length; i += 100) {
    const lote = envioOnNovas.slice(i, i + 100).map((a) => ({
      empresa_id: a.empresaId, obrigacao: a.obrigacao, ativa: true,
      motivo: null, codigos: [], nao_envia_cliente: false,
      alterada_em: agora, alterada_por_id: AUDIT_USER_ID, alterada_por_nome: AUDIT_NOME,
    }));
    await comRetry(`envio_on insert lote ${i}`, () =>
      supabase.from('empresa_obrigacoes_config').upsert(lote, { onConflict: 'empresa_id,obrigacao' }));
    console.log(`  envio_on novas: ${Math.min(i + 100, envioOnNovas.length)}/${envioOnNovas.length}`);
  }
  for (let i = 0; i < envioOnExistentes.length; i++) {
    const a = envioOnExistentes[i];
    await comRetry(`envio_on update ${a.codigo} ${a.obrigacao}`, () =>
      supabase.from('empresa_obrigacoes_config')
        .update({ ativa: true, alterada_em: agora, alterada_por_id: AUDIT_USER_ID, alterada_por_nome: AUDIT_NOME })
        .eq('empresa_id', a.empresaId).eq('obrigacao', a.obrigacao));
  }
  console.log(`\nenvio_on aplicado (${envioOnNovas.length} novas, ${envioOnExistentes.length} reativadas).`);

  // ENVIO off: UPDATE ativa=false (linha já existe, preserva o resto)
  const envioOff = acoes.filter((a) => a.acao === 'envio_off');
  for (const a of envioOff) {
    await comRetry(`envio_off ${a.codigo} ${a.obrigacao}`, () =>
      supabase.from('empresa_obrigacoes_config')
        .update({ ativa: false, alterada_em: agora, alterada_por_id: AUDIT_USER_ID, alterada_por_nome: AUDIT_NOME })
        .eq('empresa_id', a.empresaId).eq('obrigacao', a.obrigacao));
  }
  console.log(`envio_off aplicado (${envioOff.length}).`);

  // CHECKLIST on/off: upsert overrides COM VIGÊNCIA — o valor novo vale do mês
  // atual em diante; meses anteriores mantêm o estado de antes da varredura
  // (habilitada_antes = oposto, porque o script só grava DELTAS que invertem o
  // estado efetivo). Requer a migration supabase-migration-habilitacao-vigencia.sql.
  const vigencia = agora.slice(0, 7); // YYYY-MM do mês da execução
  const habs = acoes.filter((a) => a.acao === 'checklist_on' || a.acao === 'checklist_off');
  for (let i = 0; i < habs.length; i += 100) {
    const lote = habs.slice(i, i + 100).map((a) => ({
      empresa_id: a.empresaId, obrigacao: a.obrigacao,
      habilitada: a.acao === 'checklist_on',
      habilitada_por_id: AUDIT_USER_ID, habilitada_por_nome: AUDIT_NOME, habilitada_em: agora,
      vigente_desde: vigencia,
      habilitada_antes: a.acao === 'checklist_off',
    }));
    await comRetry(`checklist on/off lote ${i}`, () =>
      supabase.from('empresa_obrigacoes_habilitadas').upsert(lote, { onConflict: 'empresa_id,obrigacao' }));
    if ((i / 100) % 10 === 0) console.log(`  checklist: ${Math.min(i + 100, habs.length)}/${habs.length}`);
  }
  console.log(`checklist on/off aplicado (${habs.length}, vigente de ${vigencia} em diante).`);

  console.log('\nPronto.');
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
