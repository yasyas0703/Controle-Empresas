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
  gradient: string;
};

type DepartamentoConfig = {
  slug: DepartamentoSlug;
  titulo: string;
  descricao: string;
  gradient: string;
  tabs: [TabDef, TabDef];
};

export const DEPARTAMENTO_CONFIG: Record<Exclude<DepartamentoSlug, 'fiscal'>, DepartamentoConfig> = {
  pessoal: {
    slug: 'pessoal',
    titulo: 'Pessoal',
    descricao: 'Área em definição — em breve os controles de vencimentos e acompanhamento do Pessoal.',
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    tabs: [
      { href: '/vencimentos-pessoal', label: 'Vencimentos Pessoal', icon: Grid3x3, gradient: 'from-violet-500 via-purple-500 to-fuchsia-500' },
      { href: '/vencimentos-pessoal/controle', label: 'Controle Pessoal', icon: ListChecks, gradient: 'from-emerald-500 via-teal-500 to-cyan-500' },
    ],
  },
  contabil: {
    slug: 'contabil',
    titulo: 'Contábil',
    descricao: 'Área em definição — em breve os controles de vencimentos e acompanhamento do Contábil.',
    gradient: 'from-blue-500 via-indigo-500 to-sky-500',
    tabs: [
      { href: '/vencimentos-contabil', label: 'Vencimentos Contábil', icon: Grid3x3, gradient: 'from-blue-500 via-indigo-500 to-sky-500' },
      { href: '/vencimentos-contabil/controle', label: 'Controle Contábil', icon: ListChecks, gradient: 'from-emerald-500 via-teal-500 to-cyan-500' },
    ],
  },
  cadastro: {
    slug: 'cadastro',
    titulo: 'Cadastro',
    descricao: 'Área em definição — em breve os controles de vencimentos e acompanhamento do Cadastro.',
    gradient: 'from-amber-500 via-orange-500 to-yellow-500',
    tabs: [
      { href: '/vencimentos-cadastro', label: 'Vencimentos Cadastro', icon: Grid3x3, gradient: 'from-amber-500 via-orange-500 to-yellow-500' },
      { href: '/vencimentos-cadastro/controle', label: 'Controle Cadastro', icon: ListChecks, gradient: 'from-emerald-500 via-teal-500 to-cyan-500' },
    ],
  },
};

function DepartamentoTabs({ tabs }: { tabs: TabDef[] }) {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 sm:gap-2 rounded-2xl bg-white p-1.5 shadow-sm border border-gray-100 w-full overflow-x-auto">
      {tabs.map((tab) => {
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
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">
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
      <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-sm border border-gray-100 text-center">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${config.gradient} text-white shadow-md`}>
          <Construction size={30} />
        </div>
        <div className="text-xl sm:text-2xl font-bold text-gray-900">{abaLabel}</div>
        <div className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
          {config.descricao}
        </div>
      </div>
    </div>
  );
}
