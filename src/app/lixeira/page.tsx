'use client';

import React, { useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Clock, Building2, Search, Eraser } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { formatarDocumento, detectTipoInscricao } from '@/app/utils/validation';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ConfirmModal from '@/app/components/ConfirmModal';
import type { Empresa } from '@/app/types';

export default function LixeiraPage() {
  const { lixeira, restaurarEmpresa, excluirDefinitivamente, limparLixeira, canManage } = useSistema();
  const [search, setSearch] = useState('');
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Lixeira</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  const items = (lixeira ?? []).filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const e = item.empresa;
    return [e.codigo, e.cnpj, e.razao_social, e.apelido, item.excluidoPorNome]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora mesmo';
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    return `${days}d atrás`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-md">
              <Trash2 className="text-white" size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">Lixeira</div>
              <div className="text-sm text-gray-500">
                {items.length === 0 ? 'Nenhuma empresa na lixeira' : `${items.length} empresa(s) na lixeira`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && canManage && (
              <button
                onClick={() => {
                  setConfirmClear(true);
                }}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition shadow-sm"
              >
                <Eraser size={16} />
                Esvaziar Lixeira
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        {(lixeira ?? []).length > 0 && (
          <div className="mt-4 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar na lixeira..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-red-300 focus:bg-white transition"
            />
          </div>
        )}
      </div>

      {/* Aviso */}
      {items.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-bold text-amber-800">Itens na lixeira podem ser restaurados</div>
            <div className="text-xs text-amber-600 mt-0.5">
              Restaure empresas excluídas ou exclua permanentemente. A exclusão permanente não pode ser desfeita.
            </div>
          </div>
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm p-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Trash2 size={32} className="text-gray-300" />
          </div>
          <div className="text-lg font-bold text-gray-400">Lixeira vazia</div>
          <div className="text-sm text-gray-400 mt-1">Itens excluídos aparecerão aqui</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const e = item.empresa;
            const nome = e.razao_social || e.apelido || '-';
            const docFormatted = e.cnpj
              ? formatarDocumento(e.cnpj, detectTipoInscricao(e.cnpj) || e.tipoInscricao || '')
              : '-';
            return (
              <div
                key={item.id}
                className="rounded-2xl bg-white shadow-sm p-5 hover:shadow-md transition-shadow border-l-4 border-red-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-lg bg-gradient-to-r from-red-400 to-red-500 text-white px-2.5 py-1 text-xs font-bold shadow-sm opacity-70">
                        {e.codigo}
                      </span>
                      <span className="text-lg font-bold text-gray-900 truncate">{nome}</span>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={14} className="text-gray-400" />
                        <span>{docFormatted}</span>
                      </div>
                      {e.regime_federal && (
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{e.regime_federal}</span>
                      )}
                      {e.estado && (
                        <span className="text-gray-500">{e.cidade ? `${e.cidade}/` : ''}{e.estado}</span>
                      )}
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-400">{e.documentos.length} doc(s) · {e.rets.length} RET(s)</span>
                    </div>

                    {/* Quem excluiu e quando */}
                    <div className="mt-3 flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-red-600 font-semibold">
                        <Trash2 size={12} />
                        Excluído por <span className="font-bold">{item.excluidoPorNome}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <Clock size={12} />
                        <span>{formatDate(item.excluidoEm)}</span>
                        <span className="text-gray-300">•</span>
                        <span className="font-semibold text-gray-500">{timeAgo(item.excluidoEm)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setEmpresaView(item.empresa)}
                      className="rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm text-gray-600 font-semibold transition flex items-center gap-1.5"
                      title="Ver detalhes"
                    >
                      <Building2 size={14} />
                      <span className="hidden sm:inline">Detalhes</span>
                    </button>
                    <button
                      onClick={() => setConfirmRestore(item.id)}
                      className="rounded-xl px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition flex items-center gap-1.5 shadow-sm"
                    >
                      <RotateCcw size={14} />
                      Restaurar
                    </button>
                    {canManage && (
                      <button
                        onClick={() => setConfirmPermanent(item.id)}
                        className="rounded-xl px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition flex items-center gap-1.5 shadow-sm"
                      >
                        <Trash2 size={14} />
                        Excluir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}

      <ConfirmModal
        open={!!confirmRestore}
        title="Restaurar empresa"
        message="Deseja restaurar esta empresa? Ela voltará para a lista de empresas ativas."
        confirmText="Restaurar"
        variant="restore"
        onConfirm={() => { if (confirmRestore) restaurarEmpresa(confirmRestore); setConfirmRestore(null); }}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmModal
        open={!!confirmPermanent}
        title="Excluir permanentemente"
        message="Tem certeza que deseja excluir esta empresa permanentemente? Esta ação NÃO pode ser desfeita."
        confirmText="Excluir definitivamente"
        variant="danger"
        onConfirm={() => { if (confirmPermanent) excluirDefinitivamente(confirmPermanent); setConfirmPermanent(null); }}
        onCancel={() => setConfirmPermanent(null)}
      />

      <ConfirmModal
        open={confirmClear}
        title="Esvaziar lixeira"
        message="Tem certeza que deseja excluir TODAS as empresas da lixeira permanentemente? Esta ação NÃO pode ser desfeita."
        confirmText="Esvaziar tudo"
        variant="danger"
        onConfirm={() => { limparLixeira(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
