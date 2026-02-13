'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Building2, Plus, Search, Pencil, Trash2, Eye, FileText, CalendarClock, Upload, Users, Globe, Loader2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa, UUID } from '@/app/types';
import { detectTipoEstabelecimento, formatarDocumento, getTipoInscricaoDisplay } from '@/app/utils/validation';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ModalImportarPlanilha from '@/app/components/ModalImportarPlanilha';
import ModalImportarResponsabilidadesFiscal from '@/app/components/ModalImportarResponsabilidadesFiscal';
import ConfirmModal from '@/app/components/ConfirmModal';
import { api } from '@/app/utils/api';

function canEditEmpresa(currentUserId: UUID | null, canManage: boolean, empresa: Empresa): boolean {
  if (canManage) return true;
  if (!currentUserId) return false;
  return Object.values(empresa.responsaveis || {}).some((uid) => uid === currentUserId);
}

const DEPT_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  1: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  3: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  4: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  5: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  6: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  7: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};

export default function EmpresasPage() {
  const { empresas, currentUserId, canManage, removerEmpresa, atualizarEmpresa, departamentos, usuarios, mostrarAlerta } = useSistema();

  const getDepName = (dId: string) => departamentos.find(d => d.id === dId)?.nome ?? '';
  const getDepIndex = (dId: string) => departamentos.findIndex(d => d.id === dId);
  const getUserName = (uId: string | null) => {
    if (!uId) return '';
    return usuarios.find(u => u.id === uId)?.nome ?? '';
  };

  // ── Diagnóstico: loga estado dos responsáveis quando dados mudam ──
  useEffect(() => {
    if (empresas.length === 0) return;
    const comResp = empresas.filter((e) => {
      const uids = Object.values(e.responsaveis || {}).filter(Boolean);
      return uids.length > 0;
    });

    // Contar quantas empresas renderizam badges visíveis
    let comBadgeVisivel = 0;
    let semBadgeMasTêmResp = 0;
    const exemplosProblemas: string[] = [];

    for (const e of empresas) {
      const entries = Object.entries(e.responsaveis || {}).filter(([, uid]) => uid);
      if (entries.length === 0) continue;
      const resolvidos = entries
        .map(([dId, uid]) => ({
          dep: departamentos.find(d => d.id === dId)?.nome ?? '',
          user: uid ? (usuarios.find(u => u.id === uid)?.nome ?? '') : '',
          dId,
          uid,
        }))
        .filter(r => r.dep && r.user);
      if (resolvidos.length > 0) {
        comBadgeVisivel++;
      } else {
        semBadgeMasTêmResp++;
        if (exemplosProblemas.length < 5) {
          const firstEntry = entries[0];
          const deptFound = departamentos.find(d => d.id === firstEntry[0]);
          const userFound = usuarios.find(u => u.id === firstEntry[1]);
          exemplosProblemas.push(
            `cod=${e.codigo} | dept_id=${firstEntry[0].slice(0,8)}… → ${deptFound ? `"${deptFound.nome}"` : '❌ NÃO ENCONTRADO'} | ` +
            `user_id=${String(firstEntry[1]).slice(0,8)}… → ${userFound ? `"${userFound.nome}"` : '❌ NÃO ENCONTRADO'}`
          );
        }
      }
    }

    console.log(
      `%c[EMPRESAS PAGE] Render: ${empresas.length} empresas | ${comResp.length} com resp no state | ${comBadgeVisivel} com badges visíveis | ${semBadgeMasTêmResp} com resp MAS SEM badge`,
      'color: dodgerblue; font-weight: bold',
    );
    if (semBadgeMasTêmResp > 0) {
      console.warn(`%c[EMPRESAS PAGE] ⚠️ ${semBadgeMasTêmResp} empresas TÊM responsáveis no state mas badges NÃO aparecem!`, 'color: red; font-weight: bold');
      for (const ex of exemplosProblemas) {
        console.warn(`  → ${ex}`);
      }
      console.warn(`  Departamentos no state (${departamentos.length}):`, departamentos.map(d => `${d.id.slice(0,8)}="${d.nome}"`).join(', '));
      console.warn(`  Usuários no state (${usuarios.length}):`, usuarios.slice(0, 10).map(u => `${u.id.slice(0,8)}="${u.nome}"`).join(', '), usuarios.length > 10 ? `... +${usuarios.length - 10}` : '');
    }
  }, [empresas, departamentos, usuarios]);

  const [search, setSearch] = useState('');
  const [searchCodigo, setSearchCodigo] = useState('');
  const [modalCreate, setModalCreate] = useState(false);
  const [modalImport, setModalImport] = useState(false);
  const [modalImportFiscal, setModalImportFiscal] = useState(false);
  const [empresaEdit, setEmpresaEdit] = useState<Empresa | null>(null);
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);

  const [selectedIds, setSelectedIds] = useState<UUID[]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qCod = searchCodigo.trim();
    return empresas
      .filter((e) => {
        if (!canManage && !canEditEmpresa(currentUserId, canManage, e)) return false;
        if (qCod) {
          if (e.codigo !== qCod) return false;
        }
        if (q) {
          const hay = [e.codigo, e.cnpj, e.razao_social, e.apelido].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  }, [empresas, search, searchCodigo, canManage, currentUserId]);

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

  // ── Enriquecer CNPJ em lote ──
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, success: 0, skipped: 0 });
  const enrichAbortRef = useRef(false);

  const empresasSemEndereco = useMemo(() => {
    return empresas.filter((e) => {
      const digits = (e.cnpj || '').replace(/\D/g, '');
      if (digits.length !== 14) return false;
      // Se já tem cidade preenchida, já foi enriquecida
      if (e.cidade) return false;
      return true;
    });
  }, [empresas]);

  const handleEnrichCnpj = useCallback(async () => {
    if (enriching) {
      enrichAbortRef.current = true;
      return;
    }
    enrichAbortRef.current = false;
    const pending = empresasSemEndereco;
    if (pending.length === 0) {
      mostrarAlerta('CNPJ', 'Todas as empresas já possuem endereço preenchido.', 'aviso');
      return;
    }
    setEnriching(true);
    setEnrichProgress({ done: 0, total: pending.length, success: 0, skipped: 0 });

    let success = 0;
    let skipped = 0;
    const DELAY_MS = 1500; // 1.5s entre consultas (~40/min — dentro do limite da BrasilAPI)

    for (let i = 0; i < pending.length; i++) {
      if (enrichAbortRef.current) break;
      const emp = pending[i];
      const digits = (emp.cnpj || '').replace(/\D/g, '');

      try {
        const data = await api.consultarCnpj(digits);
        if (data?.cidade || data?.estado || data?.logradouro) {
          await atualizarEmpresa(emp.id, {
            apelido: data.nome_fantasia || emp.apelido || undefined,
            data_abertura: data.data_abertura || emp.data_abertura || undefined,
            estado: data.estado || emp.estado || undefined,
            cidade: data.cidade || emp.cidade || undefined,
            bairro: data.bairro || emp.bairro || undefined,
            logradouro: data.logradouro || emp.logradouro || undefined,
            numero: data.numero || emp.numero || undefined,
            cep: data.cep || emp.cep || undefined,
            email: data.email || emp.email || undefined,
            telefone: data.telefone || emp.telefone || undefined,
          });
          success++;
        } else {
          skipped++;
        }
      } catch (err: unknown) {
        skipped++;
        // rate-limited — esperar mais tempo (30s se 429, senão 3s)
        const isRateLimit = err instanceof Error && err.message.toLowerCase().includes('limite');
        await new Promise((r) => setTimeout(r, isRateLimit ? 30000 : 3000));
      }

      setEnrichProgress({ done: i + 1, total: pending.length, success, skipped });

      // Delay entre consultas
      if (i < pending.length - 1 && !enrichAbortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    setEnriching(false);
    mostrarAlerta(
      'Enriquecimento CNPJ',
      `${success} empresa(s) atualizadas, ${skipped} sem dados. ${enrichAbortRef.current ? '(interrompido)' : ''}`,
      success > 0 ? 'sucesso' : 'aviso'
    );
  }, [enriching, empresasSemEndereco, atualizarEmpresa, mostrarAlerta]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-md">
              <Building2 className="text-white" size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">Cadastro de Empresas</div>
              <div className="text-sm text-gray-500">{filtered.length} empresa(s) • Use o Dashboard para filtros avançados</div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {canManage && empresasSemEndereco.length > 0 && (
              <button
                onClick={handleEnrichCnpj}
                className={
                  'inline-flex items-center gap-2 rounded-xl border-2 px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-bold transition ' +
                  (enriching
                    ? 'border-orange-300 text-orange-700 bg-orange-50'
                    : 'border-violet-200 text-violet-700 hover:bg-violet-50')
                }
              >
                {enriching ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
                {enriching ? 'Parar' : `Enriquecer CNPJ (${empresasSemEndereco.length})`}
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setModalImportFiscal(true)}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-200 text-emerald-700 px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-bold hover:bg-emerald-50 transition"
              >
                <Users size={18} />
                <span className="hidden sm:inline">Importar</span> Resp. Fiscal
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setModalImport(true)}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-cyan-200 text-cyan-700 px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-bold hover:bg-cyan-50 transition"
              >
                <Upload size={18} />
                <span className="hidden sm:inline">Importar</span> Planilha
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setModalCreate(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white px-4 sm:px-5 py-2.5 sm:py-3 text-sm font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition"
              >
                <Plus size={18} />
                Nova Empresa
              </button>
            )}
          </div>
        </div>

        {/* Barra de progresso do enriquecimento CNPJ */}
        {enriching && enrichProgress.total > 0 && (
          <div className="mt-4 rounded-xl bg-violet-50 border border-violet-200 p-4">
            <div className="flex items-center justify-between text-sm font-semibold text-violet-700 mb-2">
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Consultando CNPJs... {enrichProgress.done}/{enrichProgress.total}
              </span>
              <span className="text-xs text-violet-500">
                {enrichProgress.success} atualizadas • {enrichProgress.skipped} sem dados
              </span>
            </div>
            <div className="h-2 rounded-full bg-violet-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${(enrichProgress.done / enrichProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por CNPJ/CPF, razão social..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <div className="relative w-full sm:w-44">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">#</span>
            <input
              value={searchCodigo}
              onChange={(e) => setSearchCodigo(e.target.value.replace(/\D/g, ''))}
              placeholder="Buscar por código"
              className="w-full rounded-xl bg-gray-50 pl-8 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-teal-400 focus:bg-white transition"
              inputMode="numeric"
            />
          </div>
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
        {filtered.map((e) => {
          const nome = e.razao_social || e.apelido || '-';
          const canEdit = canEditEmpresa(currentUserId, canManage, e);
          const checked = selectedVisibleIds.includes(e.id);
          return (
            <div key={e.id} className="rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
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
                const resps = Object.entries(e.responsaveis || {})
                  .filter(([, uid]) => uid)
                  .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
                  .filter(r => r.dep && r.user);
                if (resps.length === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-1.5">
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

      {modalCreate && <ModalCadastrarEmpresa onClose={() => setModalCreate(false)} />}
      {modalImport && <ModalImportarPlanilha onClose={() => setModalImport(false)} />}
      {modalImportFiscal && <ModalImportarResponsabilidadesFiscal onClose={() => setModalImportFiscal(false)} />}
      {empresaEdit && <ModalCadastrarEmpresa empresa={empresaEdit} onClose={() => setEmpresaEdit(null)} />}
      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}

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
