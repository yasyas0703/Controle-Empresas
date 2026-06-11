'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Grid3x3, ListChecks, Send } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';

const TABS = [
  { href: '/vencimentos-fiscais', label: 'Painel Fiscal', icon: Grid3x3, badge: false },
  { href: '/vencimentos-fiscais/checklist', label: 'Checklist Mensal', icon: ListChecks, badge: false },
  { href: '/vencimentos-fiscais/envio', label: 'Envio de Guias', icon: Send, badge: false },
  { href: '/vencimentos-fiscais/auto-problemas', label: 'Pendências Auto', icon: AlertTriangle, badge: true },
] as const;

export default function FiscalTabs() {
  const pathname = usePathname();
  // Badge de pendências automáticas: usa a contagem compartilhada do
  // SistemaContext (um único poll pra todos os componentes), em vez de buscar a
  // lista pesada (/listar) só pra contar.
  const { canManage, guiasAutoContagem } = useSistema();
  const contagem = guiasAutoContagem.problemasPendentes + guiasAutoContagem.pendenciasAprovacao;

  return (
    <div className="flex items-center gap-1 rounded-[var(--radius)] bg-[var(--surface-2)] p-1 border border-[var(--border)] w-full overflow-x-auto">
      {TABS.map((tab) => {
        // Esconde tab de pendências auto pra quem não pode ver (não é admin/gerente)
        if (tab.badge && !canManage) return null;
        const Icon = tab.icon;
        const active = pathname === tab.href;
        const showBadge = tab.badge && contagem > 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-[var(--radius)] px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              active
                ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)]'
                : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]'
            }`}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
            {showBadge && (
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">
                {contagem > 99 ? '99+' : contagem}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
