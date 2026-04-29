'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function WhoamiDebugPage() {
  const [loading, setLoading] = useState(true);
  const [resultado, setResultado] = useState<unknown>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          setErro('Sem sessão. Faça login primeiro e abra esta página de novo.');
          setLoading(false);
          return;
        }
        const r = await fetch('/api/debug/whoami', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await r.json();
        setResultado(j);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const json = resultado ? JSON.stringify(resultado, null, 2) : '';

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Debug — whoami</h1>

      {loading && <div className="text-gray-500">Carregando…</div>}

      {erro && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {resultado != null && (
        <>
          <button
            onClick={() => {
              navigator.clipboard.writeText(json).then(
                () => alert('JSON copiado para a área de transferência'),
                () => alert('Falha ao copiar — selecione o texto manualmente'),
              );
            }}
            className="rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 text-sm font-bold"
          >
            Copiar JSON
          </button>

          <pre className="rounded-xl bg-gray-900 text-gray-100 text-xs p-4 overflow-auto max-h-[70vh] whitespace-pre-wrap break-all">
            {json}
          </pre>
        </>
      )}
    </div>
  );
}
