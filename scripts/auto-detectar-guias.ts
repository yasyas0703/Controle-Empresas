/**
 * Auto-detecção de guias prontas em T:/Fiscal/EMPRESA.
 *
 * Lê o servidor de arquivos, identifica quais guias o pessoal já jogou na pasta
 * do mês (FECHAMENTO ou SIMPLES NACIONAL), valida cada uma com `validarGuia`,
 * e (opcional) envia automaticamente pelo Gmail do responsável fiscal.
 *
 * ATENÇÃO: SÓ LÊ do T:. Jamais grava, move ou apaga em T:.
 *
 * Uso:
 *   # MODO DRY-RUN (padrão) — só lista o que faria
 *   npx tsx scripts/auto-detectar-guias.ts
 *   npx tsx scripts/auto-detectar-guias.ts --mes 2026-05 --empresa "2GETHER"
 *
 *   # MODO ENVIAR — envia de verdade, mas com email de teste obrigatório
 *   # na 1ª vez (segurança: não vai pro cliente)
 *   npx tsx scripts/auto-detectar-guias.ts --enviar \
 *     --email-teste yasmin@triarcontabilidade.com.br \
 *     --empresa "2GETHER"
 *
 * Saída:
 *   scripts/output-auto-deteccao-<mes>.csv  → uma linha por arquivo detectado
 *   stdout                                  → resumo por status + log de envios
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

import { validarGuia } from '../src/app/utils/validarGuia';
import type { Empresa } from '../src/app/types';

const requireCJS = createRequire(import.meta.url);
const pdfjsLib = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = 'T:\\Fiscal\\EMPRESA';

// ─── Args ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
function bool(name: string): boolean {
  return argv.includes(name);
}
const mesAlvo = flag('--mes') ?? mesAnteriorAtual();
const empresaFiltro = flag('--empresa')?.toLowerCase() ?? null;
const limite = Number(flag('--limite') ?? 0) || 0;
const modoEnviar = bool('--enviar');
const emailTeste = flag('--email-teste') ?? null;
const remetenteOverride = flag('--remetente') ?? null; // email do user cujo Gmail será usado
const ignorarJaEnviado = bool('--ignorar-ja-enviado');
if (modoEnviar && !emailTeste) {
  console.error('❌ Modo --enviar exige --email-teste EMAIL (segurança).');
  console.error('   Ex: --enviar --email-teste yasmin@triarcontabilidade.com.br');
  process.exit(1);
}

function mesAnteriorAtual(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const [anoAlvo, mesNumAlvo] = mesAlvo.split('-');

// ─── env ──────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '..', '.env.local');
  const text = readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnv();
// Popula process.env pro googleOAuth.ts (que lê GOOGLE_CLIENT_ID, etc) funcionar
for (const [k, v] of Object.entries(env)) {
  if (!(k in process.env)) process.env[k] = v;
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function normalizar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bltda\b|\bme\b|\bs\.a\.?\b|\bsa\b|\beireli\b|\beirelli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tentarListar(dir: string): string[] | null {
  try { return readdirSync(dir); } catch { return null; }
}

function ehDiretorio(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

let pastasEmpresaCache: string[] | null = null;
function listarPastasEmpresa(): string[] {
  if (pastasEmpresaCache) return pastasEmpresaCache;
  try {
    pastasEmpresaCache = readdirSync(T_ROOT).filter((n) => ehDiretorio(join(T_ROOT, n)));
  } catch (err) {
    console.error(`❌ Falha ao listar ${T_ROOT}:`, (err as Error).message);
    process.exit(1);
  }
  return pastasEmpresaCache!;
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

function listarPdfsDe(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => join(dir, f));
  } catch { return []; }
}

/**
 * Os arquivos ficam direto em FECHAMENTO/<ANO>/ (sem subpasta de mês). O mês
 * está embutido no nome do arquivo, em vários formatos:
 *   "2026-04 IPI.pdf"   "042026 ICMS NORMAL (M).pdf"   "04-2026 PIS.pdf"
 *   "2026.04 ..."       "abril 2026 ..."               "abril/2026 ..."
 * Retorna true se o nome contém o mês/ano alvo.
 */
function arquivoEhDoMes(nome: string, ano: string, mes: string): boolean {
  const norm = nome.toLowerCase();
  // Formatos numéricos comuns
  if (norm.includes(`${ano}-${mes}`)) return true;
  if (norm.includes(`${mes}${ano}`)) return true;
  if (norm.includes(`${mes}-${ano}`)) return true;
  if (norm.includes(`${ano}.${mes}`)) return true;
  if (norm.includes(`${ano}_${mes}`)) return true;
  if (norm.includes(`${mes}.${ano}`)) return true;
  if (norm.includes(`${mes}/${ano}`)) return true;
  // Nome do mês por extenso (jan, fev, mar, abr, mai...)
  const nomes = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const ext = nomes[Number(mes)];
  if (ext && norm.includes(`${ext} ${ano}`)) return true;
  if (ext && norm.includes(`${ext}/${ano}`)) return true;
  if (ext && norm.includes(`${ext}-${ano}`)) return true;
  return false;
}

// ─── Detecção de obrigação pelo nome do arquivo ───────────────────────────
// Reusa as regras do descobrir-codigos-fiscal.mjs — ordem importa (mais
// específico antes). Detecta SN se vier da pasta SIMPLES NACIONAL.
const SEP = '[\\s_.-]+';
const REGRAS_NOME: Array<{ obrigacao: string; padroes: RegExp[] }> = [
  { obrigacao: 'ICMS TDD', padroes: [/icms[\s_.-]*(a[\s_.-]*recolher[\s_.-]*-?[\s_.-]*)?t[td]d\b/i, /icms[\s_.-]+tdd/i, /icms[\s_.-]+ttd/i] },
  { obrigacao: 'ICMS-ST/DIFAL', padroes: [/icms[\s_.-]+st(?!\s*entrad)/i, /icms-st/i, /substituicao[\s_.-]+tributaria/i] },
  { obrigacao: 'ICMS ANTECIPADO', padroes: [/icms[\s_.-]+ant(ecip)?/i] },
  { obrigacao: 'ST ANTECIPADO', padroes: [/icms[\s_.-]+st[\s_.-]+entrada/i, /\bst[\s_.-]+antecip/i] },
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
  { obrigacao: 'DIFERENCIAL DE ALIQUOTA', padroes: [/dif[\s_-]*aliq/i, /diferencial[\s_-]*(de[\s_-]*)?aliqu?ota/i] },
  { obrigacao: 'DIFAL', padroes: [/\bdifal\b/i] },
  { obrigacao: 'DAPI', padroes: [/\bdapi\b/i] },
  { obrigacao: 'GIA', padroes: [/\bgia[\s_-]*st\b/i, /^gia\b/i, /\bgia\.pdf$/i] },
  { obrigacao: 'DIME', padroes: [/\bdime\b/i] },
  { obrigacao: 'ISS - PRESTAÇÃO DE SERVIÇOS', padroes: [/iss.*prestad/i, /issqn.*prest/i] },
  { obrigacao: 'ISS - SERVIÇOS TOMADOS', padroes: [/iss.*tomad/i, /issqn.*tomad/i, /iss.*retid/i] },
  { obrigacao: 'SINTEGRA', padroes: [/\bsintegra\b/i] },
  { obrigacao: 'DESTDA', padroes: [/\bdestda\b/i, /\bdesfis\b/i] },
  { obrigacao: 'RECIBO DAS', padroes: [/recibo.*das\b/i, /pgdas/i, /declarac[aã]o(?!.*difal)(?!.*aliq)/i] },
  { obrigacao: 'EMISSÃO GUIA DAS', padroes: [/\bdas\b(?!.*recibo)/i] },
];

function detectarObrigacao(filename: string): string | null {
  const norm = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const regra of REGRAS_NOME) {
    if (regra.padroes.some((re) => re.test(norm))) return regra.obrigacao;
  }
  return null;
}

// ─── PDF text extraction ──────────────────────────────────────────────────
async function extrairTextoPdf(filePath: string, maxPaginas = 3): Promise<string> {
  try {
    const buffer = readFileSync(filePath);
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({
      data, useWorker: false, disableWorker: true, verbosity: 0,
    }).promise;
    const limite = Math.min(doc.numPages, maxPaginas);
    const partes: string[] = [];
    for (let p = 1; p <= limite; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
    }
    return partes.join('\n');
  } catch { return ''; }
}

// ─── Função de envio real (modo --enviar) ────────────────────────────────
function formatCompPt(mesIso: string): string {
  const [y, m] = mesIso.split('-');
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

function encodeRfc2047(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function buildMime(params: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  attachment: { filename: string; mime: string; content: Buffer };
}): string {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to.join(', ')}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join('\r\n');
  const bodyPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.bodyText, 'utf8').toString('base64'),
  ].join('\r\n');
  const b64 = params.attachment.content.toString('base64');
  const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
  const attPart = [
    `--${boundary}`,
    `Content-Type: ${params.attachment.mime}; name="${params.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${params.attachment.filename}"`,
    '',
    wrapped,
  ].join('\r\n');
  return [headers, '', bodyPart, '', attPart, '', `--${boundary}--`].join('\r\n');
}

async function enviarGuiaReal(args: {
  pdfBuffer: Buffer;
  arquivoNome: string;
  empresaId: string;
  empresaNome: string;
  obrigacao: string;
  /** ID do usuário cujo Gmail OAuth será usado pra mandar o email. */
  gmailUserId: string | null;
  /** ID do "autor" do envio (responsável fiscal da empresa) — vai no histórico. */
  autorId: string | null;
  autorNome: string;
  destinatarioOverride: string;
}): Promise<{ ok: true; envioId: string; enviadoPara: string[]; enviadoEm: string; gmailMessageId?: string } | { ok: false; erro: string }> {
  const { decryptToken, getOAuthClient } = await import('../src/lib/googleOAuth');

  if (!args.gmailUserId) {
    return { ok: false, erro: 'Nenhum usuário com Gmail conectado pra remetente.' };
  }

  // 1. Token Gmail do remetente
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('usuario_gmail_tokens')
    .select('email, refresh_token_enc, revoked')
    .eq('usuario_id', args.gmailUserId)
    .maybeSingle();
  if (tokenErr || !tokenRow || tokenRow.revoked) {
    return { ok: false, erro: 'Gmail do remetente não conectado ou revogado.' };
  }
  const refresh = decryptToken(tokenRow.refresh_token_enc);

  // 2. Upload no Storage Supabase
  const ext = (args.arquivoNome.split('.').pop() ?? 'pdf').toLowerCase();
  const obrSlug = args.obrigacao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'obrigacao';
  const storagePath = `empresas/${args.empresaId}/checklist/${mesAlvo}/${obrSlug}-${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('documentos').upload(storagePath, args.pdfBuffer, { upsert: false, contentType: 'application/pdf' });
  if (upErr) return { ok: false, erro: `Storage: ${upErr.message}` };

  // 3. Monta + envia email via Gmail OAuth do responsável
  const competenciaLabel = formatCompPt(mesAlvo);
  const subject = `[TESTE] ${args.obrigacao} — ${args.empresaNome} (${competenciaLabel})`;
  const bodyText =
    `[ENVIO AUTOMÁTICO DE TESTE — destinatário substituído]\n\n` +
    `Olá,\n\n` +
    `Segue em anexo o arquivo referente à obrigação ${args.obrigacao}, competência ${competenciaLabel}.\n\n` +
    `Qualquer dúvida, estamos à disposição.\n\nAtenciosamente.\n` +
    `(autor originalmente atribuído: ${args.autorNome})`;

  const envioId = randomUUID();
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refresh });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const mime = buildMime({
    from: tokenRow.email,
    to: [args.destinatarioOverride],
    subject,
    bodyText,
    attachment: { filename: args.arquivoNome, mime: 'application/pdf', content: args.pdfBuffer },
  });
  const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    const nowIso = new Date().toISOString();

    // 4. Marca checklist_fiscal como concluído + adiciona evento em envios_historico
    const { data: atual } = await supabase
      .from('checklist_fiscal')
      .select('envios_historico, observacao')
      .eq('empresa_id', args.empresaId).eq('mes', mesAlvo).eq('obrigacao', args.obrigacao)
      .maybeSingle();
    const enviosAnteriores = Array.isArray((atual as { envios_historico?: unknown })?.envios_historico)
      ? (atual as { envios_historico: unknown[] }).envios_historico
      : [];
    const novoEvento = {
      id: envioId,
      enviado_em: nowIso,
      enviado_por_id: args.autorId,
      enviado_por_nome: args.autorNome,
      remetente_email: tokenRow.email,
      destinatarios: [args.destinatarioOverride],
      arquivo_nome: args.arquivoNome,
      sucesso: true,
      erro: null,
      gmail_message_id: r.data.id ?? null,
      gmail_thread_id: r.data.threadId ?? null,
      entrega_status: 'pendente',
      entrega_verificada_em: null,
      bounce_motivo: null,
      bounce_destinatarios: null,
      aberto_em: null,
      aberto_em_ultimo: null,
      aberturas: 0,
      aberto_user_agent: null,
      aberto_ip: null,
    };
    await supabase.from('checklist_fiscal').upsert({
      empresa_id: args.empresaId,
      mes: mesAlvo,
      obrigacao: args.obrigacao,
      status: 'feito',
      concluido: true,
      concluido_em: nowIso,
      concluido_por_nome: args.autorNome,
      arquivo_url: storagePath,
      arquivo_nome: args.arquivoNome,
      envios_historico: [...enviosAnteriores, novoEvento],
      observacao: '[ENVIO AUTOMÁTICO via script auto-detectar-guias.ts]',
    }, { onConflict: 'empresa_id,mes,obrigacao' });

    return { ok: true, envioId, enviadoPara: [args.destinatarioOverride], enviadoEm: nowIso, gmailMessageId: r.data.id ?? undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha desconhecida';
    return { ok: false, erro: `Gmail: ${msg}` };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
type StatusDeteccao =
  | 'pronto_envio'
  | 'ja_enviado'
  | 'bloqueio_validacao'
  | 'sem_obrigacao'
  | 'sem_responsavel'
  | 'responsavel_sem_gmail'
  | 'pdf_ilegivel'
  | 'erro';

interface Resultado {
  empresaCodigo: string;
  empresaNome: string;
  pastaContexto: 'FECHAMENTO' | 'SIMPLES NACIONAL';
  arquivo: string;
  obrigacao: string | null;
  status: StatusDeteccao;
  detalhe: string;
  responsavelNome: string | null;
  responsavelTemGmail: boolean;
}

async function main() {
  console.log(`🔍 Auto-detecção V1 (dry-run) — mês alvo ${mesAlvo}\n`);

  // 1. Carrega dados do Supabase. Responsáveis vêm da tabela `responsaveis`
  // (relação N-N), não de uma coluna na `empresas`.
  console.log('📥 Carregando empresas, departamentos, responsáveis, gmail tokens, checklist...');
  const [empresasRes, deptsRes, respsRes, gmailRes, checklistRes, usuariosRes] = await Promise.all([
    supabase.from('empresas').select('id, codigo, razao_social, apelido, cnpj, estado, cidade, vencimentos_fiscais, inscricao_estadual, desligada_em'),
    supabase.from('departamentos').select('id, nome'),
    supabase.from('responsaveis').select('empresa_id, departamento_id, usuario_id'),
    supabase.from('usuario_gmail_tokens').select('usuario_id, email, revoked'),
    supabase.from('checklist_fiscal').select('empresa_id, obrigacao, concluido').eq('mes', mesAlvo),
    supabase.from('usuarios').select('id, nome'),
  ]);

  const firstErr = [empresasRes, deptsRes, respsRes, gmailRes, checklistRes, usuariosRes].find((r) => r.error);
  if (firstErr?.error) {
    console.error('❌ Falha ao carregar:', firstErr.error);
    process.exit(1);
  }

  const empresasRaw = (empresasRes.data ?? []) as Record<string, unknown>[];
  const depts = (deptsRes.data ?? []) as Array<{ id: string; nome: string }>;
  const resps = (respsRes.data ?? []) as Array<{ empresa_id: string; departamento_id: string; usuario_id: string | null }>;
  const gmailTokens = (gmailRes.data ?? []) as Array<{ usuario_id: string; email: string; revoked: boolean }>;
  const checklist = (checklistRes.data ?? []) as Array<{ empresa_id: string; obrigacao: string; concluido: boolean }>;
  const usuarios = (usuariosRes.data ?? []) as Array<{ id: string; nome: string }>;

  // Map empresa → { deptId → userId }
  const responsaveisPorEmpresa = new Map<string, Record<string, string | null>>();
  for (const r of resps) {
    const m = responsaveisPorEmpresa.get(r.empresa_id) ?? {};
    m[r.departamento_id] = r.usuario_id;
    responsaveisPorEmpresa.set(r.empresa_id, m);
  }

  const gmailMap = new Map<string, boolean>();
  for (const g of gmailTokens) gmailMap.set(g.usuario_id, !g.revoked);

  const usuarioNomeMap = new Map<string, string>();
  for (const u of usuarios) usuarioNomeMap.set(u.id, u.nome);

  const checklistFeito = new Set<string>();
  for (const c of checklist) {
    if (c.concluido) checklistFeito.add(`${c.empresa_id}|${c.obrigacao}`);
  }

  const fiscalDeptIds = new Set<string>();
  for (const d of depts) {
    if (d.nome.toLowerCase().includes('fiscal')) fiscalDeptIds.add(d.id);
  }

  // Injeta responsaveis em cada empresa pra simplificar o uso abaixo
  for (const e of empresasRaw) {
    e.responsaveis = responsaveisPorEmpresa.get(String(e.id)) ?? {};
  }

  const empresas = empresasRaw
    .filter((e) => !e.desligada_em)
    .filter((e) => {
      const cnpj = String(e.cnpj ?? '').replace(/\D/g, '');
      return cnpj.length === 14;
    })
    .filter((e) => {
      const resp = (e.responsaveis ?? {}) as Record<string, string | null>;
      return [...fiscalDeptIds].some((d) => resp[d]);
    });

  // Se foi passado --remetente EMAIL, busca o usuario_id correspondente.
  // Esse ID sobrescreve o "responsavelId" na hora de enviar (Gmail OAuth
  // sai dessa conta) MAS o histórico continua creditando o responsável da
  // empresa como autor do envio.
  let remetenteUserId: string | null = null;
  let remetenteUserNome: string | null = null;
  if (remetenteOverride) {
    const { data: u } = await supabase
      .from('usuarios')
      .select('id, nome')
      .eq('email', remetenteOverride)
      .maybeSingle();
    if (!u) {
      console.error(`❌ Usuário com email ${remetenteOverride} não encontrado.`);
      process.exit(1);
    }
    remetenteUserId = (u as { id: string }).id;
    remetenteUserNome = (u as { nome: string }).nome;
    if (!gmailMap.get(remetenteUserId)) {
      console.error(`❌ ${remetenteOverride} não conectou o Gmail. Conecte primeiro na página de Obrigações.`);
      process.exit(1);
    }
    console.log(`📨 Remetente override: ${remetenteOverride} (${remetenteUserNome})`);
  }

  console.log(`✅ ${empresas.length} empresas com responsável fiscal e CNPJ válido.`);

  // 2. Pra cada empresa, escaneia pasta T:
  const resultados: Resultado[] = [];
  let processadas = 0;

  for (const e of empresas) {
    if (limite && processadas >= limite) break;
    const razao = String(e.razao_social ?? '');
    const apelido = String(e.apelido ?? '');
    const codigo = String(e.codigo ?? '');

    if (empresaFiltro) {
      const hay = `${codigo} ${razao} ${apelido}`.toLowerCase();
      if (!hay.includes(empresaFiltro)) continue;
    }

    const pastaEmpresa = acharPastaEmpresa(razao, apelido);
    if (!pastaEmpresa) continue;
    processadas++;

    const resp = (e.responsaveis ?? {}) as Record<string, string | null>;
    let responsavelId: string | null = null;
    for (const deptId of fiscalDeptIds) {
      if (resp[deptId]) { responsavelId = resp[deptId]; break; }
    }
    // Se tem --remetente override, considera Gmail OK independente do responsável
    const respGmail = remetenteUserId ? true : (responsavelId ? (gmailMap.get(responsavelId) ?? false) : false);

    const responsavelNome: string | null = responsavelId ? (usuarioNomeMap.get(responsavelId) ?? null) : null;

    // Escaneia FECHAMENTO/<ano>/ e SIMPLES NACIONAL/<ano>/ — os arquivos ficam
    // diretamente nessa pasta, com o mês embutido no NOME do arquivo (não em
    // subpasta). Filtramos por arquivoEhDoMes().
    const contextos: Array<{ nome: 'FECHAMENTO' | 'SIMPLES NACIONAL'; subpasta: string }> = [
      { nome: 'FECHAMENTO', subpasta: 'FECHAMENTO' },
      { nome: 'SIMPLES NACIONAL', subpasta: 'SIMPLES NACIONAL' },
    ];

    for (const ctx of contextos) {
      const pasta = join(T_ROOT, pastaEmpresa, ctx.subpasta, anoAlvo);
      const todosPdfs = listarPdfsDe(pasta);
      const pdfs = todosPdfs.filter((p) => {
        const nome = p.split(/[\\/]/).pop()!;
        return arquivoEhDoMes(nome, anoAlvo, mesNumAlvo);
      });
      if (pdfs.length === 0) continue;

      for (const pdfPath of pdfs) {
        const arquivo = pdfPath.split(/[\\/]/).pop()!;
        const obrigacao = detectarObrigacao(arquivo);

        const baseRow: Resultado = {
          empresaCodigo: codigo,
          empresaNome: razao || apelido,
          pastaContexto: ctx.nome,
          arquivo,
          obrigacao,
          status: 'erro',
          detalhe: '',
          responsavelNome,
          responsavelTemGmail: respGmail,
        };

        if (!obrigacao) {
          baseRow.status = 'sem_obrigacao';
          baseRow.detalhe = 'Não identificou tipo pelo nome';
          resultados.push(baseRow);
          continue;
        }

        if (checklistFeito.has(`${e.id}|${obrigacao}`) && !ignorarJaEnviado) {
          baseRow.status = 'ja_enviado';
          baseRow.detalhe = 'Checklist já marcado como concluído';
          resultados.push(baseRow);
          continue;
        }

        if (!responsavelId) {
          baseRow.status = 'sem_responsavel';
          baseRow.detalhe = 'Empresa sem responsável fiscal cadastrado';
          resultados.push(baseRow);
          continue;
        }
        if (!respGmail) {
          baseRow.status = 'responsavel_sem_gmail';
          baseRow.detalhe = `Responsável (${responsavelNome ?? '?'}) não conectou Gmail`;
          resultados.push(baseRow);
          continue;
        }

        // Extrai texto + valida
        const texto = await extrairTextoPdf(pdfPath);
        if (!texto) {
          baseRow.status = 'pdf_ilegivel';
          baseRow.detalhe = 'PDF não retornou texto (imagem/scan?)';
          resultados.push(baseRow);
          continue;
        }

        // Monta um Empresa parcial pro validador
        const empresaParcial = {
          ...e,
          vencimentosFiscais: Array.isArray(e.vencimentos_fiscais) ? e.vencimentos_fiscais : [],
        } as unknown as Empresa;

        const r = validarGuia(texto, empresaParcial, obrigacao);
        const bloqueios = r.problemas.filter((p) => p.severidade === 'bloqueio');
        if (bloqueios.length > 0) {
          baseRow.status = 'bloqueio_validacao';
          baseRow.detalhe = bloqueios.map((b) => b.motivo).join('; ');
          resultados.push(baseRow);
          continue;
        }

        baseRow.status = 'pronto_envio';
        baseRow.detalhe = `Válido (perfil ${r.perfilUsado ?? '?'})`;
        resultados.push(baseRow);
      }
    }
  }

  // 3. Salva CSV
  const csvPath = resolve(__dirname, `output-auto-deteccao-${mesAlvo}.csv`);
  const header = ['codigo', 'empresa', 'contexto', 'arquivo', 'obrigacao', 'status', 'detalhe', 'responsavel', 'gmail_conectado'].join(',');
  const linhasCsv = [header];
  for (const r of resultados) {
    linhasCsv.push([
      `"${r.empresaCodigo}"`,
      `"${(r.empresaNome ?? '').replace(/"/g, "''")}"`,
      r.pastaContexto,
      `"${r.arquivo.replace(/"/g, "''")}"`,
      r.obrigacao ?? '',
      r.status,
      `"${(r.detalhe ?? '').replace(/"/g, "''")}"`,
      `"${(r.responsavelNome ?? '').replace(/"/g, "''")}"`,
      r.responsavelTemGmail ? 'sim' : 'nao',
    ].join(','));
  }
  writeFileSync(csvPath, linhasCsv.join('\n'), 'utf8');
  console.log(`\n💾 CSV salvo em ${csvPath}\n`);

  // 4. Resumo
  const porStatus = new Map<StatusDeteccao, number>();
  for (const r of resultados) porStatus.set(r.status, (porStatus.get(r.status) ?? 0) + 1);
  console.log('📊 Resumo por status:\n');
  const ordem: Array<{ k: StatusDeteccao; emoji: string; label: string }> = [
    { k: 'pronto_envio', emoji: '🟢', label: 'Pronto pra enviar (válido + responsável c/ Gmail)' },
    { k: 'ja_enviado', emoji: '✅', label: 'Já enviado anteriormente' },
    { k: 'bloqueio_validacao', emoji: '🔴', label: 'PDF NÃO confere com a empresa/obrigação' },
    { k: 'responsavel_sem_gmail', emoji: '📵', label: 'Responsável sem Gmail conectado' },
    { k: 'sem_responsavel', emoji: '👤', label: 'Empresa sem responsável fiscal' },
    { k: 'sem_obrigacao', emoji: '❓', label: 'Tipo não identificado pelo nome' },
    { k: 'pdf_ilegivel', emoji: '📄', label: 'PDF ilegível (imagem/scan)' },
    { k: 'erro', emoji: '⚠️ ', label: 'Erro' },
  ];
  for (const o of ordem) {
    const c = porStatus.get(o.k) ?? 0;
    if (c > 0) console.log(`   ${o.emoji} ${c.toString().padStart(4)}  ${o.label}`);
  }

  // 5. Mostra prontos pra enviar (preview)
  const prontos = resultados.filter((r) => r.status === 'pronto_envio');
  if (prontos.length > 0) {
    console.log(`\n🟢 Prontos pra enviar (${prontos.length}):\n`);
    for (const p of prontos.slice(0, 20)) {
      console.log(`   • ${p.empresaCodigo.padEnd(6)} ${p.empresaNome.padEnd(40).slice(0, 40)} → ${p.obrigacao} (${p.arquivo})`);
    }
    if (prontos.length > 20) console.log(`   ... e mais ${prontos.length - 20}.`);
  }

  // 6. Modo --enviar: envia DE VERDADE pra emailTeste, marca checklist como feito
  if (modoEnviar && prontos.length > 0) {
    console.log(`\n📤 MODO ENVIAR ATIVO — destinatário: ${emailTeste}`);
    console.log(`   ${prontos.length} guia(s) serão enviadas. Iniciando...\n`);
    let sucessos = 0, falhas = 0;
    for (const p of prontos) {
      const empresa = empresas.find((e) => String(e.codigo) === p.empresaCodigo)!;
      const responsavelId = (() => {
        const resp = (empresa.responsaveis ?? {}) as Record<string, string | null>;
        for (const d of fiscalDeptIds) if (resp[d]) return resp[d] as string;
        return null;
      })();
      if (!responsavelId) { console.log(`   ⚠️  ${p.empresaCodigo} → sem responsável (pulado)`); continue; }

      // Reconstrói caminho do PDF
      const pastaEmpresa = acharPastaEmpresa(String(empresa.razao_social), String(empresa.apelido));
      if (!pastaEmpresa) continue;
      const subpasta = p.pastaContexto === 'FECHAMENTO' ? 'FECHAMENTO' : 'SIMPLES NACIONAL';
      const pdfPath = join(T_ROOT, pastaEmpresa, subpasta, anoAlvo, p.arquivo);
      if (!existsSync(pdfPath)) { console.log(`   ⚠️  ${p.empresaCodigo} → arquivo sumiu (${pdfPath})`); falhas++; continue; }
      const pdfBuffer = readFileSync(pdfPath);

      // remetente: --remetente override OU responsável da empresa.
      // O "autor" no histórico continua sendo o responsável da empresa.
      const remetenteEnvioId = remetenteUserId ?? responsavelId;
      const res = await enviarGuiaReal({
        pdfBuffer,
        arquivoNome: p.arquivo,
        empresaId: String(empresa.id),
        empresaNome: p.empresaNome,
        obrigacao: p.obrigacao!,
        gmailUserId: remetenteEnvioId,
        autorId: responsavelId,
        autorNome: p.responsavelNome ?? remetenteUserNome ?? 'sistema',
        destinatarioOverride: emailTeste!,
      });
      if (res.ok) {
        sucessos++;
        console.log(`   ✅ ${p.empresaCodigo} → ${p.obrigacao} enviado (${res.gmailMessageId ?? '?'})`);
      } else {
        falhas++;
        console.log(`   ❌ ${p.empresaCodigo} → ${p.obrigacao} FALHOU: ${res.erro}`);
      }
    }
    console.log(`\n📤 Envios: ${sucessos} sucesso(s), ${falhas} falha(s).`);
  }

  if (!modoEnviar) {
    console.log('\n💡 Pra enviar de verdade (com email de teste):');
    console.log(`   npx tsx scripts/auto-detectar-guias.ts --enviar --email-teste SEU_EMAIL --empresa "2GETHER"`);
  }

  console.log('\n✅ Pronto.');
}

main().catch((err) => {
  console.error('💥 Erro:', err);
  process.exit(1);
});
