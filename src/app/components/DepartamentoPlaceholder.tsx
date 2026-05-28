'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid3x3, ListChecks, Construction, ShieldAlert } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { getDepartamentoSlugDoUsuario, type DepartamentoSlug } from '@/app/utils/departamento';

type TabDef = {
  href: string;
  label: string;
  icon: typeof Grid3x3;
};

type DepartamentoConfig = {
  slug: DepartamentoSlug;
  titulo: string;
  descricao: string;
  tabs: TabDef[];
};

export const DEPARTAMENTO_CONFIG: Record<Exclude<DepartamentoSlug, 'fiscal'>, DepartamentoConfig> = {
  pessoal: {
    slug: 'pessoal',
    titulo: 'Pessoal',
    descricao: 'Área em definição — em breve os controles de vencimentos e acompanhamento do Pessoal.',
    tabs: [
      { href: '/vencimentos-pessoal', label: 'Vencimentos Pessoal', icon: Grid3x3 },
      { href: '/vencimentos-pessoal/controle', label: 'Controle Pessoal', icon: ListChecks },
    ],
  },
  contabil: {
    slug: 'contabil',
    titulo: 'Contábil',
    descricao: 'Área em definição — em breve os controles de acompanhamento do Contábil.',
    tabs: [
      { href: '/vencimentos-contabil/controle', label: 'Controle Contábil', icon: ListChecks },
    ],
  },
  cadastro: {
    slug: 'cadastro',
    titulo: 'Cadastro',
    descricao: 'Área em definição — em breve os controles de vencimentos e acompanhamento do Cadastro.',
    tabs: [
      { href: '/vencimentos-cadastro', label: 'Vencimentos Cadastro', icon: Grid3x3 },
      { href: '/vencimentos-cadastro/controle', label: 'Controle Cadastro', icon: ListChecks },
    ],
  },
};

export function DepartamentoTabs({ tabs }: { tabs: TabDef[] }) {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 rounded-[var(--radius)] bg-[var(--surface-2)] p-1 border border-[var(--border)] w-full overflow-x-auto">
      {tabs.map((tab) => {
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

interface DepartamentoPlaceholderProps {
  slug: Exclude<DepartamentoSlug, 'fiscal'>;
  aba: 'painel' | 'controle';
}

export default function DepartamentoPlaceholder({ slug, aba }: DepartamentoPlaceholderProps) {
  const { currentUser, canAdmin, isPrivileged, departamentos, authReady } = useSistema();
  const config = DEPARTAMENTO_CONFIG[slug];
  const userSlug = getDepartamentoSlugDoUsuario(currentUser, departamentos);
  const podeVer = canAdmin || isPrivileged || userSlug === slug;

  if (!authReady) {
    return null;
  }

  if (!currentUser || !podeVer) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-6 sm:p-8 border border-[var(--border)] text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-[var(--danger-soft)] text-[var(--danger)]">
            <ShieldAlert size={26} />
          </div>
          <div className="text-lg font-bold text-[var(--text-1)]">Acesso restrito</div>
          <div className="mt-1 text-sm text-[var(--text-2)]">
            Esta área é exclusiva do departamento {config.titulo}.
          </div>
        </div>
      </div>
    );
  }

  const abaLabel = aba === 'painel' ? config.tabs[0].label : config.tabs[1].label;

  return (
    <div className="space-y-4">
      <DepartamentoTabs tabs={config.tabs} />
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-6 sm:p-10 border border-[var(--border)] text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-[var(--surface-3)] text-[var(--text-2)]">
          <Construction size={28} />
        </div>
        <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">{abaLabel}</div>
        <div className="mt-2 text-sm text-[var(--text-2)] max-w-md mx-auto">
          {config.descricao}
        </div>
      </div>
    </div>
  );
}
