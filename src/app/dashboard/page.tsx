'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, CalendarClock, FileText, Building2, Clock, Search, MapPin, Briefcase, Eye, Pencil, Trash2, CheckSquare, Square, FileDown, X, ArrowUpDown } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR, isWithinDays } from '@/app/utils/date';
import { detectTipoEstabelecimento, formatarDocumento, getTipoInscricaoDisplay } from '@/app/utils/validation';
import type { Empresa, UUID, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import ModalCadastrarEmpresa from '@/app/components/ModalCadastrarEmpresa';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import ConfirmModal from '@/app/components/ConfirmModal';
import { exportEmpresasPdf } from '@/lib/exportPdf';

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

  const [limiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);

  const [search, setSearch] = useState('');
  const [depId, setDepId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [tipoEstabelecimento, setTipoEstabelecimento] = useState('');
  const [regimeFederal, setRegimeFederal] = useState('');
  const [servico, setServico] = useState('');
  const [estado, setEstado] = useState('');
  const [cadastrada, setCadastrada] = useState('');
  const [statusVenc, setStatusVenc] = useState('');
  const [sortBy, setSortBy] = useState<'alpha' | 'vencidos' | 'proximo' | 'recente'>('alpha');
  const [selecionando, setSelecionando] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

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
        if (cadastrada === 'sim' && !e.cadastrada) return false;
        if (cadastrada === 'nao' && e.cadastrada) return false;
        if (depId) {
          const resp = (e.responsaveis || {})[depId];
          if (!resp) return false;
          if (responsavelId && resp !== responsavelId) return false;
        } else if (responsavelId) {
          const anyResp = Object.values(e.responsaveis || {}).some((uid) => uid === responsavelId);
          if (!anyResp) return false;
        }
        if (statusVenc) {
          const allItems = [
            ...e.documentos.map((d) => d.validade),
            ...e.rets.map((r) => r.vencimento),
          ];
          const temVencido = allItems.some((v) => { const d = daysUntil(v); return d !== null && d < 0; });
          const temRisco = allItems.some((v) => { const d = daysUntil(v); return d !== null && d >= 0 && d <= limiares.atencao; });
          if (statusVenc === 'vencidos' && !temVencido) return false;
          if (statusVenc === 'risco' && !temRisco) return false;
          if (statusVenc === 'emdia' && (temVencido || temRisco)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'vencidos') {
          const countV = (e: Empresa) => [...e.documentos.map((d) => d.validade), ...e.rets.map((r) => r.vencimento)]
            .filter((v) => { const d = daysUntil(v); return d !== null && d < 0; }).length;
          return countV(b) - countV(a);
        }
        if (sortBy === 'proximo') {
          const nearest = (e: Empresa) => {
            let min: number | null = null;
            for (const v of [...e.documentos.map((d) => d.validade), ...e.rets.map((r) => r.vencimento)]) {
              const d = daysUntil(v);
              if (d !== null && (min === null || d < min)) min = d;
            }
            return min ?? 99999;
          };
          return nearest(a) - nearest(b);
        }
        if (sortBy === 'recente') {
          return new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime();
        }
        return (a.razao_social || a.apelido || '').localeCompare(b.razao_social || b.apelido || '');
      });
  }, [empresas, search, depId, responsavelId, tipoEstabelecimento, regimeFederal, servico, estado, cadastrada, statusVenc, sortBy, limiares, canManage, currentUserId]);

  const riskItems = useMemo(() => {
    const risk: Array<{ empresaNome: string; empresaCodigo: string; nome: string; vencimento: string; dias: number; kind: string }> = [];
    for (const e of filteredEmpresas) {
      for (const d of e.documentos) {
        const dias = daysUntil(d.validade);
        if (dias !== null && dias <= limiares.proximo) {
          risk.push({ empresaNome: e.razao_social || e.apelido || '-', empresaCodigo: e.codigo, nome: d.nome, vencimento: d.validade, dias, kind: 'Doc' });
        }
      }
      for (const r of e.rets) {
        const dias = daysUntil(r.vencimento);
        if (dias !== null && dias <= limiares.proximo) {
          risk.push({ empresaNome: e.razao_social || e.apelido || '-', empresaCodigo: e.codigo, nome: `RET: ${r.nome}`, vencimento: r.vencimento, dias, kind: 'RET' });
        }
      }
    }
    return risk.sort((a, b) => a.dias - b.dias);
  }, [filteredEmpresas, limiares]);

  const vencidos = riskItems.filter((r) => r.dias < 0);
  const criticos = riskItems.filter((r) => r.dias >= 0 && r.dias <= limiares.critico);
  const atencao = riskItems.filter((r) => r.dias > limiares.critico && r.dias <= limiares.atencao);
  const proximo = riskItems.filter((r) => r.dias > limiares.atencao && r.dias <= limiares.proximo);

  const totals = useMemo(() => ({
    empresas: filteredEmpresas.length,
    documentos: filteredEmpresas.reduce((a, e) => a + e.documentos.length, 0),
    rets: filteredEmpresas.reduce((a, e) => a + e.rets.length, 0),
    vencidos: vencidos.length,
    emRisco: criticos.length + atencao.length + proximo.length,
  }), [filteredEmpresas, vencidos, criticos, atencao, proximo]);

  const hasFilters = search || depId || responsavelId || tipoEstabelecimento || regimeFederal || servico || estado || cadastrada || statusVenc;

  const getDepName = (dId: string) => departamentos.find(d => d.id === dId)?.nome ?? '';
  const getDepIndex = (dId: string) => departamentos.findIndex(d => d.id === dId);
  const getUserName = (uId: string | null) => {
    if (!uId) return '';
    return usuarios.find(u => u.id === uId)?.nome ?? '';
  };

  return (
    <div className="space-y-6">
      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        <StatCard icon={<Building2 size={24} />} gradient="from-blue-500 to-blue-600" label="Total Empresas" value={totals.empresas} />
        <StatCard icon={<FileText size={24} />} gradient="from-orange-400 to-orange-500" label="Documentos" value={totals.documentos} />
        <StatCard icon={<CalendarClock size={24} />} gradient="from-emerald-500 to-emerald-600" label="RETs" value={totals.rets} />
        <StatCard icon={<AlertTriangle size={24} />} gradient="from-red-700 to-red-800" label="Vencidos" value={totals.vencidos} pulse={totals.vencidos > 0} />
        <StatCard icon={<Clock size={24} />} gradient="from-amber-500 to-orange-500" label={`Em Risco (≤${limiares.proximo}d)`} value={totals.emRisco} />
      </div>

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
                  <span className="text-red-100 text-sm break-words" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.nome}</span>
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

      {/* Risk Alert Banner — próximos a vencer (crítico + atenção) */}
      {(criticos.length > 0 || atencao.length > 0) && (
        <div className="rounded-2xl bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={22} />
            </div>
            <div>
              <div className="text-lg font-bold text-red-800">{criticos.length + atencao.length} Próximo(s) a Vencer</div>
              <div className="text-sm text-red-600">
                {criticos.length > 0 && <span className="font-bold">🔴 {criticos.length} crítico(s) (≤{limiares.critico}d)</span>}
                {criticos.length > 0 && atencao.length > 0 && ' • '}
                {atencao.length > 0 && <span>🟡 {atencao.length} em atenção (≤{limiares.atencao}d)</span>}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {[...criticos, ...atencao].slice(0, 8).map((r, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white/70 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={16} className={`shrink-0 ${r.dias <= limiares.critico ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className="font-bold text-gray-800 shrink-0">{r.empresaCodigo}</span>
                  <span className="text-gray-500 hidden sm:inline">—</span>
                  <span className="font-bold text-gray-800 truncate">{r.empresaNome}</span>
                </div>
                <div className="flex items-center gap-2 pl-6 sm:pl-0 sm:ml-auto shrink-0">
                  <span className="text-gray-700 text-sm break-words" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.nome}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${r.dias <= limiares.critico ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
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

      {/* Próximo (≤90d) — Banner verde */}
      {proximo.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center">
              <Clock className="text-green-600" size={22} />
            </div>
            <div>
              <div className="text-lg font-bold text-green-800">🟢 {proximo.length} Próximo(s) (≤{limiares.proximo} dias)</div>
              <div className="text-sm text-green-600">Estes documentos/RETs vencem nos próximos {limiares.atencao + 1} a {limiares.proximo} dias</div>
            </div>
          </div>
          <div className="space-y-2">
            {proximo.slice(0, 8).map((r, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white/70 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={16} className="shrink-0 text-green-500" />
                  <span className="font-bold text-gray-800 shrink-0">{r.empresaCodigo}</span>
                  <span className="text-gray-500 hidden sm:inline">—</span>
                  <span className="font-bold text-gray-800 truncate">{r.empresaNome}</span>
                </div>
                <div className="flex items-center gap-2 pl-6 sm:pl-0 sm:ml-auto shrink-0">
                  <span className="text-gray-700 text-sm break-words" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.nome}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap bg-green-100 text-green-700">
                    {r.dias}d restantes
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatBR(r.vencimento)}</span>
                </div>
              </div>
            ))}
            {proximo.length > 8 && (
              <div className="text-sm text-green-600 font-semibold pl-4">+{proximo.length - 8} mais itens</div>
            )}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="text-lg font-bold text-gray-800">Filtros de Empresas</div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'alpha' | 'vencidos' | 'proximo' | 'recente')} className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm text-gray-900 font-medium focus:ring-2 focus:ring-cyan-400 border border-teal-200">
              <option value="alpha">Ordenar por</option>
              <option value="vencidos">Mais vencidos</option>
              <option value="proximo">Mais próximo</option>
              <option value="recente">Mais recente</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setDepId(''); setResponsavelId(''); setTipoEstabelecimento(''); setRegimeFederal(''); setServico(''); setEstado(''); setCadastrada(''); setStatusVenc(''); setSortBy('alpha'); }}
                className="text-xs text-teal-600 hover:text-teal-700 font-bold"
              >
                Limpar filtros
              </button>
            )}
            <button
              onClick={() => { setSelecionando(!selecionando); if (selecionando) setSelecionadas(new Set()); }}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold transition ${
                selecionando
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
              }`}
            >
              {selecionando ? 'Cancelar' : 'Selecionar'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="col-span-2 sm:col-span-1 md:col-span-2 relative">
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
          <select value={cadastrada} onChange={(e) => setCadastrada(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Cadastro</option>
            <option value="sim">Cadastrada</option>
            <option value="nao">Não cadastrada</option>
          </select>
          <select value={statusVenc} onChange={(e) => setStatusVenc(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Vencimento</option>
            <option value="vencidos">Tem vencidos</option>
            <option value="risco">Em risco</option>
            <option value="emdia">Em dia</option>
          </select>
        </div>
      </div>

      {/* Cards de Empresas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredEmpresas.map((e) => {
          const nome = e.razao_social || e.apelido || '-';
          const docsRisco = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias >= 0 && dias <= limiares.atencao; }).length;
          const docsVencidos = e.documentos.filter((d) => { const dias = daysUntil(d.validade); return dias !== null && dias < 0; }).length;
          const retsRisco = e.rets.filter((r) => { const dias = daysUntil(r.vencimento); return dias !== null && dias >= 0 && dias <= limiares.atencao; }).length;
          const retsVencidos = e.rets.filter((r) => { const dias = daysUntil(r.vencimento); return dias !== null && dias < 0; }).length;
          const totalRisco = docsRisco + retsRisco;
          const totalVencidos = docsVencidos + retsVencidos;
          const proximoVencDias = (() => {
            let min: number | null = null;
            for (const d of e.documentos) {
              const dias = daysUntil(d.validade);
              if (dias !== null && dias >= 0 && (min === null || dias < min)) min = dias;
            }
            for (const r of e.rets) {
              const dias = daysUntil(r.vencimento);
              if (dias !== null && dias >= 0 && (min === null || dias < min)) min = dias;
            }
            return min;
          })();

          return (
            <div key={e.id} className={`rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow p-5 ${selecionando && selecionadas.has(e.id) ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {selecionando && (
                      <button
                        onClick={() => {
                          const newSet = new Set(selecionadas);
                          if (newSet.has(e.id)) {
                            newSet.delete(e.id);
                          } else {
                            newSet.add(e.id);
                          }
                          setSelecionadas(newSet);
                        }}
                        className="shrink-0 mt-1 p-1 hover:bg-gray-100 rounded-lg transition"
                        title={selecionadas.has(e.id) ? 'Desselecionar' : 'Selecionar'}
                      >
                        {selecionadas.has(e.id) ? (
                          <CheckSquare size={20} className="text-blue-600" />
                        ) : (
                          <Square size={20} className="text-gray-400" />
                        )}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
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
                  </div>
                  <div className="font-bold text-gray-900 text-lg mt-2 truncate">{nome}</div>
                  {e.apelido && e.razao_social && <div className="text-sm text-gray-500 truncate">({e.apelido})</div>}
                    </div>
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

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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

      {/* Floating Action Bar para Seleção em Massa */}
      {selecionando && (
        <div className="fixed bottom-6 left-6 right-6 bg-white rounded-2xl shadow-2xl p-4 flex items-center gap-3 z-50 border-l-4 border-blue-500">
          <div className="text-sm font-bold text-gray-800 whitespace-nowrap">
            {selecionadas.size} {selecionadas.size === 1 ? 'selecionada' : 'selecionadas'}
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            <button
              onClick={() => {
                const allIds = new Set(filteredEmpresas.map(e => e.id));
                setSelecionadas(allIds);
              }}
              className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium transition"
            >
              Selecionar tudo
            </button>
            <button
              onClick={() => setSelecionadas(new Set())}
              className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium transition"
            >
              Limpar
            </button>
            <button
              onClick={() => {
                const empresasSelecionadas = filteredEmpresas.filter(e => selecionadas.has(e.id));
                if (empresasSelecionadas.length > 0) {
                  exportEmpresasPdf(empresasSelecionadas, departamentos, usuarios);
                }
              }}
              disabled={selecionadas.size === 0}
              className="text-sm px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <FileDown size={16} />
              Exportar PDF
            </button>
            <button
              onClick={() => { setSelecionando(false); setSelecionadas(new Set()); }}
              className="text-sm px-3 py-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 font-medium transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

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
