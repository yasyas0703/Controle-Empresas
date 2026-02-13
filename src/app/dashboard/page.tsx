'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FileText, Building2, Clock, Search, MapPin, Briefcase, Eye, Pencil, Trash2, Plus } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR, isWithinDays } from '@/app/utils/date';
import { detectTipoEstabelecimento, formatarDocumento, getTipoInscricaoDisplay } from '@/app/utils/validation';
import type { Empresa, UUID } from '@/app/types';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ConfirmModal from '@/app/components/ConfirmModal';

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

export default function DashboardPage() {
  const { empresas, usuarios, departamentos, currentUserId, canManage, removerEmpresa } = useSistema();

  const [search, setSearch] = useState('');
  const [depId, setDepId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [tipoEstabelecimento, setTipoEstabelecimento] = useState('');
  const [regimeFederal, setRegimeFederal] = useState('');
  const [servico, setServico] = useState('');
  const [estado, setEstado] = useState('');

  const [empresaEdit, setEmpresaEdit] = useState<Empresa | null>(null);
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Empresa | null>(null);

  const responsaveisOptions = useMemo(() => {
    if (!depId) return usuarios.filter((u) => u.ativo);
    return usuarios.filter((u) => u.ativo && u.departamentoId === depId);
  }, [usuarios, depId]);

  const allServicos = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) for (const s of e.servicos || []) set.add(s);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [empresas]);

  const allEstados = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) if (e.estado) set.add(e.estado);
    return Array.from(set).sort();
  }, [empresas]);

  const filteredEmpresas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return empresas
      .filter((e) => {
        if (!canManage) {
          if (!canEditEmpresa(currentUserId, canManage, e)) return false;
        }
        if (q) {
          const hay = [e.codigo, e.cnpj, e.razao_social, e.apelido].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (tipoEstabelecimento) {
          const computed = detectTipoEstabelecimento(e.cnpj || '');
          const effective = computed || e.tipoEstabelecimento;
          if (tipoEstabelecimento === 'cpf') {
            const digits = (e.cnpj || '').replace(/\D/g, '');
            if (digits.length !== 11) return false;
          } else if (tipoEstabelecimento === 'caepf') {
            if ((e.tipoInscricao || '') !== 'CAEPF') return false;
          } else if (tipoEstabelecimento === 'cno') {
            const digits = (e.cnpj || '').replace(/\D/g, '');
            if (digits.length !== 12 && (e.tipoInscricao || '') !== 'CNO') return false;
          } else if (tipoEstabelecimento === 'cei') {
            if ((e.tipoInscricao || '') !== 'CEI') return false;
          } else if (effective !== tipoEstabelecimento) {
            return false;
          }
        }
        if (regimeFederal && (e.regime_federal || '') !== regimeFederal) return false;
        if (estado && (e.estado || '') !== estado) return false;
        if (servico && !(e.servicos || []).includes(servico)) return false;
        if (depId) {
          const resp = (e.responsaveis || {})[depId] || '';
          if (responsavelId && resp !== responsavelId) return false;
        } else if (responsavelId) {
          const anyResp = Object.values(e.responsaveis || {}).some((uid) => uid === responsavelId);
          if (!anyResp) return false;
        }
        return true;
      })
      .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  }, [empresas, search, depId, responsavelId, tipoEstabelecimento, regimeFederal, servico, estado, canManage, currentUserId]);

  const riskItems = useMemo(() => {
    const risk: Array<{ empresaNome: string; empresaCodigo: string; nome: string; vencimento: string; dias: number; kind: string }> = [];
    for (const e of filteredEmpresas) {
      for (const d of e.documentos) {
        const dias = daysUntil(d.validade);
        if (dias !== null && dias <= 60) {
          risk.push({ empresaNome: e.razao_social || e.apelido || '-', empresaCodigo: e.codigo, nome: d.nome, vencimento: d.validade, dias, kind: 'Doc' });
        }
      }
      for (const r of e.rets) {
        const dias = daysUntil(r.vencimento);
        if (dias !== null && dias <= 60) {
          risk.push({ empresaNome: e.razao_social || e.apelido || '-', empresaCodigo: e.codigo, nome: `RET: ${r.nome}`, vencimento: r.vencimento, dias, kind: 'RET' });
        }
      }
    }
    return risk.sort((a, b) => a.dias - b.dias);
  }, [filteredEmpresas]);

  const vencidos = riskItems.filter((r) => r.dias < 0);
  const criticos = riskItems.filter((r) => r.dias >= 0 && r.dias <= 15);
  const atencao = riskItems.filter((r) => r.dias > 15 && r.dias <= 60);

  const totals = useMemo(() => ({
    empresas: filteredEmpresas.length,
    documentos: filteredEmpresas.reduce((a, e) => a + e.documentos.length, 0),
    rets: filteredEmpresas.reduce((a, e) => a + e.rets.length, 0),
    vencidos: vencidos.length,
    emRisco: criticos.length + atencao.length,
  }), [filteredEmpresas, vencidos, criticos, atencao]);

  const hasFilters = search || depId || responsavelId || tipoEstabelecimento || regimeFederal || servico || estado;

  const getDepName = (dId: string) => departamentos.find(d => d.id === dId)?.nome ?? '';
  const getDepIndex = (dId: string) => departamentos.findIndex(d => d.id === dId);
  const getUserName = (uId: string | null) => {
    if (!uId) return '';
    return usuarios.find(u => u.id === uId)?.nome ?? '';
  };

  return (
    <div className="space-y-6">
      {/* VENCIDOS — Banner vermelho forte */}
      {vencidos.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-red-600 to-red-700 p-5 shadow-lg ring-2 ring-red-300 animate-pulse-subtle">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <AlertTriangle className="text-white" size={28} />
            </div>
            <div>
              <div className="text-xl font-black text-white">⚠️ {vencidos.length} VENCIDO(S)!</div>
              <div className="text-sm text-red-100">Estes documentos/RETs JÁ VENCERAM — ação imediata necessária!</div>
            </div>
          </div>
          <div className="space-y-2">
            {vencidos.slice(0, 10).map((r, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white/15 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={16} className="text-red-200 shrink-0" />
                  <span className="font-bold text-white shrink-0">{r.empresaCodigo}</span>
                  <span className="text-red-200 hidden sm:inline">—</span>
                  <span className="font-bold text-white truncate">{r.empresaNome}</span>
                </div>
                <div className="flex items-center gap-2 pl-6 sm:pl-0 sm:ml-auto shrink-0">
                  <span className="text-red-100 truncate text-sm">{r.nome}</span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-white text-red-700 whitespace-nowrap">
                    VENCIDO HÁ {Math.abs(r.dias)}d
                  </span>
                  <span className="text-xs text-red-200 whitespace-nowrap">{formatBR(r.vencimento)}</span>
                </div>
              </div>
            ))}
            {vencidos.length > 10 && (
              <div className="text-sm text-red-100 font-bold pl-4">+{vencidos.length - 10} mais itens vencidos</div>
            )}
          </div>
        </div>
      )}

      {/* Risk Alert Banner — próximos a vencer */}
      {(criticos.length > 0 || atencao.length > 0) && (
        <div className="rounded-2xl bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={22} />
            </div>
            <div>
              <div className="text-lg font-bold text-red-800">{criticos.length + atencao.length} Próximo(s) a Vencer</div>
              <div className="text-sm text-red-600">
                {criticos.length > 0 && <span className="font-bold">🔴 {criticos.length} crítico(s) (≤15d)</span>}
                {criticos.length > 0 && atencao.length > 0 && ' • '}
                {atencao.length > 0 && <span>🟡 {atencao.length} em atenção (≤60d)</span>}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {[...criticos, ...atencao].slice(0, 8).map((r, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white/70 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={16} className={`shrink-0 ${r.dias <= 15 ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className="font-bold text-gray-800 shrink-0">{r.empresaCodigo}</span>
                  <span className="text-gray-500 hidden sm:inline">—</span>
                  <span className="font-bold text-gray-800 truncate">{r.empresaNome}</span>
                </div>
                <div className="flex items-center gap-2 pl-6 sm:pl-0 sm:ml-auto shrink-0">
                  <span className="text-gray-700 truncate text-sm">{r.nome}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${r.dias <= 15 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.dias}d restantes
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatBR(r.vencimento)}</span>
                </div>
              </div>
            ))}
            {(criticos.length + atencao.length) > 8 && (
              <div className="text-sm text-red-600 font-semibold pl-4">+{criticos.length + atencao.length - 8} mais itens em risco</div>
            )}
          </div>
        </div>
      )}

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        <StatCard icon={<Building2 size={24} />} gradient="from-blue-500 to-blue-600" label="Total Empresas" value={totals.empresas} />
        <StatCard icon={<FileText size={24} />} gradient="from-orange-400 to-orange-500" label="Documentos" value={totals.documentos} />
        <StatCard icon={<CalendarClock size={24} />} gradient="from-emerald-500 to-emerald-600" label="RETs" value={totals.rets} />
        <StatCard icon={<AlertTriangle size={24} />} gradient="from-red-700 to-red-800" label="Vencidos" value={totals.vencidos} pulse={totals.vencidos > 0} />
        <StatCard icon={<Clock size={24} />} gradient="from-amber-500 to-orange-500" label="Em Risco (≤60d)" value={totals.emRisco} />
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold text-gray-800">Filtros de Empresas</div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setDepId(''); setResponsavelId(''); setTipoEstabelecimento(''); setRegimeFederal(''); setServico(''); setEstado(''); }}
              className="text-xs text-teal-600 hover:text-teal-700 font-bold"
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, CNPJ, código..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <select value={depId} onChange={(e) => { setDepId(e.target.value); setResponsavelId(''); }} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Departamento</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Responsável</option>
            {responsaveisOptions.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select value={tipoEstabelecimento} onChange={(e) => setTipoEstabelecimento(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Tipo</option>
            <option value="matriz">Matriz</option>
            <option value="filial">Filial</option>
            <option value="cpf">CPF</option>
            <option value="caepf">CAEPF</option>
            <option value="cno">CNO</option>
            <option value="cei">CEI</option>
          </select>
          <select value={regimeFederal} onChange={(e) => setRegimeFederal(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Regime Federal</option>
            <option value="Simples Nacional">Simples Nacional</option>
            <option value="Lucro Presumido">Lucro Presumido</option>
            <option value="Lucro Real">Lucro Real</option>
          </select>
          <select value={servico} onChange={(e) => setServico(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Serviço</option>
            {allServicos.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Estado</option>
            {allEstados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>
      </div>

      {/* Cards de Empresas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredEmpresas.map((e) => {
          const nome = e.razao_social || e.apelido || '-';
          const docsRisco = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias >= 0 && dias <= 60; }).length;
          const docsVencidos = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias < 0; }).length;
          const retsRisco = e.rets.filter((r) => { const dias = daysUntil(r.vencimento); return dias !== null && dias >= 0 && dias <= 60; }).length;
          const retsVencidos = e.rets.filter((r) => { const dias = daysUntil(r.vencimento); return dias !== null && dias < 0; }).length;
          const totalRisco = docsRisco + retsRisco;
          const totalVencidos = docsVencidos + retsVencidos;

          return (
            <div key={e.id} className="rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
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
                    {totalRisco > 0 && (
                      <span className="rounded-md bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                        <Clock size={10} /> {totalRisco} em risco
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-gray-900 text-lg mt-2 truncate">{nome}</div>
                  {e.apelido && e.razao_social && <div className="text-sm text-gray-500 truncate">({e.apelido})</div>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEmpresaView(e)} className="rounded-lg p-2 hover:bg-blue-50 transition" title="Ver detalhes">
                    <Eye size={17} className="text-blue-500" />
                  </button>
                  <button onClick={() => setEmpresaEdit(e)} className="rounded-lg p-2 hover:bg-teal-50 transition" title="Editar" disabled={!canEditEmpresa(currentUserId, canManage, e)}>
                    <Pencil size={17} className="text-teal-500" />
                  </button>
                  <button onClick={() => setConfirmDelete(e)} className="rounded-lg p-2 hover:bg-red-50 transition" title="Excluir" disabled={!canEditEmpresa(currentUserId, canManage, e)}>
                    <Trash2 size={17} className="text-red-400" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Briefcase size={14} className="text-blue-400 shrink-0" />
                  <span className="font-medium text-gray-500">{(() => {
                    const d = (e.cnpj || '').replace(/\D/g, '');
                    if (d.length === 11) return 'CPF:';
                    if (d.length === 14) return 'CNPJ:';
                    if (d.length === 12) return 'CNO:';
                    if (e.tipoInscricao === 'CAEPF') return 'CAEPF:';
                    if (e.tipoInscricao === 'CEI') return 'CEI:';
                    if (e.tipoInscricao) return `${e.tipoInscricao}:`;
                    return 'Doc:';
                  })()}</span>
                  <span className="text-gray-800 truncate">{e.cnpj ? formatarDocumento(e.cnpj, (e.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : e.cnpj.replace(/\D/g, '').length === 12 ? 'CNO' : e.tipoInscricao || 'CNPJ')) : '-'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin size={14} className="text-rose-400 shrink-0" />
                  <span className="font-medium text-gray-500">Local:</span>
                  <span className="text-gray-800 truncate">{e.cidade || '-'}{e.estado ? `/${e.estado}` : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <FileText size={14} className="text-amber-400 shrink-0" />
                  <span className="font-medium text-gray-500">Regime:</span>
                  <span className="text-gray-800 truncate">{e.regime_federal || '-'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <CalendarClock size={14} className="text-emerald-400 shrink-0" />
                  <span className="font-medium text-gray-500">Docs:</span>
                  <span className="text-gray-800">{e.documentos.length}</span>
                  <span className="font-medium text-gray-500 ml-1">RETs:</span>
                  <span className="text-gray-800">{e.rets.length}</span>
                </div>
              </div>

              {(e.servicos?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.servicos.slice(0, 5).map((s) => (
                    <span key={s} className="rounded-md bg-cyan-50 text-teal-600 px-2 py-0.5 text-[11px] font-semibold">{s}</span>
                  ))}
                  {e.servicos.length > 5 && <span className="text-[11px] text-gray-400">+{e.servicos.length - 5}</span>}
                </div>
              )}

              {/* Responsáveis */}
              {Object.keys(e.responsaveis || {}).length > 0 && (() => {
                const resps = Object.entries(e.responsaveis || {})
                  .filter(([, uid]) => uid)
                  .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
                  .filter(r => r.dep && r.user);
                if (resps.length === 0) return null;
                return (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Responsáveis</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {resps.map((r) => {
                        const c = DEPT_COLORS[r.depIdx % 8];
                        return (
                          <div key={r.dep} className={`rounded-lg px-2.5 py-1.5 border ${c.bg} ${c.border}`}>
                            <div className={`text-[10px] font-bold ${c.text} uppercase tracking-wide`}>{r.dep}</div>
                            <div className="text-xs font-semibold text-gray-800 truncate">{r.user}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {filteredEmpresas.length === 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-10 text-center text-gray-400 md:col-span-2">
            Nenhuma empresa encontrada com os filtros atuais.
          </div>
        )}
      </div>

      {empresaEdit && <ModalCadastrarEmpresa empresa={empresaEdit} onClose={() => setEmpresaEdit(null)} />}
      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}
      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir empresa"
        message={`Tem certeza que deseja excluir a empresa "${confirmDelete?.codigo} - ${confirmDelete?.razao_social || confirmDelete?.apelido || ''}"? Ela será movida para a lixeira.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => { if (confirmDelete) removerEmpresa(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function StatCard({ icon, gradient, label, value, pulse }: { icon: React.ReactNode; gradient: string; label: string; value: number; pulse?: boolean }) {
  return (
    <div className={`rounded-2xl bg-white p-3 sm:p-5 shadow-sm ${pulse ? 'ring-2 ring-red-300 ring-offset-2' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs sm:text-sm font-semibold text-gray-500">{label}</div>
          <div className={`text-2xl sm:text-3xl font-bold mt-1 ${pulse ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
        </div>
        <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-md ${pulse ? 'animate-pulse' : ''}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
