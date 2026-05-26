'use client';

// Error Boundary do segmento raiz do App Router. É chamado pelo Next.js
// quando algum componente abaixo deste segmento (qualquer página fora de
// /portal) atira durante render/effect. Sem isso, um erro derrubava a árvore
// inteira e o usuário via tela branca.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log básico — vai pro stdout do servidor (Vercel) e console do browser.
    // Quando o logger estruturado entrar (Pino), trocar por logger.error(...).
    console.error('[app/error.tsx] erro capturado:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Erro inesperado</p>
        <p className="mt-2 text-base text-slate-700 dark:text-slate-300">
          Algo deu errado ao carregar esta tela.
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
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Tentar de novo
          </button>
          <a
            href="/dashboard"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Ir pro Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
