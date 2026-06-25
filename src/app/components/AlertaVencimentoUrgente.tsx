'use client';

// Alerta PISCANTE no topo: guias que vencem em até 3 dias (ou já venceram) e
// ainda não foram enviadas. Diferente do AlertaGuiasPendentes (que avisa de
// erro/pendência de aprovação) — esse é sobre prazo, mesmo sem erro nenhum:
// a guia simplesmente ainda não chegou/não foi enviada e o vencimento tá em
// cima. Visível pra admin + Fiscal/Fiscal-SN (qualquer papel, não só gerente).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, X } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';

const DISMISS_KEY = 'alerta-vencimento-urgente-dispensado-total';

export default function AlertaVencimentoUrgente() {
  const { authReady, guiasUrgentesContagem } = useSistema();
  const { total, itens } = guiasUrgentesContagem;
  const [dispensadoNoTotal, setDispensadoNoTotal] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (raw != null) setDispensadoNoTotal(Number(raw));
    } catch {
      // ignora
    }
  }, []);

  if (!authReady || total === 0) return null;
  if (dispensadoNoTotal === total) return null;

  const dispensar = () => {
    try { sessionStorage.setItem(DISMISS_KEY, String(total)); } catch { /* ignora */ }
    setDispensadoNoTotal(total);
  };

  const exemplos = itens.slice(0, 3).map((it) => {
    const venceu = it.dias < 0;
    const quando = venceu ? `venceu há ${Math.abs(it.dias)}d` : it.dias === 0 ? 'vence hoje' : `vence em ${it.dias}d`;
    return `${it.empresaNome} — ${it.obrigacao} (${quando})`;
  });

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm shadow-sm animate-pulse">
      <AlertOctagon size={20} className="shrink-0 text-red-600" />
      <div className="min-w-0 flex-1 text-red-900">
        <span className="font-bold">
          {total} {total === 1 ? 'guia vencendo sem envio' : 'guias vencendo sem envio'}
        </span>{' '}
        <span className="text-red-800">— verifique urgente.</span>
        {exemplos.length > 0 && (
          <div className="mt-0.5 text-xs text-red-700">
            {exemplos.join(' · ')}{itens.length > 3 ? ` · +${itens.length - 3}` : ''}
          </div>
        )}
      </div>
      <Link
        href="/vencimentos-fiscais/checklist"
        className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
      >
        Ver checklist
      </Link>
      <button
        onClick={dispensar}
        aria-label="Dispensar aviso"
        className="shrink-0 text-red-700 hover:text-red-900"
      >
        <X size={16} />
      </button>
    </div>
  );
}
