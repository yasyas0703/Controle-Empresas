'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { usePortal } from '@/app/portal/PortalContext';
import InstallPrompt from '@/app/portal/components/InstallPrompt';

export default function PortalLoginPage() {
  const router = useRouter();
  const { cliente, authReady, login } = usePortal();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && cliente) router.replace('/portal');
  }, [authReady, cliente, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim() || !senha) {
      setErro('Preencha email e senha.');
      return;
    }
    setLoading(true);
    const result = await login(email, senha);
    setLoading(false);

    switch (result.status) {
      case 'ok':
        router.replace('/portal');
        return;
      case 'invalid':
        setErro('Email ou senha incorretos.');
        return;
      case 'inactive':
        setErro('Seu acesso foi desativado. Entre em contato com o escritório.');
        return;
      case 'rate_limited':
        setErro('Muitas tentativas seguidas. Aguarde 3 minutos e tente novamente.');
        return;
      case 'error':
        setErro(result.message);
        return;
    }
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <InstallPrompt />
        <div className="mb-6 mt-4 flex flex-col items-center text-center">
          <Image src="/triar.png" alt="Triar" width={56} height={56} className="rounded" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-100">Portal do Cliente</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Triar Contabilidade</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-300">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-950"
              placeholder="seu@email.com"
              disabled={loading}
            />
          </label>

          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-300">Senha</span>
            <div className="relative">
              <input
                type={showSenha ? 'text' : 'password'}
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-950"
                placeholder="••••••••"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowSenha((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-700"
                tabIndex={-1}
                aria-label={showSenha ? 'Esconder senha' : 'Mostrar senha'}
              >
                {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {erro && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            Entrar
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Esqueceu a senha? Entre em contato com o escritório.
          </p>
        </form>
      </div>
    </div>
  );
}
