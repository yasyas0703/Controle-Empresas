'use client';

import { Building2, LogOut } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';

// Renderiza um overlay full-screen quando o cliente tem acesso a múltiplas
// empresas e ainda não escolheu qual visualizar. Bloqueia todo o portal até
// a escolha.
export default function EmpresaPicker() {
  const { acessos, precisaEscolherEmpresa, selecionarEmpresa, logout } = usePortal();

  if (!precisaEscolherEmpresa) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="rounded-t-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-4 text-white">
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">
            Portal Triar
          </div>
          <div className="mt-1 text-lg font-bold">Escolha a empresa</div>
          <div className="text-xs opacity-90">
            Você tem acesso a {acessos.length} empresas. Selecione qual deseja visualizar.
          </div>
        </div>

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {acessos.map((a) => {
            const titulo = a.empresa?.razaoSocial || a.empresa?.apelido || 'Empresa sem nome';
            const subtitulo = a.empresa?.cnpj ?? '—';
            return (
              <li key={a.cliente.id}>
                <button
                  onClick={() => selecionarEmpresa(a.cliente.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {titulo}
                    </div>
                    <div className="truncate text-xs text-slate-500">{subtitulo}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="rounded-b-2xl border-t border-slate-100 px-5 py-3 text-right dark:border-slate-800">
          <button
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <LogOut size={12} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}
