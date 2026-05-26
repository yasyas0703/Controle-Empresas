'use client';

// Error Boundary do portal cliente. Separado do app/error.tsx porque o portal
// NÃO tem SistemaContext nem ToastStack — qualquer fallback que tente usar
// `useSistema()` quebraria de novo. Mantém só Tailwind + ações cliente puras.

import { useEffect } from 'react';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[portal/error.tsx] erro capturado:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Erro inesperado</p>
        <p className="mt-2 text-base text-slate-700 dark:text-slate-300">
          Algo deu errado ao carregar o portal.
        </p>
        {error?.digest ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Código do erro: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Tentar de novo
          </button>
          <a
            href="/portal"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Voltar
          </a>
        </div>
      </div>
    </div>
  );
}
