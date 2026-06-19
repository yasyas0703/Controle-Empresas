'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, Plus, Search, Pencil, Trash2, Eye, FileText, CalendarClock, Upload, Users, Clock, ChevronLeft, ChevronRight, ScanSearch } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa, UUID, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { detectTipoEstabelecimento, formatarDocumento, getTipoInscricaoDisplay } from '@/app/utils/validation';
import { daysUntil, isRetRenovado, formatMesAno } from '@/app/utils/date';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ModalImportarPlanilha from '@/app/components/ModalImportarPlanilha';
import ModalImportarResponsabilidadesPorDep from '@/app/components/ModalImportarResponsabilidadesPorDep';
import ModalEncontrarCnpjs from '@/app/components/ModalEncontrarCnpjs';
import ConfirmModal from '@/app/components/ConfirmModal';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import { useEntityLoaders } from '@/app/hooks/useEntityLoaders';
import { usePagination } from '@/app/hooks/usePagination';
import { sortResponsaveisByNome, sortStringsPtBr } from '@/lib/sort';
import { DEPT_COLORS } from '@/app/utils/constants';

// canEditAll: quem edita QUALQUER empresa (gerente/admin via canManage, e o
// depto Cadastro via canCriarEmpresa). Os demais só editam onde são responsáveis.
function canEditEmpresa(currentUserId: UUID | null, canEditAll: boolean, empresa: Empresa): boolean {
  if (canEditAll) return true;
  if (!currentUserId) return false;
  return Object.values(empresa.responsaveis || {}).some((uid) => uid === currentUserId);
}

export default function EmpresasPage() {
  const { empresas, currentUserId, canManage, canCriarEmpresa, removerEmpresa, tags: tagsCadastradas } = useSistema();

  const [limiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);

  const { getDepName, getDepIndex, getUserName, getUserEmail } = useEntityLoaders();

  const [search, setSearch] = useState('');
  const [searchCodigo, setSearchCodigo] = useState('');
  const [tagFiltro, setTagFiltro] = useState('');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) for (const t of e.tags || []) set.add(t);
    return sortStringsPtBr(Array.from(set));
  }, [empresas]);
  const [modalCreate, setModalCreate] = useState(false);
  const [modalImport, setModalImport] = useState(false);
  const [empresaEdit, setEmpresaEdit] = useState<Empresa | null>(null);
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);
  const [modalImportPorDep, setModalImportPorDep] = useState(false);
  const [modalEncontrarCnpjs, setModalEncontrarCnpjs] = useState(false);

  const [selectedIds, setSelectedIds] = useState<UUID[]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qCod = searchCodigo.trim();
    return empresas
      .filter((e) => {
        if (qCod) {
          if (e.codigo !== qCod) return false;
        }
        if (q) {
          const hay = [e.codigo, e.cnpj, e.razao_social, e.apelido].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (tagFiltro && !(e.tags || []).includes(tagFiltro)) return false;
        return true;
      })
      .sort((a, b) => (a.razao_social || a.apelido || '').localeCompare(b.razao_social || b.apelido || ''));
  }, [empresas, search, searchCodigo, tagFiltro]);

  const pagination = usePagination(filtered, { storageKey: 'triar-empresas-per-page' });
  const { page: pageClamped, perPage, setPage, setPerPage, totalPages, sliced: filteredVisivel } = pagination;

  // Reseta pra página 1 quando filtros ou tamanho de página mudam
  useEffect(() => {
    setPage(1);
  }, [search, searchCodigo, tagFiltro, perPage, setPage]);

  const selectableIds = useMemo(() => {
    return filtered.filter((e) => canEditEmpresa(currentUserId, canManage, e)).map((e) => e.id);
  }, [filtered, currentUserId, canManage]);

  const selectedVisibleIds = useMemo(() => {
    const allowed = new Set(selectableIds);
    return selectedIds.filter((id) => allowed.has(id));
  }, [selectedIds, selectableIds]);

  useEffect(() => {
    // remove seleções que saíram do filtro atual
    if (selectedVisibleIds.length !== selectedIds.length) setSelectedIds(selectedVisibleIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVisibleIds.join('|'), selectableIds.join('|')]);

  const allSelected = selectableIds.length > 0 && selectedVisibleIds.length === selectableIds.length;
  const someSelected = selectedVisibleIds.length > 0 && !allSelected;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleSelect = (id: UUID, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? selectableIds : []);
  };

  const [confirmDelete, setConfirmDelete] = useState<Empresa | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const apagarSelecionadas = () => {
    if (!canManage) return;
    if (selectedVisibleIds.length === 0) return;
    setConfirmBulk(true);
  };

  const executarBulkDelete = () => {
    for (const id of selectedVisibleIds) removerEmpresa(id);
    setSelectedIds([]);
    setConfirmBulk(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
              <Building2 size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--text-1)] tracking-tight">Cadastro de Empresas</div>
              <div className="text-sm text-[var(--text-2)]">
                {filtered.length === 0 ? '0 empresa(s)' : (
                  <>
                    Mostrando <span className="ct-num font-semibold text-[var(--text-1)]">{(pageClamped - 1) * perPage + 1}–{Math.min(pageClamped * perPage, filtered.length)}</span> de <span className="ct-num font-semibold text-[var(--text-1)]">{filtered.length}</span> empresa(s)
                  </>
                )} • Use o Dashboard para filtros avançados
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canCriarEmpresa && (
              <button
                onClick={() => setModalEncontrarCnpjs(true)}
                className="ct-btn-secondary"
                title="Consulta a Receita e preenche os dados das empresas com CNPJ"
              >
                <ScanSearch size={16} />
                <span className="hidden sm:inline">Encontrar</span> CNPJs
              </button>
            )}
            {canCriarEmpresa && (
              <button onClick={() => setModalImportPorDep(true)} className="ct-btn-secondary">
                <Users size={16} />
                <span className="hidden sm:inline">Importar</span> por DEP
              </button>
            )}
            {canCriarEmpresa && (
              <button onClick={() => setModalImport(true)} className="ct-btn-secondary">
                <Upload size={16} />
                <span className="hidden sm:inline">Importar</span> Planilha
              </button>
            )}
            {canCriarEmpresa && (
              <button onClick={() => setModalCreate(true)} className="ct-btn-primary">
                <Plus size={16} />
                Nova Empresa
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por CNPJ/CPF, razão social..."
              className="ct-input pl-10"
            />
          </div>
          <div className="relative w-full sm:w-44">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-xs font-semibold pointer-events-none">#</span>
            <input
              value={searchCodigo}
              onChange={(e) => setSearchCodigo(e.target.value.replace(/\D/g, ''))}
              placeholder="Buscar por código"
              className="ct-input pl-8"
              inputMode="numeric"
            />
          </div>
          {allTags.length > 0 && (
            <select
              value={tagFiltro}
              onChange={(e) => setTagFiltro(e.target.value)}
              className="ct-input sm:w-44"
            >
              <option value="">Todas as tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        {canManage && (filtered.length > 0 || selectedVisibleIds.length > 0) && (
          <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-2)] select-none">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border-strong)]"
                checked={allSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                disabled={selectableIds.length === 0}
              />
              Selecionar todas
              <span className="ct-num text-xs text-[var(--text-muted)] font-semibold">({selectedVisibleIds.length}/{selectableIds.length})</span>
            </label>

            <button
              onClick={apagarSelecionadas}
              disabled={selectedVisibleIds.length === 0}
              className={
                'inline-flex items-center gap-2 rounded-[var(--radius-md)] px-4 py-2.5 font-semibold transition-colors ' +
                (selectedVisibleIds.length === 0
                  ? 'bg-[var(--surface-3)] text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-[var(--danger-soft)] text-[var(--danger)] hover:brightness-95')
              }
              title="Apagar selecionadas"
            >
              <Trash2 size={18} />
              Apagar selecionadas
            </button>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredVisivel.map((e) => {
          const nome = e.razao_social || e.apelido || '-';
          const canEdit = canEditEmpresa(currentUserId, canCriarEmpresa, e);
          const checked = selectedVisibleIds.includes(e.id);
          const totalVencidos = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias < 0; }).length
            + e.rets.filter((r) => { if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) return false; const dias = daysUntil(r.vencimento); return dias !== null && dias < 0; }).length;
          const totalRenovados = e.rets.filter((r) => isRetRenovado(r.vencimento, r.ultimaRenovacao)).length;
          const proximoVenc = (() => {
            let minDias: number | null = null;
            let minData: string | null = null;
            const considerar = (dias: number | null, data?: string) => {
              if (dias === null || dias < 0) return;
              if (minDias === null || dias < minDias) { minDias = dias; minData = data ?? null; }
            };
            for (const d of e.documentos) considerar(daysUntil(d.validade), d.validade);
            for (const r of e.rets) {
              if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) continue;
              considerar(daysUntil(r.vencimento), r.vencimento);
            }
            return { dias: minDias, data: minData };
          })();
          return (
            <div key={e.id} className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border-strong)]"
                        checked={checked}
                        onChange={(ev) => toggleSelect(e.id, ev.target.checked)}
                        disabled={!canEdit}
                        title={canEdit ? 'Selecionar empresa' : 'Sem permissão'}
                      />
                    </label>
                    <span className="shrink-0 ct-num rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--text-1)] px-2 py-0.5 text-xs font-semibold border border-[var(--border)]">
                      {e.codigo}
                    </span>
                    {(() => {
                      const computed = detectTipoEstabelecimento(e.cnpj || '');
                      const effective = computed || e.tipoEstabelecimento;
                      const digits = (e.cnpj || '').replace(/\D/g, '');
                      const tipoIns = getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao);
                      const tipoChip = 'rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border-subtle)]';
                      if (digits.length === 11) {
                        return <span className={tipoChip}>CPF</span>;
                      }
                      if (effective) {
                        return <span className={tipoChip}>{effective}</span>;
                      }
                      if (tipoIns && tipoIns !== 'CNPJ') {
                        return <span className={tipoChip}>{tipoIns}</span>;
                      }
                      return null;
                    })()}
                    {totalVencidos > 0 && (
                      <span className="ct-badge ct-badge-danger gap-1">
                        <AlertTriangle size={10} /> <span className="ct-num">{totalVencidos}</span> VENCIDO(S)
                      </span>
                    )}
                    {totalRenovados > 0 && (
                      <span className="ct-badge ct-badge-ok gap-1">
                        <span className="ct-num">{totalRenovados}</span> RENOVADO(S)
                      </span>
                    )}
                    {proximoVenc.dias !== null && totalVencidos === 0 && (
                      <span className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold inline-flex items-center gap-1 ${
                        proximoVenc.dias <= limiares.critico
                          ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                          : proximoVenc.dias <= limiares.atencao
                            ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
                            : 'text-[var(--text-3)]'
                      }`}>
                        <Clock size={10} /> Vence <span className="ct-num">{formatMesAno(proximoVenc.data ?? undefined)}</span>
                      </span>
                    )}
                    {(e.tags || []).map((tagNome) => {
                      const tagObj = tagsCadastradas.find((t) => t.nome === tagNome);
                      const cor = tagObj?.cor ?? 'slate';
                      const colorMap: Record<string, string> = {
                        red: 'bg-red-100 text-red-700', orange: 'bg-orange-100 text-orange-700', amber: 'bg-amber-100 text-amber-700',
                        green: 'bg-green-100 text-green-700', emerald: 'bg-emerald-100 text-emerald-700', cyan: 'bg-cyan-100 text-cyan-700',
                        blue: 'bg-blue-100 text-blue-700', violet: 'bg-violet-100 text-violet-700', purple: 'bg-purple-100 text-purple-700',
                        pink: 'bg-pink-100 text-pink-700', rose: 'bg-rose-100 text-rose-700', slate: 'bg-slate-100 text-slate-700',
                      };
                      return (
                        <span key={tagNome} className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold ${colorMap[cor] ?? colorMap.slate}`}>
                          {tagNome}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-1)] truncate">{nome}</div>
                  {e.apelido && e.razao_social && <div className="text-[13px] text-[var(--text-3)] truncate">({e.apelido})</div>}
                </div>
              </div>

              <div className="mt-3 text-[13px] space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-3)]">
                    {getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao) || 'Doc'}:
                  </span>
                  <span className="ct-num text-[var(--text-2)]">{e.cnpj ? formatarDocumento(e.cnpj, getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao) || undefined) : '-'}</span>
                </div>
                {e.regime_federal && <div className="flex items-center gap-2"><span className="font-medium text-[var(--text-3)]">Regime:</span> <span className="text-[var(--text-2)]">{e.regime_federal}</span></div>}
                <div className="flex items-center gap-2"><span className="font-medium text-[var(--text-3)]">Local:</span> <span className="text-[var(--text-2)]">{e.cidade || '-'}{e.estado ? `/${e.estado}` : ''}</span></div>
                <div className="flex items-center gap-4 text-[var(--text-2)]">
                  <span className="flex items-center gap-1"><FileText size={13} className="text-[var(--text-muted)]" /> <span className="ct-num">{e.documentos.length}</span> docs</span>
                  <span className="flex items-center gap-1"><CalendarClock size={13} className="text-[var(--text-muted)]" /> <span className="ct-num">{e.rets.length}</span> RETs</span>
                </div>
              </div>

              {/* Responsáveis */}
              {(() => {
                const resps = sortResponsaveisByNome(
                  Object.entries(e.responsaveis || {})
                    .filter(([, uid]) => uid)
                    .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), email: getUserEmail(uid), depIdx: getDepIndex(dId) }))
                    .filter((r) => r.dep && r.user)
                );
                if (resps.length === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {resps.map((r) => {
                        const c = DEPT_COLORS[r.depIdx % 8];
                        return (
                          <div
                            key={r.dep}
                            className={`rounded-[var(--radius)] px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--border-subtle)] border-l-[3px] ${c.bar}`}
                          >
                            <div className={`text-[10px] font-semibold ${c.text} uppercase tracking-wider`}>{r.dep}</div>
                            <div className="text-[11px] font-semibold text-[var(--text-1)] truncate">{r.user}</div>
                            {r.email && <div className="text-[10px] text-[var(--text-3)] truncate" title={r.email}>{r.email}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {(e.servicos?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {e.servicos.slice(0, 3).map((s) => (
                    <span key={s} className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--text-2)] px-2 py-0.5 text-[11px] font-semibold">{s}</span>
                  ))}
                  {e.servicos.length > 3 && <span className="text-[11px] text-[var(--text-3)]">+{e.servicos.length - 3}</span>}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => setEmpresaView(e)} className="ct-btn-primary flex-1">
                  <Eye size={16} />
                  Detalhes
                </button>
                <button
                  onClick={() => setEmpresaEdit(e)}
                  className="rounded-[var(--radius)] bg-[var(--surface-3)] p-2.5 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] text-[var(--text-2)] transition-colors disabled:opacity-50"
                  title="Editar"
                  disabled={!canEdit}
                >
                  <Pencil size={17} />
                </button>
                {canManage && (
                  <button
                    onClick={() => setConfirmDelete(e)}
                    className="rounded-[var(--radius)] bg-[var(--surface-3)] p-2.5 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] text-[var(--text-2)] transition-colors disabled:opacity-50"
                    title="Excluir"
                    disabled={!canEdit}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-8 text-center text-[var(--text-3)] md:col-span-3">
            Nenhuma empresa encontrada.
          </div>
        )}
      </div>

      {/* Paginação */}
      {filtered.length > perPage && (
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            <span className="font-semibold">Página</span>
            <span className="ct-num rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-2.5 py-1 font-semibold text-[var(--text-1)]">
              {pageClamped} <span className="text-[var(--text-muted)]">/ {totalPages}</span>
            </span>
            <span className="text-[var(--text-muted)] hidden sm:inline">·</span>
            <label className="hidden sm:inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--text-3)]">Empresas por página:</span>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="ct-num rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1 text-xs font-semibold focus:outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_1px_var(--brand)]"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={pageClamped <= 1}
              className="rounded-[var(--radius)] px-2 py-1.5 text-xs font-semibold bg-[var(--surface-3)] text-[var(--text-2)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Primeira página"
            >
              «
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              className="inline-flex items-center gap-1 rounded-[var(--radius)] px-3 py-1.5 text-sm font-semibold bg-[var(--surface-3)] text-[var(--text-2)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">Anterior</span>
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              className="inline-flex items-center gap-1 rounded-[var(--radius)] px-3 py-1.5 text-sm font-semibold bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="hidden sm:inline">Próxima</span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={pageClamped >= totalPages}
              className="rounded-[var(--radius)] px-2 py-1.5 text-xs font-semibold bg-[var(--surface-3)] text-[var(--text-2)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Última página"
            >
              »
            </button>
          </div>
        </div>
      )}

      {modalCreate && <ModalCadastrarEmpresa onClose={() => setModalCreate(false)} />}
      {modalImport && (
        <ModalImportarPlanilha
          onClose={() => setModalImport(false)}
          onBuscarCnpjs={() => setModalEncontrarCnpjs(true)}
        />
      )}
      {empresaEdit && <ModalCadastrarEmpresa empresa={empresaEdit} onClose={() => setEmpresaEdit(null)} />}
      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}
      {modalImportPorDep && <ModalImportarResponsabilidadesPorDep onClose={() => setModalImportPorDep(false)} />}
      {modalEncontrarCnpjs && <ModalEncontrarCnpjs onClose={() => setModalEncontrarCnpjs(false)} />}

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir empresa"
        message={confirmDelete ? `Tem certeza que deseja excluir "${confirmDelete.razao_social || confirmDelete.apelido}"? A empresa será movida para a lixeira.` : ''}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => { if (confirmDelete) removerEmpresa(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmModal
        open={confirmBulk}
        title="Excluir empresas selecionadas"
        message={`Tem certeza que deseja excluir ${selectedIds.length} empresa(s)? Elas serão movidas para a lixeira.`}
        confirmText="Excluir todas"
        variant="danger"
        onConfirm={() => { executarBulkDelete(); setConfirmBulk(false); }}
        onCancel={() => setConfirmBulk(false)}
      />
    </div>
  );
}
