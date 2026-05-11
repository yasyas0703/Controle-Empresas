'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Clock, LogOut, User } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';

type Props = {
  /** Mostrar link "Voltar" no canto esquerdo em vez do logo (páginas internas) */
  backHref?: string;
};

export default function PortalHeader({ backHref }: Props) {
  const router = useRouter();
  const { cliente, empresa, logout } = usePortal();

  const displayName = empresa?.apelido || empresa?.razaoSocial || 'sua empresa';

  async function handleLogout() {
    await logout();
    router.replace('/portal/login');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        {backHref ? (
          <Link
            href={backHref}
            className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            ← Voltar
          </Link>
        ) : (
          <Link href="/portal" className="flex items-center gap-2">
            <Image src="/triar.png" alt="Triar" width={32} height={32} className="rounded" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Portal do Cliente</p>
              <p className="text-sm font-semibold">{displayName}</p>
            </div>
          </Link>
        )}

        <div className="flex items-center gap-1">
          <Link
            href="/portal/historico"
            className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            title="Histórico de acessos"
          >
            <Clock size={16} />
            <span className="hidden sm:inline">Histórico</span>
          </Link>
          <Link
            href="/portal/perfil"
            className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            title={cliente?.email}
          >
            <User size={16} />
            <span className="hidden sm:inline">Meu cadastro</span>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
}
