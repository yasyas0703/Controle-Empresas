'use client';

import React, { useState } from 'react';
import { CalendarClock, History, Plus, Tag, Trash2, X } from 'lucide-react';
import type { HistoricoVencimentoItem } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import ConfirmModal from '@/app/components/ConfirmModal';
import { useSistema } from '@/app/context/SistemaContext';
import type { TagCor } from '@/app/types';
import { formatBR } from '@/app/utils/date';
import { criarHistoricoVencimentoItem, limparTagVencimento, normalizarHistoricoVencimento } from '@/app/utils/vencimentos';

type ItemModalHistorico = {
  empresaCodigo: string;
  empresaNome: string;
  tipo: 'Documento' | 'RET' | 'Fiscal';
  nome: string;
  vencimento: string;
  dias: number;
  statusLabel: string;
  statusClassName: string;
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
  /** Só pra RET — habilita a seção "Atualizar vencimento" com a renovação. */
  ultimaRenovacao?: string;
};

interface ModalHistoricoVencimentoProps {
  open: boolean;
  item: ItemModalHistorico | null;
  canEdit: boolean;
  saving?: boolean;
  onClose: () => void;
  /**
   * vencimento/ultimaRenovacao só vêm preenchidos quando o item é RET e o
   * usuário mexeu na seção "Atualizar vencimento". Quem salva via
   * atualizarEmpresa ganha o registro automático na linha do tempo
   * ("Vencimento atualizado para X / Antes: Y") — não duplique aqui.
   */
  onSave: (payload: {
    tagVencimento?: string;
    historicoVencimento: HistoricoVencimentoItem[];
    vencimento?: string;
    ultimaRenovacao?: string;
  }) => Promise<void> | void;
}

const TAGS_RAPIDAS_PADRAO = [
  'Renovação solicitada',
  'Aguardando retorno',
  'Em análise',
  'Regularizado',
];

const TAG_COLOR_MAP: Record<TagCor, { bg: string; text: string; border: string }> = {
  red: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  green: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  cyan: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
};

function getDescricaoHistoricoParts(descricao?: string) {
  const texto = descricao?.trim();
  if (!texto) return { dataAnterior: null, texto: null };

  const matchDataAnterior = texto.match(/^(?:Antes|Data anterior):\s*(.+)$/i);
  if (matchDataAnterior) return { dataAnterior: matchDataAnterior[1], texto: null };

  return { dataAnterior: null, texto };
}

export default function ModalHistoricoVencimento({
  open,
  item,
  canEdit,
  saving = false,
  onClose,
  onSave,
}: ModalHistoricoVencimentoProps) {
  const { currentUser, tags: tagsCadastradas } = useSistema();
  const [tagVencimento, setTagVencimento] = useState(() => item?.tagVencimento || '');
  const [historico, setHistorico] = useState<HistoricoVencimentoItem[]>(() => normalizarHistoricoVencimento(item?.historicoVencimento));
  // Atualização de vencimento (só RET): novo vencimento + data da renovação.
  // Pedido da Yasmin (2026-06-12): "tinha esse RET, queria atualizar ele, só
  // que não tem campo de atualizar, só de histórico". Ao salvar, o
  // atualizarEmpresa registra a mudança na linha do tempo automaticamente.
  const [novoVencimento, setNovoVencimento] = useState(() => item?.vencimento || '');
  const [novaRenovacao, setNovaRenovacao] = useState(() => item?.ultimaRenovacao || '');
  const [confirmDeleteHistoricoId, setConfirmDeleteHistoricoId] = useState<string | null>(null);
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
    // NÃO criamos os registros de "Vencimento atualizado" / "Renovação" aqui:
    // quem salva é o atualizarEmpresa (enriquecerRetsComHistorico no
    // SistemaContext), que já gera esses eventos COM dedup. Duplicar aqui criava
    // duas linhas (e com rótulo divergente "Data anterior:" vs "Antes:", que
    // escapava do dedup). O modal só envia o estado novo; o histórico manual
    // (andamentos digitados) continua vindo de `historico`.
    await onSave({
      tagVencimento: limparTagVencimento(tagVencimento),
      historicoVencimento: normalizarHistoricoVencimento(historico),
      // RET: manda o vencimento/renovação da seção "Atualizar vencimento".
      ...(item?.tipo === 'RET' ? { vencimento: novoVencimento, ultimaRenovacao: novaRenovacao } : {}),
    });
  };

  if (!open || !item) return null;

  return (
    <>
    <ModalBase
      isOpen={open}
      onClose={onClose}
      labelledBy="historico-vencimento-title"
      dialogClassName="w-full max-w-3xl bg-[var(--surface-2)] rounded-[var(--radius-md)] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.18)] outline-none max-h-[92vh] overflow-y-auto"
      zIndex={1500}
    >
      <div>
        <div className="border-b border-[var(--border-subtle)] p-5 sticky top-0 z-10 bg-[var(--surface-2)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] shrink-0">
                <History size={18} />
              </div>
              <div className="min-w-0">
                <h3 id="historico-vencimento-title" className="text-base font-bold text-[var(--text-1)] tracking-tight">
                  Histórico do Vencimento
                </h3>
                <div className="text-xs text-[var(--text-3)] mt-0.5 truncate">
                  <span className="ct-num text-[var(--text-2)]">{item.empresaCodigo}</span> · {item.empresaNome}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-2 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition shrink-0"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Info do vencimento */}
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-3)] p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold border ${item.statusClassName}`}>
                {item.statusLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--text-2)] border border-[var(--border)]">
                <CalendarClock size={11} />
                {item.tipo}
              </span>
            </div>
            <div className="text-base font-bold text-[var(--text-1)] tracking-tight">{item.nome}</div>
            <div className="text-sm text-[var(--text-2)] mt-1">
              Vencimento: <span className="font-semibold text-[var(--text-1)] ct-num">{formatBR(item.vencimento)}</span>
              {' · '}
              <span className="ct-num">
                {item.dias < 0 ? `${Math.abs(item.dias)} dia(s) em atraso` : `${item.dias} dia(s) restantes`}
              </span>
            </div>
          </div>

          {/* Atualizar vencimento (só RET) — novo vencimento + data da renovação.
              A mudança entra sozinha na linha do tempo ao salvar. */}
          {item.tipo === 'RET' && (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock size={14} className="text-[var(--text-3)]" />
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">Atualizar vencimento</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-[var(--text-2)]">Novo vencimento</span>
                  <input
                    type="date"
                    value={novoVencimento}
                    onChange={(e) => setNovoVencimento(e.target.value)}
                    disabled={!canEdit || saving}
                    className="ct-input mt-1 disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-[var(--text-2)]">Última renovação</span>
                  <input
                    type="date"
                    value={novaRenovacao}
                    onChange={(e) => setNovaRenovacao(e.target.value)}
                    disabled={!canEdit || saving}
                    className="ct-input mt-1 disabled:opacity-60"
                  />
                </label>
              </div>
              <div className="mt-2 text-xs text-[var(--text-3)]">
                Ao salvar, a atualização é registrada sozinha na linha do tempo (quem mudou, de quê pra quê).
              </div>
            </div>
          )}

          {/* Tag */}
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Tag size={14} className="text-[var(--text-3)]" />
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">Tag atual</div>
            </div>
            <input
              value={tagVencimento}
              onChange={(e) => setTagVencimento(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Ex.: Renovação solicitada"
              className="ct-input disabled:opacity-60"
            />
            {canEdit && tagVencimento.trim() && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setTagVencimento('')}
                  className="text-xs font-semibold text-[var(--brand)] hover:text-[var(--brand-strong)] disabled:opacity-50 transition-colors"
                >
                  Limpar tag
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tagsCadastradas.map((tag) => {
                const colors = TAG_COLOR_MAP[tag.cor] ?? TAG_COLOR_MAP.slate;
                const isSelected = tagVencimento === tag.nome;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={!canEdit || saving}
                    onClick={() => setTagVencimento(tag.nome)}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${colors.bg} ${colors.text} ${colors.border} ${
                      isSelected ? 'ring-2 ring-offset-1 ring-offset-[var(--surface-2)] ring-[var(--text-1)]' : 'hover:opacity-80'
                    }`}
                  >
                    {tag.nome}
                  </button>
                );
              })}
              {TAGS_RAPIDAS_PADRAO.filter((t) => !tagsCadastradas.some((tc) => tc.nome === t)).map((tag) => {
                const isSelected = tagVencimento === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!canEdit || saving}
                    onClick={() => setTagVencimento(tag)}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isSelected
                        ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)] border-[var(--brand)] ring-2 ring-offset-1 ring-offset-[var(--surface-2)] ring-[var(--brand)]'
                        : 'bg-[var(--surface-3)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Adicionar andamento */}
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus size={14} className="text-[var(--text-3)]" />
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">Adicionar andamento</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={!canEdit || saving}
                placeholder="Ex.: Solicitei renovação"
                className="ct-input disabled:opacity-60"
              />
              <input
                type="date"
                value={dataEvento}
                onChange={(e) => setDataEvento(e.target.value)}
                disabled={!canEdit || saving}
                className="ct-input disabled:opacity-60"
              />
            </div>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              disabled={!canEdit || saving}
              rows={3}
              placeholder="Detalhes opcionais do andamento"
              className="ct-input mt-3 resize-none disabled:opacity-60"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={adicionarHistorico}
                disabled={!canEdit || saving || !titulo.trim()}
                className="ct-btn-primary"
              >
                <Plus size={16} />
                Adicionar ao histórico
              </button>
            </div>
          </div>

          {/* Linha do tempo */}
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <History size={14} className="text-[var(--text-3)]" />
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">Linha do tempo</div>
            </div>
            {historico.length === 0 ? (
              <div className="rounded-[var(--radius)] bg-[var(--surface-3)] border border-[var(--border)] p-4 text-sm text-[var(--text-3)]">
                Nenhum andamento registrado ainda.
              </div>
            ) : (
              <div className="space-y-2">
                {historico.map((itemHistorico) => {
                  const descricaoParts = getDescricaoHistoricoParts(itemHistorico.descricao);

                  return (
                    <div
                    key={itemHistorico.id}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-3)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-1)]">{itemHistorico.titulo}</div>
                        <div className="text-xs text-[var(--text-3)] mt-1">
                          <span className="ct-num">
                            {itemHistorico.dataEvento ? formatBR(itemHistorico.dataEvento) : formatBR(itemHistorico.criadoEm)}
                          </span>
                          {itemHistorico.autorNome ? ` · ${itemHistorico.autorNome}` : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setConfirmDeleteHistoricoId(itemHistorico.id)}
                          className="rounded-md p-2 text-[var(--text-3)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50 transition-colors shrink-0"
                          title="Remover registro"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {descricaoParts.dataAnterior && (
                      <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-sm text-[var(--text-2)]">
                        <span className="font-semibold text-[var(--text-3)]">Data anterior:</span>
                        <span className="ct-num font-semibold text-[var(--text-1)]">{descricaoParts.dataAnterior}</span>
                      </div>
                    )}
                    {descricaoParts.texto && (
                      <div className="mt-2 text-sm text-[var(--text-2)] whitespace-pre-wrap">{descricaoParts.texto}</div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="ct-btn-secondary flex-1">
              Fechar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={!canEdit || saving}
              className="ct-btn-primary flex-1"
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </ModalBase>

    <ConfirmModal
      open={!!confirmDeleteHistoricoId}
      title="Remover registro?"
      message="Tem certeza que deseja remover este registro do histórico?"
      confirmText="Remover"
      variant="danger"
      onConfirm={() => { if (confirmDeleteHistoricoId) removerHistorico(confirmDeleteHistoricoId); setConfirmDeleteHistoricoId(null); }}
      onCancel={() => setConfirmDeleteHistoricoId(null)}
    />
    </>
  );
}
