import type { SupabaseClient } from '@supabase/supabase-js';
import { FISCAL_DEPT_NOME, FISCAL_SN_DEPT_NOME } from '@/app/types';

// ============================================================================
//  Alertas do auto-envio (Fase 1 — rede de segurança)
// ----------------------------------------------------------------------------
//  Helpers compartilhados entre:
//   - /api/checklist-fiscal/auto-enviar (alerta no sino quando uma guia trava)
//   - /api/cron/alertar-pendencias-auto (resumo por email + heartbeat)
//
//  Tudo roda server-side com o client service-role (bypassa RLS).
// ============================================================================

/** Rótulo legível pra cada tipo de problema (pra mensagem do sino/email). */
export const LABEL_TIPO_PROBLEMA: Record<string, string> = {
  pdf_ilegivel: 'PDF ilegível (imagem/escaneado)',
  empresa_nao_identificada: 'Empresa não identificada no PDF',
  empresa_ambigua: 'Mais de uma empresa no PDF (ambíguo)',
  empresa_match_fraco: 'Empresa identificada só pelo nome (sem CNPJ/IE)',
  obrigacao_nao_identificada: 'Tipo de guia não reconhecido',
  obrigacao_ambigua: 'Tipo de guia ambíguo',
  competencia_nao_identificada: 'Competência (mês) não identificada',
  competencia_futura: 'Competência no futuro',
  competencia_antiga: 'Competência muito antiga (precisa aprovação)',
  obrigacao_nao_configurada: 'Obrigação não configurada pra empresa',
  obrigacao_inativa: 'Obrigação inativa pra empresa',
  codigo_receita_divergente: 'Código de receita não bate com o cadastro',
  validacao_falhou: 'PDF não passou na validação',
  sem_emails: 'Empresa sem email de cliente cadastrado',
  gmail_nao_conectado: 'Gmail do sistema desconectado',
  gmail_send_failed: 'Falha ao enviar pelo Gmail',
  storage_upload_failed: 'Falha ao subir o arquivo',
  erro: 'Erro inesperado no processamento',
  // Detectados pelo WATCHER (local, antes de chegar na API) e reportados via heartbeat:
  pdf_invalido_local: 'PDF inválido/cortado (não enviado)',
  arquivo_preso_entrada: 'Arquivo parado na pasta de entrada',
};

/**
 * Tipos que BLOQUEIAM o envio de verdade (não é só "preciso revisar"): a guia
 * não chega no cliente. Viram severidade 'erro' no sino e destaque no email.
 */
const TIPOS_BLOQUEIO = new Set([
  'sem_emails',
  'gmail_nao_conectado',
  'gmail_send_failed',
  'storage_upload_failed',
  'validacao_falhou',
  'erro',
  'pdf_invalido_local',
  'arquivo_preso_entrada',
  'codigo_receita_divergente',
]);

export function rotuloTipoProblema(tipo: string): string {
  return LABEL_TIPO_PROBLEMA[tipo] ?? tipo;
}

/** Rótulos dos problemas do watcher de CERTIDÕES (cadastro). */
export const LABEL_TIPO_PROBLEMA_CADASTRO: Record<string, string> = {
  empresa_nao_encontrada: 'Empresa não reconhecida no PDF',
  empresa_ambigua: 'Mais de uma empresa casou com o PDF (ambíguo)',
  certidao_desconhecida: 'Tipo de certidão não reconhecido',
  resultado_indefinido: 'Resultado (negativa/positiva) não identificado',
  nome_fora_padrao: 'Nome do arquivo fora do padrão',
  erro: 'Erro inesperado no processamento',
};

export function rotuloProblemaCadastro(tipo: string): string {
  return LABEL_TIPO_PROBLEMA_CADASTRO[tipo] ?? tipo;
}

export function severidadeDoProblema(tipo: string): 'erro' | 'aviso' {
  return TIPOS_BLOQUEIO.has(tipo) ? 'erro' : 'aviso';
}

type DeptoRow = { id: string; nome: string };
type UsuarioRow = {
  id: string;
  nome: string | null;
  email: string | null;
  role: string;
  departamento_id: string | null;
  departamentos_extras_ids: string[] | null;
  ativo: boolean;
};

/** Acha os ids dos departamentos Fiscal e Fiscal-SN pelo nome. */
function acharDeptosFiscais(deptos: DeptoRow[]): string[] {
  const fiscal = deptos.find((d) => d.nome.trim().toLowerCase() === FISCAL_DEPT_NOME)
    ?? deptos.find((d) => {
      const n = d.nome.trim().toLowerCase();
      return n.includes('fiscal') && !n.includes('sn');
    });
  const fiscalSn = deptos.find((d) => d.nome.trim().toLowerCase() === FISCAL_SN_DEPT_NOME);
  return [fiscal?.id, fiscalSn?.id].filter((v): v is string => !!v);
}

// ⚠️ MODO TESTE (PROVISÓRIO — remover quando a usuária terminar de testar):
// enquanto o auto-envio está em teste, TODOS os alertas (sino + email) vão SÓ
// pra esta usuária, pra não spammar a equipe. Coloque `null` pra voltar ao
// normal (admins + gerentes do Fiscal + responsável da empresa).
// Aponta pro usuário "Testes" (admin@triarcontabilidade.com.br) — é nele que a
// Yasmin fica logada durante os testes (pedido dela em 2026-06-11; antes
// apontava pro usuário Yasmin e os avisos caíam na caixa errada).
const ALERTA_TESTE_SOMENTE_USER_ID: string | null = '0dd329df-3ce7-403b-9bee-2768c33686a3'; // Testes (admin@)

/**
 * Quem deve receber o alerta de uma guia travada:
 *   - responsável fiscal da empresa (quando há empresaId e responsável setado);
 *   - gerentes/admins lotados no Fiscal (principal ou extras).
 * Fallback: se ninguém casar, todos os admins ativos — pra alerta nunca sumir.
 * Retorna a lista de usuários (id, nome, email) já deduplicada e ativa.
 */
export async function resolverDestinatariosFiscais(
  admin: SupabaseClient,
  empresaId: string | null,
): Promise<UsuarioRow[]> {
  // MODO TESTE: manda só pra usuária de teste (ver constante no topo).
  if (ALERTA_TESTE_SOMENTE_USER_ID) {
    const { data } = await admin
      .from('usuarios')
      .select('id, nome, email, role, departamento_id, departamentos_extras_ids, ativo')
      .eq('id', ALERTA_TESTE_SOMENTE_USER_ID)
      .maybeSingle();
    return data ? [data as UsuarioRow] : [];
  }

  const [{ data: deptosData }, { data: usuariosData }] = await Promise.all([
    admin.from('departamentos').select('id, nome'),
    admin.from('usuarios').select('id, nome, email, role, departamento_id, departamentos_extras_ids, ativo'),
  ]);
  const deptos = (deptosData ?? []) as DeptoRow[];
  const usuarios = (usuariosData ?? []) as UsuarioRow[];
  const fiscalDeptIds = acharDeptosFiscais(deptos);

  const porId = new Map<string, UsuarioRow>();

  // Admins recebem TODOS os alertas de guia travada (gerenciam o sistema /
  // operam o auto-envio). Gerentes só se forem do Fiscal/Fiscal-SN.
  // (Antes só ia pra quem era do Fiscal — admin SEM departamento, como quem
  // opera o auto-envio, ficava de fora e não era avisado de nada.)
  for (const u of usuarios) {
    if (!u.ativo) continue;
    if (u.role === 'admin') { porId.set(u.id, u); continue; }
    if (u.role !== 'gerente') continue;
    const deptosU = new Set(
      [u.departamento_id, ...(u.departamentos_extras_ids ?? [])].filter((v): v is string => !!v),
    );
    if (fiscalDeptIds.some((id) => deptosU.has(id))) porId.set(u.id, u);
  }

  // Responsável fiscal da empresa específica
  if (empresaId && fiscalDeptIds.length) {
    const { data: respData } = await admin
      .from('responsaveis')
      .select('departamento_id, usuario_id')
      .eq('empresa_id', empresaId)
      .in('departamento_id', fiscalDeptIds);
    for (const r of (respData ?? []) as Array<{ departamento_id: string; usuario_id: string | null }>) {
      if (!r.usuario_id) continue;
      const u = usuarios.find((x) => x.id === r.usuario_id && x.ativo);
      if (u) porId.set(u.id, u);
    }
  }

  // Fallback: nunca deixar o alerta sem destinatário.
  if (porId.size === 0) {
    for (const u of usuarios) {
      if (u.ativo && u.role === 'admin') porId.set(u.id, u);
    }
  }

  return [...porId.values()];
}

/** Acha os ids do departamento Cadastro pelo nome (normalizado). */
function acharDeptosCadastro(deptos: DeptoRow[]): string[] {
  const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return deptos.filter((d) => { const n = norm(d.nome); return n === 'cadastro' || n === 'cadastros'; }).map((d) => d.id);
}

/**
 * Quem recebe o alerta de uma certidão não-processada: as MENINAS do Cadastro —
 * todos os usuários ativos do depto Cadastro (principal ou extras), de QUALQUER
 * role (são data-entry, não só gerentes) + admins. Respeita o MODO TESTE (manda
 * só pra usuária de teste enquanto o auto-envio está em validação). Fallback:
 * admins, pra alerta nunca sumir.
 */
export async function resolverDestinatariosCadastro(admin: SupabaseClient): Promise<UsuarioRow[]> {
  if (ALERTA_TESTE_SOMENTE_USER_ID) {
    const { data } = await admin
      .from('usuarios')
      .select('id, nome, email, role, departamento_id, departamentos_extras_ids, ativo')
      .eq('id', ALERTA_TESTE_SOMENTE_USER_ID)
      .maybeSingle();
    return data ? [data as UsuarioRow] : [];
  }

  const [{ data: deptosData }, { data: usuariosData }] = await Promise.all([
    admin.from('departamentos').select('id, nome'),
    admin.from('usuarios').select('id, nome, email, role, departamento_id, departamentos_extras_ids, ativo'),
  ]);
  const deptos = (deptosData ?? []) as DeptoRow[];
  const usuarios = (usuariosData ?? []) as UsuarioRow[];
  const cadastroIds = acharDeptosCadastro(deptos);

  const porId = new Map<string, UsuarioRow>();
  for (const u of usuarios) {
    if (!u.ativo) continue;
    if (u.role === 'admin') { porId.set(u.id, u); continue; }
    const deptosU = new Set(
      [u.departamento_id, ...(u.departamentos_extras_ids ?? [])].filter((v): v is string => !!v),
    );
    if (cadastroIds.some((id) => deptosU.has(id))) porId.set(u.id, u);
  }

  if (porId.size === 0) {
    for (const u of usuarios) if (u.ativo && u.role === 'admin') porId.set(u.id, u);
  }
  return [...porId.values()];
}

/** Cria uma notificação de sistema no sino (tabela notificacoes). */
export async function criarNotificacaoSistema(
  admin: SupabaseClient,
  params: {
    titulo: string;
    mensagem: string;
    tipo: 'erro' | 'aviso';
    empresaId: string | null;
    destinatarios: string[];
  },
): Promise<void> {
  if (params.destinatarios.length === 0) return;
  const { error } = await admin.from('notificacoes').insert({
    titulo: params.titulo,
    mensagem: params.mensagem,
    tipo: params.tipo,
    lida: false,
    lidas_por: [],
    autor_id: null,
    autor_nome: 'Sistema',
    empresa_id: params.empresaId,
    destinatarios: params.destinatarios,
  });
  if (error) console.error('[alertas-auto-envio] falha ao criar notificação:', error.message);
}
