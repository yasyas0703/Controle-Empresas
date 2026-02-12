'use client';

import React, { useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Clock, Building2, Search, Eraser, FileText, MessageSquare, Filter } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { formatarDocumento, detectTipoInscricao } from '@/app/utils/validation';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ConfirmModal from '@/app/components/ConfirmModal';
import type { Empresa, LixeiraTipo } from '@/app/types';

const TIPO_LABELS: Record<LixeiraTipo, string> = {
  empresa: 'Empresa',
  documento: 'Documento',
  observacao: 'Observação',
};
const TIPO_COLORS: Record<LixeiraTipo, { bg: string; text: string; border: string }> = {
  empresa: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  documento: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  observacao: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
};

export default function LixeiraPage() {
  const { lixeira, restaurarEmpresa, restaurarItem, excluirDefinitivamente, limparLixeira, canManage } = useSistema();
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<LixeiraTipo | 'todos'>('todos');
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

  const allItems = lixeira ?? [];

  const items = allItems.filter((item) => {
    const tipo = item.tipo ?? 'empresa';
    if (filtroTipo !== 'todos' && tipo !== filtroTipo) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const e = item.empresa;
    const parts: (string | undefined)[] = [e.codigo, e.cnpj, e.razao_social, e.apelido, item.excluidoPorNome];
    if (item.documento) parts.push(item.documento.nome);
    if (item.observacao) parts.push(item.observacao.texto);
    return parts.filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  // Contadores por tipo
  const countByTipo = { empresa: 0, documento: 0, observacao: 0 };
  for (const item of allItems) {
    const t = (item.tipo ?? 'empresa') as LixeiraTipo;
    if (t in countByTipo) countByTipo[t]++;
  }

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

  const tipoIcon = (tipo: LixeiraTipo) => {
    if (tipo === 'documento') return <FileText size={14} />;
    if (tipo === 'observacao') return <MessageSquare size={14} />;
    return <Building2 size={14} />;
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
                {allItems.length === 0 ? 'Nenhum item na lixeira' : `${allItems.length} item(ns) na lixeira`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {allItems.length > 0 && canManage && (
              <button
                onClick={() => { setConfirmClear(true); }}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition shadow-sm"
              >
                <Eraser size={16} />
                Esvaziar Lixeira
              </button>
            )}
          </div>
        </div>

        {/* Filtros */}
        {allItems.length > 0 && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar na lixeira..."
                className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-red-300 focus:bg-white transition"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-gray-400" />
              <button
                onClick={() => setFiltroTipo('todos')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${filtroTipo === 'todos' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Todos ({allItems.length})
              </button>
              {countByTipo.empresa > 0 && (
                <button
                  onClick={() => setFiltroTipo('empresa')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1 ${filtroTipo === 'empresa' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  <Building2 size={12} /> Empresas ({countByTipo.empresa})
                </button>
              )}
              {countByTipo.documento > 0 && (
                <button
                  onClick={() => setFiltroTipo('documento')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1 ${filtroTipo === 'documento' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
                >
                  <FileText size={12} /> Documentos ({countByTipo.documento})
                </button>
              )}
              {countByTipo.observacao > 0 && (
                <button
                  onClick={() => setFiltroTipo('observacao')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1 ${filtroTipo === 'observacao' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                >
                  <MessageSquare size={12} /> Observações ({countByTipo.observacao})
                </button>
              )}
            </div>
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
              Restaure itens excluídos ou exclua permanentemente. <strong>Itens com mais de 10 dias são removidos automaticamente.</strong>
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
            const tipo = (item.tipo ?? 'empresa') as LixeiraTipo;
            const colors = TIPO_COLORS[tipo];
            const e = item.empresa;
            const nome = e.razao_social || e.apelido || '-';
            const docFormatted = e.cnpj
              ? formatarDocumento(e.cnpj, detectTipoInscricao(e.cnpj) || e.tipoInscricao || '')
              : '-';

            return (
              <div
                key={item.id}
                className={`rounded-2xl bg-white shadow-sm p-5 hover:shadow-md transition-shadow border-l-4 ${colors.border}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Tipo badge */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${colors.bg} ${colors.text}`}>
                        {tipoIcon(tipo)}
                        {TIPO_LABELS[tipo]}
                      </span>

                      {tipo === 'empresa' && (
                        <span className="rounded-lg bg-gradient-to-r from-red-400 to-red-500 text-white px-2.5 py-1 text-xs font-bold shadow-sm opacity-70">
                          {e.codigo}
                        </span>
                      )}

                      {tipo !== 'empresa' && (
                        <span className="text-xs text-gray-400">
                          da empresa <span className="font-bold text-gray-600">{e.codigo}</span> — {nome}
                        </span>
                      )}
                    </div>

                    {/* Empresa details */}
                    {tipo === 'empresa' && (
                      <>
                        <div className="text-lg font-bold text-gray-900 truncate">{nome}</div>
                        <div className="mt-1 flex items-center gap-4 text-sm text-gray-500 flex-wrap">
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
                      </>
                    )}

                    {/* Documento details */}
                    {tipo === 'documento' && item.documento && (
                      <div className="mt-1">
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-orange-500" />
                          <span className="text-base font-bold text-gray-900">{item.documento.nome}</span>
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          Validade: {new Date(item.documento.validade).toLocaleDateString('pt-BR')}
                          {item.documento.arquivoUrl && (
                            <span className="ml-2 text-orange-600 font-semibold text-xs">📎 Com arquivo anexo</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Observação details */}
                    {tipo === 'observacao' && item.observacao && (
                      <div className="mt-1">
                        <div className="flex items-center gap-2">
                          <MessageSquare size={16} className="text-blue-500" />
                          <span className="text-sm font-bold text-gray-700">Observação de {item.observacao.autorNome}</span>
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5 line-clamp-2 italic">
                          &ldquo;{item.observacao.texto}&rdquo;
                        </div>
                      </div>
                    )}

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
                    {tipo === 'empresa' && (
                      <button
                        onClick={() => setEmpresaView(item.empresa)}
                        className="rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm text-gray-600 font-semibold transition flex items-center gap-1.5"
                        title="Ver detalhes"
                      >
                        <Building2 size={14} />
                        <span className="hidden sm:inline">Detalhes</span>
                      </button>
                    )}
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
        title="Restaurar item"
        message="Deseja restaurar este item? Ele voltará para onde estava."
        confirmText="Restaurar"
        variant="restore"
        onConfirm={() => {
          if (confirmRestore) {
            const item = allItems.find((l) => l.id === confirmRestore);
            if (item?.tipo === 'empresa' || !item?.tipo) {
              restaurarEmpresa(confirmRestore);
            } else {
              restaurarItem(confirmRestore);
            }
          }
          setConfirmRestore(null);
        }}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmModal
        open={!!confirmPermanent}
        title="Excluir permanentemente"
        message="Tem certeza que deseja excluir este item permanentemente? Esta ação NÃO pode ser desfeita."
        confirmText="Excluir definitivamente"
        variant="danger"
        onConfirm={() => { if (confirmPermanent) excluirDefinitivamente(confirmPermanent); setConfirmPermanent(null); }}
        onCancel={() => setConfirmPermanent(null)}
      />

      <ConfirmModal
        open={confirmClear}
        title="Esvaziar lixeira"
        message="Tem certeza que deseja excluir TODOS os itens da lixeira permanentemente? Esta ação NÃO pode ser desfeita."
        confirmText="Esvaziar tudo"
        variant="danger"
        onConfirm={() => { limparLixeira(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
