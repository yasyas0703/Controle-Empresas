'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, Plus, Search, Pencil, Trash2, Eye, FileText, CalendarClock, Upload, Users, Clock, ChevronLeft, ChevronRight, ScanSearch } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa, UUID, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { detectTipoEstabelecimento, formatarDocumento, getTipoInscricaoDisplay } from '@/app/utils/validation';
import { daysUntil, isRetRenovado } from '@/app/utils/date';
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

function canEditEmpresa(currentUserId: UUID | null, canManage: boolean, empresa: Empresa): boolean {
  if (canManage) return true;
  if (!currentUserId) return false;
  return Object.values(empresa.responsaveis || {}).some((uid) => uid === currentUserId);
}

export default function EmpresasPage() {
  const { empresas, currentUserId, canManage, removerEmpresa, tags: tagsCadastradas } = useSistema();

  const [limiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);

  const { getDepName, getDepIndex, getUserName } = useEntityLoaders();

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
            {canManage && (
              <button
                onClick={() => setModalEncontrarCnpjs(true)}
                className="ct-btn-secondary"
                title="Consulta a Receita e preenche os dados das empresas com CNPJ"
              >
                <ScanSearch size={16} />
                <span className="hidden sm:inline">Encontrar</span> CNPJs
              </button>
            )}
            {canManage && (
              <button onClick={() => setModalImportPorDep(true)} className="ct-btn-secondary">
                <Users size={16} />
                <span className="hidden sm:inline">Importar</span> por DEP
              </button>
            )}
            {canManage && (
              <button onClick={() => setModalImport(true)} className="ct-btn-secondary">
                <Upload size={16} />
                <span className="hidden sm:inline">Importar</span> Planilha
              </button>
            )}
            {canManage && (
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
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 select-none">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={allSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                disabled={selectableIds.length === 0}
              />
              Selecionar todas
              <span className="text-xs text-gray-400 font-bold">({selectedVisibleIds.length}/{selectableIds.length})</span>
            </label>

            <button
              onClick={apagarSelecionadas}
              disabled={selectedVisibleIds.length === 0}
              className={
                'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold transition ' +
                (selectedVisibleIds.length === 0
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-red-50 text-red-700 hover:bg-red-100')
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
          const canEdit = canEditEmpresa(currentUserId, canManage, e);
          const checked = selectedVisibleIds.includes(e.id);
          const totalVencidos = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias < 0; }).length
            + e.rets.filter((r) => { if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) return false; const dias = daysUntil(r.vencimento); return dias !== null && dias < 0; }).length;
          const totalRenovados = e.rets.filter((r) => isRetRenovado(r.vencimento, r.ultimaRenovacao)).length;
          const proximoVencDias = (() => {
            let min: number | null = null;
            for (const d of e.documentos) {
              const dias = daysUntil(d.validade);
              if (dias !== null && dias >= 0 && (min === null || dias < min)) min = dias;
            }
            for (const r of e.rets) {
              if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) continue;
              const dias = daysUntil(r.vencimento);
              if (dias !== null && dias >= 0 && (min === null || dias < min)) min = dias;
            }
            return min;
          })();
          return (
            <div key={e.id} className="rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={checked}
                        onChange={(ev) => toggleSelect(e.id, ev.target.checked)}
                        disabled={!canEdit}
                        title={canEdit ? 'Selecionar empresa' : 'Sem permissão'}
                      />
                    </label>
                    <span className="shrink-0 rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-2.5 py-1 text-xs font-bold shadow-sm">
                      {e.codigo}
                    </span>
                    {(() => {
                      const computed = detectTipoEstabelecimento(e.cnpj || '');
                      const effective = computed || e.tipoEstabelecimento;
                      const digits = (e.cnpj || '').replace(/\D/g, '');
                      const tipoIns = getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao);
                      if (digits.length === 11) {
                        return <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase bg-sky-100 text-sky-700">CPF</span>;
                      }
                      if (effective) {
                        return (
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${effective === 'matriz' ? 'bg-teal-100 text-teal-700' : 'bg-teal-100 text-teal-700'}`}>
                            {effective}
                          </span>
                        );
                      }
                      if (tipoIns && tipoIns !== 'CNPJ') {
                        return <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase bg-gray-100 text-gray-600">{tipoIns}</span>;
                      }
                      return null;
                    })()}
                    {totalVencidos > 0 && (
                      <span className="rounded-md bg-red-600 text-white px-2 py-0.5 text-[10px] font-black flex items-center gap-1 animate-pulse">
                        <AlertTriangle size={10} /> {totalVencidos} VENCIDO(S)
                      </span>
                    )}
                    {totalRenovados > 0 && (
                      <span className="rounded-md bg-blue-600 text-white px-2 py-0.5 text-[10px] font-black flex items-center gap-1">
                        {totalRenovados} RENOVADO(S)
                      </span>
                    )}
                    {proximoVencDias !== null && totalVencidos === 0 && (
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 ${
                        proximoVencDias <= limiares.critico
                          ? 'bg-orange-100 text-orange-700'
                          : proximoVencDias <= limiares.atencao
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-green-100 text-green-700'
                      }`}>
                        <Clock size={10} /> Vence em {proximoVencDias}d
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
                        <span key={tagNome} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${colorMap[cor] ?? colorMap.slate}`}>
                          {tagNome}
                        </span>
                      );
                    })}
                  </div>
                  <div className="font-bold text-gray-900 mt-2 truncate">{nome}</div>
                  {e.apelido && e.razao_social && <div className="text-sm text-gray-500 truncate">({e.apelido})</div>}
                </div>
              </div>

              <div className="mt-3 text-sm text-gray-700 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-500">
                    {getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao) || 'Doc'}:
                  </span>
                  <span className="text-gray-800">{e.cnpj ? formatarDocumento(e.cnpj, getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao) || undefined) : '-'}</span>
                </div>
                {e.regime_federal && <div className="flex items-center gap-2"><span className="font-semibold text-gray-500">Regime:</span> <span className="text-gray-800">{e.regime_federal}</span></div>}
                <div className="flex items-center gap-2"><span className="font-semibold text-gray-500">Local:</span> <span className="text-gray-800">{e.cidade || '-'}{e.estado ? `/${e.estado}` : ''}</span></div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-blue-600"><FileText size={13} /> {e.documentos.length} docs</span>
                  <span className="flex items-center gap-1 text-emerald-600"><CalendarClock size={13} /> {e.rets.length} RETs</span>
                </div>
              </div>

              {/* Responsáveis */}
              {(() => {
                const resps = sortResponsaveisByNome(
                  Object.entries(e.responsaveis || {})
                    .filter(([, uid]) => uid)
                    .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
                    .filter((r) => r.dep && r.user)
                );
                if (resps.length === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {resps.map((r) => {
                        const c = DEPT_COLORS[r.depIdx % 8];
                        return (
                          <div key={r.dep} className={`rounded-lg px-2 py-1 border ${c.bg} ${c.border}`}>
                            <div className={`text-[10px] font-bold ${c.text} uppercase tracking-wide`}>{r.dep}</div>
                            <div className="text-[11px] font-semibold text-gray-800 truncate">{r.user}</div>
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
                    <span key={s} className="rounded-md bg-cyan-50 text-teal-600 px-2 py-0.5 text-[11px] font-semibold">{s}</span>
                  ))}
                  {e.servicos.length > 3 && <span className="text-[11px] text-gray-400">+{e.servicos.length - 3}</span>}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setEmpresaView(e)}
                  className="flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white py-2.5 text-sm font-bold hover:from-teal-600 hover:to-cyan-600 inline-flex items-center justify-center gap-2 shadow-sm transition"
                >
                  <Eye size={16} />
                  Detalhes
                </button>
                <button
                  onClick={() => setEmpresaEdit(e)}
                  className="rounded-xl bg-teal-50 p-2.5 hover:bg-teal-100 transition"
                  title="Editar"
                  disabled={!canEdit}
                >
                  <Pencil className="text-teal-600" size={17} />
                </button>
                {canManage && (
                  <button
                    onClick={() => setConfirmDelete(e)}
                    className="rounded-xl bg-red-50 p-2.5 hover:bg-red-100 transition"
                    title="Excluir"
                    disabled={!canEdit}
                  >
                    <Trash2 className="text-red-500" size={17} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-8 text-center text-gray-400 md:col-span-3">
            Nenhuma empresa encontrada.
          </div>
        )}
      </div>

      {/* Paginação */}
      {filtered.length > perPage && (
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-semibold">Página</span>
            <span className="rounded-lg bg-gray-100 px-2.5 py-1 font-bold text-gray-800 tabular-nums">
              {pageClamped} <span className="text-gray-400">/ {totalPages}</span>
            </span>
            <span className="text-gray-400 hidden sm:inline">·</span>
            <label className="hidden sm:inline-flex items-center gap-1.5 text-xs">
              <span className="text-gray-500">Empresas por página:</span>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-cyan-400"
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
              className="rounded-lg px-2 py-1.5 text-xs font-bold bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Primeira página"
            >
              «
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">Anterior</span>
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold bg-gradient-to-r from-cyan-600 to-teal-500 text-white hover:from-cyan-700 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
            >
              <span className="hidden sm:inline">Próxima</span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={pageClamped >= totalPages}
              className="rounded-lg px-2 py-1.5 text-xs font-bold bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Última página"
            >
              »
            </button>
          </div>
        </div>
      )}

      {modalCreate && <ModalCadastrarEmpresa onClose={() => setModalCreate(false)} />}
      {modalImport && <ModalImportarPlanilha onClose={() => setModalImport(false)} />}
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
