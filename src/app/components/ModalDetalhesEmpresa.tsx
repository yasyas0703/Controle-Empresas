'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { X, Plus, Trash2, Send, MessageSquare, Pencil, Download, Eye, Paperclip, FileText, Globe, Building2, Lock, Users, Loader2 } from 'lucide-react';
import type { Empresa, DocumentoEmpresa, UUID } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import ConfirmModal from '@/app/components/ConfirmModal';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR } from '@/app/utils/date';
import ModalAdicionarDocumento from '@/app/components/ModalAdicionarDocumento';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';
import { getDocumentoSignedUrl } from '@/lib/db';

/** Formata número do RET no padrão XX.XXXXXXXXX-XX (13 dígitos) */
function formatRetNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 11) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 11)}-${digits.slice(11)}`;
}

const VIS_BADGE: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
  publico: { icon: <Globe size={11} />, label: 'Público', cls: 'bg-green-100 text-green-700' },
  departamento: { icon: <Building2 size={11} />, label: 'Departamento', cls: 'bg-blue-100 text-blue-700' },
  usuarios: { icon: <Users size={11} />, label: 'Por Usuários', cls: 'bg-purple-100 text-purple-700' },
  confidencial: { icon: <Lock size={11} />, label: 'Confidencial', cls: 'bg-red-100 text-red-700' },
};

export default function ModalDetalhesEmpresa({
  empresa: empresaProp,
  onClose,
}: {
  empresa: Empresa;
  onClose: () => void;
}) {
  const { adicionarDocumento, removerDocumento, atualizarDocumento, adicionarObservacao, removerObservacao, departamentos, usuarios, currentUser, canManage, empresas, currentUserId } = useSistema();
  // Sempre buscar a versão mais atualizada da empresa no contexto
  const empresa = empresas.find((e) => e.id === empresaProp.id) ?? empresaProp;
  const canEdit = canManage || (!!currentUserId && Object.values(empresa.responsaveis || {}).some((uid) => uid === currentUserId));
  const [docOpen, setDocOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [obsTexto, setObsTexto] = useState('');
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);
  const [confirmDeleteObsId, setConfirmDeleteObsId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editDocNome, setEditDocNome] = useState('');
  const [editDocValidade, setEditDocValidade] = useState('');
  const [editDocDepts, setEditDocDepts] = useState<UUID[]>([]);
  const [editDocVis, setEditDocVis] = useState<import('@/app/types').Visibilidade>('publico');
  const [editDocUsers, setEditDocUsers] = useState<UUID[]>([]);
  const [editDocFile, setEditDocFile] = useState<File | null>(null);
  const editFileRef = React.useRef<HTMLInputElement>(null);

  // Signed URLs cache & loading
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loadingUrlId, setLoadingUrlId] = useState<string | null>(null);

  const resolveUrl = useCallback(async (doc: DocumentoEmpresa): Promise<string | null> => {
    if (!doc.arquivoUrl) return null;
    if (signedUrls[doc.id]) return signedUrls[doc.id];
    try {
      setLoadingUrlId(doc.id);
      const url = await getDocumentoSignedUrl(doc.arquivoUrl);
      setSignedUrls((prev) => ({ ...prev, [doc.id]: url }));
      return url;
    } catch {
      // Fallback: tentar URL direta (legado)
      return doc.arquivoUrl;
    } finally {
      setLoadingUrlId(null);
    }
  }, [signedUrls]);

  const forceDownload = useCallback(async (url: string, fileName: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback: abrir em nova aba se fetch falhar (CORS)
      window.open(url, '_blank');
    }
  }, []);

  const handlePreview = useCallback(async (doc: DocumentoEmpresa) => {
    if (previewDocId === doc.id) {
      setPreviewDocId(null);
      return;
    }
    const url = await resolveUrl(doc);
    if (url) setPreviewDocId(doc.id);
  }, [previewDocId, resolveUrl]);

  const handleDownload = useCallback(async (doc: DocumentoEmpresa) => {
    const url = await resolveUrl(doc);
    if (url) forceDownload(url, doc.nome);
  }, [resolveUrl, forceDownload]);

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
          <div className="bg-gradient-to-r from-green-500 to-green-600 p-4 sm:p-6 rounded-t-2xl sticky top-0 z-10">
            <div className="flex justify-between items-center">
              <h3 id="empresa-detalhes" className="text-xl font-bold text-white">
                Detalhes da Empresa
              </h3>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={() => setEditOpen(true)}
                    className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-semibold px-3 py-2 rounded-lg transition"
                  >
                    <Pencil size={16} />
                    Editar
                  </button>
                )}
                <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg">
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-6">
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
                  .map(([depId, userId]) => {
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
                    const vencido = dias !== null && dias < 0;
                    const critico = dias !== null && !vencido && dias <= 60;
                    const proximo = dias !== null && !vencido && !critico && dias <= 90;
                    return (
                      <div key={r.id} className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
                        vencido ? 'bg-red-50 border-red-200' : critico ? 'bg-amber-50 border-amber-200' : proximo ? 'bg-green-50 border-green-200' : 'bg-white'
                      }`}>
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900 break-words">{r.nome}</div>
                          <div className="text-sm text-gray-600">PTA: {r.numeroPta ? formatRetNumber(r.numeroPta) : '-'}</div>
                          <div className="text-sm text-gray-600">
                            Vencimento: <span className={
                              vencido ? 'font-bold text-red-600' :
                              critico ? 'font-bold text-amber-600' :
                              proximo ? 'font-semibold text-green-600' :
                              'text-gray-900'
                            }>{formatBR(r.vencimento)}</span>
                            {dias !== null ? ` • ${dias < 0 ? `${Math.abs(dias)}d atrás` : `${dias}d`}` : ''}
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
              canEdit ? (
                <button
                  onClick={() => setDocOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange-600 text-white px-4 py-2 text-sm font-semibold hover:bg-orange-700"
                >
                  <Plus size={16} />
                  Adicionar
                </button>
              ) : undefined
            }>
              {empresa.documentos.length === 0 ? (
                <div className="text-sm text-gray-600">Sem documentos.</div>
              ) : (
                <div className="space-y-3">
                  {empresa.documentos.map((d) => {
                    const dias = d.validade ? daysUntil(d.validade) : null;
                    const vencido = dias !== null && dias < 0;
                    const critico = dias !== null && !vencido && dias <= 60;
                    const proximo = dias !== null && !vencido && !critico && dias <= 90;
                    const docDepts = (d.departamentosIds ?? []).map((id) => departamentos.find((dep) => dep.id === id)?.nome).filter(Boolean);
                    const docUsers = (d.usuariosPermitidos ?? []).map((id) => usuarios.find((u) => u.id === id)?.nome).filter(Boolean);
                    const isEditingThis = editingDocId === d.id;
                    const visBadge = VIS_BADGE[d.visibilidade ?? 'publico'] ?? VIS_BADGE.publico;
                    const isLoadingThis = loadingUrlId === d.id;
                    return (
                      <React.Fragment key={d.id}>
                      <div className={`rounded-xl border p-4 ${
                        vencido ? 'bg-red-50 border-red-200' : critico ? 'bg-amber-50 border-amber-200' : proximo ? 'bg-green-50 border-green-200' : 'bg-white'
                      }`}>
                        <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileText size={16} className="text-orange-500 shrink-0" />
                            <div className="font-bold text-gray-900 truncate">{d.nome}</div>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${visBadge.cls}`}>
                              {visBadge.icon} {visBadge.label}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {d.validade ? (
                              <>
                                Validade: <span className={
                                  vencido ? 'font-bold text-red-600' :
                                  critico ? 'font-bold text-amber-600' :
                                  proximo ? 'font-semibold text-green-600' :
                                  'text-gray-900'
                                }>{formatBR(d.validade)}</span>
                                {dias !== null ? ` • ${dias < 0 ? `${Math.abs(dias)}d atrás` : `${dias}d`}` : ''}
                              </>
                            ) : (
                              <span className="text-gray-400 italic">Sem validade definida</span>
                            )}
                          </div>
                          {docDepts.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {docDepts.map((n) => (
                                <span key={n} className="rounded-md bg-orange-100 text-orange-700 px-2 py-0.5 text-[10px] font-bold">{n}</span>
                              ))}
                            </div>
                          )}
                          {docDepts.length === 0 && d.visibilidade !== 'confidencial' && d.visibilidade !== 'usuarios' && (
                            <div className="text-[10px] text-gray-400 mt-1">Todos os departamentos</div>
                          )}
                          {d.visibilidade === 'usuarios' && docUsers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {docUsers.map((n) => (
                                <span key={n} className="rounded-md bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-bold">{n}</span>
                              ))}
                            </div>
                          )}
                          {d.arquivoUrl && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Paperclip size={12} className="text-orange-400" />
                              <span className="text-xs text-orange-600 font-semibold">Arquivo anexado</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {d.arquivoUrl && (
                            <>
                              <button
                                onClick={() => handlePreview(d)}
                                disabled={isLoadingThis}
                                className={`rounded-xl border p-2 hover:bg-orange-50 transition ${previewDocId === d.id ? 'bg-orange-100 border-orange-300' : ''}`}
                                title="Visualizar arquivo"
                              >
                                {isLoadingThis ? <Loader2 className="text-orange-600 animate-spin" size={18} /> : <Eye className="text-orange-600" size={18} />}
                              </button>
                              <button
                                onClick={() => handleDownload(d)}
                                disabled={isLoadingThis}
                                className="rounded-xl border p-2 hover:bg-blue-50 transition"
                                title="Baixar arquivo"
                              >
                                <Download className="text-blue-600" size={18} />
                              </button>
                            </>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => {
                                if (isEditingThis) {
                                  setEditingDocId(null);
                                } else {
                                  setEditingDocId(d.id);
                                  setEditDocNome(d.nome);
                                  setEditDocValidade(d.validade ?? '');
                                  setEditDocDepts(d.departamentosIds ?? []);
                                  setEditDocVis(d.visibilidade ?? 'publico');
                                  setEditDocUsers((d.usuariosPermitidos ?? []).filter((uid) => uid !== currentUserId));
                                  setEditDocFile(null);
                                }
                              }}
                              className={`rounded-xl border p-2 hover:bg-blue-50 transition ${isEditingThis ? 'bg-blue-100 border-blue-300' : ''}`}
                              title="Editar documento"
                            >
                              <Pencil className="text-blue-600" size={18} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => setConfirmDeleteDocId(d.id)}
                              className="rounded-xl border p-2 hover:bg-red-50 transition"
                              title="Excluir documento"
                            >
                              <Trash2 className="text-red-600" size={18} />
                            </button>
                          )}
                        </div>
                        </div>
                        {/* Inline edit completo */}
                        {isEditingThis && canEdit && (
                          <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                            {/* Nome */}
                            <div>
                              <div className="text-xs font-bold text-gray-600 mb-1">Nome do documento:</div>
                              <input
                                value={editDocNome}
                                onChange={(e) => setEditDocNome(e.target.value)}
                                className="w-full rounded-lg border px-3 py-2 text-sm"
                                placeholder="Nome do documento"
                              />
                            </div>

                            {/* Validade */}
                            <div>
                              <div className="text-xs font-bold text-gray-600 mb-1">Validade <span className="font-normal text-gray-400">(opcional)</span>:</div>
                              <div className="flex gap-2 items-center">
                                <input
                                  type="date"
                                  value={editDocValidade}
                                  onChange={(e) => setEditDocValidade(e.target.value)}
                                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                                />
                                {editDocValidade && (
                                  <button
                                    type="button"
                                    onClick={() => setEditDocValidade('')}
                                    className="text-xs text-red-500 hover:text-red-700 font-semibold whitespace-nowrap"
                                  >
                                    Limpar
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Arquivo */}
                            <div>
                              <div className="text-xs font-bold text-gray-600 mb-1">Arquivo:</div>
                              <input
                                ref={editFileRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                                onChange={(e) => setEditDocFile(e.target.files?.[0] ?? null)}
                                className="hidden"
                              />
                              {editDocFile ? (
                                <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                                  <FileText size={14} className="text-orange-600 shrink-0" />
                                  <span className="text-xs font-semibold text-gray-900 truncate flex-1">{editDocFile.name}</span>
                                  <button type="button" onClick={() => { setEditDocFile(null); if (editFileRef.current) editFileRef.current.value = ''; }} className="text-xs text-red-500 font-bold">Remover</button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => editFileRef.current?.click()}
                                  className="w-full rounded-lg border-2 border-dashed border-gray-300 px-3 py-3 text-center hover:border-orange-400 hover:bg-orange-50 transition text-xs text-gray-500"
                                >
                                  {d.arquivoUrl ? 'Trocar arquivo' : 'Anexar arquivo'}
                                </button>
                              )}
                              {d.arquivoUrl && !editDocFile && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Paperclip size={11} className="text-orange-400" />
                                  <span className="text-[10px] text-orange-600 font-semibold">Arquivo atual mantido</span>
                                </div>
                              )}
                            </div>

                            {/* Visibilidade */}
                            <div>
                              <div className="text-xs font-bold text-gray-600 mb-2">Visibilidade:</div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {([
                                  { value: 'publico' as const, label: 'Público', icon: <Globe size={13} />, color: 'text-green-700', border: 'border-green-300', bg: 'bg-green-50' },
                                  { value: 'departamento' as const, label: 'Departamento', icon: <Building2 size={13} />, color: 'text-blue-700', border: 'border-blue-300', bg: 'bg-blue-50' },
                                  { value: 'usuarios' as const, label: 'Por Usuários', icon: <Users size={13} />, color: 'text-purple-700', border: 'border-purple-300', bg: 'bg-purple-50' },
                                  { value: 'confidencial' as const, label: 'Confidencial', icon: <Lock size={13} />, color: 'text-red-700', border: 'border-red-300', bg: 'bg-red-50' },
                                ]).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setEditDocVis(opt.value)}
                                    className={`flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 transition text-xs font-bold ${
                                      editDocVis === opt.value
                                        ? `${opt.bg} ${opt.border} ${opt.color}`
                                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >
                                    {opt.icon}
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Departamentos — visível para público e departamento */}
                            {(editDocVis === 'publico' || editDocVis === 'departamento') && (
                              <div>
                                <div className="text-xs font-bold text-gray-600 mb-2">Departamentos responsáveis:</div>
                                <div className="grid grid-cols-2 gap-2">
                                  {departamentos.map((dep) => (
                                    <label
                                      key={dep.id}
                                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition text-sm ${
                                        editDocDepts.includes(dep.id)
                                          ? 'bg-orange-50 border-orange-300'
                                          : 'bg-white border-gray-200 hover:bg-gray-50'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editDocDepts.includes(dep.id)}
                                        onChange={() => setEditDocDepts((prev) =>
                                          prev.includes(dep.id) ? prev.filter((x) => x !== dep.id) : [...prev, dep.id]
                                        )}
                                        className="h-3.5 w-3.5 rounded"
                                      />
                                      <span className="font-semibold text-gray-800">{dep.nome}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Seletor de usuários — visível quando 'usuarios' */}
                            {editDocVis === 'usuarios' && (
                              <div>
                                <div className="text-xs font-bold text-gray-600 mb-2">Usuários que podem ver:</div>
                                <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-1.5 mb-2 text-[11px] text-purple-700 font-semibold">
                                  {currentUser?.nome ?? 'Você'} — incluído automaticamente
                                </div>
                                <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                                  {usuarios.filter((u) => u.ativo && u.id !== currentUserId).map((u) => (
                                    <label
                                      key={u.id}
                                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition text-sm ${
                                        editDocUsers.includes(u.id)
                                          ? 'bg-purple-50 border-purple-300'
                                          : 'bg-white border-gray-200 hover:bg-gray-50'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editDocUsers.includes(u.id)}
                                        onChange={() => setEditDocUsers((prev) =>
                                          prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                                        )}
                                        className="h-3.5 w-3.5 rounded"
                                      />
                                      <div className="min-w-0">
                                        <span className="font-semibold text-gray-800 block truncate">{u.nome}</span>
                                        <span className="text-[10px] text-gray-500">{u.email}</span>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                                {editDocUsers.length > 0 && (
                                  <div className="text-[11px] text-purple-600 font-semibold mt-1">
                                    {editDocUsers.length} usuário(s) selecionado(s)
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => setEditingDocId(null)}
                                className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-gray-50"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => {
                                  const patch: Record<string, unknown> = {
                                    nome: editDocNome.trim(),
                                    validade: editDocValidade,
                                    visibilidade: editDocVis,
                                    departamentosIds: editDocDepts,
                                  };
                                  if (editDocVis === 'usuarios') {
                                    const usersArr = [...editDocUsers];
                                    if (currentUserId && !usersArr.includes(currentUserId)) {
                                      usersArr.unshift(currentUserId);
                                    }
                                    patch.usuariosPermitidos = usersArr;
                                  } else {
                                    patch.usuariosPermitidos = [];
                                  }
                                  atualizarDocumento(empresa.id, d.id, patch as any, editDocFile ?? undefined);
                                  setEditingDocId(null);
                                  setEditDocFile(null);
                                }}
                                disabled={!editDocNome.trim() || (editDocVis === 'usuarios' && editDocUsers.length === 0)}
                                className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {previewDocId === d.id && (signedUrls[d.id] || d.arquivoUrl) && (
                        <div className="rounded-xl border border-orange-200 bg-orange-50/50 overflow-hidden" style={{ height: 400 }}>
                          <iframe
                            src={signedUrls[d.id] || d.arquivoUrl}
                            className="w-full h-full border-0"
                            title={`Preview: ${d.nome}`}
                          />
                        </div>
                      )}
                    </React.Fragment>
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
        onSubmit={(doc, file) => adicionarDocumento(empresa.id, doc, file)}
        departamentos={departamentos}
        usuarios={usuarios}
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
