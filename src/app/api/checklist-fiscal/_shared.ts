// Helpers compartilhados entre as rotas de envio (enviar-anexo, enviar-multiplos-anexos).
// Centraliza autenticação, permissão, rate limit, guard de envio duplicado e
// validação de PDF no servidor — defesa em profundidade contra burlar o front.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { validarGuia, type ResultadoValidacao } from '@/app/utils/validarGuia';
import { FISCAL_DEPT_NOME, FISCAL_SN_DEPT_NOME, type Empresa } from '@/app/types';

// ─── Tipos de retorno ───────────────────────────────────────────────────────
export interface ErroApi {
  error: string;
  status: number;
  /** Código machine-readable pra frontend distinguir tipos de erro. */
  code?: 'duplicado' | 'rate_limit' | 'permissao' | 'validacao_pdf';
  /** Dados extras (ex: data do envio anterior, código duplicado). */
  meta?: Record<string, unknown>;
}

export function isErroApi(x: unknown): x is ErroApi {
  return typeof x === 'object' && x !== null && 'error' in x && 'status' in x;
}

// ─── Auth ───────────────────────────────────────────────────────────────────
export async function autenticarRequest(req: Request): Promise<{ userId: string } | ErroApi> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { error: 'Supabase não configurado', status: 500 };
  }
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  const m = header?.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return { error: 'Sessão ausente', status: 401 };
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { error: 'Sessão expirada', status: 401 };
  return { userId: data.user.id };
}

// ─── Permissão ──────────────────────────────────────────────────────────────
/**
 * Confere que o usuário tem direito de enviar guias dessa empresa.
 *   - admin/gerente → permite tudo
 *   - usuario comum → só se for responsável fiscal (ou fiscal-SN) da empresa
 *
 * Retorna ErroApi com status 403 se negar.
 */
export async function assertPodeEnviar(
  admin: SupabaseClient,
  userId: string,
  empresaId: string,
): Promise<{ ok: true } | ErroApi> {
  const [userRes, deptsRes, empresaRes] = await Promise.all([
    admin.from('usuarios').select('id, role').eq('id', userId).maybeSingle(),
    admin.from('departamentos').select('id, nome'),
    admin.from('empresas').select('responsaveis').eq('id', empresaId).maybeSingle(),
  ]);
  if (userRes.error || !userRes.data) {
    return { error: 'Usuário não encontrado.', status: 401 };
  }
  const role = (userRes.data as { role?: string }).role;
  if (role === 'admin' || role === 'gerente') return { ok: true };

  if (empresaRes.error || !empresaRes.data) {
    return { error: 'Empresa não encontrada.', status: 404 };
  }
  const responsaveis = ((empresaRes.data as { responsaveis?: Record<string, string | null> }).responsaveis) ?? {};
  const depts = (deptsRes.data ?? []) as Array<{ id: string; nome: string }>;
  const fiscalDeptIds = new Set<string>();
  for (const d of depts) {
    const nome = d.nome.toLowerCase().trim();
    if (nome === FISCAL_DEPT_NOME || nome === FISCAL_SN_DEPT_NOME || nome.includes('fiscal')) {
      fiscalDeptIds.add(d.id);
    }
  }
  for (const deptId of fiscalDeptIds) {
    if (responsaveis[deptId] === userId) return { ok: true };
  }
  return {
    error: 'Você não é responsável fiscal dessa empresa. Apenas o responsável (ou gerente/admin) pode enviar guias.',
    status: 403,
    code: 'permissao',
  };
}

// ─── Rate limit ─────────────────────────────────────────────────────────────
const RATE_LIMIT_MAX = 30;       // envios
const RATE_LIMIT_WINDOW_SEC = 60; // por minuto

/**
 * Limita a 30 envios por usuário por minuto. Gmail tem hard limit de 500/dia,
 * e disparos em rajada (script malicioso, bug em loop) podem bloquear a conta
 * do escritório inteiro. Esse cap é generoso pro uso normal (mês inteiro em
 * lote leva ~15min) mas trava abuso.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | ErroApi> {
  const desde = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
  const { count, error } = await admin
    .from('envios_rate_limit')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', userId)
    .gte('criado_em', desde);
  if (error) {
    // Falha de banco no rate limit não deveria bloquear envio (best-effort).
    console.error('[rate_limit] falha ao contar:', error);
    return { ok: true };
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return {
      error: `Você fez ${count} envios em ${RATE_LIMIT_WINDOW_SEC}s. Aguarde um minuto e tente novamente (limite ${RATE_LIMIT_MAX}/min).`,
      status: 429,
      code: 'rate_limit',
    };
  }
  // Registra o envio (best-effort — se falhar, não trava)
  await admin.from('envios_rate_limit').insert({ usuario_id: userId }).then(
    () => undefined,
    (err) => console.error('[rate_limit] falha ao inserir:', err),
  );
  return { ok: true };
}

// Limites defensivos do AUTO-ENVIO — protegem a quota de ~500/dia do Gmail da
// conta ghost contra um watcher em loop. Diferente do checkRateLimit por-usuário:
// chave FIXA = ghost (o único remetente automático), DB-backed (compartilhado
// entre instâncias serverless) e com DUAS janelas. NÃO usar IP: X-Forwarded-For
// é forjável (rotacionar zera o contador) e o Map em memória do lib/rateLimit não
// é global no serverless — ambos derrotavam o limite anterior.
const AUTO_ENVIO_LIM_MIN = 20;
const AUTO_ENVIO_LIM_HORA = 300;

export async function checkAutoEnvioRateLimit(
  admin: SupabaseClient,
  ghostUserId: string,
): Promise<{ ok: true } | ErroApi> {
  const agora = Date.now();
  const contarDesde = async (janelaSec: number): Promise<number | null> => {
    const desde = new Date(agora - janelaSec * 1000).toISOString();
    const { count, error } = await admin
      .from('envios_rate_limit')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', ghostUserId)
      .gte('criado_em', desde);
    if (error) {
      // Falha de banco no rate limit não deve bloquear envio (best-effort).
      console.error('[auto-envio rate_limit] falha ao contar:', error);
      return null;
    }
    return count ?? 0;
  };

  const noMinuto = await contarDesde(60);
  if (noMinuto !== null && noMinuto >= AUTO_ENVIO_LIM_MIN) {
    return {
      error: 'Muitas requisições no último minuto. Watcher pode estar em loop.',
      status: 429,
      code: 'rate_limit',
    };
  }
  const naHora = await contarDesde(3600);
  if (naHora !== null && naHora >= AUTO_ENVIO_LIM_HORA) {
    return {
      error: 'Muitas requisições na última hora. Quota diária do Gmail em risco.',
      status: 429,
      code: 'rate_limit',
    };
  }

  // Registra a tentativa (best-effort — se falhar, não trava o envio)
  await admin.from('envios_rate_limit').insert({ usuario_id: ghostUserId }).then(
    () => undefined,
    (err) => console.error('[auto-envio rate_limit] falha ao inserir:', err),
  );
  return { ok: true };
}

// ─── Guard de envio duplicado ───────────────────────────────────────────────
/**
 * Checa se já houve um envio com sucesso pra essa empresa+mês+obrigação.
 * Retorna info do envio anterior, ou null se não há duplicado.
 *
 * Frontend deve perguntar "confirmar reenvio?" se houver duplicado e
 * reenviar com `confirmarReenvio=true` no payload.
 */
export async function buscarEnvioAnterior(
  admin: SupabaseClient,
  empresaId: string,
  mes: string,
  obrigacao: string,
): Promise<null | { enviadoEm: string; enviadoPorNome: string | null; destinatarios: string[] }> {
  const { data } = await admin
    .from('checklist_fiscal')
    .select('envios_historico')
    .eq('empresa_id', empresaId)
    .eq('mes', mes)
    .eq('obrigacao', obrigacao)
    .maybeSingle();
  if (!data) return null;
  const envios = ((data as { envios_historico?: unknown[] | null }).envios_historico ?? []) as Array<{
    sucesso?: boolean;
    enviado_em?: string;
    enviado_por_nome?: string | null;
    destinatarios?: string[];
  }>;
  // Pega o último envio com sucesso
  const sucessos = envios.filter((e) => e.sucesso === true);
  if (sucessos.length === 0) return null;
  const ultimo = sucessos[sucessos.length - 1];
  return {
    enviadoEm: ultimo.enviado_em ?? '',
    enviadoPorNome: ultimo.enviado_por_nome ?? null,
    destinatarios: Array.isArray(ultimo.destinatarios) ? ultimo.destinatarios : [],
  };
}

// ─── Validação de PDF no servidor ───────────────────────────────────────────
type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: Uint8Array; useWorker?: boolean; disableWorker?: boolean; verbosity?: number }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
    }>;
  };
};

let pdfjsCache: PdfjsLib | null = null;
function loadPdfjs(): PdfjsLib {
  if (pdfjsCache) return pdfjsCache;
  const requireCJS = createRequire(import.meta.url);
  const lib = requireCJS('pdfjs-dist/build/pdf.js') as PdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = '';
  pdfjsCache = lib;
  return lib;
}

/**
 * Checa os 4 primeiros bytes do buffer pra confirmar que é um PDF de
 * verdade: `%PDF` (0x25, 0x50, 0x44, 0x46). Defesa contra arquivos
 * renomeados (`.exe` → `.pdf`, `.html` → `.pdf`) que poderiam burlar
 * a validação caindo no fallback "PDF não-legível" do pdfjs.
 *
 * PDFs reais SEMPRE começam com %PDF (especificação ISO 32000-1).
 * PDFs scaneados, criptografados ou corrompidos também têm o magic
 * byte — só falham depois, na extração de texto.
 */
function temAssinaturaPdf(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

export async function extrairTextoPdfServidor(buffer: Buffer, maxPaginas = 3): Promise<string> {
  const pdfjs = loadPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data, useWorker: false, disableWorker: true, verbosity: 0,
  }).promise;
  const limite = Math.min(doc.numPages, maxPaginas);
  const partes: string[] = [];
  for (let p = 1; p <= limite; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    partes.push(content.items.map((i) => i.str ?? '').join(' '));
  }
  return partes.join('\n');
}

/**
 * Reaplica `validarGuia()` no servidor pro PDF anexado. Defesa em profundidade:
 * o front já valida, mas DevTools permite burlar — o servidor tem que reconfirmar.
 *
 * Retorna ErroApi se houver bloqueio (a menos que `forcarEnvio=true` E o usuário
 * seja admin/gerente). Avisos/info nunca bloqueiam.
 */
export async function validarPdfNoServidor(opts: {
  buffer: Buffer;
  empresa: Empresa;
  obrigacao: string;
  codigosEsperados: string[];
  forcarEnvio: boolean;
  motivoForcar?: string;
  podeForcar: boolean;
}): Promise<{ ok: true; resultado: ResultadoValidacao } | ErroApi> {
  // Magic-byte check ANTES de tentar pdfjs. Sem isso, um arquivo .exe
  // renomeado .pdf cairia no catch abaixo (pdfjs falha em parse) e o
  // fallback aceitaria como "PDF não-legível" — guia mentirosa indo
  // pro cliente. Magic-byte é a primeira barreira de defesa.
  if (!temAssinaturaPdf(opts.buffer)) {
    return {
      error: 'O arquivo enviado não é um PDF válido (assinatura %PDF ausente).',
      status: 422,
      code: 'validacao_pdf',
      meta: {
        bloqueios: [{
          motivo: 'Arquivo não é PDF',
          detalhe: 'Os primeiros bytes do arquivo não correspondem ao formato PDF. Pode ser um arquivo renomeado (.exe, .html, .zip) ou um upload corrompido.',
        }],
        perfilUsado: null,
      },
    };
  }

  let texto = '';
  try {
    texto = await extrairTextoPdfServidor(opts.buffer);
  } catch (err) {
    console.error('[validar_pdf] falha ao extrair texto:', err);
    // PDF ilegível (imagem scaneada, criptografado) — não bloqueia mas registra aviso.
    // Esse caminho só é atingido por PDFs reais (magic-byte ok) que pdfjs não
    // consegue parsear — scanned, password-protected, ou versão muito antiga.
    return {
      ok: true,
      resultado: {
        valido: true,
        problemas: [{ severidade: 'aviso', motivo: 'PDF não-legível no servidor', detalhe: 'O servidor não conseguiu extrair texto; pulou validação reaplicada.' }],
        detectado: { cnpjEncontrado: null, denominacaoEncontrada: null, codigoReceitaEncontrado: null, cidadeEncontrada: null, competencia: null, vencimento: null, valor: null },
        perfilUsado: null,
      },
    };
  }
  const resultado = validarGuia(texto, opts.empresa, opts.obrigacao, opts.codigosEsperados);
  const bloqueios = resultado.problemas.filter((p) => p.severidade === 'bloqueio');
  if (bloqueios.length === 0) return { ok: true, resultado };

  // Bloqueios encontrados — verifica se pode forçar
  if (opts.forcarEnvio && opts.podeForcar && (opts.motivoForcar?.trim().length ?? 0) >= 10) {
    return { ok: true, resultado };
  }
  return {
    error: `PDF não confere com a empresa/obrigação: ${bloqueios.map((b) => b.motivo).join('; ')}.`,
    status: 422,
    code: 'validacao_pdf',
    meta: {
      bloqueios: bloqueios.map((b) => ({ motivo: b.motivo, detalhe: b.detalhe })),
      perfilUsado: resultado.perfilUsado,
    },
  };
}

// ─── Empresa completa pra validação ─────────────────────────────────────────
/**
 * Carrega empresa com os campos necessários pra rebuild parcial do tipo Empresa
 * (suficiente pra `validarGuia` + montagem de email). O banco usa snake_case;
 * convertemos pro shape do tipo Empresa onde necessário (ex: vencimentosFiscais).
 */
export async function carregarEmpresaCompleta(
  admin: SupabaseClient,
  empresaId: string,
): Promise<Empresa | ErroApi> {
  const { data, error } = await admin
    .from('empresas')
    .select('*')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) return { error: 'Erro ao consultar empresa.', status: 500 };
  if (!data) return { error: 'Empresa não encontrada.', status: 404 };
  const row = data as Record<string, unknown>;
  // Mapeia só os campos que o endpoint usa (resto fica como Partial<Empresa>).
  const empresa = {
    ...row,
    vencimentosFiscais: Array.isArray(row.vencimentos_fiscais) ? row.vencimentos_fiscais : [],
  } as unknown as Empresa;
  return empresa;
}

// ─── Util: re-export admin ──────────────────────────────────────────────────
export { getSupabaseAdmin };
