'use client';

// Alerta no topo do app pra gerência: quantas guias NÃO foram enviadas
// (problemas + pendências de aprovação do envio automático). Aparece só pra
// admin/gerente, só quando há pendências, é dispensável (reaparece se o número
// mudar), e atualiza sozinho a cada 60s. Link direto pro painel de resolução.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSistema } from '@/app/context/SistemaContext';

const DISMISS_KEY = 'alerta-guias-pendentes-dispensado-total';

export default function AlertaGuiasPendentes() {
  const { canManage, authReady } = useSistema();
  const [problemas, setProblemas] = useState(0);
  const [pendencias, setPendencias] = useState(0);
  const [dispensadoNoTotal, setDispensadoNoTotal] = useState<number | null>(null);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/admin/guias-auto/contagem', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      setProblemas(Number(j.problemasPendentes) || 0);
      setPendencias(Number(j.pendenciasAprovacao) || 0);
      setCarregado(true);
    } catch {
      // silencioso — alerta não pode quebrar o app
    }
  }, []);

  // Restaura a dispensa da sessão.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (raw != null) setDispensadoNoTotal(Number(raw));
    } catch {
      // ignora
    }
  }, []);

  useEffect(() => {
    if (!authReady || !canManage) return;
    carregar();
    const id = setInterval(carregar, 60_000);
    return () => clearInterval(id);
  }, [authReady, canManage, carregar]);

  const total = problemas + pendencias;

  if (!authReady || !canManage || !carregado || total === 0) return null;
  // Dispensado pra ESTE total exato — se aparecer/sumir guia, o número muda e o alerta volta.
  if (dispensadoNoTotal === total) return null;

  const dispensar = () => {
    try { sessionStorage.setItem(DISMISS_KEY, String(total)); } catch { /* ignora */ }
    setDispensadoNoTotal(total);
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
      <AlertTriangle size={18} className="shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 text-amber-900">
        <span className="font-semibold">
          {total} {total === 1 ? 'guia não foi enviada' : 'guias não foram enviadas'}
        </span>{' '}
        <span className="text-amber-800">
          ({problemas} com problema{pendencias > 0 ? `, ${pendencias} aguardando aprovação` : ''})
        </span>
      </div>
      <Link
        href="/vencimentos-fiscais/auto-problemas"
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
      >
        Ver e resolver
      </Link>
      <button
        onClick={dispensar}
        aria-label="Dispensar aviso"
        className="shrink-0 text-amber-700 hover:text-amber-900"
      >
        <X size={16} />
      </button>
    </div>
  );
}
