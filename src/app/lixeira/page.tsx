'use client';

import React, { useEffect, useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Clock, Building2, Search, Eraser, FileText, MessageSquare, Filter, ShieldCheck, Paperclip } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { formatarDocumento, detectTipoInscricao } from '@/app/utils/validation';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ConfirmModal from '@/app/components/ConfirmModal';
import type { Empresa, LixeiraTipo } from '@/app/types';

const TIPO_LABELS: Record<LixeiraTipo, string> = {
  empresa: 'Empresa',
  documento: 'Documento',
  observacao: 'Observação',
  ret: 'RET',
};
const TIPO_COLORS: Record<LixeiraTipo, { bg: string; text: string; border: string }> = {
  empresa: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  documento: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  observacao: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
  ret: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
};

export default function LixeiraPage() {
  const { lixeira, restaurarEmpresa, restaurarItem, excluirDefinitivamente, limparLixeira, canManage, loadLixeira } = useSistema();
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<LixeiraTipo | 'todos'>('todos');
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setAgoraMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Lixeira é carregada sob demanda — antes vinha junto do loadForUser e era
  // re-baixada a cada mudança no realtime. Agora só carrega ao abrir a página.
  useEffect(() => {
    if (!canManage) return;
    loadLixeira();
  }, [canManage, loadLixeira]);

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
    if (item.ret) parts.push(item.ret.nome, item.ret.numeroPta);
    return parts.filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  // Contadores por tipo
  const countByTipo = { empresa: 0, documento: 0, observacao: 0, ret: 0 };
  for (const item of allItems) {
    const t = (item.tipo ?? 'empresa') as LixeiraTipo;
    if (t in countByTipo) countByTipo[t]++;
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const timeAgo = (iso: string) => {
    const diff = agoraMs - new Date(iso).getTime();
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
    if (tipo === 'ret') return <ShieldCheck size={14} />;
    return <Building2 size={14} />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
              <Trash2 size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--text-1)] tracking-tight">Lixeira</div>
              <div className="text-sm text-[var(--text-2)]">
                {allItems.length === 0 ? 'Nenhum item na lixeira' : (
                  <><span className="ct-num font-semibold text-[var(--text-1)]">{allItems.length}</span> item(ns) na lixeira</>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {allItems.length > 0 && canManage && (
              <button onClick={() => { setConfirmClear(true); }} className="ct-btn-danger">
                <Eraser size={16} />
                Esvaziar Lixeira
              </button>
            )}
          </div>
        </div>

        {/* Filtros */}
        {allItems.length > 0 && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar na lixeira..."
                className="ct-input pl-10"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter size={14} className="text-[var(--text-3)]" />
              {([
                { val: 'todos', label: 'Todos', count: allItems.length, icon: null },
                { val: 'empresa', label: 'Empresas', count: countByTipo.empresa, icon: <Building2 size={12} /> },
                { val: 'documento', label: 'Documentos', count: countByTipo.documento, icon: <FileText size={12} /> },
                { val: 'observacao', label: 'Observações', count: countByTipo.observacao, icon: <MessageSquare size={12} /> },
                { val: 'ret', label: 'RETs', count: countByTipo.ret, icon: <ShieldCheck size={12} /> },
              ] as const).map((f) => {
                if (f.val !== 'todos' && f.count === 0) return null;
                const active = filtroTipo === f.val;
                return (
                  <button
                    key={f.val}
                    onClick={() => setFiltroTipo(f.val)}
                    className={`inline-flex items-center gap-1 rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)] border border-[var(--brand)]'
                        : 'bg-[var(--surface-3)] text-[var(--text-2)] border border-transparent hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]'
                    }`}
                  >
                    {f.icon}
                    <span>{f.label}</span>
                    <span className="ct-num opacity-70">({f.count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Aviso */}
      {items.length > 0 && (
        <div className="rounded-[var(--radius)] bg-[var(--warn-soft)] border-l-4 border-[var(--warn)] p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-[var(--warn)] mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-[var(--text-1)]">Itens na lixeira podem ser restaurados</div>
            <div className="text-xs text-[var(--text-2)] mt-0.5">
              Restaure itens excluídos ou exclua permanentemente. <strong className="font-semibold text-[var(--text-1)]">Itens com mais de 10 dias são removidos automaticamente.</strong>
            </div>
          </div>
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-16 text-center">
          <div className="h-14 w-14 rounded-md bg-[var(--surface-3)] flex items-center justify-center mx-auto mb-4">
            <Trash2 size={26} className="text-[var(--text-3)]" />
          </div>
          <div className="text-lg font-bold text-[var(--text-1)] tracking-tight">Lixeira vazia</div>
          <div className="text-sm text-[var(--text-2)] mt-1">Itens excluídos aparecerão aqui.</div>
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
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
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
                            <span className="ml-2 inline-flex items-center gap-1 text-orange-600 font-semibold text-xs">
                              <Paperclip size={11} /> Com arquivo anexo
                            </span>
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

                    {/* RET details */}
                    {tipo === 'ret' && item.ret && (
                      <div className="mt-1">
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={16} className="text-emerald-500" />
                          <span className="text-base font-bold text-gray-900">{item.ret.nome}</span>
                          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${item.ret.ativo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {item.ret.ativo !== false ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5 flex flex-wrap gap-3">
                          <span>PTA: <span className="font-semibold text-gray-700">{item.ret.numeroPta}</span></span>
                          <span>Vencimento: <span className="font-semibold text-gray-700">{new Date(item.ret.vencimento).toLocaleDateString('pt-BR')}</span></span>
                          {item.ret.portaria && <span>Portaria: <span className="font-semibold text-gray-700">{item.ret.portaria}</span></span>}
                        </div>
                      </div>
                    )}

                    {/* Quem excluiu e quando */}
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-xs">
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
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
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
