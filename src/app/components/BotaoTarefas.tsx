'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ListTodo, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Variant = 'sidebar-expanded' | 'sidebar-collapsed' | 'mobile-bar' | 'mobile-menu' | 'card';

interface Props {
  variant: Variant;
  onClick?: () => void;
}

const FALLBACK_TAREFAS_URL = 'https://controle-tarefas.vercel.app';

export default function BotaoTarefas({ variant, onClick }: Props) {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ssoUrl, setSsoUrl] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const buscarSsoUrl = useCallback(async (): Promise<string | null> => {
    if (ssoUrl) return ssoUrl;
    if (fetchingRef.current) return null;
    fetchingRef.current = true;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setErro('Sessão não encontrada. Faça login novamente.');
        return null;
      }

      const res = await fetch('/api/sso/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        setErro(data?.error || 'Falha ao gerar acesso ao Tarefas');
        return null;
      }

      const url: string | undefined = data?.ssoUrl
        ?? (data?.token
          ? `${process.env.NEXT_PUBLIC_TAREFAS_URL || FALLBACK_TAREFAS_URL}/sso?token=${encodeURIComponent(data.token)}`
          : undefined);

      if (!url) {
        setErro('Falha ao gerar acesso ao Tarefas');
        return null;
      }

      setSsoUrl(url);
      setErro(null);
      return url;
    } catch (e: any) {
      setErro(e?.message || 'Erro de conexão');
      return null;
    } finally {
      fetchingRef.current = false;
    }
  }, [ssoUrl]);

  // Pré-busca silenciosa ao montar — assim o click abre direto, sem popup blocker
  useEffect(() => {
    void buscarSsoUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click: se já temos URL, deixa o <a target="_blank"> abrir naturalmente.
  // Se ainda não temos (pré-busca falhou), busca e navega na mesma aba (sem popup blocker).
  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.();
    if (ssoUrl) return; // anchor abre nova aba normalmente
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const url = await buscarSsoUrl();
    setLoading(false);
    if (url) {
      // Sem popup blocker: navega na aba atual
      window.location.href = url;
    }
  }

  // Re-busca em hover/focus caso ainda não tenhamos
  const prefetch = () => { if (!ssoUrl && !fetchingRef.current) void buscarSsoUrl(); };

  const commonAnchorProps = {
    href: ssoUrl ?? '#',
    target: '_blank' as const,
    rel: 'noopener noreferrer',
    onClick: handleClick,
    onMouseEnter: prefetch,
    onFocus: prefetch,
    'aria-busy': loading,
  };

  if (variant === 'sidebar-expanded') {
    return (
      <div className="px-1.5 pt-1.5 pb-2">
        <a
          {...commonAnchorProps}
          className="w-full flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] bg-[var(--surface-3)] border border-transparent hover:bg-[var(--brand-soft)] hover:border-[var(--brand)] transition-colors aria-busy:opacity-60"
          title="Abrir Controle de Tarefas"
        >
          {loading ? <Loader2 size={18} className="animate-spin shrink-0 text-[var(--brand)]" /> : <ListTodo size={18} className="shrink-0 text-[var(--brand)]" />}
          <span className="flex-1 text-left">Controle de Tarefas</span>
          <ExternalLink size={14} className="text-[var(--text-3)] shrink-0" />
        </a>
        {erro && (
          <div className="mt-1.5 text-[10px] text-[var(--danger)] font-semibold px-1 leading-tight">{erro}</div>
        )}
      </div>
    );
  }

  if (variant === 'sidebar-collapsed') {
    return (
      <div className="px-1.5 pt-1.5 pb-2">
        <a
          {...commonAnchorProps}
          className="w-full flex items-center justify-center rounded-[var(--radius)] p-2.5 text-[var(--brand)] bg-[var(--surface-3)] border border-transparent hover:bg-[var(--brand-soft)] hover:border-[var(--brand)] transition-colors aria-busy:opacity-60"
          title="Abrir Controle de Tarefas"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <ListTodo size={18} />}
        </a>
      </div>
    );
  }

  if (variant === 'mobile-bar') {
    return (
      <a
        {...commonAnchorProps}
        className="p-2 rounded-[var(--radius)] hover:bg-[var(--surface-3)] text-[var(--brand)] aria-busy:opacity-60"
        title="Abrir Controle de Tarefas"
      >
        {loading ? <Loader2 size={20} className="animate-spin" /> : <ListTodo size={20} />}
      </a>
    );
  }

  if (variant === 'mobile-menu') {
    return (
      <div className="px-2 pt-2 pb-1">
        <a
          {...commonAnchorProps}
          className="w-full flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] bg-[var(--surface-3)] border border-transparent hover:bg-[var(--brand-soft)] hover:border-[var(--brand)] transition-colors aria-busy:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin shrink-0 text-[var(--brand)]" /> : <ListTodo size={18} className="shrink-0 text-[var(--brand)]" />}
          <span className="flex-1 text-left">Controle de Tarefas</span>
          <ExternalLink size={14} className="text-[var(--text-3)] shrink-0" />
        </a>
        {erro && (
          <div className="mt-1.5 text-[10px] text-[var(--danger)] font-semibold px-1 leading-tight">{erro}</div>
        )}
      </div>
    );
  }

  // variant === 'card'
  return (
    <div>
      <a
        {...commonAnchorProps}
        className="w-full flex items-center justify-between gap-4 rounded-[var(--radius-md)] px-6 py-5 text-left bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--brand)] hover:bg-[var(--surface-3)] transition-colors aria-busy:opacity-60"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center justify-center w-12 h-12 rounded-md bg-[var(--brand-soft)] text-[var(--brand)] shrink-0">
            {loading ? <Loader2 size={24} className="animate-spin" /> : <ListTodo size={24} />}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-[var(--text-1)] leading-tight">Controle de Tarefas</div>
            <div className="text-xs font-medium text-[var(--text-3)] mt-0.5">Abrir o sistema de processos e solicitações</div>
          </div>
        </div>
        <ExternalLink size={20} className="text-[var(--text-3)] shrink-0" />
      </a>
      {erro && (
        <div className="mt-2 text-xs text-[var(--danger)] font-semibold">{erro}</div>
      )}
    </div>
  );
}
