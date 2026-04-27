'use client';

import { useState } from 'react';
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

  async function handleClick() {
    if (loading) return;
    setErro(null);
    setLoading(true);
    try {
      onClick?.();

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setErro('Sessao nao encontrada. Faca login novamente.');
        return;
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
        return;
      }

      const url: string | undefined = data?.ssoUrl;
      if (!url) {
        const fallback = process.env.NEXT_PUBLIC_TAREFAS_URL || FALLBACK_TAREFAS_URL;
        window.location.href = `${fallback}/sso?token=${encodeURIComponent(data?.token || '')}`;
        return;
      }
      window.location.href = url;
    } catch (e: any) {
      setErro(e?.message || 'Erro de conexao');
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'sidebar-expanded') {
    return (
      <div className="px-1.5 pt-1.5 pb-2">
        <button
          onClick={handleClick}
          disabled={loading}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 shadow-md hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          title="Abrir Controle de Tarefas"
        >
          {loading ? <Loader2 size={18} className="animate-spin shrink-0" /> : <ListTodo size={18} className="shrink-0" />}
          <span className="flex-1 text-left">Controle de Tarefas</span>
          <ExternalLink size={14} className="opacity-80 shrink-0" />
        </button>
        {erro && (
          <div className="mt-1.5 text-[10px] text-red-600 font-semibold px-1 leading-tight">{erro}</div>
        )}
      </div>
    );
  }

  if (variant === 'sidebar-collapsed') {
    return (
      <div className="px-1.5 pt-1.5 pb-2">
        <button
          onClick={handleClick}
          disabled={loading}
          className="w-full flex items-center justify-center rounded-lg p-2.5 text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 shadow-md hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          title="Abrir Controle de Tarefas"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <ListTodo size={18} />}
        </button>
      </div>
    );
  }

  if (variant === 'mobile-bar') {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className="p-2 rounded-lg hover:bg-violet-50 text-violet-600 disabled:opacity-60"
        title="Abrir Controle de Tarefas"
      >
        {loading ? <Loader2 size={20} className="animate-spin" /> : <ListTodo size={20} />}
      </button>
    );
  }

  if (variant === 'mobile-menu') {
    return (
      <div className="px-2 pt-2 pb-1">
        <button
          onClick={handleClick}
          disabled={loading}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 shadow-md disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin shrink-0" /> : <ListTodo size={18} className="shrink-0" />}
          <span className="flex-1 text-left">Controle de Tarefas</span>
          <ExternalLink size={14} className="opacity-80 shrink-0" />
        </button>
        {erro && (
          <div className="mt-1.5 text-[10px] text-red-600 font-semibold px-1 leading-tight">{erro}</div>
        )}
      </div>
    );
  }

  // variant === 'card'
  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex items-center justify-between gap-4 rounded-2xl px-6 py-5 text-left text-white bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 hover:from-violet-700 hover:via-fuchsia-700 hover:to-pink-700 shadow-lg hover:shadow-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 shrink-0">
            {loading ? <Loader2 size={24} className="animate-spin" /> : <ListTodo size={24} />}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-tight">Controle de Tarefas</div>
            <div className="text-xs font-semibold text-white/85 mt-0.5">Abrir o sistema de processos e solicitacoes</div>
          </div>
        </div>
        <ExternalLink size={20} className="opacity-90 shrink-0" />
      </button>
      {erro && (
        <div className="mt-2 text-xs text-red-600 font-semibold">{erro}</div>
      )}
    </div>
  );
}
