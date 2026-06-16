'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabasePortal } from '@/lib/supabasePortal';

// ---- Tipos públicos do contexto ----

export type PortalCliente = {
  id: string;
  empresaId: string;
  email: string;
  nomeContato: string | null;
  telefone: string | null;
  ativo: boolean;
  ultimoLoginEm: string | null;
};

export type PortalEmpresa = {
  id: string;
  razaoSocial: string | null;
  apelido: string | null;
  cnpj: string | null;
};

export type PortalAcesso = {
  cliente: PortalCliente;
  empresa: PortalEmpresa | null;
};

export type PortalLoginResult =
  | { status: 'ok' }
  | { status: 'ok_multi' } // logou mas tem N empresas, precisa escolher
  | { status: 'invalid' }
  | { status: 'rate_limited' }
  | { status: 'inactive' }
  | { status: 'error'; message: string };

type PortalContextValue = {
  cliente: PortalCliente | null;
  empresa: PortalEmpresa | null;
  acessos: PortalAcesso[];
  precisaEscolherEmpresa: boolean;
  authReady: boolean;
  login: (email: string, senha: string) => Promise<PortalLoginResult>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  selecionarEmpresa: (clienteId: string) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

// ---- Rate limiting in-memory ----

const MAX_LOGIN_ATTEMPTS = 5;
const RATE_WINDOW_MS = 3 * 60 * 1000;
const STORAGE_KEY_EMPRESA_SELECIONADA = 'controle-triar-portal-empresa-cliente-id';

type AttemptState = { count: number; firstAttemptAt: number };

// ---- Helpers ----

type EmpresaShape = { id: string; razao_social: string | null; apelido: string | null; cnpj: string | null };

function rowToAcesso(row: {
  id: string;
  empresa_id: string;
  email: string;
  nome_contato: string | null;
  telefone: string | null;
  ativo: boolean;
  ultimo_login_em: string | null;
  empresa: EmpresaShape | EmpresaShape[] | null;
}): PortalAcesso {
  const empresaRaw: EmpresaShape | null = Array.isArray(row.empresa)
    ? (row.empresa[0] ?? null)
    : (row.empresa ?? null);

  return {
    cliente: {
      id: row.id,
      empresaId: row.empresa_id,
      email: row.email,
      nomeContato: row.nome_contato ?? null,
      telefone: row.telefone ?? null,
      ativo: !!row.ativo,
      ultimoLoginEm: row.ultimo_login_em ?? null,
    },
    empresa: empresaRaw
      ? {
          id: empresaRaw.id,
          razaoSocial: empresaRaw.razao_social ?? null,
          apelido: empresaRaw.apelido ?? null,
          cnpj: empresaRaw.cnpj ?? null,
        }
      : null,
  };
}

async function fetchAcessosByAuthUser(authUserId: string): Promise<PortalAcesso[]> {
  const { data, error } = await supabasePortal
    .from('clientes_portal')
    .select('id, empresa_id, email, nome_contato, telefone, ativo, ultimo_login_em, empresa:empresas(id, razao_social, apelido, cnpj)')
    .eq('auth_user_id', authUserId)
    .eq('ativo', true)
    .order('criado_em', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as Parameters<typeof rowToAcesso>[0][]).map(rowToAcesso);
}

async function registrarAcesso(acao: 'login' | 'logout', clienteId: string) {
  try {
    await supabasePortal.from('portal_acessos').insert({
      cliente_id: clienteId,
      acao,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
    });
  } catch {
    // Falha de log não bloqueia o fluxo.
  }
}

function lerEmpresaSalva(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY_EMPRESA_SELECIONADA);
  } catch {
    return null;
  }
}

function salvarEmpresa(clienteId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (clienteId) window.sessionStorage.setItem(STORAGE_KEY_EMPRESA_SELECIONADA, clienteId);
    else window.sessionStorage.removeItem(STORAGE_KEY_EMPRESA_SELECIONADA);
  } catch {
    // ignore
  }
}

// ---- Provider ----

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [acessos, setAcessos] = useState<PortalAcesso[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const attemptsRef = useRef<AttemptState | null>(null);

  const acessoSelecionado = useMemo<PortalAcesso | null>(() => {
    if (!clienteIdSelecionado) return acessos.length === 1 ? acessos[0] : null;
    return acessos.find((a) => a.cliente.id === clienteIdSelecionado) ?? null;
  }, [acessos, clienteIdSelecionado]);

  const cliente = acessoSelecionado?.cliente ?? null;
  const empresa = acessoSelecionado?.empresa ?? null;
  const precisaEscolherEmpresa = acessos.length > 1 && !acessoSelecionado;

  const aplicarSessao = useCallback(async (userId: string | null) => {
    if (!userId) {
      setAcessos([]);
      setClienteIdSelecionado(null);
      salvarEmpresa(null);
      return;
    }
    const lista = await fetchAcessosByAuthUser(userId);
    if (lista.length === 0) {
      // Sessão existe mas não é cliente do portal (ou foi desativado).
      await supabasePortal.auth.signOut();
      setAcessos([]);
      setClienteIdSelecionado(null);
      salvarEmpresa(null);
      return;
    }
    setAcessos(lista);

    // Recupera empresa anteriormente selecionada se ainda válida
    const salva = lerEmpresaSalva();
    if (salva && lista.some((a) => a.cliente.id === salva)) {
      setClienteIdSelecionado(salva);
    } else if (lista.length === 1) {
      setClienteIdSelecionado(lista[0].cliente.id);
      salvarEmpresa(lista[0].cliente.id);
    } else {
      // Múltiplas e nenhuma salva: deixa null pra UI mostrar picker
      setClienteIdSelecionado(null);
      salvarEmpresa(null);
    }
  }, []);

  const reload = useCallback(async () => {
    const { data } = await supabasePortal.auth.getSession();
    await aplicarSessao(data.session?.user?.id ?? null);
  }, [aplicarSessao]);

  // Carga inicial + listener de mudança de sessão.
  //
  // PEGADINHA SUPABASE: o callback de `onAuthStateChange` é invocado dentro
  // de um lock interno do supabase-js. Fazer query no DB ali dentro (ou
  // `await` em qualquer método do supabase) gera deadlock. Solução: deferir
  // o trabalho com `setTimeout(0)` pra rodar FORA do lock.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabasePortal.auth.getSession();
        if (cancelled) return;
        await aplicarSessao(data.session?.user?.id ?? null);
      } catch (err) {
        console.error('[PortalContext] erro na carga inicial:', err);
      }
      if (!cancelled) setAuthReady(true);
    })();

    const { data: sub } = supabasePortal.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      setTimeout(() => {
        if (cancelled) return;
        void aplicarSessao(userId).catch((err) =>
          console.error('[PortalContext] erro em onAuthStateChange:', err)
        );
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [aplicarSessao]);

  const checkAndRegisterAttempt = useCallback((): 'ok' | 'rate_limited' => {
    const now = Date.now();
    const st = attemptsRef.current;
    if (!st || now - st.firstAttemptAt > RATE_WINDOW_MS) {
      attemptsRef.current = { count: 1, firstAttemptAt: now };
      return 'ok';
    }
    if (st.count >= MAX_LOGIN_ATTEMPTS) return 'rate_limited';
    st.count += 1;
    return 'ok';
  }, []);

  const resetAttempts = useCallback(() => {
    attemptsRef.current = null;
  }, []);

  const selecionarEmpresa = useCallback(
    (clienteId: string) => {
      const existe = acessos.some((a) => a.cliente.id === clienteId);
      if (!existe) return;
      setClienteIdSelecionado(clienteId);
      salvarEmpresa(clienteId);
      // best-effort: atualiza ultimo_login_em + log
      void supabasePortal
        .from('clientes_portal')
        .update({ ultimo_login_em: new Date().toISOString() })
        .eq('id', clienteId);
      void registrarAcesso('login', clienteId);
    },
    [acessos],
  );

  const login = useCallback(
    async (email: string, senha: string): Promise<PortalLoginResult> => {
      console.log('[PortalLogin] iniciando login com', { email: email.trim().toLowerCase() });

      if (checkAndRegisterAttempt() === 'rate_limited') {
        console.warn('[PortalLogin] rate_limited');
        return { status: 'rate_limited' };
      }

      const { data, error } = await supabasePortal.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });

      if (error) {
        console.error('[PortalLogin] signInWithPassword ERRO:', {
          message: error.message,
          status: error.status,
          name: error.name,
        });
        const msg = error.message?.toLowerCase() ?? '';
        if (msg.includes('invalid') || msg.includes('credentials')) {
          return { status: 'invalid' };
        }
        // Detalhe técnico do GoTrue já foi logado acima; cliente vê msg amigável.
        return { status: 'error', message: 'Não foi possível entrar agora. Tente de novo em instantes; se persistir, fale com o escritório.' };
      }

      const userId = data.user?.id;
      console.log('[PortalLogin] signInWithPassword OK, userId=', userId);
      if (!userId) {
        console.warn('[PortalLogin] resposta sem user.id');
        return { status: 'invalid' };
      }

      const lista = await fetchAcessosByAuthUser(userId);
      console.log('[PortalLogin] fetchAcessosByAuthUser retornou', lista.length, 'acessos', lista);
      if (lista.length === 0) {
        console.warn('[PortalLogin] nenhum cliente_portal ativo encontrado pro auth_user_id', userId, '— fazendo signOut');
        await supabasePortal.auth.signOut();
        return { status: 'invalid' };
      }
      // Note: lista filtra ativos == true, então não precisa testar inactive aqui.

      setAcessos(lista);
      resetAttempts();

      if (lista.length === 1) {
        const unico = lista[0];
        setClienteIdSelecionado(unico.cliente.id);
        salvarEmpresa(unico.cliente.id);

        void supabasePortal
          .from('clientes_portal')
          .update({ ultimo_login_em: new Date().toISOString() })
          .eq('id', unico.cliente.id);
        void registrarAcesso('login', unico.cliente.id);
        return { status: 'ok' };
      }

      // Múltiplas empresas: UI vai mostrar o picker
      setClienteIdSelecionado(null);
      salvarEmpresa(null);
      return { status: 'ok_multi' };
    },
    [checkAndRegisterAttempt, resetAttempts]
  );

  const logout = useCallback(async () => {
    const clienteId = cliente?.id;
    if (clienteId) await registrarAcesso('logout', clienteId);
    await supabasePortal.auth.signOut();
    setAcessos([]);
    setClienteIdSelecionado(null);
    salvarEmpresa(null);
  }, [cliente?.id]);

  const value = useMemo<PortalContextValue>(
    () => ({
      cliente,
      empresa,
      acessos,
      precisaEscolherEmpresa,
      authReady,
      login,
      logout,
      reload,
      selecionarEmpresa,
    }),
    [cliente, empresa, acessos, precisaEscolherEmpresa, authReady, login, logout, reload, selecionarEmpresa]
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal deve ser usado dentro de <PortalProvider>');
  return ctx;
}
