'use client';

import React, { useMemo, useState } from 'react';
import { X, Plus, Trash2, Send, MessageSquare, Pencil } from 'lucide-react';
import type { Empresa, UUID } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import ConfirmModal from '@/app/components/ConfirmModal';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR } from '@/app/utils/date';
import ModalAdicionarDocumento from '@/app/components/ModalAdicionarDocumento';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';

/** Formata número do RET no padrão XX.XXXXXXXX-XX */
function formatRetNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export default function ModalDetalhesEmpresa({
  empresa,
  onClose,
}: {
  empresa: Empresa;
  onClose: () => void;
}) {
  const { adicionarDocumento, removerDocumento, adicionarObservacao, removerObservacao, departamentos, usuarios, currentUser, canManage } = useSistema();
  const [docOpen, setDocOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [obsTexto, setObsTexto] = useState('');
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);
  const [confirmDeleteObsId, setConfirmDeleteObsId] = useState<string | null>(null);

  const nome = useMemo(() => empresa.razao_social || empresa.apelido || '-', [empresa]);

  return (
    <>
      <ModalBase
        isOpen
        onClose={onClose}
        labelledBy="empresa-detalhes"
        dialogClassName="w-full max-w-4xl bg-white rounded-2xl shadow-2xl outline-none max-h-[90vh] overflow-y-auto"
        zIndex={1350}
      >
        <div className="rounded-2xl">
          <div className="bg-gradient-to-r from-green-500 to-green-600 p-6 rounded-t-2xl sticky top-0 z-10">
            <div className="flex justify-between items-center">
              <h3 id="empresa-detalhes" className="text-xl font-bold text-white">
                Detalhes da Empresa
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-semibold px-3 py-2 rounded-lg transition"
                >
                  <Pencil size={16} />
                  Editar
                </button>
                <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg">
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <Section title="Informações Principais" tone="green">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Info label="Razão Social" value={nome} />
                <Info label="Código" value={empresa.codigo || '-'} />
                <Info label="Nome Fantasia" value={empresa.apelido || '-'} />
                <Info label="CNPJ/CPF" value={empresa.cnpj || '-'} />
                <Info label="Data de abertura" value={empresa.data_abertura ? formatBR(empresa.data_abertura) : '-'} />
                <Info label="Matriz/Filial" value={empresa.tipoEstabelecimento ? empresa.tipoEstabelecimento.toUpperCase() : '-'} />
                <Info label="Tipo" value={empresa.tipoInscricao || '-'} />
                <Info label="Serviços" value={empresa.servicos.length ? empresa.servicos.join(', ') : '-'} />
              </div>
            </Section>

            <Section title="Inscrições e Regimes" tone="blue">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Info label="Inscrição Estadual" value={empresa.inscricao_estadual || '-'} />
                <Info label="Inscrição Municipal" value={empresa.inscricao_municipal || '-'} />
                <Info label="Regime Federal" value={empresa.regime_federal || '-'} />
                <Info label="Regime Estadual" value={empresa.regime_estadual || '-'} />
                <Info label="Regime Municipal" value={empresa.regime_municipal || '-'} />
              </div>
            </Section>

            <Section title="Responsáveis por Departamento" tone="cyan">
              {(() => {
                const entries = Object.entries(empresa.responsaveis || {});
                const mapped = entries
                  .map(([depId, userId], idx) => {
                    const dep = departamentos.find((d) => d.id === depId);
                    const depIdx = departamentos.findIndex((d) => d.id === depId);
                    const user = userId ? usuarios.find((u) => u.id === userId) : null;
                    return dep ? { dep: dep.nome, user: user?.nome || null, depIdx } : null;
                  })
                  .filter(Boolean) as { dep: string; user: string | null; depIdx: number }[];

                if (mapped.length === 0) return <div className="text-sm text-gray-600">Nenhum responsável vinculado.</div>;

                const DEPT_C: Record<number, { bg: string; text: string; border: string }> = {
                  0: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
                  1: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
                  2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
                  3: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
                  4: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
                  5: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
                  6: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
                  7: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
                };

                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {mapped.map((m) => {
                      const c = DEPT_C[m.depIdx % 8];
                      return (
                        <div key={m.dep} className={`rounded-xl px-4 py-3 border-2 ${c.bg} ${c.border}`}>
                          <div className={`text-[11px] font-bold ${c.text} uppercase tracking-wide`}>{m.dep}</div>
                          <div className="text-sm font-bold text-gray-900 mt-1">{m.user || '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Section>

            <Section title="Endereço" tone="cyan">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Info label="CEP" value={empresa.cep || '-'} />
                <Info label="Estado" value={empresa.estado || '-'} />
                <Info label="Cidade" value={empresa.cidade || '-'} />
                <Info label="Bairro" value={empresa.bairro || '-'} />
                <Info label="Logradouro" value={empresa.logradouro || '-'} />
                <Info label="Número" value={empresa.numero || '-'} />
              </div>
            </Section>

            <Section title="RETs" tone="emerald">
              {!empresa.possuiRet || empresa.rets.length === 0 ? (
                <div className="text-sm text-gray-600">Sem RET cadastrado.</div>
              ) : (
                <div className="space-y-3">
                  {empresa.rets.map((r) => {
                    const dias = daysUntil(r.vencimento);
                    const danger = dias !== null && dias <= 60;
                    return (
                      <div key={r.id} className="rounded-xl border bg-white p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900 truncate">{r.nome}</div>
                          <div className="text-sm text-gray-600">PTA: {r.numeroPta ? formatRetNumber(r.numeroPta) : '-'}</div>
                          <div className="text-sm text-gray-600">
                            Vencimento: <span className={danger ? 'font-bold text-red-600' : 'text-gray-900'}>{formatBR(r.vencimento)}</span>
                            {dias !== null ? ` • ${dias}d` : ''}
                          </div>
                          <div className="text-sm text-gray-600">Última renovação: {formatBR(r.ultimaRenovacao)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Documentos da Empresa" tone="orange" right={
              <button
                onClick={() => setDocOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-600 text-white px-4 py-2 text-sm font-semibold hover:bg-orange-700"
              >
                <Plus size={16} />
                Adicionar
              </button>
            }>
              {empresa.documentos.length === 0 ? (
                <div className="text-sm text-gray-600">Sem documentos.</div>
              ) : (
                <div className="space-y-3">
                  {empresa.documentos.map((d) => {
                    const dias = daysUntil(d.validade);
                    const danger = dias !== null && dias <= 60;
                    return (
                      <div key={d.id} className="rounded-xl border bg-white p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900 truncate">{d.nome}</div>
                          <div className="text-sm text-gray-600">
                            Validade: <span className={danger ? 'font-bold text-red-600' : 'text-gray-900'}>{formatBR(d.validade)}</span>
                            {dias !== null ? ` • ${dias}d` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => setConfirmDeleteDocId(d.id)}
                          className="rounded-xl border p-2 hover:bg-gray-50"
                          title="Excluir"
                        >
                          <Trash2 className="text-red-600" size={18} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Observações / Chat Interno */}
            <Section title="Observações" tone="blue" right={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 px-2.5 py-1 text-xs font-bold">
                <MessageSquare size={13} />
                {(empresa.observacoes ?? []).length}
              </span>
            }>
              <div className="space-y-3">
                {/* Input para nova observação */}
                <div className="flex gap-2">
                  <textarea
                    value={obsTexto}
                    onChange={(e) => setObsTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (obsTexto.trim()) {
                          adicionarObservacao(empresa.id, obsTexto.trim());
                          setObsTexto('');
                        }
                      }
                    }}
                    placeholder="Escreva uma observação... (Enter para enviar, Shift+Enter para nova linha)"
                    rows={2}
                    className="flex-1 rounded-xl bg-white border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-transparent transition resize-none"
                  />
                  <button
                    onClick={() => {
                      if (obsTexto.trim()) {
                        adicionarObservacao(empresa.id, obsTexto.trim());
                        setObsTexto('');
                      }
                    }}
                    disabled={!obsTexto.trim()}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition self-end ${
                      obsTexto.trim()
                        ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Send size={16} />
                  </button>
                </div>

                {/* Lista de observações (mais recentes primeiro) */}
                {(empresa.observacoes ?? []).length === 0 ? (
                  <div className="text-sm text-gray-500 text-center py-4">
                    Nenhuma observação. Adicione a primeira!
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {[...(empresa.observacoes ?? [])].reverse().map((obs) => {
                      const isAutor = obs.autorId === currentUser?.id;
                      return (
                        <div
                          key={obs.id}
                          className={`rounded-xl p-3 border ${
                            isAutor ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${isAutor ? 'text-blue-700' : 'text-gray-700'}`}>
                                {obs.autorNome}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(obs.criadoEm).toLocaleString('pt-BR', {
                                  day: '2-digit', month: '2-digit', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </span>
                            </div>
                            {(isAutor || canManage) && (
                              <button
                                onClick={() => setConfirmDeleteObsId(obs.id)}
                                className="text-red-400 hover:text-red-600 transition p-0.5"
                                title="Excluir observação"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                            {obs.texto}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>
      </ModalBase>

      <ModalAdicionarDocumento
        isOpen={docOpen}
        onClose={() => setDocOpen(false)}
        onSubmit={(doc) => adicionarDocumento(empresa.id, doc)}
      />

      {editOpen && (
        <ModalCadastrarEmpresa
          empresa={empresa}
          onClose={() => setEditOpen(false)}
        />
      )}

      <ConfirmModal
        open={!!confirmDeleteDocId}
        title="Remover documento"
        message="Tem certeza que deseja remover este documento?"
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteDocId) removerDocumento(empresa.id, confirmDeleteDocId); setConfirmDeleteDocId(null); }}
        onCancel={() => setConfirmDeleteDocId(null)}
      />

      <ConfirmModal
        open={!!confirmDeleteObsId}
        title="Remover observação"
        message="Tem certeza que deseja remover esta observação?"
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteObsId) removerObservacao(empresa.id, confirmDeleteObsId); setConfirmDeleteObsId(null); }}
        onCancel={() => setConfirmDeleteObsId(null)}
      />
    </>
  );
}

function Section({
  title,
  tone,
  right,
  children,
}: {
  title: string;
  tone: 'green' | 'blue' | 'cyan' | 'orange' | 'emerald';
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-green-50 border-green-200'
      : tone === 'blue'
        ? 'bg-blue-50 border-blue-200'
        : tone === 'cyan'
          ? 'bg-cyan-50 border-cyan-200'
          : tone === 'orange'
            ? 'bg-orange-50 border-orange-200'
            : 'bg-emerald-50 border-emerald-200';

  const titleClass =
    tone === 'green'
      ? 'text-green-800'
      : tone === 'blue'
        ? 'text-blue-800'
        : tone === 'cyan'
          ? 'text-cyan-800'
          : tone === 'orange'
            ? 'text-orange-800'
            : 'text-emerald-800';

  return (
    <div className={`rounded-xl p-4 border ${toneClass}`}>
      <div className="flex items-center justify-between gap-4">
        <h4 className={`font-semibold ${titleClass}`}>{title}</h4>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-1 break-words">{value}</div>
    </div>
  );
}
