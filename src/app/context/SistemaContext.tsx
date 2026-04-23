'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DocumentoEmpresa,
  Empresa,
  Limiares,
  LogEntry,
  Notificacao,
  RetItem,
  SistemaState,
  Usuario,
  UUID,
  VencimentoFiscal,
} from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { daysUntil, formatBR, isoNow } from '@/app/utils/date';
import { criarHistoricoVencimentoItem, garantirVencimentosFiscais, limparTagVencimento, normalizarHistoricoVencimento } from '@/app/utils/vencimentos';
import * as db from '@/lib/db';
import { supabase } from '@/lib/supabase';

const FISCAL_ALERT_LIMIARES: Limiares = LIMIARES_DEFAULTS;
const FISCAL_ALERT_TITLES = {
  vencido: 'Vencimento fiscal vencido',
  critico: 'Vencimento fiscal critico',
} as const;

function newId(): UUID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function diffObjects(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'senha') continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = { from: a, to: b };
  }
  return diff;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function hasOwnField<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

type AutorHistorico = {
  autorId: UUID | null;
  autorNome?: string;
};

function enriquecerDocumentoComHistorico(
  documentoAtual: DocumentoEmpresa | undefined,
  patch: Partial<DocumentoEmpresa>,
  autor: AutorHistorico
): Partial<DocumentoEmpresa> {
  const historicoBase = hasOwnField(patch, 'historicoVencimento')
    ? normalizarHistoricoVencimento(patch.historicoVencimento)
    : normalizarHistoricoVencimento(documentoAtual?.historicoVencimento);
  let historico = historicoBase;
  const tagVencimento = hasOwnField(patch, 'tagVencimento')
    ? limparTagVencimento(patch.tagVencimento)
    : limparTagVencimento(documentoAtual?.tagVencimento);

  if (documentoAtual && patch.validade !== undefined && patch.validade !== documentoAtual.validade) {
    const anterior = documentoAtual.validade ? formatBR(documentoAtual.validade) : 'sem validade';
    const proximo = patch.validade ? formatBR(patch.validade) : 'sem validade';
    historico = normalizarHistoricoVencimento([
      criarHistoricoVencimentoItem({
        titulo: patch.validade ? `Validade atualizada para ${proximo}` : 'Validade removida',
        descricao: `Antes: ${anterior}`,
        dataEvento: new Date().toISOString().slice(0, 10),
        autorId: autor.autorId,
        autorNome: autor.autorNome,
      }),
      ...historico,
    ]);
  }

  return {
    ...patch,
    tagVencimento,
    historicoVencimento: historico,
  };
}

function enriquecerRetsComHistorico(retsAtuais: RetItem[], proximosRets: RetItem[], autor: AutorHistorico): RetItem[] {
  return proximosRets.map((ret) => {
    const retAtual = retsAtuais.find((item) => item.id === ret.id);
    let historico = hasOwnField(ret, 'historicoVencimento')
      ? normalizarHistoricoVencimento(ret.historicoVencimento)
      : normalizarHistoricoVencimento(retAtual?.historicoVencimento);
    const tagVencimento = hasOwnField(ret, 'tagVencimento')
      ? limparTagVencimento(ret.tagVencimento)
      : limparTagVencimento(retAtual?.tagVencimento);

    if (retAtual && ret.vencimento !== retAtual.vencimento) {
      const anterior = retAtual.vencimento ? formatBR(retAtual.vencimento) : 'sem vencimento';
      const proximo = ret.vencimento ? formatBR(ret.vencimento) : 'sem vencimento';
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: ret.vencimento ? `Vencimento atualizado para ${proximo}` : 'Vencimento removido',
          descricao: `Antes: ${anterior}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    if (retAtual && ret.ultimaRenovacao !== retAtual.ultimaRenovacao && ret.ultimaRenovacao) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: 'Renovação registrada',
          descricao: `Última renovação em ${formatBR(ret.ultimaRenovacao)}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    // Status ativo/inativo
    if (retAtual && ret.ativo !== retAtual.ativo) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: ret.ativo ? 'RET marcado como Ativo' : 'RET marcado como Inativo',
          descricao: `Antes: ${retAtual.ativo !== false ? 'Ativo' : 'Inativo'}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    // Portaria
    if (retAtual && (ret.portaria || '') !== (retAtual.portaria || '')) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: ret.portaria ? `Portaria alterada para ${ret.portaria}` : 'Portaria removida',
          descricao: `Antes: ${retAtual.portaria || '(vazio)'}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    // Nome do RET
    if (retAtual && ret.nome !== retAtual.nome) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: `Nome alterado para ${ret.nome}`,
          descricao: `Antes: ${retAtual.nome || '(vazio)'}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    // Número PTA
    if (retAtual && ret.numeroPta !== retAtual.numeroPta) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: `Nº PTA alterado para ${ret.numeroPta}`,
          descricao: `Antes: ${retAtual.numeroPta || '(vazio)'}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    return {
      ...ret,
      tagVencimento,
      historicoVencimento: historico,
    };
  });
}

function enriquecerVencimentosFiscaisComHistorico(
  fiscaisAtuais: VencimentoFiscal[],
  proximosFiscais: VencimentoFiscal[],
  autor: AutorHistorico
): VencimentoFiscal[] {
  return proximosFiscais.map((fiscal) => {
    const atual = fiscaisAtuais.find((f) => f.id === fiscal.id || f.nome === fiscal.nome);
    let historico = hasOwnField(fiscal, 'historicoVencimento')
      ? normalizarHistoricoVencimento(fiscal.historicoVencimento)
      : normalizarHistoricoVencimento(atual?.historicoVencimento);
    const tagVencimento = hasOwnField(fiscal, 'tagVencimento')
      ? limparTagVencimento(fiscal.tagVencimento)
      : limparTagVencimento(atual?.tagVencimento);

    if (atual && fiscal.vencimento !== atual.vencimento) {
      const anterior = atual.vencimento ? formatBR(atual.vencimento) : 'sem vencimento';
      const proximo = fiscal.vencimento ? formatBR(fiscal.vencimento) : 'sem vencimento';
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: fiscal.vencimento ? `Vencimento atualizado para ${proximo}` : 'Vencimento removido',
          descricao: `Antes: ${anterior}`,
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    if (atual && (fiscal.arquivoUrl || '') !== (atual.arquivoUrl || '')) {
      historico = normalizarHistoricoVencimento([
        criarHistoricoVencimentoItem({
          titulo: fiscal.arquivoUrl ? 'Anexo atualizado' : 'Anexo removido',
          dataEvento: new Date().toISOString().slice(0, 10),
          autorId: autor.autorId,
          autorNome: autor.autorNome,
        }),
        ...historico,
      ]);
    }

    return {
      ...fiscal,
      tagVencimento,
      historicoVencimento: historico,
    };
  });
}

function buildFiscalAlertNotification(empresa: Empresa, fiscal: VencimentoFiscal) {
  const dias = daysUntil(fiscal.vencimento);
  if (dias === null) return null;

  const status = dias < 0
    ? 'vencido'
    : dias <= FISCAL_ALERT_LIMIARES.critico
      ? 'critico'
      : null;

  if (!status) return null;

  const empresaNome = empresa.razao_social || empresa.apelido || '-';
  const diasLabel = dias < 0
    ? `${Math.abs(dias)} dia(s) em atraso`
    : dias === 0
      ? 'vence hoje'
      : `vence em ${dias} dia(s)`;

  return {
    key: `${empresa.id}:${fiscal.id}:${status}:${fiscal.vencimento}`,
    titulo: FISCAL_ALERT_TITLES[status],
    mensagem: `${empresa.codigo} - ${empresaNome}: ${fiscal.nome} com vencimento em ${formatBR(fiscal.vencimento)} (${diasLabel}). Abra o sininho e marque como lida quando estiver ciente.`,
    tipo: status === 'vencido' ? 'erro' as const : 'aviso' as const,
  };
}

function dedupeIds(ids?: UUID[] | null): UUID[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function normalizarControleAcessoDocumento(
  documento: Pick<DocumentoEmpresa, 'visibilidade' | 'departamentosIds' | 'usuariosPermitidos' | 'criadoPorId'>,
  currentUserId?: UUID | null
) {
  const visibilidade = documento.visibilidade ?? 'publico';

  return {
    visibilidade,
    departamentosIds: visibilidade === 'departamento' ? dedupeIds(documento.departamentosIds) : [],
    usuariosPermitidos: visibilidade === 'usuarios' ? dedupeIds(documento.usuariosPermitidos) : [],
    criadoPorId: documento.criadoPorId ?? currentUserId ?? undefined,
  };
}

function canUserViewDocumento(documento: DocumentoEmpresa, usuario: Usuario | null): boolean {
  if (!usuario || !usuario.ativo) return false;

  if (usuario.role === 'admin') {
    return true;
  }

  const visibilidade = documento.visibilidade ?? 'publico';

  if (visibilidade === 'confidencial') {
    return !!documento.criadoPorId && documento.criadoPorId === usuario.id;
  }

  if (visibilidade === 'publico') {
    return true;
  }

  if (visibilidade === 'departamento') {
    const departamentosIds = documento.departamentosIds ?? [];
    if (departamentosIds.length === 0) return true;
    return !!usuario.departamentoId && departamentosIds.includes(usuario.departamentoId);
  }

  if (visibilidade === 'usuarios') {
    return (documento.usuariosPermitidos ?? []).includes(usuario.id);
  }

  return true;
}

function filtrarEmpresasPorPermissaoDocumentos(empresas: Empresa[], usuario: Usuario | null): Empresa[] {
  // Admin tem acesso a TODOS os documentos -- pula filtro completamente
  if (usuario?.role === 'admin') return empresas;

  return empresas.map((empresa) => ({
    ...empresa,
    documentos: empresa.documentos.filter((documento) => canUserViewDocumento(documento, usuario)),
  }));
}

type AlertType = 'sucesso' | 'aviso' | 'erro';
export type AlertItem = { id: UUID; title: string; message: string; type: AlertType };

interface SistemaContextValue extends SistemaState {
  currentUser: Usuario | null;
  canManage: boolean;
  canAdmin: boolean;
  isGhost: boolean;
  isDeveloper: boolean;
  isPrivileged: boolean;
  protectedUserIds: string[];
  loading: boolean;
  authReady: boolean;
  reloadData: () => Promise<void>;

  login: (email: string, senha: string) => Promise<boolean | 'rate_limited'>;
  logout: () => void;

  mostrarAlerta: (title: string, message: string, type: AlertType) => void;
  dismissAlert: (id: UUID) => void;
  alerts: AlertItem[];
  // -- Serviços --
  criarServico: (nome: string) => Promise<UUID | null>;
  removerServico: (id: UUID) => Promise<void>;
  // -- Tags --
  criarTag: (nome: string, cor: import('@/app/types').TagCor) => Promise<UUID | null>;
  atualizarTag: (id: UUID, patch: { nome?: string; cor?: import('@/app/types').TagCor }) => Promise<void>;
  removerTag: (id: UUID) => Promise<void>;
  // -- Departamentos --
  criarDepartamento: (nome: string) => Promise<UUID | null>;
  removerDepartamento: (id: UUID) => Promise<void>;
  // -- Usuários --
  criarUsuario: (payload: Omit<Usuario, 'id' | 'criadoEm' | 'atualizadoEm'>) => Promise<UUID | null>;
  atualizarUsuario: (id: UUID, patch: Partial<Usuario>) => Promise<void>;
  toggleUsuarioAtivo: (id: UUID) => Promise<void>;
  removerUsuario: (id: UUID) => Promise<void>;
  // -- Empresas --
  criarEmpresa: (payload: Partial<Empresa>) => Promise<UUID>;
  atualizarEmpresa: (id: UUID, patch: Partial<Empresa>) => Promise<boolean>;
  removerEmpresa: (id: UUID) => Promise<void>;
  // -- Documentos --
  adicionarDocumento: (empresaId: UUID, doc: Omit<DocumentoEmpresa, 'id' | 'criadoEm' | 'atualizadoEm'>, file?: File) => Promise<boolean>;
  atualizarDocumento: (empresaId: UUID, docId: UUID, patch: Partial<Pick<DocumentoEmpresa, 'nome' | 'validade' | 'departamentosIds' | 'visibilidade' | 'usuariosPermitidos' | 'arquivoUrl' | 'tagVencimento' | 'historicoVencimento' | 'criadoPorId'>>, file?: File) => Promise<boolean>;
  removerDocumento: (empresaId: UUID, docId: UUID) => Promise<void>;

  // RETs
  removerRet: (empresaId: UUID, retId: UUID) => Promise<void>;
  // -- Observações --
  adicionarObservacao: (empresaId: UUID, texto: string) => Promise<void>;
  removerObservacao: (empresaId: UUID, obsId: UUID) => Promise<void>;

  // Lixeira
  restaurarEmpresa: (lixeiraItemId: UUID) => Promise<void>;
  restaurarItem: (lixeiraItemId: UUID) => Promise<void>;
  excluirDefinitivamente: (lixeiraItemId: UUID) => Promise<void>;
  limparLixeira: () => Promise<void>;
  // -- Notificações --
  notificacoes: Notificacao[];
  adicionarNotificacao: (titulo: string, mensagem: string, tipo: Notificacao['tipo'], empresaId?: UUID | null) => Promise<void>;
  marcarNotificacaoLida: (id: UUID) => Promise<void>;
  marcarTodasLidas: () => Promise<void>;
  limparNotificacoes: () => Promise<void>;

  // Histórico
  limparHistorico: () => Promise<void>;
  removerLogsSelecionados: (ids: UUID[]) => Promise<void>;
}

const SistemaContext = createContext<SistemaContextValue | null>(null);

export function SistemaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SistemaState>({
    empresas: [],
    usuarios: [],
    departamentos: [],
    servicos: [],
    tags: [],
    logs: [],
    lixeira: [],
    notificacoes: [],
    currentUserId: null,
  });
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [privileges, setPrivileges] = useState({ isGhost: false, isDeveloper: false, isPrivileged: false, protectedUserIds: [] as string[] });
  const loginAttemptsRef = useRef<number[]>([]);
  const fiscalAlertQueueRef = useRef<Set<string>>(new Set());

  const [authReady, setAuthReady] = useState(false);

  const loadForUser = useCallback(
    async (userId: UUID) => {
      // Sempre carregamos o próprio perfil primeiro (define canManage de forma confiável)
      const meList = await db.fetchUsuarioById(userId);
      const me = meList[0] ?? null;
      const isManager = !!me && me.ativo && (me.role === 'gerente' || me.role === 'admin');

      const [empresas, departamentos, servicos, tags, notificacoes, logs, lixeira, usuarios] = await Promise.all([
        db.fetchEmpresas(),
        db.fetchDepartamentos(),
        db.fetchServicos(),
        db.fetchTags(),
        db.fetchNotificacoes(userId),
        db.fetchLogs().catch(() => []),
        isManager ? db.fetchLixeira() : Promise.resolve([]),
        isManager ? db.fetchUsuariosAdmin() : db.fetchUsuariosBasic().catch(() => (me ? [me] : [])),
      ]);

      // Auto-purge: remover itens da lixeira com mais de 10 dias
      if (isManager) {
        db.purgeLixeiraOlderThan(10).catch(() => {});
      }
      // -- Filtrar notificações por papel --
      // Títulos de notificações internas (só admin deve ver)
      const ADMIN_ONLY_TITLES = new Set([
        'Histórico excluído',
        'Registros do histórico excluídos',
        'Exclusão permanente',
        'Lixeira limpa',
      ]);

      let notifsFiltradas = notificacoes;
      if (me && me.role === 'usuario') {
        // Usuário: vê notificações onde está nos destinatários (exceto internas)
        notifsFiltradas = notificacoes.filter(n =>
          !ADMIN_ONLY_TITLES.has(n.titulo) &&
          Array.isArray(n.destinatarios) && n.destinatarios.includes(userId)
        );
      } else if (me && me.role === 'gerente') {
        // Gerente: vê notificações relacionadas a empresas ou onde está nos destinatários (exceto internas)
        notifsFiltradas = notificacoes.filter(n =>
          !ADMIN_ONLY_TITLES.has(n.titulo) &&
          (
            !n.empresaId ||
            (Array.isArray(n.destinatarios) && n.destinatarios.includes(userId))
          )
        );
      }
      // Admin: sem filtro (todas)

      // Garante que o próprio usuário logado sempre esteja na lista,
      // mesmo que seja filtrado da lista pública (ex: ghost user).
      const usuariosComMe =
        me && !usuarios.some((u) => u.id === userId)
          ? [me, ...usuarios]
          : usuarios;

      setState({
        empresas,
        usuarios: usuariosComMe,
        departamentos,
        servicos,
        tags,
        logs,
        lixeira,
        notificacoes: notifsFiltradas,
        currentUserId: userId,
      });
      return me;
    },
    []
  );
  // -- Load all data from Supabase --
  const reloadData = useCallback(async () => {
    try {
      if (!state.currentUserId) return;
      await loadForUser(state.currentUserId);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  }, [loadForUser, state.currentUserId]);
  // -- Realtime: sincroniza automaticamente quando outro usuário faz mudanças --
  useEffect(() => {
    if (!state.currentUserId) return;

    const userId = state.currentUserId;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadForUser(userId as UUID).catch(console.error);
      }, 1500);
    };

    const tables = [
      'empresas', 'documentos', 'observacoes', 'rets', 'responsaveis',
      'usuarios', 'departamentos', 'servicos', 'tags',
      'notificacoes', 'lixeira', 'logs',
    ];

    let channel = supabase.channel(`app-realtime-${userId}`);
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleReload
      );
    }
    channel.subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [state.currentUserId, loadForUser]);

  const fetchPrivileges = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/me/privileges', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const nextPrivileges = {
          isGhost: !!json.isGhost,
          isDeveloper: !!json.isDeveloper,
          isPrivileged: !!json.isPrivileged,
          protectedUserIds: Array.isArray(json.protectedUserIds) ? json.protectedUserIds : [],
        };
        setPrivileges(nextPrivileges);
        return nextPrivileges;
      }
    } catch {
      setPrivileges({ isGhost: false, isDeveloper: false, isPrivileged: false, protectedUserIds: [] });
    }
    return { isGhost: false, isDeveloper: false, isPrivileged: false, protectedUserIds: [] as string[] };
  }, []);

  // -- Auth --
  useEffect(() => {
    let mounted = true;
    let initialLoadDone = false;

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!mounted) return;
        if (error) console.error('Erro ao obter sessão:', error);
        const userId = data.session?.user?.id ?? null;
        if (userId) {
          setLoading(true);
          initialLoadDone = true;
          await Promise.all([
            loadForUser(userId as UUID).catch((err) => console.error(err)),
            fetchPrivileges(data.session!.access_token),
          ]);
        } else {
          setState((prev) => ({ ...prev, currentUserId: null }));
          setPrivileges({ isGhost: false, isDeveloper: false, isPrivileged: false, protectedUserIds: [] });
        }
      })
      .finally(() => {
        if (!mounted) return;
        setAuthReady(true);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Evitar recarregar se getSession já carregou (INITIAL_SESSION duplicado)
      if (_event === 'INITIAL_SESSION' && initialLoadDone) return;

      const userId = session?.user?.id ?? null;
      if (userId) {
        setLoading(true);
        Promise.all([
          loadForUser(userId as UUID),
          fetchPrivileges(session!.access_token),
        ])
          .catch((err) => console.error(err))
          .finally(() => setLoading(false));
      } else {
        setState((prev) => ({
          ...prev,
          currentUserId: null,
          empresas: [],
          usuarios: [],
          departamentos: [],
          servicos: [],
          tags: [],
          logs: [],
          lixeira: [],
          notificacoes: [],
        }));
        setPrivileges({ isGhost: false, isDeveloper: false, isPrivileged: false, protectedUserIds: [] });
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [loadForUser, fetchPrivileges]);

  const currentUser = useMemo(
    () => state.usuarios.find((u) => u.id === state.currentUserId) ?? null,
    [state.currentUserId, state.usuarios]
  );
  const protectedUserIdSet = useMemo(() => new Set(privileges.protectedUserIds), [privileges.protectedUserIds]);
  const usuariosVisiveis = useMemo(
    () => state.usuarios.filter((u) => u.id === state.currentUserId || !protectedUserIdSet.has(u.id)),
    [protectedUserIdSet, state.currentUserId, state.usuarios]
  );
  const logsVisiveis = useMemo(
    () =>
      state.logs.filter(
        (log) =>
          !((log.userId && protectedUserIdSet.has(log.userId)) ||
            (log.entity === 'usuario' && log.entityId && protectedUserIdSet.has(log.entityId)))
      ),
    [protectedUserIdSet, state.logs]
  );

  const canManage = currentUser?.role === 'gerente' || currentUser?.role === 'admin';
  const canAdmin = currentUser?.role === 'admin';
  const empresasVisiveis = useMemo(
    () => filtrarEmpresasPorPermissaoDocumentos(state.empresas, currentUser),
    [currentUser, state.empresas]
  );

  const pushLog = async (entry: Omit<LogEntry, 'id' | 'em' | 'userId' | 'userNome'> & { diff?: LogEntry['diff'] }, nomeOverride?: string | null, userIdOverride?: string | null) => {
    const resolvedUserId = userIdOverride ?? state.currentUserId;
    if (privileges.isGhost || privileges.isDeveloper) return;
    try {
      const newLog = await db.insertLog({
        userId: resolvedUserId,
        userNome: nomeOverride !== undefined ? nomeOverride : (currentUser?.nome ?? null),
        ...entry,
      });
      queueMicrotask(() => {
        setState((prev) => ({
          ...prev,
          logs: [newLog, ...prev.logs],
        }));
      });
    } catch (err) {
      console.error('Erro ao inserir log:', err);
    }
  };

  const mostrarAlerta = (title: string, message: string, type: AlertType) => {
    const id = newId();
    setAlerts((prev) => [{ id, title, message, type }, ...prev].slice(0, 5));
    window.setTimeout(() => dismissAlert(id), 5000);
  };

  const dismissAlert = (id: UUID) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  const getNotificationDestinatarios = useCallback((empresaId?: UUID | null) => {
    const destinatarios: UUID[] = [];
    const addDestinatario = (userId?: UUID | null) => {
      if (!userId || destinatarios.includes(userId)) return;
      destinatarios.push(userId);
    };

    if (!empresaId) return destinatarios;

    const empresa = state.empresas.find((item) => item.id === empresaId);
    if (!empresa) return destinatarios;

    const deptIdsComResp = new Set<string>();
    for (const [deptId, uid] of Object.entries(empresa.responsaveis)) {
      if (!uid) continue;
      addDestinatario(uid as UUID);
      deptIdsComResp.add(deptId);
    }

    for (const usuario of state.usuarios) {
      if (!usuario.ativo) continue;
      if ((usuario.role === 'gerente' || usuario.role === 'admin') && usuario.departamentoId && deptIdsComResp.has(usuario.departamentoId)) {
        addDestinatario(usuario.id);
      }
    }

    if (destinatarios.length === 0) {
      for (const usuario of state.usuarios) {
        if (!usuario.ativo) continue;
        if (usuario.role === 'gerente' || usuario.role === 'admin') addDestinatario(usuario.id);
      }
    }

    return destinatarios;
  }, [state.empresas, state.usuarios]);

  const addNotification = async (
    titulo: string,
    mensagem: string,
    tipo: Notificacao['tipo'],
    empresaId?: UUID | null,
  ) => {
    try {
      // Computar destinatários: quem deve ver esta notificação
      const destinatarios = getNotificationDestinatarios(empresaId);
      /*
      if (false && empresaId) {
        const empresa = state.empresas.find(e => e.id === empresaId);
        if (empresa) {
          const deptIdsComResp = new Set<string>();
          // Adicionar usuários responsáveis diretos
          for (const [deptId, uid] of Object.entries(empresa.responsaveis)) {
            if (uid) {
              destinatarios.push(uid as UUID);
              deptIdsComResp.add(deptId);
            }
          }
          // Adicionar gerentes dos departamentos envolvidos
          for (const u of state.usuarios) {
            if (u.role === 'gerente' && u.departamentoId && deptIdsComResp.has(u.departamentoId)) {
              if (!destinatarios.includes(u.id)) {
                destinatarios.push(u.id);
              }
            }
          }
        }
      }
      */

      const notif = await db.insertNotificacao({
        titulo,
        mensagem,
        tipo,
        lida: false,
        autorId: state.currentUserId,
        autorNome: currentUser?.nome,
        empresaId: empresaId ?? null,
        destinatarios,
      });
      setState((prev) => ({
        ...prev,
        notificacoes: [notif, ...prev.notificacoes].slice(0, 100),
      }));
    } catch (err) {
      console.error('Erro ao inserir notificação:', err);
    }
  };

  useEffect(() => {
    if (!state.currentUserId || !canManage) return;

    const pendentes = state.empresas.flatMap((empresa) =>
      garantirVencimentosFiscais(empresa.vencimentosFiscais).flatMap((fiscal) => {
        const alerta = buildFiscalAlertNotification(empresa, fiscal);
        if (!alerta) return [];

        const jaExiste = state.notificacoes.some((notificacao) =>
          notificacao.empresaId === empresa.id &&
          notificacao.titulo === alerta.titulo &&
          notificacao.mensagem === alerta.mensagem
        );

        if (jaExiste || fiscalAlertQueueRef.current.has(alerta.key)) return [];

        return [{ ...alerta, empresaId: empresa.id }];
      })
    );

    if (pendentes.length === 0) return;

    let ativo = true;

    void (async () => {
      for (const alerta of pendentes) {
        if (!ativo) break;

        fiscalAlertQueueRef.current.add(alerta.key);
        try {
          await addNotification(alerta.titulo, alerta.mensagem, alerta.tipo, alerta.empresaId);
        } finally {
          fiscalAlertQueueRef.current.delete(alerta.key);
        }
      }
    })();

    return () => {
      ativo = false;
    };
  }, [addNotification, canManage, state.currentUserId, state.empresas, state.notificacoes]);

  // -- Auth --

  const login = async (email: string, senha: string): Promise<boolean | 'rate_limited'> => {
    const now = Date.now();
    const WINDOW_MS = 3 * 60 * 1000; // 3 minutos
    const MAX_ATTEMPTS = 5;

    // Limpar tentativas antigas (fora da janela)
    loginAttemptsRef.current = loginAttemptsRef.current.filter((t) => now - t < WINDOW_MS);

    if (loginAttemptsRef.current.length >= MAX_ATTEMPTS) {
      return 'rate_limited';
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session?.user) {
      loginAttemptsRef.current.push(now);
      return false;
    }

    // Login bem-sucedido -- limpar tentativas
    loginAttemptsRef.current = [];

    const userId = data.session.user.id;
    setLoading(true);
    let me: { nome?: string } | null = null;
    let nextPrivileges = privileges;
    try {
      me = await loadForUser(userId as UUID);
      nextPrivileges = await fetchPrivileges(data.session.access_token);
    } catch (err: unknown) {
      console.error(err);
      return false;
      mostrarAlerta('Erro ao carregar dados', getErrorMessage(err, 'Falha ao carregar dados do sistema após login.'), 'erro');
    } finally {
      setLoading(false);
    }
    if (!nextPrivileges.isGhost && !nextPrivileges.isDeveloper) {
      await pushLog({ action: 'login', entity: 'usuario', entityId: userId, message: `Login` }, me?.nome ?? null, userId);
    }
    return true;
  };

  const logout = () => {
    pushLog({ action: 'logout', entity: 'usuario', entityId: state.currentUserId, message: `Logout` });
    supabase.auth.signOut().catch((err) => console.error('Erro ao sair:', err));
    setState((prev) => ({ ...prev, currentUserId: null }));
  };
  // -- Serviços --

  const criarServico = async (nome: string) => {
    if (!canManage) return null;
    try {
      const servico = await db.insertServico(nome);
      await pushLog({ action: 'create', entity: 'servico', entityId: servico.id, message: `Criou serviço: ${nome}` });
      setState((prev) => ({ ...prev, servicos: [servico, ...prev.servicos] }));
      return servico.id;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const removerServico = async (id: UUID) => {
    if (!canManage) return;
    const servico = state.servicos.find((s) => s.id === id);
    try {
      await db.deleteServico(id, servico?.nome ?? '');
      await pushLog({ action: 'delete', entity: 'servico', entityId: id, message: `Removeu serviço: ${servico?.nome ?? id}` });
      setState((prev) => ({
        ...prev,
        servicos: prev.servicos.filter((s) => s.id !== id),
        empresas: prev.empresas.map((e) => ({
          ...e,
          servicos: e.servicos.filter((s) => s !== servico?.nome),
        })),
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Tags --

  const criarTag = async (nome: string, cor: import('@/app/types').TagCor) => {
    if (!canManage) return null;
    try {
      const tag = await db.insertTag(nome, cor);
      await pushLog({ action: 'create', entity: 'tag', entityId: tag.id, message: `Criou tag: ${nome}` });
      setState((prev) => ({ ...prev, tags: [tag, ...prev.tags] }));
      return tag.id;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const atualizarTag = async (id: UUID, patch: { nome?: string; cor?: import('@/app/types').TagCor }) => {
    if (!canManage) return;
    const tagAtual = state.tags.find((t) => t.id === id);
    try {
      await db.updateTag(id, patch);
      await pushLog({ action: 'update', entity: 'tag', entityId: id, message: `Atualizou tag: ${tagAtual?.nome ?? id}` });
      // Se o nome mudou, atualizar em todas as empresas
      if (patch.nome && tagAtual && patch.nome !== tagAtual.nome) {
        const { data: empresasComTag } = await supabase
          .from('empresas')
          .select('id, tags')
          .contains('tags', [tagAtual.nome]);
        if (empresasComTag) {
          for (const e of empresasComTag) {
            const updated = (e.tags as string[]).map((t: string) => t === tagAtual.nome ? patch.nome! : t);
            await supabase.from('empresas').update({ tags: updated }).eq('id', e.id);
          }
        }
        setState((prev) => ({
          ...prev,
          tags: prev.tags.map((t) => t.id === id ? { ...t, ...patch } : t),
          empresas: prev.empresas.map((emp) => ({
            ...emp,
            tags: emp.tags.map((t) => t === tagAtual.nome ? patch.nome! : t),
          })),
        }));
      } else {
        setState((prev) => ({
          ...prev,
          tags: prev.tags.map((t) => t.id === id ? { ...t, ...patch } : t),
        }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removerTag = async (id: UUID) => {
    if (!canManage) return;
    const tag = state.tags.find((t) => t.id === id);
    try {
      await db.deleteTag(id, tag?.nome ?? '');
      await pushLog({ action: 'delete', entity: 'tag', entityId: id, message: `Removeu tag: ${tag?.nome ?? id}` });
      setState((prev) => ({
        ...prev,
        tags: prev.tags.filter((t) => t.id !== id),
        empresas: prev.empresas.map((e) => ({
          ...e,
          tags: e.tags.filter((t) => t !== tag?.nome),
        })),
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Departamentos --

  const criarDepartamento = async (nome: string) => {
    if (!canManage) return null;
    try {
      const dep = await db.insertDepartamento(nome);
      await pushLog({ action: 'create', entity: 'departamento', entityId: dep.id, message: `Criou departamento: ${nome}` });
      setState((prev) => ({ ...prev, departamentos: [dep, ...prev.departamentos] }));
      return dep.id;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const removerDepartamento = async (id: UUID) => {
    if (!canManage) return;
    const dep = state.departamentos.find((d) => d.id === id);
    try {
      await db.deleteDepartamento(id);
      await pushLog({ action: 'delete', entity: 'departamento', entityId: id, message: `Removeu departamento: ${dep?.nome ?? id}` });
      setState((prev) => ({
        ...prev,
        departamentos: prev.departamentos.filter((d) => d.id !== id),
        usuarios: prev.usuarios.map((u) => (u.departamentoId === id ? { ...u, departamentoId: null } : u)),
        empresas: prev.empresas.map((e) => {
          const rest = { ...e.responsaveis };
          delete rest[id];
          return { ...e, responsaveis: rest };
        }),
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Usuários --

  const criarUsuario = async (payload: Omit<Usuario, 'id' | 'criadoEm' | 'atualizadoEm'>) => {
    if (!canAdmin) return null;
    try {
      const user = await db.insertUsuario(payload);
      await pushLog({ action: 'create', entity: 'usuario', entityId: user.id, message: `Criou usuário: ${user.nome}` });
      setState((prev) => ({ ...prev, usuarios: [user, ...prev.usuarios] }));
      return user.id;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const atualizarUsuario = async (id: UUID, patch: Partial<Usuario>) => {
    if (!canAdmin) return;
    const before = state.usuarios.find((u) => u.id === id);
    if (!before) return;
    const after = { ...before, ...patch, atualizadoEm: isoNow() };
    const diff = diffObjects(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    try {
      await db.updateUsuario(id, patch);
      await pushLog({ action: 'update', entity: 'usuario', entityId: id, message: `Atualizou usuário: ${before.nome}`, diff });
      setState((prev) => ({
        ...prev,
        usuarios: prev.usuarios.map((u) => (u.id === id ? after : u)),
      }));
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const toggleUsuarioAtivo = async (id: UUID) => {
    const user = state.usuarios.find((u) => u.id === id);
    if (!user) return;
    await atualizarUsuario(id, { ativo: !user.ativo });
  };

  const removerUsuario = async (id: UUID) => {
    if (!canAdmin) return;
    const user = state.usuarios.find((u) => u.id === id);
    try {
      await db.deleteUsuario(id);
      await pushLog({ action: 'delete', entity: 'usuario', entityId: id, message: `Removeu usuário: ${user?.nome ?? id}` });
      setState((prev) => ({
        ...prev,
        usuarios: prev.usuarios.filter((u) => u.id !== id),
        empresas: prev.empresas.map((e) => {
          const responsaveis: Empresa['responsaveis'] = { ...e.responsaveis };
          for (const depId of Object.keys(responsaveis)) {
            if (responsaveis[depId] === id) responsaveis[depId] = null;
          }
          return { ...e, responsaveis };
        }),
        currentUserId: prev.currentUserId === id ? null : prev.currentUserId,
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Empresas --

  const criarEmpresa = async (payload: Partial<Empresa>) => {
    if (!canManage) throw new Error('Apenas gerentes podem criar empresas.');
    const depIds = state.departamentos.map((d) => d.id);
    try {
      const empresaId = await db.insertEmpresa(payload, depIds);

      // Montar responsáveis incluindo depts do state E do payload (importação pode ter depts novos)
      const responsaveis: Empresa['responsaveis'] = {};
      for (const d of state.departamentos) responsaveis[d.id] = payload.responsaveis?.[d.id] ?? null;
      if (payload.responsaveis) {
        for (const [depId, userId] of Object.entries(payload.responsaveis)) {
          if (!(depId in responsaveis)) responsaveis[depId] = userId;
        }
      }

      const empresa: Empresa = {
        id: empresaId,
        cadastrada: payload.cadastrada ?? false,
        cnpj: payload.cnpj,
        codigo: payload.codigo ?? '',
        razao_social: payload.razao_social,
        apelido: payload.apelido,
        data_abertura: payload.data_abertura,
        tipoEstabelecimento: payload.tipoEstabelecimento ?? '',
        tipoInscricao: payload.tipoInscricao ?? '',
        servicos: payload.servicos ?? [],
        tags: payload.tags ?? [],
        possuiRet: payload.possuiRet ?? false,
        rets: (payload.rets ?? []).map((ret) => ({
          ...ret,
          tagVencimento: limparTagVencimento(ret.tagVencimento),
          historicoVencimento: normalizarHistoricoVencimento(ret.historicoVencimento),
        })),
        vencimentosFiscais: garantirVencimentosFiscais(payload.vencimentosFiscais),
        formaEnvio: payload.formaEnvio ?? [],
        inscricao_estadual: payload.inscricao_estadual,
        inscricao_municipal: payload.inscricao_municipal,
        regime_federal: payload.regime_federal,
        regime_estadual: payload.regime_estadual,
        regime_municipal: payload.regime_municipal,
        estado: payload.estado,
        cidade: payload.cidade,
        bairro: payload.bairro,
        logradouro: payload.logradouro,
        numero: payload.numero,
        cep: payload.cep,
        email: payload.email,
        telefone: payload.telefone,
        responsaveis,
        documentos: (payload.documentos ?? []).map((doc) => ({
          ...doc,
          tagVencimento: limparTagVencimento(doc.tagVencimento),
          historicoVencimento: normalizarHistoricoVencimento(doc.historicoVencimento),
        })),
        observacoes: payload.observacoes ?? [],
        criadoEm: isoNow(),
        atualizadoEm: isoNow(),
      };

      await pushLog({ action: 'create', entity: 'empresa', entityId: empresaId, message: `Criou empresa: ${empresa.codigo} - ${empresa.razao_social ?? empresa.apelido ?? ''}` });
      await addNotification('Nova empresa cadastrada', `${empresa.codigo} - ${empresa.razao_social || empresa.apelido || ''} foi cadastrada por ${currentUser?.nome ?? 'Desconhecido'}`, 'sucesso', empresaId);

      setState((prev) => ({ ...prev, empresas: [empresa, ...prev.empresas] }));
      return empresaId;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const atualizarEmpresa = async (id: UUID, patch: Partial<Empresa>) => {
    const before = state.empresas.find((e) => e.id === id);
    if (!before) return false;
    const skipHistorico = privileges.isGhost || privileges.isDeveloper;
    const patchPreparado: Partial<Empresa> = {
      ...patch,
      ...(patch.rets !== undefined
        ? {
            rets: skipHistorico
              ? patch.rets
              : enriquecerRetsComHistorico(before.rets, patch.rets, {
                  autorId: state.currentUserId,
                  autorNome: currentUser?.nome,
                }),
          }
        : {}),
      ...(patch.vencimentosFiscais !== undefined
        ? {
            vencimentosFiscais: skipHistorico
              ? patch.vencimentosFiscais
              : enriquecerVencimentosFiscaisComHistorico(
                  before.vencimentosFiscais ?? [],
                  patch.vencimentosFiscais,
                  { autorId: state.currentUserId, autorNome: currentUser?.nome }
                ),
          }
        : {}),
    };
    const after: Empresa = {
      ...before,
      ...patchPreparado,
      responsaveis: { ...before.responsaveis, ...(patch.responsaveis ?? {}) },
      atualizadoEm: isoNow(),
    };
    const diff = diffObjects(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    try {
      await db.updateEmpresa(id, patchPreparado);
      await pushLog({ action: 'update', entity: 'empresa', entityId: id, message: `Atualizou empresa: ${before.codigo}`, diff });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) => (e.id === id ? after : e)),
      }));
      return true;
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const removerEmpresa = async (id: UUID) => {
    if (!canManage) return;
    const empresa = state.empresas.find((e) => e.id === id);
    if (!empresa) return;
    try {
      const lixeiraItem = await db.insertLixeira(empresa, state.currentUserId, currentUser?.nome ?? 'Desconhecido');
      await addNotification('Empresa excluída', `${empresa.codigo} - ${empresa.razao_social || empresa.apelido || ''} foi movida para a lixeira por ${currentUser?.nome ?? 'Desconhecido'}`, 'aviso', id);
      await db.deleteEmpresa(id);
      await pushLog({ action: 'delete', entity: 'empresa', entityId: id, message: `Moveu empresa para lixeira: ${empresa.codigo}` });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.filter((e) => e.id !== id),
        lixeira: [lixeiraItem, ...prev.lixeira],
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const restaurarEmpresa = async (lixeiraItemId: UUID) => {
    if (!canManage) return;
    const item = state.lixeira.find((l) => l.id === lixeiraItemId);
    if (!item) return;
    try {
      const depIds = state.departamentos.map((d) => d.id);
      await db.insertEmpresa(item.empresa, depIds);
      await db.deleteLixeiraItem(lixeiraItemId);
      await pushLog({ action: 'create', entity: 'empresa', entityId: item.empresa.id, message: `Restaurou empresa da lixeira: ${item.empresa.codigo}` });
      await addNotification('Empresa restaurada', `${item.empresa.codigo} - ${item.empresa.razao_social || item.empresa.apelido || ''} foi restaurada por ${currentUser?.nome ?? 'Desconhecido'}`, 'sucesso', item.empresa.id);
      setState((prev) => ({
        ...prev,
        empresas: [item.empresa, ...prev.empresas],
        lixeira: prev.lixeira.filter((l) => l.id !== lixeiraItemId),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const restaurarItem = async (lixeiraItemId: UUID) => {
    const item = state.lixeira.find((l) => l.id === lixeiraItemId);
    if (!item) return;
    try {
      if (item.tipo === 'empresa') {
        await restaurarEmpresa(lixeiraItemId);
        return;
      }
      if (item.tipo === 'documento' && item.documento && item.empresaId) {
        // Verificar se a empresa-pai ainda existe
        const empresaExiste = state.empresas.some((e) => e.id === item.empresaId);
        if (!empresaExiste) {
          mostrarAlerta('Erro', 'A empresa deste documento não existe mais. Restaure a empresa primeiro.', 'erro');
          return;
        }
        await db.restoreDocumento(item.documento, item.empresaId);
        await db.deleteLixeiraItem(lixeiraItemId);
        await pushLog({ action: 'create', entity: 'documento', entityId: item.documento.id, message: `Restaurou documento da lixeira: ${item.documento.nome}` });
        // Recarregar empresas para pegar o doc com o novo ID gerado pelo banco
        const freshEmpresas = await db.fetchEmpresas();
        setState((prev) => ({
          ...prev,
          empresas: freshEmpresas,
          lixeira: prev.lixeira.filter((l) => l.id !== lixeiraItemId),
        }));
        mostrarAlerta('Documento restaurado', `"${item.documento.nome}" foi restaurado na empresa ${item.empresa.codigo}`, 'sucesso');
        return;
      }
      if (item.tipo === 'observacao' && item.observacao && item.empresaId) {
        const empresaExiste = state.empresas.some((e) => e.id === item.empresaId);
        if (!empresaExiste) {
          mostrarAlerta('Erro', 'A empresa desta observação não existe mais. Restaure a empresa primeiro.', 'erro');
          return;
        }
        await db.restoreObservacao(item.observacao, item.empresaId);
        await db.deleteLixeiraItem(lixeiraItemId);
        await pushLog({ action: 'create', entity: 'empresa', entityId: item.empresaId, message: `Restaurou observação da lixeira` });
        const freshEmpresas = await db.fetchEmpresas();
        setState((prev) => ({
          ...prev,
          empresas: freshEmpresas,
          lixeira: prev.lixeira.filter((l) => l.id !== lixeiraItemId),
        }));
        mostrarAlerta('Observação restaurada', `Observação restaurada na empresa ${item.empresa.codigo}`, 'sucesso');
        return;
      }
      if (item.tipo === 'ret' && item.ret && item.empresaId) {
        const empresaExiste = state.empresas.some((e) => e.id === item.empresaId);
        if (!empresaExiste) {
          mostrarAlerta('Erro', 'A empresa deste RET não existe mais. Restaure a empresa primeiro.', 'erro');
          return;
        }
        await db.restoreRet(item.ret, item.empresaId);
        await db.deleteLixeiraItem(lixeiraItemId);
        await pushLog({ action: 'create', entity: 'ret', entityId: item.ret.id, message: `Restaurou RET da lixeira: ${item.ret.nome} (empresa ${item.empresa.codigo})` });
        const freshEmpresas = await db.fetchEmpresas();
        setState((prev) => ({
          ...prev,
          empresas: freshEmpresas,
          lixeira: prev.lixeira.filter((l) => l.id !== lixeiraItemId),
        }));
        mostrarAlerta('RET restaurado', `"${item.ret.nome}" foi restaurado na empresa ${item.empresa.codigo}`, 'sucesso');
        return;
      }
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível restaurar o item.', 'erro');
    }
  };

  const excluirDefinitivamente = async (lixeiraItemId: UUID) => {
    if (!canManage) return;
    const item = state.lixeira.find((l) => l.id === lixeiraItemId);
    try {
      await db.deleteLixeiraItem(lixeiraItemId);
      await pushLog({ action: 'delete', entity: 'empresa', entityId: item?.empresa.id ?? null, message: `Excluiu permanentemente: ${item?.empresa.codigo ?? lixeiraItemId}` });
      await addNotification('Exclusão permanente', `${item?.empresa.codigo ?? ''} foi excluída permanentemente`, 'erro');
      setState((prev) => ({
        ...prev,
        lixeira: prev.lixeira.filter((l) => l.id !== lixeiraItemId),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const limparLixeira = async () => {
    if (!canManage) return;
    const count = state.lixeira.length;
    try {
      await db.clearLixeira();
      await pushLog({ action: 'delete', entity: 'empresa', entityId: null, message: `Limpou lixeira: ${count} empresa(s) excluídas permanentemente` });
      await addNotification('Lixeira limpa', `${count} empresa(s) excluídas permanentemente`, 'erro');
      setState((prev) => ({ ...prev, lixeira: [] }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Documentos --

  const adicionarDocumento = async (empresaId: UUID, doc: Omit<DocumentoEmpresa, 'id' | 'criadoEm' | 'atualizadoEm'>, file?: File) => {
    try {
      if (!file) {
        mostrarAlerta('Arquivo obrigatorio', 'Envie um arquivo antes de adicionar o documento.', 'aviso');
        return false;
      }

      const controleAcesso = normalizarControleAcessoDocumento(doc, state.currentUserId);
      if (controleAcesso.visibilidade === 'usuarios' && controleAcesso.usuariosPermitidos.length === 0) {
        mostrarAlerta('Usuario obrigatorio', 'Selecione pelo menos um usuario para essa visibilidade.', 'aviso');
        return false;
      }

      let arquivoUrl = doc.arquivoUrl;
      if (file) {
        try {
          arquivoUrl = await db.uploadDocumentoArquivo(empresaId, file);
        } catch (uploadErr: unknown) {
          console.error('Erro no upload:', uploadErr);
          mostrarAlerta('Erro no upload', getErrorMessage(uploadErr, 'Não foi possível enviar o arquivo. Verifique se o bucket "documentos" existe no Supabase Storage.'), 'erro');
          return false;
        }
      }
      // Garantir que o criador está em usuariosPermitidos quando visibilidade='usuarios'
      const novo = await db.insertDocumento(empresaId, {
        ...doc,
        ...controleAcesso,
        arquivoUrl,
      });
      await pushLog({ action: 'create', entity: 'documento', entityId: novo.id, message: `Adicionou documento: ${doc.nome}` });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId ? { ...e, documentos: [novo, ...e.documentos], atualizadoEm: isoNow() } : e
        ),
      }));
      return true;
    } catch (err: unknown) {
      console.error(err);
      mostrarAlerta('Erro ao adicionar documento', getErrorMessage(err, 'Falha ao salvar documento.'), 'erro');
      return false;
    }
  };

  const atualizarDocumento = async (
    empresaId: UUID,
    docId: UUID,
    patch: Partial<Pick<DocumentoEmpresa, 'nome' | 'validade' | 'departamentosIds' | 'visibilidade' | 'usuariosPermitidos' | 'arquivoUrl' | 'tagVencimento' | 'historicoVencimento' | 'criadoPorId'>>,
    file?: File
  ) => {
    try {
      const finalPatch = { ...patch };
      if (file) {
        try {
          const arquivoUrl = await db.uploadDocumentoArquivo(empresaId, file);
          finalPatch.arquivoUrl = arquivoUrl;
        } catch (uploadErr: unknown) {
          console.error('Erro no upload:', uploadErr);
          mostrarAlerta('Erro no upload', getErrorMessage(uploadErr, 'Não foi possível enviar o arquivo.'), 'erro');
          return false;
        }
      }
      const empresa = state.empresas.find((e) => e.id === empresaId);
      const doc = empresa?.documentos.find((d) => d.id === docId);
      if (!empresa || !doc) return false;
      const visibilidadeFinal = patch.visibilidade ?? doc.visibilidade ?? 'publico';
      const controleAcesso = normalizarControleAcessoDocumento({
        visibilidade: visibilidadeFinal,
        departamentosIds: patch.departamentosIds ?? doc.departamentosIds,
        usuariosPermitidos: patch.usuariosPermitidos ?? doc.usuariosPermitidos,
        criadoPorId: patch.criadoPorId ?? doc.criadoPorId,
      }, state.currentUserId);
      if (controleAcesso.visibilidade === 'usuarios' && controleAcesso.usuariosPermitidos.length === 0) {
        mostrarAlerta('Usuario obrigatorio', 'Selecione pelo menos um usuario para essa visibilidade.', 'aviso');
        return false;
      }
      finalPatch.departamentosIds = controleAcesso.departamentosIds;
      finalPatch.usuariosPermitidos = controleAcesso.usuariosPermitidos;
      finalPatch.visibilidade = controleAcesso.visibilidade;
      finalPatch.criadoPorId = controleAcesso.criadoPorId;
      const patchPreparado = (privileges.isGhost || privileges.isDeveloper)
        ? finalPatch
        : enriquecerDocumentoComHistorico(doc, finalPatch, {
            autorId: state.currentUserId,
            autorNome: currentUser?.nome,
          });
      await db.updateDocumento(docId, patchPreparado);
      await pushLog({ action: 'update', entity: 'documento', entityId: docId, message: `Atualizou documento: ${doc?.nome ?? docId} (empresa ${empresa?.codigo ?? empresaId})` });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId
            ? { ...e, documentos: e.documentos.map((d) => d.id === docId ? { ...d, ...patchPreparado, atualizadoEm: isoNow() } : d), atualizadoEm: isoNow() }
            : e
        ),
      }));
      return true;
    } catch (err: unknown) {
      console.error(err);
      mostrarAlerta('Erro ao atualizar documento', getErrorMessage(err, 'Falha ao salvar alterações.'), 'erro');
      return false;
    }
  };

  const removerRet = async (empresaId: UUID, retId: UUID) => {
    try {
      const empresa = state.empresas.find((e) => e.id === empresaId);
      const ret = empresa?.rets.find((r) => r.id === retId);

      // 1. Deletar o RET do banco
      await db.deleteRet(retId);

      // 2. Inserir na lixeira
      if (ret && empresa && currentUser) {
        try {
          await db.insertLixeiraRet(ret, empresa, state.currentUserId, currentUser.nome);
        } catch (lixErr) {
          console.warn('RET excluído mas falhou ao inserir na lixeira:', lixErr);
        }
      }

      await pushLog({ action: 'delete', entity: 'ret', entityId: retId, message: `Moveu RET para lixeira: ${ret?.nome ?? retId} (empresa ${empresa?.codigo ?? empresaId})` });
      const freshLixeira = await db.fetchLixeira();
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId
            ? { ...e, rets: e.rets.filter((r) => r.id !== retId), possuiRet: e.rets.filter((r) => r.id !== retId).length > 0, atualizadoEm: isoNow() }
            : e
        ),
        lixeira: freshLixeira,
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const removerDocumento = async (empresaId: UUID, docId: UUID) => {
    try {
      const empresa = state.empresas.find((e) => e.id === empresaId);
      const doc = empresa?.documentos.find((d) => d.id === docId);

      // 1. Deletar o documento PRIMEIRO para garantir que ele sai da tabela
      await db.deleteDocumento(docId);

      // 2. Só depois de confirmar a exclusão, inserir na lixeira
      if (doc && empresa && currentUser) {
        try {
          await db.insertLixeiraDocumento(doc, empresa, state.currentUserId, currentUser.nome);
        } catch (lixErr) {
          // Se falhar ao inserir na lixeira, o doc já foi deletado -- apenas logar
          console.warn('Documento excluído mas falhou ao inserir na lixeira:', lixErr);
        }
      }

      await pushLog({ action: 'delete', entity: 'documento', entityId: docId, message: `Moveu documento para lixeira: ${doc?.nome ?? docId}` });
      const freshLixeira = await db.fetchLixeira();
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId ? { ...e, documentos: e.documentos.filter((d) => d.id !== docId), atualizadoEm: isoNow() } : e
        ),
        lixeira: freshLixeira,
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Observações --

  const adicionarObservacao = async (empresaId: UUID, texto: string) => {
    if (!currentUser) return;
    try {
      const obs = await db.insertObservacao(empresaId, texto, currentUser.id, currentUser.nome);
      await pushLog({ action: 'create', entity: 'empresa', entityId: empresaId, message: `Adicionou observação na empresa: ${state.empresas.find(e => e.id === empresaId)?.codigo ?? empresaId}` });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId
            ? { ...e, observacoes: [...(e.observacoes ?? []), obs], atualizadoEm: isoNow() }
            : e
        ),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const removerObservacao = async (empresaId: UUID, obsId: UUID) => {
    try {
      const empresa = state.empresas.find((e) => e.id === empresaId);
      const obs = (empresa?.observacoes ?? []).find((o) => o.id === obsId);

      // 1. Deletar primeiro
      await db.deleteObservacao(obsId);

      // 2. Só depois inserir na lixeira
      if (obs && empresa && currentUser) {
        try {
          await db.insertLixeiraObservacao(obs, empresa, state.currentUserId, currentUser.nome);
        } catch (lixErr) {
          console.warn('Observação excluída mas falhou ao inserir na lixeira:', lixErr);
        }
      }

      await pushLog({ action: 'delete', entity: 'empresa', entityId: empresaId, message: `Moveu observação para lixeira da empresa: ${empresa?.codigo ?? empresaId}` });
      const freshLixeira = await db.fetchLixeira();
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId
            ? { ...e, observacoes: (e.observacoes ?? []).filter((o) => o.id !== obsId), atualizadoEm: isoNow() }
            : e
        ),
        lixeira: freshLixeira,
      }));
    } catch (err) {
      console.error(err);
    }
  };
  // -- Notificações --

  const adicionarNotificacao = async (titulo: string, mensagem: string, tipo: Notificacao['tipo'], empresaId?: UUID | null) => {
    await addNotification(titulo, mensagem, tipo, empresaId);
  };

  const marcarNotificacaoLida = async (id: UUID) => {
    if (!state.currentUserId) return;
    try {
      await db.markNotificacaoLida(id, state.currentUserId);
      setState((prev) => ({
        ...prev,
        notificacoes: prev.notificacoes.map((n) => n.id === id ? { ...n, lida: true } : n),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const marcarTodasLidas = async () => {
    if (!state.currentUserId) return;
    try {
      await db.markAllNotificacoesLidas(state.currentUserId);
      setState((prev) => ({
        ...prev,
        notificacoes: prev.notificacoes.map((n) => ({ ...n, lida: true })),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const limparNotificacoes = async () => {
    try {
      await db.clearNotificacoes();
      setState((prev) => ({ ...prev, notificacoes: [] }));
    } catch (err) {
      console.error(err);
    }
  };

  const limparHistorico = async () => {
    if (!canAdmin || privileges.isGhost) return;
    const deletedById = state.currentUserId;
    const deletedByNome = currentUser?.nome ?? 'Admin';
    const deletedEm = isoNow();
    const count = state.logs.filter((log) => !log.deletedEm).length;
    if (count === 0) return;
    try {
      await db.clearLogs(deletedById, deletedByNome, deletedEm);
      setState((prev) => ({
        ...prev,
        logs: prev.logs.map((log) =>
          log.deletedEm
            ? log
            : {
                ...log,
                deletedEm,
                deletedById,
                deletedByNome,
              }
        ),
      }));
      await addNotification(
        'Histórico excluído',
        `${deletedByNome} excluiu todo o histórico (${count} registros)`,
        'aviso'
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const removerLogsSelecionados = async (ids: UUID[]) => {
    if (!canAdmin || privileges.isGhost || ids.length === 0) return;
    const idsParaExcluir = ids.filter((id) => {
      const log = state.logs.find((item) => item.id === id);
      return !!log && !log.deletedEm;
    });
    if (idsParaExcluir.length === 0) return;
    const idsParaExcluirSet = new Set(idsParaExcluir);
    const deletedById = state.currentUserId;
    const deletedByNome = currentUser?.nome ?? 'Admin';
    const deletedEm = isoNow();
    try {
      await db.deleteLogsByIds(idsParaExcluir, deletedById, deletedByNome, deletedEm);
      setState((prev) => ({
        ...prev,
        logs: prev.logs.map((log) =>
          idsParaExcluirSet.has(log.id) && !log.deletedEm
            ? {
                ...log,
                deletedEm,
                deletedById,
                deletedByNome,
              }
            : log
        ),
      }));
      await addNotification(
        'Registros do histórico excluídos',
        `${deletedByNome} excluiu ${idsParaExcluir.length} registro(s) do histórico`,
        'aviso'
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const value: SistemaContextValue = {
    ...state,
    empresas: empresasVisiveis,
    usuarios: usuariosVisiveis,
    logs: logsVisiveis,
    currentUser,
    canManage,
    canAdmin,
    isGhost: privileges.isGhost,
    isDeveloper: privileges.isDeveloper,
    isPrivileged: privileges.isPrivileged,
    protectedUserIds: privileges.protectedUserIds,
    loading,
    authReady,
    reloadData,
    login,
    logout,
    mostrarAlerta,
    dismissAlert,
    alerts,
    criarServico,
    removerServico,
    criarTag,
    atualizarTag,
    removerTag,
    criarDepartamento,
    removerDepartamento,
    criarUsuario,
    atualizarUsuario,
    toggleUsuarioAtivo,
    removerUsuario,
    criarEmpresa,
    atualizarEmpresa,
    removerEmpresa,
    adicionarDocumento,
    atualizarDocumento,
    removerDocumento,
    removerRet,
    adicionarObservacao,
    removerObservacao,
    restaurarEmpresa,
    restaurarItem,
    excluirDefinitivamente,
    limparLixeira,
    notificacoes: state.notificacoes ?? [],
    adicionarNotificacao,
    marcarNotificacaoLida,
    marcarTodasLidas,
    limparNotificacoes,
    limparHistorico,
    removerLogsSelecionados,
  };

  return <SistemaContext.Provider value={value}>{children}</SistemaContext.Provider>;
}

export function useSistema() {
  const ctx = useContext(SistemaContext);
  if (!ctx) throw new Error('useSistema deve ser usado dentro do SistemaProvider');
  return ctx;
}



