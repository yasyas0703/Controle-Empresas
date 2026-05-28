'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Calendar, Clock, FileText, Filter, Settings, Sun,
  ChevronDown, ChevronUp, CheckCircle, Sparkles, ListChecks,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import { daysUntil, formatBR, isRetRenovado } from '@/app/utils/date';
import { fetchChecklistFiscalByMes, fetchObrigacoesOverrides } from '@/lib/db';
import { obrigacaoAplicaParaEmpresa, obrigacaoSnAplicaParaEmpresa } from '@/app/utils/regrasVencimentosFiscais';
import {
  FISCAL_DEPT_NOME, FISCAL_SN_DEPT_NOME,
  VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES, OBRIGACOES_FISCAIS_CHECKLIST_EXTRAS,
} from '@/app/types';
import type { ChecklistFiscalItem, Empresa, UUID } from '@/app/types';

// ─── Tipos ────────────────────────────────────────────────────────────────

type Tipo = 'fiscal' | 'ret' | 'documento';

interface ItemHoje {
  id: string;
  tipo: Tipo;
  empresa: Empresa;
  nome: string;            // ICMS, nome do documento, nome do RET
  vencimento: string;      // ISO YYYY-MM-DD
  dias: number;            // negativo = vencido
  responsavelId: UUID | null;
}

// ─── Componente principal ─────────────────────────────────────────────────

export default function HojePage() {
  const { empresas, departamentos, usuarios, currentUser, currentUserId, canManage } = useSistema();

  // Departamentos Fiscal e Fiscal-SN — usados pra resolver responsável e separar abas
  const fiscalDept = useMemo(
    () => departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_DEPT_NOME)
      ?? departamentos.find((d) => {
        const n = d.nome.toLowerCase();
        return n.includes('fiscal') && !n.includes('sn');
      })
      ?? null,
    [departamentos],
  );
  const fiscalSnDept = useMemo(
    () => departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_SN_DEPT_NOME) ?? null,
    [departamentos],
  );

  // Aba do usuário logado — define quais obrigações ele vê:
  //  'sn'      → vê apenas obrigações SN (VENCIMENTOS_FISCAIS_SN_NOMES)
  //  'fiscal'  → vê apenas obrigações Fiscal (VENCIMENTOS_FISCAIS_NOMES + extras)
  //  'ambas'   → gerente/admin sem filtro de aba (canManage e apenasMinhas off)
  const abaUsuario: 'sn' | 'fiscal' = useMemo(() => {
    if (fiscalSnDept && currentUser?.departamentoId === fiscalSnDept.id) return 'sn';
    return 'fiscal';
  }, [currentUser?.departamentoId, fiscalSnDept]);

  // Resolve responsável fiscal de uma empresa olhando AMBAS as keys (fiscal e fiscal-sn).
  const getResponsavelFiscal = (empresa: Empresa): UUID | null => {
    if (fiscalDept) {
      const u = empresa.responsaveis?.[fiscalDept.id];
      if (u) return u;
    }
    if (fiscalSnDept) {
      const u = empresa.responsaveis?.[fiscalSnDept.id];
      if (u) return u;
    }
    return null;
  };

  // Set rápido pra checar se uma obrigação pertence à aba do usuário.
  // Quando apenasMinhas está desligado e o usuário é gerente, NÃO filtra por aba.
  const obrigacoesDaAba = useMemo(() => {
    const s = new Set<string>();
    const lista = abaUsuario === 'sn'
      ? VENCIMENTOS_FISCAIS_SN_NOMES
      : [...VENCIMENTOS_FISCAIS_NOMES, ...OBRIGACOES_FISCAIS_CHECKLIST_EXTRAS];
    for (const o of lista) s.add(o.trim().toLowerCase());
    return s;
  }, [abaUsuario]);

  // Configurações do usuário (persistidas em localStorage)
  // Pro gerente, "apenasMinhas" começa DESLIGADO (vê tudo do escritório por padrão).
  // Pra funcionário comum, começa LIGADO (vê só as empresas dele).
  // Cada um tem chave própria pra não sobrescrever a do outro.
  const apenasMinhasKey = canManage ? 'hoje-apenas-minhas-gerente' : 'hoje-apenas-minhas-usuario';
  const apenasMinhasDefault = !canManage; // gerente → false; usuário → true
  const [dias, setDias] = useLocalStorageState<number>('hoje-dias', 7);
  const [apenasMinhas, setApenasMinhas] = useLocalStorageState<boolean>(apenasMinhasKey, apenasMinhasDefault);
  const [tipos, setTipos] = useLocalStorageState<Tipo[]>('hoje-tipos', ['fiscal', 'ret', 'documento']);
  const [incluirVencidos, setIncluirVencidos] = useLocalStorageState<boolean>('hoje-incluir-vencidos', true);
  const [incluirFeitos, setIncluirFeitos] = useLocalStorageState<boolean>('hoje-incluir-feitos', false);
  const [configAberta, setConfigAberta] = useState(false);

  // Carrega checklist do mês corrente + anterior pra saber o que já foi marcado como feito.
  const [checklistItems, setChecklistItems] = useState<ChecklistFiscalItem[]>([]);
  useEffect(() => {
    const hoje = new Date();
    const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const antMes = new Date(hoje);
    antMes.setMonth(antMes.getMonth() - 1);
    const anterior = `${antMes.getFullYear()}-${String(antMes.getMonth() + 1).padStart(2, '0')}`;
    Promise.all([fetchChecklistFiscalByMes(atual), fetchChecklistFiscalByMes(anterior)])
      .then(([a, b]) => setChecklistItems([...a, ...b]))
      .catch((err) => console.error('[hoje] erro ao carregar checklist:', err));
  }, []);

  // Carrega overrides manuais "empresa × obrigação → habilitada?". Sem override,
  // segue a regra automática por UF/cidade.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    fetchObrigacoesOverrides()
      .then((lista) => {
        const m = new Map<string, boolean>();
        for (const o of lista) m.set(`${o.empresaId}|${o.obrigacao}`, o.habilitada);
        setOverrides(m);
      })
      .catch((err) => console.error('[hoje] erro ao carregar overrides:', err));
  }, []);

  // Decide se uma obrigação fiscal se aplica à empresa.
  // Override manual ganha; sem override, vê se aplica em Fiscal ou SN.
  function obrigacaoAplica(empresa: Empresa, obrigacao: string): boolean {
    const override = overrides.get(`${empresa.id}|${obrigacao}`);
    if (typeof override === 'boolean') return override;
    return (
      obrigacaoAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade) ||
      obrigacaoSnAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade)
    );
  }

  // Normaliza nome de obrigação pra comparar (case + acentos + espaços extras)
  function normalizarNome(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Set rápido: "empresaId|obrigacaoNorm|mes" -> true se já resolvido
  // (qualquer marcação no checklist conta: ✓ verde "feito" OU X vermelho "não se aplica")
  const feitosSet = useMemo(() => {
    const s = new Set<string>();
    for (const i of checklistItems) {
      const resolvido =
        i.concluido === true ||
        i.status === 'feito' ||
        i.status === 'sem_obrigacao';
      if (resolvido) s.add(`${i.empresaId}|${normalizarNome(i.obrigacao)}|${i.mes}`);
    }
    return s;
  }, [checklistItems]);

  function obrigacaoFiscalEstaFeita(empresaId: UUID, obrigacao: string, vencimentoIso: string): boolean {
    const v = new Date(vencimentoIso + 'T00:00:00');
    const mesmoMes = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(v);
    prev.setMonth(prev.getMonth() - 1);
    const mesAnterior = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const obrigNorm = normalizarNome(obrigacao);
    return (
      feitosSet.has(`${empresaId}|${obrigNorm}|${mesAnterior}`) ||
      feitosSet.has(`${empresaId}|${obrigNorm}|${mesmoMes}`)
    );
  }

  // Quando "apenas minhas" liga e o usuário não está logado, desliga (evita lista vazia confusa).
  const efetivoApenasMinhas = apenasMinhas && !!currentUserId;

  const itens = useMemo<ItemHoje[]>(() => {
    const out: ItemHoje[] = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Vencimentos fiscais (cadastrados na empresa)
    // Filtra obrigações conforme a aba do usuário (SN → só SN; Fiscal → só Fiscal).
    // Se o usuário é gerente E o filtro "só minhas" está desligado, mostra ambas as abas.
    const filtrarPorAba = !(canManage && !efetivoApenasMinhas);
    if (tipos.includes('fiscal')) {
      for (const emp of empresas) {
        if (emp.desligada_em) continue;
        for (const v of emp.vencimentosFiscais ?? []) {
          if (!v.vencimento) continue;
          // Pula obrigações que não pertencem à aba do usuário (SN vs Fiscal)
          if (filtrarPorAba && !obrigacoesDaAba.has(v.nome.trim().toLowerCase())) continue;
          // Pula se a obrigação não se aplica à empresa (override manual desabilitada
          // ou regra automática UF/cidade não cobre)
          if (!obrigacaoAplica(emp, v.nome)) continue;
          const d = daysUntil(v.vencimento);
          if (d === null) continue;
          if (!incluirVencidos && d < 0) continue;
          if (d > dias) continue;
          // Se a obrigação já foi marcada como feita no checklist (mês corrente
          // ou anterior), pula — a menos que o usuário queira ver feitos também.
          if (!incluirFeitos && obrigacaoFiscalEstaFeita(emp.id, v.nome, v.vencimento)) continue;
          // Responsável: olha em ambas as keys (fiscal + fiscal-sn)
          const respId = getResponsavelFiscal(emp);
          out.push({
            id: `f:${emp.id}:${v.nome}`,
            tipo: 'fiscal',
            empresa: emp,
            nome: v.nome,
            vencimento: v.vencimento,
            dias: d,
            responsavelId: respId,
          });
        }
      }
    }

    // RETs
    if (tipos.includes('ret')) {
      for (const emp of empresas) {
        if (emp.desligada_em) continue;
        for (const r of emp.rets ?? []) {
          if (!r.vencimento) continue;
          if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) continue;
          const d = daysUntil(r.vencimento);
          if (d === null) continue;
          if (!incluirVencidos && d < 0) continue;
          if (d > dias) continue;
          out.push({
            id: `r:${emp.id}:${r.id}`,
            tipo: 'ret',
            empresa: emp,
            nome: r.nome || 'RET',
            vencimento: r.vencimento,
            dias: d,
            responsavelId: null, // RET não tem responsável por departamento
          });
        }
      }
    }

    // Documentos
    if (tipos.includes('documento')) {
      for (const emp of empresas) {
        if (emp.desligada_em) continue;
        for (const doc of emp.documentos ?? []) {
          if (!doc.validade) continue;
          const d = daysUntil(doc.validade);
          if (d === null) continue;
          if (!incluirVencidos && d < 0) continue;
          if (d > dias) continue;
          out.push({
            id: `d:${emp.id}:${doc.id}`,
            tipo: 'documento',
            empresa: emp,
            nome: doc.nome || 'Documento',
            vencimento: doc.validade,
            dias: d,
            responsavelId: null,
          });
        }
      }
    }

    // Filtro "apenas minhas" (responsável pela obrigação fiscal)
    const filtrados = efetivoApenasMinhas
      ? out.filter((i) => i.responsavelId === currentUserId)
      : out;

    // Ordena: mais urgente primeiro (menor `dias`)
    filtrados.sort((a, b) => a.dias - b.dias);
    return filtrados;
  }, [empresas, departamentos, tipos, dias, incluirVencidos, incluirFeitos, feitosSet, overrides, obrigacoesDaAba, fiscalDept, fiscalSnDept, canManage, efetivoApenasMinhas, currentUserId]);

  // Agrupa por chave de dia
  const grupos = useMemo(() => {
    const map = new Map<string, ItemHoje[]>();
    for (const i of itens) {
      const k = i.dias < 0 ? 'vencidos' : String(i.dias);
      const arr = map.get(k) ?? [];
      arr.push(i);
      map.set(k, arr);
    }
    // Ordem: vencidos primeiro, depois 0, 1, 2, ...
    const chaves = [...map.keys()].sort((a, b) => {
      if (a === 'vencidos') return -1;
      if (b === 'vencidos') return 1;
      return Number(a) - Number(b);
    });
    return chaves.map((k) => ({ chave: k, itens: map.get(k)! }));
  }, [itens]);

  function tituloGrupo(chave: string): { label: string; subtitle?: string; icon?: React.ReactNode } {
    if (chave === 'vencidos') return {
      label: 'Vencidos',
      subtitle: 'Ação imediata',
      icon: <AlertTriangle size={14} className="text-red-600 dark:text-red-400" />,
    };
    const n = Number(chave);
    const hoje = new Date();
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + n);
    const dataLabel = data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    if (n === 0) return { label: 'Hoje', subtitle: dataLabel };
    if (n === 1) return { label: 'Amanhã', subtitle: dataLabel };
    return { label: `Daqui ${n} dias`, subtitle: dataLabel };
  }

  function toggleTipo(t: Tipo) {
    setTipos((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-8">
      {/* Header */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-[var(--brand)]" />
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">Hoje</h1>
            </div>
            <p className="mt-1 text-sm text-[var(--text-2)] leading-relaxed">
              {currentUser?.nome ? `${currentUser.nome}, o ` : 'O '}painel de hoje mostra as obrigações que estão vencendo para suas empresas nos próximos dias, pra você não esquecer de nada importante.
            </p>
          </div>
          <button
            onClick={() => setConfigAberta((v) => !v)}
            className="rounded-md p-2 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition shrink-0"
            aria-label="Configurar"
            title="Configurar"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Painel de configuração */}
      {configAberta && (
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 space-y-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Filter size={14} /> Configurações
            </h2>
            <button
              onClick={() => setConfigAberta(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              fechar
            </button>
          </div>

          {/* Dias a mostrar */}
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Mostrar próximos:</p>
            <div className="flex flex-wrap gap-2">
              {[3, 7, 14, 30].map((n) => (
                <button
                  key={n}
                  onClick={() => setDias(n)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    dias === n
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
                  }`}
                >
                  {n} dias
                </button>
              ))}
            </div>
          </div>

          {/* Tipos */}
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Tipos:</p>
            <div className="flex flex-wrap gap-2">
              <FiltroChip ativo={tipos.includes('fiscal')} onClick={() => toggleTipo('fiscal')} icon={<Calendar size={12} />}>
                Vencimentos Fiscais
              </FiltroChip>
              <FiltroChip ativo={tipos.includes('ret')} onClick={() => toggleTipo('ret')} icon={<ListChecks size={12} />}>
                RETs
              </FiltroChip>
              <FiltroChip ativo={tipos.includes('documento')} onClick={() => toggleTipo('documento')} icon={<FileText size={12} />}>
                Documentos
              </FiltroChip>
            </div>
          </div>

          {/* Apenas minhas */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={apenasMinhas}
                onChange={(e) => setApenasMinhas(e.target.checked)}
                className="rounded"
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">Só as minhas empresas (responsável fiscal)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={incluirVencidos}
                onChange={(e) => setIncluirVencidos(e.target.checked)}
                className="rounded"
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">Incluir vencidos</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={incluirFeitos}
                onChange={(e) => setIncluirFeitos(e.target.checked)}
                className="rounded"
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">Incluir já feitos no checklist</span>
            </label>
          </div>
        </div>
      )}

      {/* Resumo rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <ResumoCard
          cor="red"
          icon={<AlertTriangle size={16} />}
          label="Vencidos"
          count={itens.filter((i) => i.dias < 0).length}
        />
        <ResumoCard
          cor="orange"
          icon={<Clock size={16} />}
          label="Hoje"
          count={itens.filter((i) => i.dias === 0).length}
        />
        <ResumoCard
          cor="amber"
          icon={<Calendar size={16} />}
          label="Amanhã"
          count={itens.filter((i) => i.dias === 1).length}
        />
        <ResumoCard
          cor="cyan"
          icon={<Sun size={16} />}
          label="Próximos"
          count={itens.filter((i) => i.dias >= 2).length}
        />
      </div>

      {/* Lista agrupada */}
      {itens.length === 0 ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-10 text-center border border-[var(--border)]">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-md bg-[var(--ok-soft)] text-[var(--ok)] mb-3">
            <CheckCircle size={26} />
          </div>
          <p className="font-bold text-[var(--text-1)] tracking-tight">Nada pendente no período</p>
          <p className="text-sm text-[var(--text-2)] mt-1">
            {efetivoApenasMinhas
              ? 'Você não tem obrigações nos próximos dias. Aproveita pra avançar em outras coisas.'
              : 'Nenhuma empresa tem obrigação vencendo nesse período.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <GrupoDia key={g.chave} chave={g.chave} itens={g.itens} usuarios={usuarios} tituloFn={tituloGrupo} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function FiltroChip({
  ativo, onClick, children, icon,
}: { ativo: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        ativo
          ? 'border-cyan-600 bg-cyan-600 text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ResumoCard({ cor, icon, label, count }: {
  cor: 'red' | 'orange' | 'amber' | 'cyan';
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  // Vencidos = danger; Hoje = warn (urgente hoje); Amanhã = warn suave;
  // Próximos = neutro. Cor só pra marcar urgência real.
  const config = {
    red: {
      chipBg: 'bg-[var(--danger-soft)]',
      chipText: 'text-[var(--danger)]',
      valueColor: 'text-[var(--danger)]',
      borderColor: 'border-[var(--danger)]/40',
    },
    orange: {
      chipBg: 'bg-[var(--warn-soft)]',
      chipText: 'text-[var(--warn)]',
      valueColor: 'text-[var(--warn)]',
      borderColor: 'border-[var(--warn)]/40',
    },
    amber: {
      chipBg: 'bg-[var(--warn-soft)]',
      chipText: 'text-[var(--warn)]',
      valueColor: 'text-[var(--text-1)]',
      borderColor: 'border-[var(--border)]',
    },
    cyan: {
      chipBg: 'bg-[var(--surface-3)]',
      chipText: 'text-[var(--text-2)]',
      valueColor: 'text-[var(--text-1)]',
      borderColor: 'border-[var(--border)]',
    },
  }[cor];
  return (
    <div className={`rounded-[var(--radius)] bg-[var(--surface-2)] border p-3 ${config.borderColor}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] leading-snug">{label}</span>
        <div className={`shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md ${config.chipBg} ${config.chipText}`}>
          {icon}
        </div>
      </div>
      <div className={`ct-num font-bold text-2xl mt-2 ${config.valueColor} leading-none`}>{count}</div>
    </div>
  );
}

function GrupoDia({
  chave, itens, usuarios, tituloFn,
}: {
  chave: string;
  itens: ItemHoje[];
  usuarios: { id: UUID; nome: string }[];
  tituloFn: (k: string) => { label: string; subtitle?: string; icon?: React.ReactNode };
}) {
  const [aberto, setAberto] = useState(true);
  const { label, subtitle, icon } = tituloFn(chave);
  return (
    <section className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 transition"
      >
        <div className="text-left">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5">
            {icon}
            {label}
          </div>
          {subtitle && <div className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 text-xs font-bold">
            {itens.length}
          </span>
          {aberto ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>
      {aberto && (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {itens.map((i) => (
            <ItemRow key={i.id} item={i} usuarios={usuarios} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemRow({ item, usuarios }: { item: ItemHoje; usuarios: { id: UUID; nome: string }[] }) {
  const responsavel = item.responsavelId ? usuarios.find((u) => u.id === item.responsavelId) : null;
  const tipoLabel = item.tipo === 'fiscal' ? 'Fiscal' : item.tipo === 'ret' ? 'RET' : 'Documento';
  const tipoCor = item.tipo === 'fiscal'
    ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300'
    : item.tipo === 'ret'
      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';

  // Link de destino: pra fiscal abre o checklist do mês; pra outros vai pra detalhe da empresa
  const href = item.tipo === 'fiscal'
    ? `/vencimentos-fiscais/checklist?empresa=${item.empresa.id}`
    : `/empresas?empresa=${item.empresa.id}`;

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${tipoCor}`}>
              {tipoLabel}
            </span>
            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
              {item.empresa.codigo} · {item.empresa.razao_social || item.empresa.apelido}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium">{item.nome}</span>
            <span className="text-gray-400">·</span>
            <span>{formatBR(item.vencimento)}</span>
            {responsavel && (
              <>
                <span className="text-gray-400">·</span>
                <span>{responsavel.nome}</span>
              </>
            )}
          </div>
        </div>
        <UrgenciaBadge dias={item.dias} />
      </Link>
    </li>
  );
}

function UrgenciaBadge({ dias }: { dias: number }) {
  if (dias < 0) {
    return (
      <span className="rounded-full bg-red-100 text-red-700 px-2 py-1 text-[10px] font-black whitespace-nowrap dark:bg-red-900/40 dark:text-red-300">
        {Math.abs(dias)}d atrasado
      </span>
    );
  }
  if (dias === 0) {
    return (
      <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-1 text-[10px] font-black whitespace-nowrap dark:bg-orange-900/40 dark:text-orange-300">
        HOJE
      </span>
    );
  }
  if (dias === 1) {
    return (
      <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-1 text-[10px] font-black whitespace-nowrap dark:bg-amber-900/40 dark:text-amber-300">
        AMANHÃ
      </span>
    );
  }
  return (
    <span className="rounded-full bg-cyan-100 text-cyan-700 px-2 py-1 text-[10px] font-black whitespace-nowrap dark:bg-cyan-900/40 dark:text-cyan-300">
      em {dias}d
    </span>
  );
}
