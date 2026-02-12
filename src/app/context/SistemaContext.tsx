'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  Departamento,
  DocumentoEmpresa,
  Empresa,
  LixeiraItem,
  LogEntry,
  Notificacao,
  Observacao,
  Servico,
  SistemaState,
  Usuario,
  UUID,
} from '@/app/types';
import { isoNow } from '@/app/utils/date';
import * as db from '@/lib/db';
import { supabase } from '@/lib/supabase';

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

type AlertType = 'sucesso' | 'aviso' | 'erro';
export type AlertItem = { id: UUID; title: string; message: string; type: AlertType };

interface SistemaContextValue extends SistemaState {
  currentUser: Usuario | null;
  canManage: boolean;
  loading: boolean;
  authReady: boolean;
  reloadData: () => Promise<void>;

  login: (email: string, senha: string) => Promise<boolean>;
  logout: () => void;

  mostrarAlerta: (title: string, message: string, type: AlertType) => void;
  dismissAlert: (id: UUID) => void;
  alerts: AlertItem[];

  // Serviços
  criarServico: (nome: string) => Promise<UUID | null>;
  removerServico: (id: UUID) => Promise<void>;

  // Departamentos
  criarDepartamento: (nome: string) => Promise<UUID | null>;
  removerDepartamento: (id: UUID) => Promise<void>;

  // Usuários
  criarUsuario: (payload: Omit<Usuario, 'id' | 'criadoEm' | 'atualizadoEm'>) => Promise<UUID | null>;
  atualizarUsuario: (id: UUID, patch: Partial<Usuario>) => Promise<void>;
  toggleUsuarioAtivo: (id: UUID) => Promise<void>;
  removerUsuario: (id: UUID) => Promise<void>;

  // Empresas
  criarEmpresa: (payload: Partial<Empresa>) => Promise<UUID>;
  atualizarEmpresa: (id: UUID, patch: Partial<Empresa>) => Promise<void>;
  removerEmpresa: (id: UUID) => Promise<void>;

  // Documentos
  adicionarDocumento: (empresaId: UUID, doc: Omit<DocumentoEmpresa, 'id' | 'criadoEm' | 'atualizadoEm'>, file?: File) => Promise<void>;
  removerDocumento: (empresaId: UUID, docId: UUID) => Promise<void>;

  // Observações
  adicionarObservacao: (empresaId: UUID, texto: string) => Promise<void>;
  removerObservacao: (empresaId: UUID, obsId: UUID) => Promise<void>;

  // Lixeira
  restaurarEmpresa: (lixeiraItemId: UUID) => Promise<void>;
  restaurarItem: (lixeiraItemId: UUID) => Promise<void>;
  excluirDefinitivamente: (lixeiraItemId: UUID) => Promise<void>;
  limparLixeira: () => Promise<void>;

  // Notificações
  notificacoes: Notificacao[];
  adicionarNotificacao: (titulo: string, mensagem: string, tipo: Notificacao['tipo']) => Promise<void>;
  marcarNotificacaoLida: (id: UUID) => Promise<void>;
  marcarTodasLidas: () => Promise<void>;
  limparNotificacoes: () => Promise<void>;
}

const SistemaContext = createContext<SistemaContextValue | null>(null);

export function SistemaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SistemaState>({
    empresas: [],
    usuarios: [],
    departamentos: [],
    servicos: [],
    logs: [],
    lixeira: [],
    notificacoes: [],
    currentUserId: null,
  });
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const [authReady, setAuthReady] = useState(false);

  const loadForUser = useCallback(
    async (userId: UUID) => {
      // Sempre carregamos o próprio perfil primeiro (define canManage de forma confiável)
      const meList = await db.fetchUsuarioById(userId);
      const me = meList[0] ?? null;
      const isManager = !!me && me.ativo && me.role === 'gerente';

      const [empresas, departamentos, servicos, notificacoes, logs, lixeira, usuarios] = await Promise.all([
        db.fetchEmpresas(),
        db.fetchDepartamentos(),
        db.fetchServicos(),
        db.fetchNotificacoes(),
        isManager ? db.fetchLogs() : Promise.resolve([]),
        isManager ? db.fetchLixeira() : Promise.resolve([]),
        isManager ? db.fetchUsuariosAdmin() : Promise.resolve(me ? [me] : []),
      ]);

      // Auto-purge: remover itens da lixeira com mais de 10 dias
      if (isManager) {
        db.purgeLixeiraOlderThan(10).catch(() => {});
      }

      setState((prev) => ({
        empresas,
        usuarios,
        departamentos,
        servicos,
        logs,
        lixeira,
        notificacoes,
        currentUserId: userId,
      }));
    },
    []
  );

  // ── Load all data from Supabase ──
  const reloadData = useCallback(async () => {
    try {
      if (!state.currentUserId) return;
      await loadForUser(state.currentUserId);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  }, [loadForUser, state.currentUserId]);

  // Auth + initial load
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
          await loadForUser(userId as UUID).catch((err) => console.error(err));
        } else {
          setState((prev) => ({ ...prev, currentUserId: null }));
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
        loadForUser(userId as UUID)
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
          logs: [],
          lixeira: [],
          notificacoes: [],
        }));
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [loadForUser]);

  const currentUser = useMemo(
    () => state.usuarios.find((u) => u.id === state.currentUserId) ?? null,
    [state.currentUserId, state.usuarios]
  );

  const canManage = currentUser?.role === 'gerente';

  const pushLog = async (entry: Omit<LogEntry, 'id' | 'em' | 'userId'> & { diff?: LogEntry['diff'] }) => {
    try {
      await db.insertLog({
        userId: state.currentUserId,
        ...entry,
      });
    } catch (err) {
      console.error('Erro ao inserir log:', err);
    }
  };

  const mostrarAlerta = (title: string, message: string, type: AlertType) => {
    const id = newId();
    setAlerts((prev) => [{ id, title, message, type }, ...prev].slice(0, 5));
    pushLog({ action: 'alert', entity: 'empresa', entityId: null, message: `${type.toUpperCase()}: ${title} - ${message}` });
    window.setTimeout(() => dismissAlert(id), 5000);
  };

  const dismissAlert = (id: UUID) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  const addNotification = async (titulo: string, mensagem: string, tipo: Notificacao['tipo']) => {
    try {
      const notif = await db.insertNotificacao({
        titulo,
        mensagem,
        tipo,
        lida: false,
        autorId: state.currentUserId,
        autorNome: currentUser?.nome,
      });
      setState((prev) => ({
        ...prev,
        notificacoes: [notif, ...prev.notificacoes].slice(0, 100),
      }));
    } catch (err) {
      console.error('Erro ao inserir notificação:', err);
    }
  };

  // ── Auth ──

  const login = async (email: string, senha: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session?.user) return false;
    const userId = data.session.user.id;
    setLoading(true);
    try {
      await loadForUser(userId as UUID);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
    await pushLog({ action: 'login', entity: 'usuario', entityId: userId, message: `Login` });
    return true;
  };

  const logout = () => {
    pushLog({ action: 'logout', entity: 'usuario', entityId: state.currentUserId, message: `Logout` });
    supabase.auth.signOut().catch((err) => console.error('Erro ao sair:', err));
    setState((prev) => ({ ...prev, currentUserId: null }));
  };

  // ── Serviços ──

  const criarServico = async (nome: string) => {
    if (!canManage) return null;
    try {
      const servico = await db.insertServico(nome);
      await pushLog({ action: 'create', entity: 'departamento', entityId: servico.id, message: `Criou serviço: ${nome}` });
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
      await pushLog({ action: 'delete', entity: 'departamento', entityId: id, message: `Removeu serviço: ${servico?.nome ?? id}` });
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

  // ── Departamentos ──

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
          const { [id]: _, ...rest } = e.responsaveis;
          return { ...e, responsaveis: rest };
        }),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  // ── Usuários ──

  const criarUsuario = async (payload: Omit<Usuario, 'id' | 'criadoEm' | 'atualizadoEm'>) => {
    if (!canManage) return null;
    try {
      const user = await db.insertUsuario(payload);
      await pushLog({ action: 'create', entity: 'usuario', entityId: user.id, message: `Criou usuário: ${user.nome}` });
      setState((prev) => ({ ...prev, usuarios: [user, ...prev.usuarios] }));
      return user.id;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const atualizarUsuario = async (id: UUID, patch: Partial<Usuario>) => {
    if (!canManage) return;
    const before = state.usuarios.find((u) => u.id === id);
    if (!before) return;
    const after = { ...before, ...patch, atualizadoEm: isoNow() };
    const diff = diffObjects(before as any, after as any);
    try {
      await db.updateUsuario(id, patch);
      await pushLog({ action: 'update', entity: 'usuario', entityId: id, message: `Atualizou usuário: ${before.nome}`, diff });
      setState((prev) => ({
        ...prev,
        usuarios: prev.usuarios.map((u) => (u.id === id ? after : u)),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const toggleUsuarioAtivo = async (id: UUID) => {
    const user = state.usuarios.find((u) => u.id === id);
    if (!user) return;
    await atualizarUsuario(id, { ativo: !user.ativo });
  };

  const removerUsuario = async (id: UUID) => {
    if (!canManage) return;
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

  // ── Empresas ──

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
        possuiRet: payload.possuiRet ?? false,
        rets: payload.rets ?? [],
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
        documentos: payload.documentos ?? [],
        observacoes: payload.observacoes ?? [],
        criadoEm: isoNow(),
        atualizadoEm: isoNow(),
      };

      await pushLog({ action: 'create', entity: 'empresa', entityId: empresaId, message: `Criou empresa: ${empresa.codigo} - ${empresa.razao_social ?? empresa.apelido ?? ''}` });
      await addNotification('Nova empresa cadastrada', `${empresa.codigo} - ${empresa.razao_social || empresa.apelido || ''} foi cadastrada por ${currentUser?.nome ?? 'Desconhecido'}`, 'sucesso');

      setState((prev) => ({ ...prev, empresas: [empresa, ...prev.empresas] }));
      return empresaId;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const atualizarEmpresa = async (id: UUID, patch: Partial<Empresa>) => {
    const before = state.empresas.find((e) => e.id === id);
    if (!before) return;
    const after: Empresa = {
      ...before,
      ...patch,
      responsaveis: { ...before.responsaveis, ...(patch.responsaveis ?? {}) },
      atualizadoEm: isoNow(),
    };
    const diff = diffObjects(before as any, after as any);
    try {
      await db.updateEmpresa(id, patch);
      await pushLog({ action: 'update', entity: 'empresa', entityId: id, message: `Atualizou empresa: ${before.codigo}`, diff });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) => (e.id === id ? after : e)),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const removerEmpresa = async (id: UUID) => {
    if (!canManage) return;
    const empresa = state.empresas.find((e) => e.id === id);
    if (!empresa) return;
    try {
      const lixeiraItem = await db.insertLixeira(empresa, state.currentUserId, currentUser?.nome ?? 'Desconhecido');
      await db.deleteEmpresa(id);
      await pushLog({ action: 'delete', entity: 'empresa', entityId: id, message: `Moveu empresa para lixeira: ${empresa.codigo}` });
      await addNotification('Empresa excluída', `${empresa.codigo} - ${empresa.razao_social || empresa.apelido || ''} foi movida para a lixeira por ${currentUser?.nome ?? 'Desconhecido'}`, 'aviso');
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
      await addNotification('Empresa restaurada', `${item.empresa.codigo} - ${item.empresa.razao_social || item.empresa.apelido || ''} foi restaurada por ${currentUser?.nome ?? 'Desconhecido'}`, 'sucesso');
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

  // ── Documentos ──

  const adicionarDocumento = async (empresaId: UUID, doc: Omit<DocumentoEmpresa, 'id' | 'criadoEm' | 'atualizadoEm'>, file?: File) => {
    try {
      let arquivoUrl = doc.arquivoUrl;
      if (file) {
        try {
          arquivoUrl = await db.uploadDocumentoArquivo(empresaId, file);
        } catch (uploadErr: any) {
          console.error('Erro no upload:', uploadErr);
          mostrarAlerta('Erro no upload', uploadErr?.message || 'Não foi possível enviar o arquivo. Verifique se o bucket "documentos" existe no Supabase Storage.', 'erro');
          // Continua criando o documento sem arquivo
          arquivoUrl = undefined;
        }
      }
      const novo = await db.insertDocumento(empresaId, { ...doc, arquivoUrl });
      await pushLog({ action: 'create', entity: 'documento', entityId: novo.id, message: `Adicionou documento: ${doc.nome}` });
      setState((prev) => ({
        ...prev,
        empresas: prev.empresas.map((e) =>
          e.id === empresaId ? { ...e, documentos: [novo, ...e.documentos], atualizadoEm: isoNow() } : e
        ),
      }));
    } catch (err: any) {
      console.error(err);
      mostrarAlerta('Erro ao adicionar documento', err?.message || 'Falha ao salvar documento.', 'erro');
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
          // Se falhar ao inserir na lixeira, o doc já foi deletado — apenas logar
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

  // ── Observações ──

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

  // ── Notificações ──

  const adicionarNotificacao = async (titulo: string, mensagem: string, tipo: Notificacao['tipo']) => {
    await addNotification(titulo, mensagem, tipo);
  };

  const marcarNotificacaoLida = async (id: UUID) => {
    try {
      await db.markNotificacaoLida(id);
      setState((prev) => ({
        ...prev,
        notificacoes: prev.notificacoes.map((n) => n.id === id ? { ...n, lida: true } : n),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const marcarTodasLidas = async () => {
    try {
      await db.markAllNotificacoesLidas();
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

  const value: SistemaContextValue = {
    ...state,
    currentUser,
    canManage,
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
    removerDocumento,
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
  };

  return <SistemaContext.Provider value={value}>{children}</SistemaContext.Provider>;
}

export function useSistema() {
  const ctx = useContext(SistemaContext);
  if (!ctx) throw new Error('useSistema deve ser usado dentro do SistemaProvider');
  return ctx;
}
