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

export type PortalLoginResult =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'rate_limited' }
  | { status: 'inactive' }
  | { status: 'error'; message: string };

type PortalContextValue = {
  cliente: PortalCliente | null;
  empresa: PortalEmpresa | null;
  authReady: boolean;
  login: (email: string, senha: string) => Promise<PortalLoginResult>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const PortalContext = createContext<PortalContextValue | null>(null);

// ---- Rate limiting in-memory (mesmo padrão do AppShell interno) ----

const MAX_LOGIN_ATTEMPTS = 5;
const RATE_WINDOW_MS = 3 * 60 * 1000;

type AttemptState = { count: number; firstAttemptAt: number };

// ---- Helpers ----

async function fetchClienteEEmpresa(clienteId: string): Promise<{ cliente: PortalCliente; empresa: PortalEmpresa | null } | null> {
  // Single round-trip: cliente + empresa via embedded select. Antes eram 2 awaits sequenciais.
  const { data, error } = await supabasePortal
    .from('clientes_portal')
    .select('id, empresa_id, email, nome_contato, telefone, ativo, ultimo_login_em, empresa:empresas(id, razao_social, apelido, cnpj)')
    .eq('id', clienteId)
    .maybeSingle();

  if (error || !data) return null;

  type EmpresaShape = { id: string; razao_social: string | null; apelido: string | null; cnpj: string | null };
  const empresaField = (data as unknown as { empresa: EmpresaShape | EmpresaShape[] | null }).empresa;
  const empresaRaw: EmpresaShape | null = Array.isArray(empresaField)
    ? (empresaField[0] ?? null)
    : (empresaField ?? null);

  const cliente: PortalCliente = {
    id: data.id,
    empresaId: data.empresa_id,
    email: data.email,
    nomeContato: data.nome_contato ?? null,
    telefone: data.telefone ?? null,
    ativo: !!data.ativo,
    ultimoLoginEm: data.ultimo_login_em ?? null,
  };

  const empresa: PortalEmpresa | null = empresaRaw
    ? {
        id: empresaRaw.id,
        razaoSocial: empresaRaw.razao_social ?? null,
        apelido: empresaRaw.apelido ?? null,
        cnpj: empresaRaw.cnpj ?? null,
      }
    : null;

  return { cliente, empresa };
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

// ---- Provider ----

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [cliente, setCliente] = useState<PortalCliente | null>(null);
  const [empresa, setEmpresa] = useState<PortalEmpresa | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const attemptsRef = useRef<AttemptState | null>(null);

  const applySession = useCallback(async (userId: string | null) => {
    if (!userId) {
      setCliente(null);
      setEmpresa(null);
      return;
    }
    const result = await fetchClienteEEmpresa(userId);
    if (!result) {
      // Sessão do Supabase existe, mas o usuário não é cliente do portal
      // (ou foi desativado). Limpa pra forçar nova autenticação.
      await supabasePortal.auth.signOut();
      setCliente(null);
      setEmpresa(null);
      return;
    }
    if (!result.cliente.ativo) {
      await supabasePortal.auth.signOut();
      setCliente(null);
      setEmpresa(null);
      return;
    }
    setCliente(result.cliente);
    setEmpresa(result.empresa);
  }, []);

  const reload = useCallback(async () => {
    const { data } = await supabasePortal.auth.getSession();
    await applySession(data.session?.user?.id ?? null);
  }, [applySession]);

  // Carrega sessão inicial + escuta mudanças.
  //
  // PEGADINHA SUPABASE: o callback de `onAuthStateChange` é invocado dentro
  // de um lock interno do supabase-js. Fazer query no DB ali dentro (ou
  // `await` em qualquer método do supabase) gera deadlock — o app fica em
  // loading infinito quando há sessão persistida (recarregar página, voltar
  // depois). A solução padrão é deferir o trabalho com `setTimeout(0)`
  // pra que ele rode FORA do lock.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabasePortal.auth.getSession();
        if (cancelled) return;
        await applySession(data.session?.user?.id ?? null);
      } catch (err) {
        console.error('[PortalContext] erro na carga inicial:', err);
      }
      if (!cancelled) setAuthReady(true);
    })();

    const { data: sub } = supabasePortal.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      setTimeout(() => {
        if (cancelled) return;
        void applySession(userId).catch((err) =>
          console.error('[PortalContext] erro em onAuthStateChange:', err)
        );
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);

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

  const login = useCallback(
    async (email: string, senha: string): Promise<PortalLoginResult> => {
      if (checkAndRegisterAttempt() === 'rate_limited') {
        return { status: 'rate_limited' };
      }

      const { data, error } = await supabasePortal.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });

      if (error) {
        const msg = error.message?.toLowerCase() ?? '';
        if (msg.includes('invalid') || msg.includes('credentials')) {
          return { status: 'invalid' };
        }
        return { status: 'error', message: error.message || 'Erro ao autenticar.' };
      }

      const userId = data.user?.id;
      if (!userId) return { status: 'invalid' };

      const result = await fetchClienteEEmpresa(userId);
      if (!result) {
        // Existe no auth.users, mas não é cliente do portal.
        await supabasePortal.auth.signOut();
        return { status: 'invalid' };
      }
      if (!result.cliente.ativo) {
        await supabasePortal.auth.signOut();
        return { status: 'inactive' };
      }

      setCliente(result.cliente);
      setEmpresa(result.empresa);
      resetAttempts();

      // Atualiza ultimo_login_em + grava em portal_acessos (best-effort)
      void supabasePortal
        .from('clientes_portal')
        .update({ ultimo_login_em: new Date().toISOString() })
        .eq('id', userId);
      void registrarAcesso('login', userId);

      return { status: 'ok' };
    },
    [checkAndRegisterAttempt, resetAttempts]
  );

  const logout = useCallback(async () => {
    const clienteId = cliente?.id;
    if (clienteId) await registrarAcesso('logout', clienteId);
    await supabasePortal.auth.signOut();
    setCliente(null);
    setEmpresa(null);
  }, [cliente?.id]);

  const value = useMemo<PortalContextValue>(
    () => ({ cliente, empresa, authReady, login, logout, reload }),
    [cliente, empresa, authReady, login, logout, reload]
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal deve ser usado dentro de <PortalProvider>');
  return ctx;
}
