'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListChecks, Search, XCircle, Filter, Users, ChevronLeft, ChevronRight,
  Check, Calendar, AlertTriangle, TrendingUp, Award, Download, Clock,
  MessageSquare, History, User as UserIcon, Sparkles,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { ChecklistFiscalItem, Empresa, UUID, Usuario } from '@/app/types';
import { VENCIMENTOS_FISCAIS_NOMES } from '@/app/types';
import * as db from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { sortByPtBr } from '@/lib/sort';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';

type ChecklistKey = string; // `${empresaId}|${obrigacao}`

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function currentMonth(): string {
  return monthKey(new Date());
}

function parseMonth(mes: string): Date {
  const [y, m] = mes.split('-').map((x) => Number(x));
  return new Date(y, (m || 1) - 1, 1);
}

function shiftMonth(mes: string, delta: number): string {
  const d = parseMonth(mes);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}

function monthLabel(mes: string): string {
  const d = parseMonth(mes);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function buildKey(empresaId: UUID, obrigacao: string): ChecklistKey {
  return `${empresaId}|${obrigacao}`;
}

function userInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChecklistFiscalPage() {
  const { empresas, departamentos, usuarios, currentUser, currentUserId, canManage, mostrarAlerta } = useSistema();

  const [mes, setMes] = useState<string>(() => currentMonth());
  const [items, setItems] = useState<Map<ChecklistKey, ChecklistFiscalItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<ChecklistKey>>(new Set());

  const [search, setSearch] = useState('');
  const [filtroUsuario, setFiltroUsuario] = useState<string>('');
  const [filtroProgresso, setFiltroProgresso] = useState<'todos' | 'pendentes' | 'concluidas' | 'parciais'>('todos');
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const apenasMinhasInitRef = useRef(false);

  const [obsTarget, setObsTarget] = useState<{ empresa: Empresa; obrigacao: string } | null>(null);
  const [obsText, setObsText] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  const [histTarget, setHistTarget] = useState<{ empresa: Empresa; obrigacao: string } | null>(null);
  const [histItems, setHistItems] = useState<ChecklistFiscalItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const fiscalDept = useMemo(
    () => departamentos.find((d) => d.nome.trim().toLowerCase() === 'fiscal')
      ?? departamentos.find((d) => d.nome.toLowerCase().includes('fiscal'))
      ?? null,
    [departamentos]
  );

  const fiscalUsers: Usuario[] = useMemo(() => {
    if (!fiscalDept) return [];
    const idsResp = new Set<UUID>();
    for (const e of empresas) {
      const uid = e.responsaveis?.[fiscalDept.id];
      if (uid) idsResp.add(uid);
    }
    const doDepto = usuarios.filter((u) => u.ativo && u.departamentoId === fiscalDept.id);
    const extras = usuarios.filter((u) => u.ativo && idsResp.has(u.id) && u.departamentoId !== fiscalDept.id);
    return sortByPtBr([...doDepto, ...extras], (u) => u.nome);
  }, [fiscalDept, empresas, usuarios]);

  const getResponsavelFiscal = useCallback((empresa: Empresa): UUID | null => {
    if (!fiscalDept) return null;
    return empresa.responsaveis?.[fiscalDept.id] ?? null;
  }, [fiscalDept]);

  const isHoje = mes === currentMonth();

  // Load items for the selected month
  const carregar = useCallback(async (mesAlvo: string) => {
    setLoading(true);
    try {
      const lista = await db.fetchChecklistFiscalByMes(mesAlvo);
      const mapa = new Map<ChecklistKey, ChecklistFiscalItem>();
      for (const it of lista) mapa.set(buildKey(it.empresaId, it.obrigacao), it);
      setItems(mapa);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro ao carregar', 'Não foi possível carregar o checklist deste mês.', 'erro');
    } finally {
      setLoading(false);
    }
  }, [mostrarAlerta]);

  useEffect(() => {
    carregar(mes);
  }, [mes, carregar]);

  // Default: para usuário comum (não gerente/admin), começa filtrando só empresas dele
  useEffect(() => {
    if (apenasMinhasInitRef.current) return;
    if (!currentUserId) return;
    apenasMinhasInitRef.current = true;
    if (!canManage) setApenasMinhas(true);
  }, [currentUserId, canManage]);

  // Realtime: atualiza automaticamente quando outro usuário marca/desmarca
  useEffect(() => {
    const channel = supabase
      .channel(`checklist-fiscal-${mes}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_fiscal', filter: `mes=eq.${mes}` }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          setItems((prev) => {
            const next = new Map(prev);
            next.delete(buildKey(row.empresa_id, row.obrigacao));
            return next;
          });
        } else {
          const item: ChecklistFiscalItem = {
            id: row.id,
            empresaId: row.empresa_id,
            mes: row.mes,
            obrigacao: row.obrigacao,
            concluido: !!row.concluido,
            concluidoPorId: row.concluido_por_id,
            concluidoPorNome: row.concluido_por_nome ?? undefined,
            concluidoEm: row.concluido_em ?? undefined,
            observacao: row.observacao ?? undefined,
            criadoEm: row.criado_em ?? '',
            atualizadoEm: row.atualizado_em ?? '',
          };
          setItems((prev) => {
            const next = new Map(prev);
            next.set(buildKey(item.empresaId, item.obrigacao), item);
            return next;
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mes]);

  // Marca/desmarca uma célula
  const toggle = async (empresa: Empresa, obrigacao: string, concluido: boolean) => {
    const key = buildKey(empresa.id, obrigacao);
    const atual = items.get(key);
    setSavingKeys((prev) => new Set(prev).add(key));

    // Optimistic update
    setItems((prev) => {
      const next = new Map(prev);
      if (concluido) {
        next.set(key, {
          id: atual?.id ?? 'tmp',
          empresaId: empresa.id,
          mes,
          obrigacao,
          concluido: true,
          concluidoPorId: currentUserId ?? null,
          concluidoPorNome: currentUser?.nome,
          concluidoEm: new Date().toISOString(),
          observacao: atual?.observacao,
          criadoEm: atual?.criadoEm ?? new Date().toISOString(),
          atualizadoEm: new Date().toISOString(),
        });
      } else if (atual) {
        next.set(key, { ...atual, concluido: false, concluidoPorId: null, concluidoPorNome: undefined, concluidoEm: undefined });
      }
      return next;
    });

    try {
      await db.upsertChecklistFiscal({
        empresaId: empresa.id,
        mes,
        obrigacao,
        concluido,
        concluidoPorId: currentUserId,
        concluidoPorNome: currentUser?.nome,
        observacao: atual?.observacao ?? null,
      });
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro ao salvar', 'Não foi possível atualizar o checklist. Tente novamente.', 'erro');
      // rollback
      setItems((prev) => {
        const next = new Map(prev);
        if (atual) next.set(key, atual);
        else next.delete(key);
        return next;
      });
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const abrirObservacao = (empresa: Empresa, obrigacao: string) => {
    const atual = items.get(buildKey(empresa.id, obrigacao));
    setObsText(atual?.observacao ?? '');
    setObsTarget({ empresa, obrigacao });
  };

  const salvarObservacao = async () => {
    if (!obsTarget) return;
    setSavingObs(true);
    try {
      await db.updateChecklistObservacao(obsTarget.empresa.id, mes, obsTarget.obrigacao, obsText);
      mostrarAlerta('Observação salva', 'A observação foi registrada no checklist.', 'sucesso');
      setObsTarget(null);
      setObsText('');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar a observação.', 'erro');
    } finally {
      setSavingObs(false);
    }
  };

  const abrirHistorico = async (empresa: Empresa, obrigacao: string) => {
    setHistTarget({ empresa, obrigacao });
    setHistItems([]);
    setHistLoading(true);
    try {
      const { data, error } = await supabase
        .from('checklist_fiscal')
        .select('*')
        .eq('empresa_id', empresa.id)
        .eq('obrigacao', obrigacao)
        .order('mes', { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: ChecklistFiscalItem[] = (data ?? []).map((row: any) => ({
        id: row.id,
        empresaId: row.empresa_id,
        mes: row.mes,
        obrigacao: row.obrigacao,
        concluido: !!row.concluido,
        concluidoPorId: row.concluido_por_id,
        concluidoPorNome: row.concluido_por_nome ?? undefined,
        concluidoEm: row.concluido_em ?? undefined,
        observacao: row.observacao ?? undefined,
        criadoEm: row.criado_em ?? '',
        atualizadoEm: row.atualizado_em ?? '',
      }));
      setHistItems(mapped);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível carregar o histórico desta obrigação.', 'erro');
    } finally {
      setHistLoading(false);
    }
  };

  // Linhas da tabela (empresas filtradas) — cada linha é uma empresa
  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = empresas
      .filter((e) => e.cadastrada !== false)
      .map((empresa) => {
        const respId = getResponsavelFiscal(empresa);
        const cells: { obrigacao: string; item: ChecklistFiscalItem | undefined }[] = VENCIMENTOS_FISCAIS_NOMES.map((obrigacao) => ({
          obrigacao,
          item: items.get(buildKey(empresa.id, obrigacao)),
        }));
        const feitas = cells.filter((c) => c.item?.concluido).length;
        const total = cells.length;
        const progresso = total === 0 ? 0 : (feitas / total) * 100;
        return { empresa, respId, cells, feitas, total, progresso };
      })
      .filter((l) => {
        if (q) {
          const hay = `${l.empresa.codigo} ${l.empresa.razao_social ?? ''} ${l.empresa.apelido ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filtroUsuario) {
          if (filtroUsuario === 'sem') {
            if (l.respId) return false;
          } else if (l.respId !== filtroUsuario) return false;
        }
        if (apenasMinhas && currentUserId) {
          if (l.respId !== currentUserId) return false;
        }
        if (filtroProgresso === 'pendentes' && l.feitas > 0) return false;
        if (filtroProgresso === 'concluidas' && l.feitas !== l.total) return false;
        if (filtroProgresso === 'parciais' && (l.feitas === 0 || l.feitas === l.total)) return false;
        return true;
      });

    return list.sort((a, b) => {
      // Ordem: parciais primeiro (in progress), depois pendentes, depois concluídas
      const stateA = a.feitas === 0 ? 1 : a.feitas === a.total ? 2 : 0;
      const stateB = b.feitas === 0 ? 1 : b.feitas === b.total ? 2 : 0;
      if (stateA !== stateB) return stateA - stateB;
      if (a.progresso !== b.progresso) return b.progresso - a.progresso;
      return a.empresa.codigo.localeCompare(b.empresa.codigo);
    });
  }, [empresas, items, search, filtroUsuario, apenasMinhas, currentUserId, filtroProgresso, getResponsavelFiscal]);

  // Stats
  const stats = useMemo(() => {
    const totalCells = linhas.reduce((s, l) => s + l.total, 0);
    const feitasCells = linhas.reduce((s, l) => s + l.feitas, 0);
    const empresasCompletas = linhas.filter((l) => l.total > 0 && l.feitas === l.total).length;
    const empresasPendentes = linhas.filter((l) => l.feitas === 0).length;
    const empresasParciais = linhas.filter((l) => l.feitas > 0 && l.feitas < l.total).length;
    const progressoGeral = totalCells === 0 ? 0 : (feitasCells / totalCells) * 100;
    // por obrigação
    const porObrigacao = VENCIMENTOS_FISCAIS_NOMES.map((obr) => {
      const feitas = linhas.filter((l) => l.cells.find((c) => c.obrigacao === obr)?.item?.concluido).length;
      const total = linhas.length;
      return { obrigacao: obr, feitas, total, pct: total === 0 ? 0 : (feitas / total) * 100 };
    });
    return { totalCells, feitasCells, empresasCompletas, empresasPendentes, empresasParciais, progressoGeral, porObrigacao };
  }, [linhas]);

  // Stats por usuário (para destacar)
  const statsPorUsuario = useMemo(() => {
    const map = new Map<UUID, { feitas: number; total: number }>();
    for (const u of fiscalUsers) map.set(u.id, { feitas: 0, total: 0 });
    for (const l of linhas) {
      if (!l.respId) continue;
      const s = map.get(l.respId);
      if (!s) continue;
      s.total += l.total;
      s.feitas += l.feitas;
    }
    return map;
  }, [fiscalUsers, linhas]);

  const hasFilters = !!search || !!filtroUsuario || filtroProgresso !== 'todos' || apenasMinhas;

  // Exportar CSV do mês atual filtrado
  const exportCSV = () => {
    const header = ['Código', 'Empresa', 'Responsável Fiscal', ...VENCIMENTOS_FISCAIS_NOMES, 'Progresso (%)', 'Feitas/Total'];
    const rows = linhas.map((l) => {
      const resp = l.respId ? (usuarios.find((u) => u.id === l.respId)?.nome ?? '') : '';
      const cells = l.cells.map((c) => (c.item?.concluido ? 'OK' : ''));
      return [l.empresa.codigo, l.empresa.razao_social || l.empresa.apelido || '', resp, ...cells, Math.round(l.progresso), `${l.feitas}/${l.total}`];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklist_fiscal_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Meses recentes para navegação rápida
  const mesesRapidos = useMemo(() => {
    const out: string[] = [];
    const hoje = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      out.push(monthKey(d));
    }
    return out;
  }, []);

  // Atalho teclado para navegar mês (apenas quando não estiver digitando)
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowLeft') setMes((m) => shiftMonth(m, -1));
      else if (e.key === 'ArrowRight') setMes((m) => shiftMonth(m, +1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!fiscalDept) {
    return (
      <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
        <FiscalTabs />
        <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
          <ListChecks className="mx-auto mb-4 text-gray-300" size={48} />
          <div className="text-lg font-bold text-gray-700 mb-1">Departamento Fiscal não encontrado</div>
          <div className="text-sm text-gray-500">Cadastre um departamento chamado &quot;Fiscal&quot; para usar o checklist mensal.</div>
        </div>
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
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-md shrink-0">
              <ListChecks className="text-white" size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-2xl font-bold text-gray-900">Checklist Fiscal Mensal</div>
              <div className="text-xs sm:text-sm text-gray-500">
                Marque conforme finalizar cada uma das {VENCIMENTOS_FISCAIS_NOMES.length} obrigações. Cada mês tem seu próprio controle.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-200 text-emerald-700 px-3 py-2 font-bold hover:bg-emerald-50 transition shrink-0"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Exportar</span> CSV
            </button>
          </div>
        </div>
      </div>

      {/* Seletor de mês */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border-2 border-emerald-100 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMes((m) => shiftMonth(m, -1))}
              className="p-2 rounded-xl bg-white shadow-sm hover:shadow-md hover:bg-emerald-50 transition"
              title="Mês anterior (ou seta esquerda)"
            >
              <ChevronLeft size={18} className="text-emerald-700" />
            </button>
            <div className="flex items-center gap-2 bg-white rounded-xl px-3 sm:px-4 py-2 shadow-sm min-w-0">
              <Calendar size={18} className="text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Mês ativo</div>
                <div className="text-sm sm:text-base font-bold text-gray-900 capitalize truncate">{monthLabel(mes)}</div>
              </div>
              {isHoje && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                  <Sparkles size={10} /> AGORA
                </span>
              )}
            </div>
            <button
              onClick={() => setMes((m) => shiftMonth(m, +1))}
              className="p-2 rounded-xl bg-white shadow-sm hover:shadow-md hover:bg-emerald-50 transition"
              title="Próximo mês (ou seta direita)"
            >
              <ChevronRight size={18} className="text-emerald-700" />
            </button>
            {!isHoje && (
              <button
                onClick={() => setMes(currentMonth())}
                className="hidden sm:inline-flex items-center gap-1 text-xs text-emerald-700 font-bold hover:text-emerald-800 px-2"
                title="Voltar para o mês atual"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">Rápido:</span>
            {mesesRapidos.map((m) => (
              <button
                key={m}
                onClick={() => setMes(m)}
                className={`rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                  mes === m
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-white text-gray-700 hover:bg-emerald-50 shadow-sm'
                }`}
              >
                {m === currentMonth() ? 'Este mês' : monthLabel(m).slice(0, 3) + '/' + m.slice(2, 4)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-emerald-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Progresso geral</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-700">{Math.round(stats.progressoGeral)}%</div>
          <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all" style={{ width: `${stats.progressoGeral}%` }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1">{stats.feitasCells} de {stats.totalCells} itens</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Award size={14} className="text-emerald-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">100% concluídas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600">{stats.empresasCompletas}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas finalizadas</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Em andamento</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600">{stats.empresasParciais}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas parciais</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Não iniciadas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-red-600">{stats.empresasPendentes}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas sem marcar</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-cyan-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Total empresas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-cyan-700">{linhas.length}</div>
          <div className="text-[10px] text-gray-400 mt-1">visíveis no filtro</div>
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
              onClick={() => { setSearch(''); setFiltroUsuario(''); setFiltroProgresso('todos'); setApenasMinhas(false); }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold"
            >
              <XCircle size={14} />
              Limpar
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
            />
          </div>
          <select
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400"
          >
            <option value="">Todos responsáveis fiscais</option>
            {fiscalUsers.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            <option value="sem">Empresas sem responsável fiscal</option>
          </select>
          <select
            value={filtroProgresso}
            onChange={(e) => setFiltroProgresso(e.target.value as typeof filtroProgresso)}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400"
          >
            <option value="todos">Todas as empresas</option>
            <option value="pendentes">Só não iniciadas</option>
            <option value="parciais">Só em andamento</option>
            <option value="concluidas">Só 100% concluídas</option>
          </select>
          <button
            onClick={() => setApenasMinhas((v) => !v)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border-2 transition ${
              apenasMinhas
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-emerald-300'
            }`}
            disabled={!currentUserId}
            title={!currentUserId ? 'Faça login para filtrar suas empresas' : undefined}
          >
            <UserIcon size={16} />
            {apenasMinhas ? 'Mostrando minhas' : 'Só minhas empresas'}
          </button>
        </div>
      </div>

      {/* Stats por usuário (chips) */}
      {fiscalUsers.length > 0 && (
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-2">
            <Users size={14} className="text-gray-400" />
            Progresso por responsável
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {fiscalUsers.map((u) => {
              const s = statsPorUsuario.get(u.id);
              const pct = !s || s.total === 0 ? 0 : (s.feitas / s.total) * 100;
              const isSelected = filtroUsuario === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setFiltroUsuario((prev) => (prev === u.id ? '' : u.id))}
                  className={`rounded-xl p-2 text-left border-2 transition ${
                    isSelected ? 'border-emerald-500 bg-emerald-50 shadow' : 'border-gray-100 bg-gray-50 hover:border-emerald-300'
                  }`}
                  title={`${u.nome} - ${s?.feitas ?? 0}/${s?.total ?? 0} obrigações`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                      {userInitials(u.nome)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-gray-900 truncate">{u.nome}</div>
                      <div className="text-[10px] text-gray-500">{s?.feitas ?? 0}/{s?.total ?? 0} feitas</div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grade principal */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden min-w-0 max-w-full">
        {loading ? (
          <div className="p-10 text-center text-gray-500">
            <ListChecks className="mx-auto mb-3 text-gray-300 animate-pulse" size={40} />
            <div className="text-sm font-semibold">Carregando checklist de {monthLabel(mes)}...</div>
          </div>
        ) : linhas.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <ListChecks className="mx-auto mb-3 text-gray-300" size={40} />
            <div className="font-bold text-gray-700 mb-1">Nenhuma empresa encontrada</div>
            <div className="text-sm">Ajuste os filtros acima.</div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto overflow-y-auto max-h-[75vh]">
            <table className="border-separate border-spacing-0 text-sm min-w-max">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider text-left px-3 py-2 border-b-2 border-gray-700 w-[220px] min-w-[220px] max-w-[220px]">
                    Empresa / Responsável
                  </th>
                  <th className="sticky top-0 z-20 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider text-center px-2 py-2 border-b-2 border-gray-700 w-[90px] min-w-[90px]">
                    Progresso
                  </th>
                  {VENCIMENTOS_FISCAIS_NOMES.map((obr, idx) => {
                    const s = stats.porObrigacao[idx];
                    return (
                      <th
                        key={obr}
                        className="sticky top-0 z-20 bg-gray-900 text-white text-[9px] font-bold text-center px-1 py-2 border-b-2 border-gray-700 w-[90px] min-w-[90px] max-w-[90px]"
                        title={`${obr} — ${s.feitas}/${s.total} (${Math.round(s.pct)}%)`}
                      >
                        <div className="leading-tight px-1">{obr}</div>
                        <div className="mt-1 flex items-center justify-center gap-1">
                          <span className="rounded bg-emerald-600 px-1 text-[8px] font-black">{s.feitas}/{s.total}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const respUser = l.respId ? usuarios.find((u) => u.id === l.respId) : null;
                  const completa = l.total > 0 && l.feitas === l.total;
                  const vazia = l.feitas === 0;
                  return (
                    <tr
                      key={l.empresa.id}
                      className={`transition-colors ${completa ? 'bg-emerald-50/40' : vazia ? '' : 'bg-amber-50/30'}`}
                    >
                      <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-3 py-2 w-[220px] min-w-[220px] max-w-[220px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${
                            completa ? 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white' :
                            vazia ? 'bg-gray-100 text-gray-400' :
                            'bg-gradient-to-br from-amber-300 to-orange-400 text-white'
                          }`}>
                            {completa ? <Check size={16} strokeWidth={3} /> : <span className="text-[10px] font-black">{Math.round(l.progresso)}%</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-gray-900 text-xs truncate">{l.empresa.codigo}</div>
                            <div className="text-[10px] text-gray-500 truncate" title={l.empresa.razao_social || l.empresa.apelido}>
                              {l.empresa.razao_social || l.empresa.apelido || '-'}
                            </div>
                            {respUser && (
                              <div className="text-[9px] text-emerald-700 font-semibold truncate mt-0.5">
                                {respUser.nome}
                              </div>
                            )}
                            {!respUser && (
                              <div className="text-[9px] text-red-500 font-semibold mt-0.5">sem responsável</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-gray-100 px-2 py-2 w-[90px] min-w-[90px]">
                        <div className="text-center">
                          <div className={`text-sm font-black ${completa ? 'text-emerald-600' : vazia ? 'text-gray-400' : 'text-amber-600'}`}>
                            {l.feitas}/{l.total}
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full transition-all ${completa ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
                              style={{ width: `${l.progresso}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      {l.cells.map(({ obrigacao, item }) => {
                        const key = buildKey(l.empresa.id, obrigacao);
                        const saving = savingKeys.has(key);
                        const feito = !!item?.concluido;
                        const temObs = !!(item?.observacao && item.observacao.trim());
                        const canEdit = canManage || (!!currentUserId && l.respId === currentUserId);

                        return (
                          <td key={obrigacao} className="border-b border-gray-100 p-1 w-[90px] min-w-[90px] max-w-[90px]">
                            <div
                              className={`group relative rounded-lg border-2 p-1.5 transition ${
                                feito
                                  ? 'bg-emerald-50 border-emerald-300 hover:border-emerald-500'
                                  : 'bg-gray-50 border-gray-200 hover:border-emerald-300'
                              } ${saving ? 'opacity-60' : ''}`}
                            >
                              <button
                                type="button"
                                onClick={() => canEdit && !saving && toggle(l.empresa, obrigacao, !feito)}
                                disabled={!canEdit || saving}
                                className={`w-full flex items-center justify-center h-7 rounded-md transition ${
                                  feito
                                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                                    : canEdit
                                      ? 'bg-white border border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600'
                                      : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                }`}
                                title={
                                  !canEdit ? 'Sem permissão (responsável fiscal ou gerente)' :
                                  feito ? `Feito por ${item?.concluidoPorNome ?? '-'} em ${item?.concluidoEm ? new Date(item.concluidoEm).toLocaleString('pt-BR') : '-'}\nClique para desmarcar` :
                                  'Clique para marcar como feito'
                                }
                              >
                                {feito ? <Check size={18} strokeWidth={3} /> : <span className="text-[10px] font-semibold">marcar</span>}
                              </button>
                              {feito && item?.concluidoPorNome && (
                                <div className="mt-1 text-[9px] text-emerald-700 font-bold text-center truncate" title={item.concluidoPorNome}>
                                  {item.concluidoPorNome.split(' ')[0]}
                                </div>
                              )}
                              <div className="mt-1 flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => abrirObservacao(l.empresa, obrigacao)}
                                  className={`p-0.5 rounded hover:bg-white transition ${temObs ? 'text-violet-600' : 'text-gray-300 hover:text-violet-500'}`}
                                  title={temObs ? `Observação: ${item?.observacao}` : 'Adicionar observação'}
                                >
                                  <MessageSquare size={11} strokeWidth={temObs ? 2.5 : 2} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => abrirHistorico(l.empresa, obrigacao)}
                                  className="p-0.5 rounded text-gray-300 hover:text-cyan-600 hover:bg-white transition"
                                  title="Ver histórico desta obrigação"
                                >
                                  <History size={11} />
                                </button>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && linhas.length > 0 && (
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between flex-wrap gap-2">
            <span>Exibindo {linhas.length} empresa(s) • {stats.feitasCells} de {stats.totalCells} marcadas</span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={11} className="text-violet-500" />
                <span>observação</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <History size={11} className="text-cyan-500" />
                <span>histórico</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-mono text-[10px]">←</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-mono text-[10px]">→</kbd>
                <span>navegar meses</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Observação */}
      {obsTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onMouseDown={(e) => e.currentTarget === e.target && !savingObs && setObsTarget(null)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-4 flex items-center justify-between">
              <div className="text-white min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Observação • {monthLabel(mes)}</div>
                <div className="text-sm font-bold truncate">{obsTarget.empresa.codigo} — {obsTarget.obrigacao}</div>
              </div>
              <button
                onClick={() => !savingObs && setObsTarget(null)}
                className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition shrink-0"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={obsText}
                onChange={(e) => setObsText(e.target.value)}
                rows={5}
                placeholder="Ex: Cliente pediu prazo até dia 25..."
                className="w-full rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400 focus:bg-white transition"
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => !savingObs && setObsTarget(null)}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 transition"
                  disabled={savingObs}
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarObservacao}
                  disabled={savingObs}
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-2 text-sm font-bold hover:from-violet-700 hover:to-purple-700 shadow transition disabled:opacity-50"
                >
                  {savingObs ? 'Salvando...' : 'Salvar observação'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Histórico */}
      {histTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onMouseDown={(e) => e.currentTarget === e.target && setHistTarget(null)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-4 flex items-center justify-between">
              <div className="text-white min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Histórico da obrigação</div>
                <div className="text-sm font-bold truncate">{histTarget.empresa.codigo} — {histTarget.obrigacao}</div>
              </div>
              <button
                onClick={() => setHistTarget(null)}
                className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition shrink-0"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              {histLoading ? (
                <div className="text-center text-gray-500 py-8">
                  <History size={32} className="mx-auto mb-2 text-gray-300 animate-pulse" />
                  Carregando...
                </div>
              ) : histItems.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <History size={32} className="mx-auto mb-2 text-gray-300" />
                  Ainda não há registros desta obrigação.
                </div>
              ) : (
                <div className="space-y-2">
                  {histItems.map((it) => (
                    <div
                      key={it.id}
                      className={`rounded-xl border-2 p-3 ${it.concluido ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50/50'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            it.concluido ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-700'
                          }`}>
                            {it.concluido ? <><Check size={10} strokeWidth={3} /> FEITO</> : 'PENDENTE'}
                          </span>
                          <span className="text-sm font-bold text-gray-800 capitalize">{monthLabel(it.mes)}</span>
                        </div>
                        {it.concluidoEm && (
                          <span className="text-[10px] text-gray-500">
                            {new Date(it.concluidoEm).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                      {it.concluidoPorNome && (
                        <div className="text-xs text-emerald-700 font-semibold">por {it.concluidoPorNome}</div>
                      )}
                      {it.observacao && (
                        <div className="mt-2 rounded-lg bg-white border border-violet-100 p-2 text-xs text-gray-700">
                          <div className="text-[10px] font-bold text-violet-600 mb-1 uppercase tracking-wide">Observação</div>
                          {it.observacao}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
