'use client';

import React, { useState } from 'react';
import { CalendarClock, History, Plus, Tag, Trash2, X } from 'lucide-react';
import type { HistoricoVencimentoItem } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import { useSistema } from '@/app/context/SistemaContext';
import { formatBR } from '@/app/utils/date';
import { criarHistoricoVencimentoItem, limparTagVencimento, normalizarHistoricoVencimento } from '@/app/utils/vencimentos';

type ItemModalHistorico = {
  empresaCodigo: string;
  empresaNome: string;
  tipo: 'Documento' | 'RET';
  nome: string;
  vencimento: string;
  dias: number;
  statusLabel: string;
  statusClassName: string;
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
};

interface ModalHistoricoVencimentoProps {
  open: boolean;
  item: ItemModalHistorico | null;
  canEdit: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: { tagVencimento?: string; historicoVencimento: HistoricoVencimentoItem[] }) => Promise<void> | void;
}

const TAGS_RAPIDAS = [
  'Renovação solicitada',
  'Aguardando retorno',
  'Em análise',
  'Regularizado',
];

export default function ModalHistoricoVencimento({
  open,
  item,
  canEdit,
  saving = false,
  onClose,
  onSave,
}: ModalHistoricoVencimentoProps) {
  const { currentUser } = useSistema();
  const [tagVencimento, setTagVencimento] = useState(() => item?.tagVencimento || '');
  const [historico, setHistorico] = useState<HistoricoVencimentoItem[]>(() => normalizarHistoricoVencimento(item?.historicoVencimento));
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [dataEvento, setDataEvento] = useState('');

  const adicionarHistorico = () => {
    const tituloLimpo = titulo.trim();
    if (!tituloLimpo) return;

    const novoItem = criarHistoricoVencimentoItem({
      titulo: tituloLimpo,
      descricao,
      dataEvento,
      autorId: currentUser?.id ?? null,
      autorNome: currentUser?.nome,
    });

    setHistorico((prev) => normalizarHistoricoVencimento([novoItem, ...prev]));
    setTitulo('');
    setDescricao('');
    setDataEvento('');
  };

  const removerHistorico = (id: string) => {
    setHistorico((prev) => prev.filter((itemHistorico) => itemHistorico.id !== id));
  };

  const salvar = async () => {
    await onSave({
      tagVencimento: limparTagVencimento(tagVencimento),
      historicoVencimento: normalizarHistoricoVencimento(historico),
    });
  };

  if (!open || !item) return null;

  return (
    <ModalBase
      isOpen={open}
      onClose={onClose}
      labelledBy="historico-vencimento-title"
      dialogClassName="w-full max-w-3xl bg-white rounded-2xl shadow-2xl outline-none max-h-[92vh] overflow-y-auto"
      zIndex={1500}
    >
      <div className="rounded-2xl">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-4 sm:p-6 rounded-t-2xl sticky top-0 z-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 id="historico-vencimento-title" className="text-xl font-bold text-white">
                Histórico do Vencimento
              </h3>
              <div className="text-sm text-slate-200">
                {item.empresaCodigo} • {item.empresaNome}
              </div>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white/10 p-2 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold border ${item.statusClassName}`}>
                {item.statusLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                <CalendarClock size={12} />
                {item.tipo}
              </span>
            </div>
            <div className="text-lg font-bold text-slate-900">{item.nome}</div>
            <div className="text-sm text-slate-600 mt-1">
              Vencimento: <span className="font-semibold text-slate-900">{formatBR(item.vencimento)}</span>
              {' • '}
              {item.dias < 0 ? `${Math.abs(item.dias)} dia(s) em atraso` : `${item.dias} dia(s) restantes`}
            </div>
          </div>

          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Tag size={16} className="text-violet-700" />
              <div className="font-semibold text-violet-900">Tag atual</div>
            </div>
            <input
              value={tagVencimento}
              onChange={(e) => setTagVencimento(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Ex.: Renovação solicitada"
              className="w-full rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-100"
            />
            {canEdit && tagVencimento.trim() && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setTagVencimento('')}
                  className="text-xs font-semibold text-violet-700 hover:text-violet-900 disabled:opacity-50"
                >
                  Limpar tag
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {TAGS_RAPIDAS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => setTagVencimento(tag)}
                  className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus size={16} className="text-cyan-700" />
              <div className="font-semibold text-cyan-900">Adicionar andamento</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={!canEdit || saving}
                placeholder="Ex.: Solicitei renovação"
                className="rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-100"
              />
              <input
                type="date"
                value={dataEvento}
                onChange={(e) => setDataEvento(e.target.value)}
                disabled={!canEdit || saving}
                className="rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-100"
              />
            </div>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              disabled={!canEdit || saving}
              rows={3}
              placeholder="Detalhes opcionais do andamento"
              className="mt-3 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm text-slate-900 resize-none disabled:bg-slate-100"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={adicionarHistorico}
                disabled={!canEdit || saving || !titulo.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Adicionar ao histórico
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-4">
              <History size={16} className="text-slate-700" />
              <div className="font-semibold text-slate-900">Linha do tempo</div>
            </div>
            {historico.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                Nenhum andamento registrado ainda.
              </div>
            ) : (
              <div className="space-y-3">
                {historico.map((itemHistorico) => (
                  <div key={itemHistorico.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{itemHistorico.titulo}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {itemHistorico.dataEvento ? formatBR(itemHistorico.dataEvento) : formatBR(itemHistorico.criadoEm)}
                          {itemHistorico.autorNome ? ` • ${itemHistorico.autorNome}` : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => removerHistorico(itemHistorico.id)}
                          className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-50"
                          title="Remover registro"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    {itemHistorico.descricao && (
                      <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{itemHistorico.descricao}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={!canEdit || saving}
              className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </ModalBase>
  );
}
