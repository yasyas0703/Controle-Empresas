'use client';

// global-error.tsx é o último recurso do App Router: ele substitui o
// RootLayout inteiro quando até esse falha (ex: Providers.tsx atira no render).
// Por isso tem que incluir <html> e <body> próprios. Inline-styles aqui
// porque o globals.css pode não ter sido injetado se o crash for muito cedo.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error.tsx] erro fatal:', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#f8fafc',
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <p style={{ color: '#dc2626', fontSize: 14, fontWeight: 500, margin: 0 }}>
            Erro fatal
          </p>
          <p style={{ color: '#334155', fontSize: 16, margin: '8px 0 0' }}>
            O sistema não conseguiu carregar. Tente recarregar a página.
          </p>
          {error?.digest ? (
            <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0' }}>
              Código do erro:{' '}
              <span style={{ fontFamily: 'monospace' }}>{error.digest}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              color: '#fff',
              background: '#0f172a',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
