'use client';

import React, { useMemo, useState } from 'react';
import {
  Archive, Calendar, Eye, PowerOff, RotateCcw, Search, ShieldAlert, Trash2,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import type { Empresa } from '@/app/types';

function formatBR(iso?: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function EmpresasDesligadasPage() {
  const { empresasDesligadas, currentUser, canManage, atualizarEmpresa, removerEmpresa, mostrarAlerta, authReady } = useSistema();
  const [busca, setBusca] = useState('');
  const [confirmReativar, setConfirmReativar] = useState<Empresa | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<Empresa | null>(null);
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return [...empresasDesligadas]
      .filter((e) => {
        if (!q) return true;
        const hay = `${e.codigo} ${e.cnpj ?? ''} ${e.razao_social ?? ''} ${e.apelido ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        // Mais recentes primeiro
        if (a.desligada_em && b.desligada_em) return b.desligada_em.localeCompare(a.desligada_em);
        if (a.desligada_em) return -1;
        if (b.desligada_em) return 1;
        return (a.codigo ?? '').localeCompare(b.codigo ?? '');
      });
  }, [empresasDesligadas, busca]);

  if (!authReady) return null;
  if (!currentUser) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-6 sm:p-8 border border-[var(--border)] text-center">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-md bg-[var(--danger-soft)] text-[var(--danger)] mb-3">
          <ShieldAlert size={26} />
        </div>
        <div className="text-lg font-bold text-[var(--text-1)] tracking-tight">Acesso restrito</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <Archive size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">Empresas Desligadas</div>
            <div className="text-xs sm:text-sm text-[var(--text-2)]">
              <span className="ct-num font-semibold text-[var(--text-1)]">{empresasDesligadas.length}</span> empresa(s) desligada(s). Os dados (extratos, documentos, observações) ficam preservados — você pode reativar a qualquer momento.
            </div>
          </div>
        </div>
      </div>

      {/* Busca */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3 sm:p-4 border border-[var(--border)]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por código, CNPJ ou nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="ct-input pl-9 text-sm"
          />
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-10 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-md bg-[var(--surface-3)] text-[var(--text-3)] mb-3">
            <Archive size={24} />
          </div>
          <p className="text-sm text-[var(--text-2)]">
            {empresasDesligadas.length === 0
              ? 'Nenhuma empresa desligada ainda.'
              : 'Nenhuma empresa encontrada com esses filtros.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map((e) => (
            <div key={e.id} className="rounded-xl bg-white shadow-sm border border-gray-200 p-3 sm:p-4 hover:shadow transition">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-gray-500">{e.codigo}</span>
                    <span className="rounded-md bg-slate-200 text-slate-700 px-1.5 py-0.5 text-[10px] font-bold">DESLIGADA</span>
                    {e.tags?.includes('desligada-historica') ? (
                      <span className="rounded-md bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold inline-flex items-center gap-1">
                        <PowerOff size={11} /> HISTÓRICA
                      </span>
                    ) : e.desligada_em ? (
                      <span className="text-[11px] text-slate-600 inline-flex items-center gap-1">
                        <PowerOff size={11} /> Desligada em {formatBR(e.desligada_em)}
                      </span>
                    ) : null}
                  </div>
                  <div className="font-bold text-gray-900 mt-1 text-sm sm:text-base">
                    {e.razao_social || e.apelido || <span className="text-gray-400 italic">Sem nome</span>}
                  </div>
                  {e.apelido && e.razao_social && (
                    <div className="text-xs text-gray-500">({e.apelido})</div>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 flex-wrap">
                    {e.cnpj && <span>CNPJ: {e.cnpj}</span>}
                    {e.cliente_desde && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={10} /> Cliente desde {formatBR(e.cliente_desde)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => setEmpresaView(e)}
                    className="rounded-lg p-2 hover:bg-blue-50 transition"
                    title="Ver detalhes"
                  >
                    <Eye size={16} className="text-blue-500" />
                  </button>
                  <button
                    onClick={() => setConfirmReativar(e)}
                    className="rounded-lg p-2 hover:bg-emerald-50 transition disabled:opacity-50"
                    title="Reativar empresa"
                    disabled={!canManage}
                  >
                    <RotateCcw size={16} className="text-emerald-600" />
                  </button>
                  <button
                    onClick={() => setConfirmExcluir(e)}
                    className="rounded-lg p-2 hover:bg-red-50 transition disabled:opacity-50"
                    title="Excluir definitivamente (vai pra lixeira)"
                    disabled={!canManage}
                  >
                    <Trash2 size={16} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {empresaView && (
        <ModalDetalhesEmpresa
          empresa={empresaView}
          onClose={() => setEmpresaView(null)}
        />
      )}

      <ConfirmModal
        open={!!confirmReativar}
        title="Reativar empresa"
        message={`A empresa "${confirmReativar?.codigo} - ${confirmReativar?.razao_social || confirmReativar?.apelido || ''}" voltará a aparecer no dashboard e nos controles.`}
        confirmText="Reativar"
        variant="restore"
        onConfirm={async () => {
          if (confirmReativar) {
            try {
              await atualizarEmpresa(confirmReativar.id, { desligada_em: null });
              mostrarAlerta('Empresa reativada', `${confirmReativar.razao_social ?? confirmReativar.codigo} voltou a ser ativa.`, 'sucesso');
            } catch (err) {
              console.error(err);
              mostrarAlerta('Erro', 'Não foi possível reativar.', 'erro');
            }
          }
          setConfirmReativar(null);
        }}
        onCancel={() => setConfirmReativar(null)}
      />

      <ConfirmModal
        open={!!confirmExcluir}
        title="Excluir definitivamente"
        message={`A empresa "${confirmExcluir?.codigo} - ${confirmExcluir?.razao_social || confirmExcluir?.apelido || ''}" será movida para a lixeira. De lá ainda dá pra restaurar, mas tente reativar primeiro caso só queira reativar.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => {
          if (confirmExcluir) removerEmpresa(confirmExcluir.id);
          setConfirmExcluir(null);
        }}
        onCancel={() => setConfirmExcluir(null)}
      />
    </div>
  );
}
