'use client';

import React, { useMemo, useState } from 'react';
import {
  Grid3x3, Search, XCircle, Filter, CalendarClock, Users, AlertTriangle, Shield,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR } from '@/app/utils/date';
import { garantirVencimentosFiscais } from '@/app/utils/vencimentos';
import type {
  Empresa, HistoricoVencimentoItem, Limiares, UUID, Usuario, VencimentoFiscal,
} from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import ModalHistoricoVencimento from '@/app/components/ModalHistoricoVencimento';
import ModalLimiares from '@/app/components/ModalLimiares';
import { sortByPtBr } from '@/lib/sort';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';

type StatusFiscal = 'vencido' | 'critico' | 'atencao' | 'proximo' | 'ok' | 'sem-data';

type FiscalCellItem = {
  fiscal: VencimentoFiscal;
  dias: number | null;
  status: StatusFiscal;
};

type EmpresaLinha = {
  empresa: Empresa;
  fiscalUserId: UUID | null;
  itens: FiscalCellItem[];
  piorStatus: StatusFiscal;
  diasMaisUrgente: number | null;
};

const STATUS_RANK: Record<StatusFiscal, number> = {
  vencido: 0,
  critico: 1,
  atencao: 2,
  proximo: 3,
  ok: 4,
  'sem-data': 5,
};

const STATUS_STYLE: Record<StatusFiscal, {
  bg: string; text: string; border: string; label: string; dot: string; cellBg: string;
}> = {
  vencido: { bg: 'bg-red-600', text: 'text-white', border: 'border-red-800', label: 'Vencido', dot: 'bg-red-600', cellBg: 'bg-red-500 hover:bg-red-600' },
  critico: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-700', label: 'Critico (<=15d)', dot: 'bg-orange-500', cellBg: 'bg-orange-400 hover:bg-orange-500' },
  atencao: { bg: 'bg-amber-400', text: 'text-amber-950', border: 'border-amber-600', label: 'Atencao (<=60d)', dot: 'bg-amber-400', cellBg: 'bg-amber-300 hover:bg-amber-400' },
  proximo: { bg: 'bg-lime-400', text: 'text-lime-950', border: 'border-lime-600', label: 'Proximo (<=90d)', dot: 'bg-lime-400', cellBg: 'bg-lime-300 hover:bg-lime-400' },
  ok: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-700', label: 'Em dia', dot: 'bg-emerald-500', cellBg: 'bg-emerald-400 hover:bg-emerald-500' },
  'sem-data': { bg: 'bg-gray-300', text: 'text-gray-700', border: 'border-gray-400', label: 'Sem data', dot: 'bg-gray-300', cellBg: 'bg-gray-200 hover:bg-gray-300' },
};

const STATUS_LEGENDA_ORDER: StatusFiscal[] = ['vencido', 'critico', 'atencao', 'proximo', 'ok', 'sem-data'];

function getStatus(dias: number | null, lim: Limiares): StatusFiscal {
  if (dias === null) return 'sem-data';
  if (dias < 0) return 'vencido';
  if (dias <= lim.critico) return 'critico';
  if (dias <= lim.atencao) return 'atencao';
  if (dias <= lim.proximo) return 'proximo';
  return 'ok';
}

function userInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function VencimentosFiscaisPage() {
  const { empresas, departamentos, usuarios, canManage, currentUserId, atualizarEmpresa, mostrarAlerta } = useSistema();

  const [limiares, setLimiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);
  const [showLimiares, setShowLimiares] = useState(false);

  const [search, setSearch] = useState('');
  const [filtroUsuario, setFiltroUsuario] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<StatusFiscal | 'todos' | 'risco'>('todos');

  const [modalEmpresa, setModalEmpresa] = useState<Empresa | null>(null);
  const [historicoAlvo, setHistoricoAlvo] = useState<{ empresa: Empresa; fiscal: VencimentoFiscal; status: StatusFiscal; dias: number | null } | null>(null);
  const [savingHistorico, setSavingHistorico] = useState(false);

  const fiscalDept = useMemo(() => {
    const nameMatch = departamentos.find((d) => d.nome.trim().toLowerCase() === 'fiscal');
    if (nameMatch) return nameMatch;
    return departamentos.find((d) => d.nome.toLowerCase().includes('fiscal')) ?? null;
  }, [departamentos]);

  // Usuarios que aparecem como responsaveis pelo depto fiscal em alguma empresa
  const fiscalUsers: Usuario[] = useMemo(() => {
    if (!fiscalDept) return [];
    const idsDosResponsaveis = new Set<UUID>();
    for (const e of empresas) {
      const uid = e.responsaveis?.[fiscalDept.id];
      if (uid) idsDosResponsaveis.add(uid);
    }
    const doDepto = usuarios.filter((u) => u.ativo && u.departamentoId === fiscalDept.id);
    const extras = usuarios.filter((u) => u.ativo && idsDosResponsaveis.has(u.id) && u.departamentoId !== fiscalDept.id);
    return sortByPtBr([...doDepto, ...extras], (u) => u.nome);
  }, [fiscalDept, empresas, usuarios]);

  const linhas: EmpresaLinha[] = useMemo(() => {
    const resultado: EmpresaLinha[] = [];
    for (const empresa of empresas) {
      const fiscaisComData = garantirVencimentosFiscais(empresa.vencimentosFiscais)
        .filter((f) => f.vencimento);

      const itens: FiscalCellItem[] = fiscaisComData.map((fiscal) => {
        const dias = daysUntil(fiscal.vencimento);
        return { fiscal, dias, status: getStatus(dias, limiares) };
      });

      const pior: StatusFiscal = itens.length === 0
        ? 'sem-data'
        : itens.reduce<StatusFiscal>((acc, it) => (
            STATUS_RANK[it.status] < STATUS_RANK[acc] ? it.status : acc
          ), 'ok');

      const diasUrgentes = itens
        .filter((it) => it.dias !== null)
        .map((it) => it.dias as number);
      const diasMaisUrgente = diasUrgentes.length > 0 ? Math.min(...diasUrgentes) : null;

      const fiscalUserId = fiscalDept ? (empresa.responsaveis?.[fiscalDept.id] ?? null) : null;

      resultado.push({ empresa, fiscalUserId, itens, piorStatus: pior, diasMaisUrgente });
    }
    return resultado;
  }, [empresas, limiares, fiscalDept]);

  const linhasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return linhas
      .filter((l) => {
        if (q) {
          const hay = `${l.empresa.codigo} ${l.empresa.razao_social ?? ''} ${l.empresa.apelido ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filtroUsuario) {
          if (filtroUsuario === 'sem') {
            if (l.fiscalUserId) return false;
          } else if (l.fiscalUserId !== filtroUsuario) return false;
        }
        if (filtroStatus === 'risco') {
          if (!(l.piorStatus === 'vencido' || l.piorStatus === 'critico' || l.piorStatus === 'atencao')) return false;
        } else if (filtroStatus === 'todos') {
          // Padrao: esconde sem-data. Usuario precisa escolher "So sem data" para ver.
          if (l.piorStatus === 'sem-data') return false;
        } else if (l.piorStatus !== filtroStatus) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = STATUS_RANK[a.piorStatus] - STATUS_RANK[b.piorStatus];
        if (rank !== 0) return rank;
        const da = a.diasMaisUrgente ?? 9999;
        const db = b.diasMaisUrgente ?? 9999;
        if (da !== db) return da - db;
        return a.empresa.codigo.localeCompare(b.empresa.codigo);
      });
  }, [linhas, search, filtroUsuario, filtroStatus]);

  // Estatisticas por usuario (colunas)
  const statsPorUsuario = useMemo(() => {
    const map = new Map<UUID, { vencido: number; critico: number; atencao: number; proximo: number; ok: number; total: number }>();
    for (const u of fiscalUsers) map.set(u.id, { vencido: 0, critico: 0, atencao: 0, proximo: 0, ok: 0, total: 0 });
    for (const l of linhas) {
      if (!l.fiscalUserId) continue;
      const s = map.get(l.fiscalUserId);
      if (!s) continue;
      s.total++;
      if (l.piorStatus === 'vencido') s.vencido++;
      else if (l.piorStatus === 'critico') s.critico++;
      else if (l.piorStatus === 'atencao') s.atencao++;
      else if (l.piorStatus === 'proximo') s.proximo++;
      else if (l.piorStatus === 'ok') s.ok++;
    }
    return map;
  }, [fiscalUsers, linhas]);

  const totaisGerais = useMemo(() => {
    const t = { vencido: 0, critico: 0, atencao: 0, proximo: 0, ok: 0,'sem-data': 0, total: linhas.length };
    for (const l of linhas) t[l.piorStatus]++;
    return t;
  }, [linhas]);

  const hasFilters = !!search || !!filtroUsuario || filtroStatus !== 'todos';

  const podeEditarHistorico = (empresa: Empresa) => {
    if (canManage) return true;
    if (!currentUserId) return false;
    if (!fiscalDept) return false;
    return empresa.responsaveis?.[fiscalDept.id] === currentUserId;
  };

  const salvarHistorico = async (payload: { tagVencimento?: string; historicoVencimento: HistoricoVencimentoItem[] }) => {
    if (!historicoAlvo) return;
    setSavingHistorico(true);
    try {
      const { empresa, fiscal } = historicoAlvo;
      const fiscaisAtuais = garantirVencimentosFiscais(empresa.vencimentosFiscais);
      const vencimentosFiscais = fiscaisAtuais.map((f) =>
        f.id === fiscal.id
          ? { ...f, tagVencimento: payload.tagVencimento, historicoVencimento: payload.historicoVencimento }
          : f
      );
      const ok = await atualizarEmpresa(empresa.id, { vencimentosFiscais });
      if (ok === false) return;
      mostrarAlerta('Historico atualizado', 'As informacoes desse vencimento fiscal foram salvas.', 'sucesso');
      setHistoricoAlvo(null);

      // Atualiza o modal da empresa se estiver aberto
      setModalEmpresa((prev) => {
        if (!prev || prev.id !== empresa.id) return prev;
        const atualizada = empresas.find((e) => e.id === empresa.id);
        return atualizada ?? prev;
      });
    } finally {
      setSavingHistorico(false);
    }
  };

  if (!fiscalDept) {
    return (
      <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
        <Shield className="mx-auto mb-4 text-gray-300" size={48} />
        <div className="text-lg font-bold text-gray-700 mb-1">Departamento Fiscal nao encontrado</div>
        <div className="text-sm text-gray-500">Cadastre um departamento chamado &quot;Fiscal&quot; para usar este painel.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <FiscalTabs />
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-red-500 via-orange-500 to-amber-500 flex items-center justify-center shadow-md shrink-0">
              <Grid3x3 className="text-white" size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-2xl font-bold text-gray-900">Painel Fiscal - Batalha Naval</div>
              <div className="text-xs sm:text-sm text-gray-500">
                Controle visual dos vencimentos fiscais por responsavel.
                {' '}Clique num quadradinho para ver e registrar historico.
              </div>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowLimiares(true)}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-violet-200 text-violet-700 px-3 py-2 font-bold hover:bg-violet-50 transition shrink-0"
            >
              <Filter size={18} />
              <span>Limiares</span>
            </button>
          )}
        </div>
      </div>

      {/* Legenda */}
      <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <AlertTriangle size={14} className="text-amber-500" />
            Legenda de cores
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-600">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-violet-400 ring-1 ring-white shadow animate-pulse" />
              <span>com tag (em andamento)</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400 ring-1 ring-white shadow" />
              <span>com historico</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {STATUS_LEGENDA_ORDER.map((status) => {
            const s = STATUS_STYLE[status];
            const count =
              status === 'vencido' ? totaisGerais.vencido :
              status === 'critico' ? totaisGerais.critico :
              status === 'atencao' ? totaisGerais.atencao :
              status === 'proximo' ? totaisGerais.proximo :
              status === 'ok' ? totaisGerais.ok :
              totaisGerais['sem-data'];
            return (
              <button
                key={status}
                onClick={() => setFiltroStatus((prev) => (prev === status ? 'todos' : status))}
                className={`flex items-center gap-2 rounded-lg border-2 p-2 transition text-left min-w-0 ${
                  filtroStatus === status ? 'border-gray-800 bg-gray-50 shadow-md' : 'border-gray-200 hover:border-gray-300'
                }`}
                title={`Filtrar por ${s.label}`}
              >
                <div className={`h-8 w-8 rounded-lg ${s.bg} ${s.border} border-2 flex items-center justify-center shadow-sm shrink-0`}>
                  <span className="text-xs font-black text-white drop-shadow">{count}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-bold text-gray-900 truncate">{s.label}</div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {status === 'vencido' && 'Ja venceu'}
                    {status === 'critico' && `<=${limiares.critico}d`}
                    {status === 'atencao' && `<=${limiares.atencao}d`}
                    {status === 'proximo' && `<=${limiares.proximo}d`}
                    {status === 'ok' && `> ${limiares.proximo}d`}
                    {status === 'sem-data' && 'Sem venc.'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Filter size={14} className="text-gray-400" />
            Filtros
          </div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFiltroUsuario(''); setFiltroStatus('todos'); }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold"
            >
              <XCircle size={14} />
              Limpar
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa ou codigo..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <select
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
          >
            <option value="">Todos responsaveis fiscais</option>
            {fiscalUsers.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            <option value="sem">Empresas sem responsavel fiscal</option>
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as StatusFiscal | 'todos' | 'risco')}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
          >
            <option value="todos">Todos os status (padrao)</option>
            <option value="risco">So em risco (vencido+critico+atencao)</option>
            <option value="vencido">So vencidos</option>
            <option value="critico">So criticos</option>
            <option value="atencao">So atencao</option>
            <option value="proximo">So proximos</option>
            <option value="ok">So em dia</option>
            <option value="sem-data">So sem data</option>
          </select>
        </div>
      </div>

      {/* Matriz */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden min-w-0 max-w-full">
        {fiscalUsers.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Users className="mx-auto mb-3 text-gray-300" size={40} />
            <div className="font-bold text-gray-700 mb-1">Nenhum responsavel fiscal definido</div>
            <div className="text-sm">Atribua responsaveis do departamento Fiscal nas empresas para visualizar a matriz.</div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto overflow-y-auto max-h-[70vh]">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider text-left px-3 py-2 border-b-2 border-gray-700 w-[160px] min-w-[160px] max-w-[160px]">
                    Empresa \ Resp.
                  </th>
                  {fiscalUsers.map((u) => {
                    const s = statsPorUsuario.get(u.id);
                    return (
                      <th
                        key={u.id}
                        className="sticky top-0 z-20 bg-gray-900 text-white text-[10px] font-bold text-center px-1.5 py-2 border-b-2 border-gray-700 w-[90px] min-w-[90px] max-w-[90px] cursor-pointer hover:bg-gray-800 transition"
                        onClick={() => setFiltroUsuario((prev) => (prev === u.id ? '' : u.id))}
                        title={`${u.nome} - clique para filtrar`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center font-black text-white text-[10px] shadow">
                            {userInitials(u.nome)}
                          </div>
                          <div className="text-[9px] font-bold truncate max-w-[82px] w-full" title={u.nome}>{u.nome}</div>
                          {s && s.total > 0 && (
                            <div className="flex items-center gap-0.5 text-[8px] font-bold">
                              {s.vencido > 0 && <span className="rounded px-0.5 bg-red-600 text-white">{s.vencido}V</span>}
                              {s.critico > 0 && <span className="rounded px-0.5 bg-orange-500 text-white">{s.critico}C</span>}
                              {s.atencao > 0 && <span className="rounded px-0.5 bg-amber-400 text-amber-900">{s.atencao}A</span>}
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.map((l) => {
                  const s = STATUS_STYLE[l.piorStatus];
                  return (
                    <tr key={l.empresa.id}>
                      <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-2 py-1.5 w-[160px] min-w-[160px] max-w-[160px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.dot} ${l.piorStatus === 'vencido' ? 'animate-pulse' : ''}`} />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-gray-900 text-xs truncate">{l.empresa.codigo}</div>
                            <div className="text-[10px] text-gray-500 truncate" title={l.empresa.razao_social || l.empresa.apelido}>
                              {l.empresa.razao_social || l.empresa.apelido || '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                      {fiscalUsers.map((u) => {
                        const isResp = l.fiscalUserId === u.id;
                        if (!isResp) {
                          return (
                            <td key={u.id} className="border-b border-gray-100 bg-gray-50/50 w-[90px] min-w-[90px] max-w-[90px]" />
                          );
                        }
                        const cell = STATUS_STYLE[l.piorStatus];
                        const vencidosCount = l.itens.filter((it) => it.status === 'vencido').length;
                        const criticosCount = l.itens.filter((it) => it.status === 'critico').length;
                        const temTag = l.itens.some((it) => !!it.fiscal.tagVencimento);
                        const temHistorico = l.itens.some((it) => (it.fiscal.historicoVencimento?.length ?? 0) > 0);
                        const tagsTitulo = l.itens
                          .map((it) => it.fiscal.tagVencimento)
                          .filter((t): t is string => !!t);
                        const tituloCell = [
                          `${l.empresa.codigo} - ${l.empresa.razao_social || ''}`,
                          temTag ? `Tags: ${Array.from(new Set(tagsTitulo)).join(', ')}` : null,
                          temHistorico ? `Com registros de historico` : null,
                        ].filter(Boolean).join('\n');
                        return (
                          <td key={u.id} className="border-b border-gray-100 p-1 w-[90px] min-w-[90px] max-w-[90px]">
                            <button
                              onClick={() => setModalEmpresa(l.empresa)}
                              className={`relative w-full h-full min-h-[56px] rounded-lg border-2 ${cell.border} ${cell.cellBg} ${cell.text} p-1.5 text-left transition shadow-sm hover:shadow-lg hover:scale-[1.03] active:scale-95`}
                              title={tituloCell}
                            >
                              {(temTag || temHistorico) && (
                                <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
                                  {temTag && (
                                    <span
                                      className="h-2 w-2 rounded-full bg-violet-400 ring-1 ring-white shadow animate-pulse"
                                      title="Possui tag (em andamento)"
                                    />
                                  )}
                                  {temHistorico && (
                                    <span
                                      className="h-2 w-2 rounded-full bg-sky-400 ring-1 ring-white shadow"
                                      title="Possui registros no historico"
                                    />
                                  )}
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-0.5 mb-0.5 pr-4">
                                <span className="text-[8px] font-black uppercase tracking-wide opacity-90 truncate">
                                  {cell.label.split(' ')[0]}
                                </span>
                                <span className="text-[8px] font-bold opacity-80 shrink-0">
                                  {l.itens.length}
                                </span>
                              </div>
                              <div className="font-black text-sm leading-none tabular-nums">
                                {l.diasMaisUrgente === null ? '-' :
                                  l.diasMaisUrgente < 0 ? `${Math.abs(l.diasMaisUrgente)}d⬇` :
                                  l.diasMaisUrgente === 0 ? 'HOJE' :
                                  `${l.diasMaisUrgente}d`}
                              </div>
                              {(vencidosCount > 0 || criticosCount > 0) && (
                                <div className="mt-0.5 flex flex-wrap gap-0.5">
                                  {vencidosCount > 0 && <span className="rounded bg-black/25 px-1 text-[9px] font-bold">V:{vencidosCount}</span>}
                                  {criticosCount > 0 && <span className="rounded bg-black/25 px-1 text-[9px] font-bold">C:{criticosCount}</span>}
                                </div>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {linhasFiltradas.length === 0 && (
                  <tr>
                    <td colSpan={fiscalUsers.length + 1} className="px-6 py-12 text-center text-gray-500 bg-gray-50 sticky left-0">
                      <Shield className="mx-auto mb-2 text-gray-300" size={32} />
                      <div className="font-bold text-gray-700">Nenhuma empresa encontrada</div>
                      <div className="text-xs">Ajuste os filtros ou cadastre vencimentos fiscais nas empresas.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {linhasFiltradas.length > 0 && (
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between flex-wrap gap-2">
            <span>Exibindo {linhasFiltradas.length} de {linhas.length} empresas</span>
            <div className="flex items-center gap-1">
              <CalendarClock size={12} className="text-gray-400" />
              <span>Ordenado por urgencia - arraste lateralmente para ver todos os responsaveis</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal: detalhe da empresa (lista todos os fiscais dela) */}
      {modalEmpresa && (
        <ModalDetalheEmpresa
          empresa={empresas.find((e) => e.id === modalEmpresa.id) ?? modalEmpresa}
          limiares={limiares}
          onClose={() => setModalEmpresa(null)}
          onClickFiscal={(fiscal, dias, status) => {
            const empresaAtualizada = empresas.find((e) => e.id === modalEmpresa.id) ?? modalEmpresa;
            setHistoricoAlvo({ empresa: empresaAtualizada, fiscal, dias, status });
          }}
        />
      )}

      {/* Modal: historico de um fiscal especifico */}
      <ModalHistoricoVencimento
        key={historicoAlvo ? `${historicoAlvo.empresa.id}-${historicoAlvo.fiscal.id}-${historicoAlvo.fiscal.historicoVencimento?.length ?? 0}` : 'fechado'}
        open={!!historicoAlvo}
        item={historicoAlvo ? {
          empresaCodigo: historicoAlvo.empresa.codigo,
          empresaNome: historicoAlvo.empresa.razao_social || historicoAlvo.empresa.apelido || '-',
          tipo: 'Fiscal',
          nome: historicoAlvo.fiscal.nome,
          vencimento: historicoAlvo.fiscal.vencimento,
          dias: historicoAlvo.dias ?? 0,
          statusLabel: STATUS_STYLE[historicoAlvo.status].label,
          statusClassName: `${STATUS_STYLE[historicoAlvo.status].bg} ${STATUS_STYLE[historicoAlvo.status].text} ${STATUS_STYLE[historicoAlvo.status].border}`,
          tagVencimento: historicoAlvo.fiscal.tagVencimento,
          historicoVencimento: historicoAlvo.fiscal.historicoVencimento,
        } : null}
        canEdit={historicoAlvo ? podeEditarHistorico(historicoAlvo.empresa) : false}
        saving={savingHistorico}
        onClose={() => {
          if (savingHistorico) return;
          setHistoricoAlvo(null);
        }}
        onSave={salvarHistorico}
      />

      {showLimiares && (
        <ModalLimiares
          limiares={limiares}
          onSave={setLimiares}
          onClose={() => setShowLimiares(false)}
        />
      )}
    </div>
  );
}

function ModalDetalheEmpresa({
  empresa,
  limiares,
  onClose,
  onClickFiscal,
}: {
  empresa: Empresa;
  limiares: Limiares;
  onClose: () => void;
  onClickFiscal: (fiscal: VencimentoFiscal, dias: number | null, status: StatusFiscal) => void;
}) {
  const fiscais = useMemo(() => {
    return garantirVencimentosFiscais(empresa.vencimentosFiscais)
      .map((fiscal) => {
        const dias = daysUntil(fiscal.vencimento);
        return { fiscal, dias, status: getStatus(dias, limiares) };
      })
      .sort((a, b) => {
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (rank !== 0) return rank;
        return (a.dias ?? 9999) - (b.dias ?? 9999);
      });
  }, [empresa, limiares]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-red-600 via-orange-500 to-amber-500 px-5 py-4 flex items-center justify-between">
          <div className="text-white">
            <div className="text-xs font-bold uppercase tracking-wider opacity-90">Vencimentos fiscais da empresa</div>
            <div className="text-lg font-bold">{empresa.codigo} - {empresa.razao_social || empresa.apelido || '-'}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition"
          >
            <XCircle size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          <div className="text-xs text-gray-500 mb-3">
            Clique em qualquer obrigacao abaixo para ver ou registrar no historico.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fiscais.map(({ fiscal, dias, status }) => {
              const s = STATUS_STYLE[status];
              const temHistorico = (fiscal.historicoVencimento?.length ?? 0) > 0;
              return (
                <button
                  key={fiscal.id}
                  onClick={() => onClickFiscal(fiscal, dias, status)}
                  className={`rounded-xl border-2 ${s.border} ${s.cellBg} ${s.text} p-3 text-left transition shadow-sm hover:shadow-lg hover:scale-[1.02]`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wide opacity-90">{s.label}</span>
                    <span className="text-[10px] font-bold opacity-80">
                      {fiscal.vencimento ? formatBR(fiscal.vencimento) : 'Sem data'}
                    </span>
                  </div>
                  <div className="font-bold text-sm leading-tight">{fiscal.nome}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="font-black text-lg tabular-nums">
                      {dias === null ? '-' : dias < 0 ? `${Math.abs(dias)}d atras` : dias === 0 ? 'HOJE' : `${dias}d`}
                    </span>
                    <div className="flex gap-1">
                      {fiscal.tagVencimento && (
                        <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold">
                          {fiscal.tagVencimento}
                        </span>
                      )}
                      {temHistorico && (
                        <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold">
                          {fiscal.historicoVencimento?.length} reg.
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
