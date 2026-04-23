'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid3x3, ListChecks } from 'lucide-react';

const TABS = [
  { href: '/vencimentos-fiscais', label: 'Painel Fiscal', icon: Grid3x3, gradient: 'from-red-500 via-orange-500 to-amber-500' },
  { href: '/vencimentos-fiscais/checklist', label: 'Checklist Mensal', icon: ListChecks, gradient: 'from-emerald-500 via-teal-500 to-cyan-500' },
] as const;

export default function FiscalTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 sm:gap-2 rounded-2xl bg-white p-1.5 shadow-sm border border-gray-100 w-full overflow-x-auto">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              active
                ? `bg-gradient-to-r ${tab.gradient} text-white shadow-md`
                : 'text-gray-600 hover:bg-gray-100'
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
