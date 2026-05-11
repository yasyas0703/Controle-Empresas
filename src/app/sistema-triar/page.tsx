'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSistema } from '@/app/context/SistemaContext';
import { Loader2, ShieldCheck } from 'lucide-react';

// Porta de entrada secreta do sistema interno.
// Quando o usuário não está logado, o AppShell mostra o modal de login automaticamente.
// Quando o login é feito, o SistemaContext seta o cookie "triar-staff" e
// a middleware passa a liberar /dashboard, /empresas, etc.
export default function SistemaEntrarPage() {
  const router = useRouter();
  const { currentUser, authReady } = useSistema();

  useEffect(() => {
    if (authReady && currentUser) {
      router.replace('/dashboard');
    }
  }, [authReady, currentUser, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50 ring-1 ring-cyan-100 dark:bg-cyan-950/40 dark:ring-cyan-900">
          <ShieldCheck size={22} className="text-cyan-700 dark:text-cyan-400" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Acesso interno</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Faça login para continuar.
        </p>
        {authReady && currentUser && (
          <div className="mt-4 inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Redirecionando...
          </div>
        )}
      </div>
    </div>
  );
}
