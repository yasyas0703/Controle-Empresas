'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid3x3, ListChecks, Send } from 'lucide-react';

const TABS = [
  { href: '/vencimentos-fiscais', label: 'Painel Fiscal', icon: Grid3x3 },
  { href: '/vencimentos-fiscais/checklist', label: 'Checklist Mensal', icon: ListChecks },
  { href: '/vencimentos-fiscais/envio', label: 'Envio de Guias', icon: Send },
] as const;

export default function FiscalTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 rounded-[var(--radius)] bg-[var(--surface-2)] p-1 border border-[var(--border)] w-full overflow-x-auto">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href;
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
          </Link>
        );
      })}
    </div>
  );
}
