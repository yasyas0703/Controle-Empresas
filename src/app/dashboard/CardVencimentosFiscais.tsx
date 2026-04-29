'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ListChecks, Loader2,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil } from '@/app/utils/date';
import { normalizarNomeDepartamento } from '@/app/utils/departamento';
import { ehEmpresaHistorica } from '@/app/utils/empresaHistorica';
import { vencimentoDoMes } from '@/app/utils/regrasVencimentosFiscais';
import { fetchChecklistFiscalByMes } from '@/lib/db';
import { VENCIMENTOS_FISCAIS_NOMES } from '@/app/types';
import type { ChecklistFiscalItem, UUID } from '@/app/types';

type Pendencia = {
  empresaId: UUID;
  empresaCodigo: string;
  empresaNome: string;
  obrigacao: string;
  vencimento: string; // ISO
  dias: number;
};

function mesAtualKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

/**
 * Card consolidado dos vencimentos fiscais do mês corrente.
 * - 4 contadores: vencidos, hoje, em ≤3 dias, concluídos
 * - Top 5 mais urgentes
 * - Filtra por responsável (usuário do fiscal vê só dele; admin/gerente vê tudo)
 * - Não aparece pra usuários de outros departamentos (sem permissão fiscal)
 */
export default function CardVencimentosFiscais() {
  const {
    empresas, departamentos, currentUser, currentUserId, canAdmin, canManage, isPrivileged,
  } = useSistema();

  const [checklistMap, setChecklistMap] = useState<Map<string, ChecklistFiscalItem>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false);

  const mes = mesAtualKey();

  // Fiscal departamento (pra mapear responsável)
  const fiscalDept = useMemo(
    () => departamentos.find((d) => normalizarNomeDepartamento(d.nome) === 'fiscal') ?? null,
    [departamentos],
  );

  const userSlug = useMemo(() => {
    if (!currentUser?.departamentoId) return null;
    const dep = departamentos.find((d) => d.id === currentUser.departamentoId);
    return normalizarNomeDepartamento(dep?.nome);
  }, [currentUser, departamentos]);

  // Quem pode ver o card: admin, gerente, ghost/dev, ou usuário do fiscal
  const podeVer = canAdmin || canManage || isPrivileged || userSlug === 'fiscal';

  // Carrega checklist do mês corrente
  useEffect(() => {
    if (!podeVer) return;
    let cancelado = false;
    setCarregando(true);
    fetchChecklistFiscalByMes(mes)
      .then((lista) => {
        if (cancelado) return;
        const mapa = new Map<string, ChecklistFiscalItem>();
        for (const it of lista) mapa.set(`${it.empresaId}|${it.obrigacao}`, it);
        setChecklistMap(mapa);
      })
      .catch(() => { if (!cancelado) setErro('Falha ao carregar checklist fiscal.'); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [mes, podeVer]);

  // Filtra empresas: admin/gerente vê tudo; usuário do fiscal vê só onde é responsável.
  // Empresas históricas (arquivadas/desligadas/código reciclado) ficam fora —
  // ver `ehEmpresaHistorica` pra todos os critérios de detecção.
  const empresasFiltradas = useMemo(() => {
    const ativas = empresas.filter((e) => !ehEmpresaHistorica(e));
    if (canAdmin || canManage || isPrivileged) return ativas;
    if (!fiscalDept || !currentUserId) return [];
    return ativas.filter((e) => e.responsaveis?.[fiscalDept.id] === currentUserId);
  }, [empresas, canAdmin, canManage, isPrivileged, fiscalDept, currentUserId]);

  // Calcula pendências do mês corrente, escopadas pra HOJE em diante.
  //  - Vencimentos com data anterior a hoje não entram na lista (nem como
  //    "vencidos") — assume-se que já foram resolvidos. Foco é forward-looking.
  //  - `concluidos` e `totalImpostosMes` cobrem só itens de hoje pra frente
  //    também, pra que o "X/Y" reflita o trabalho que ainda existe.
  //  - Vencimentos manuais (preenchidos no cadastro da empresa) têm prioridade
  //    sobre a regra automática por UF.
  const { pendencias, concluidos, totalImpostosMes } = useMemo(() => {
    const pendencias: Pendencia[] = [];
    let concluidos = 0;
    let totalImpostosMes = 0;
    const anoMesAtual = mes;

    for (const empresa of empresasFiltradas) {
      const manuaisPorNome = new Map<string, string>();
      for (const f of empresa.vencimentosFiscais ?? []) {
        if (f.vencimento) manuaisPorNome.set(f.nome, f.vencimento);
      }

      for (const nomeObrigacao of VENCIMENTOS_FISCAIS_NOMES) {
        const dataManual = manuaisPorNome.get(nomeObrigacao);
        const data = dataManual ?? vencimentoDoMes(nomeObrigacao, empresa.estado, anoMesAtual);
        if (!data) continue;
        if (!data.startsWith(`${anoMesAtual}-`)) continue;

        const dias = daysUntil(data);
        if (dias === null) continue;
        if (dias < 0) continue; // já passou — não interessa

        totalImpostosMes++;

        const item = checklistMap.get(`${empresa.id}|${nomeObrigacao}`);
        if (item?.concluido) {
          concluidos++;
          continue;
        }

        pendencias.push({
          empresaId: empresa.id,
          empresaCodigo: empresa.codigo,
          empresaNome: empresa.razao_social || empresa.apelido || empresa.codigo,
          obrigacao: nomeObrigacao,
          vencimento: data,
          dias,
        });
      }
    }

    pendencias.sort((a, b) => a.dias - b.dias);
    return { pendencias, concluidos, totalImpostosMes };
  }, [empresasFiltradas, checklistMap, mes]);

  const hoje = pendencias.filter((p) => p.dias === 0).length;
  const tresDias = pendencias.filter((p) => p.dias > 0 && p.dias <= 3).length;
  const seteDias = pendencias.filter((p) => p.dias > 3 && p.dias <= 7).length;
  const top5 = pendencias.slice(0, 5);

  if (!podeVer) return null;

  // Se não tem nada (nenhum imposto ainda no mês — empresas sem regra ou estado vazio)
  if (!carregando && totalImpostosMes === 0 && empresasFiltradas.length === 0) {
    return null;
  }

  const titulo = (canAdmin || canManage || isPrivileged) ? 'Vencimentos fiscais do mês' : 'Meus vencimentos fiscais do mês';

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-3 sm:px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-red-50 via-amber-50 to-emerald-50 flex items-center gap-2">
        <CalendarClock size={18} className="text-red-600 shrink-0" />
        <div className="font-bold text-gray-900 text-sm sm:text-base flex-1 min-w-0">
          <div className="truncate">{titulo}</div>
          <div className="text-[10px] sm:text-[11px] font-semibold text-gray-500 sm:inline sm:ml-2">
            {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </div>
        </div>
        <Link
          href="/vencimentos-fiscais/checklist"
          className="inline-flex items-center gap-1 rounded-lg bg-white/70 hover:bg-white px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold text-gray-700 border border-gray-200 transition shrink-0"
        >
          <ListChecks size={13} />
          <span className="hidden sm:inline">Ver checklist</span>
          <span className="sm:hidden">Checklist</span>
          <ChevronRight size={13} />
        </Link>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Contadores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <ContadorBox cor="orange" valor={hoje} label="Hoje" />
          <ContadorBox cor="amber" valor={tresDias} label="Em ≤ 3 dias" />
          <ContadorBox cor="yellow" valor={seteDias} label="Em ≤ 7 dias" />
          <ContadorBox cor="emerald" valor={concluidos} label={`Concluídos${totalImpostosMes > 0 ? ` (${concluidos}/${totalImpostosMes})` : ''}`} />
        </div>

        {/* Top 5 urgentes */}
        {carregando && (
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-3">
            <Loader2 size={14} className="animate-spin" /> carregando…
          </div>
        )}

        {!carregando && erro && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {erro}
          </div>
        )}

        {!carregando && !erro && pendencias.length > 0 && (
          <div>
            {expandido ? (
              <ListaPendenciasAgrupadas pendencias={pendencias} />
            ) : (
              <>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Mais urgentes
                </div>
                <ul className="space-y-1">
                  {top5.map((p) => (
                    <PendenciaLinha key={`${p.empresaId}|${p.obrigacao}`} p={p} />
                  ))}
                </ul>
              </>
            )}

            {pendencias.length > 5 && (
              <button
                onClick={() => setExpandido((v) => !v)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition"
              >
                {expandido ? (
                  <>
                    <ChevronUp size={14} /> 
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} /> Ver todos os {pendencias.length} pendentes
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {!carregando && !erro && pendencias.length === 0 && totalImpostosMes > 0 && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 inline-flex items-center gap-2">
            <CheckCircle2 size={14} /> Tudo concluído pro mês. Bom trabalho!
          </div>
        )}

        {!carregando && !erro && totalImpostosMes === 0 && empresasFiltradas.length > 0 && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 inline-flex items-center gap-2">
            <AlertTriangle size={14} /> Nenhum imposto com data calculada — confira a UF das empresas.
          </div>
        )}
      </div>
    </div>
  );
}

function ContadorBox({ cor, valor, label }: { cor: 'red' | 'orange' | 'amber' | 'yellow' | 'emerald'; valor: number; label: string }) {
  const classes = {
    red: 'bg-red-50 border-red-200 text-red-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  }[cor];
  return (
    <div className={`rounded-xl border p-3 ${classes}`}>
      <div className="text-2xl sm:text-3xl font-black leading-none">{valor}</div>
      <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider opacity-90 mt-1">{label}</div>
    </div>
  );
}

const PendenciaLinha = React.memo(function PendenciaLinha({ p }: { p: Pendencia }) {
  const bg = p.dias < 0
    ? 'bg-red-50 border border-red-200'
    : p.dias === 0
      ? 'bg-orange-50 border border-orange-200'
      : p.dias <= 3
        ? 'bg-amber-50 border border-amber-200'
        : p.dias <= 7
          ? 'bg-yellow-50 border border-yellow-200'
          : 'bg-gray-50 border border-gray-200';
  const corDias = p.dias < 0
    ? 'text-red-700'
    : p.dias === 0
      ? 'text-orange-700'
      : p.dias <= 3
        ? 'text-amber-700'
        : p.dias <= 7
          ? 'text-yellow-700'
          : 'text-gray-600';
  const textoDias = p.dias < 0
    ? `${Math.abs(p.dias)}d atraso`
    : p.dias === 0
      ? 'hoje'
      : `em ${p.dias}d`;
  return (
    <li className={`rounded-lg px-2.5 py-1.5 text-xs ${bg}`}>
      {/* Mobile: empilha em 2 linhas. Desktop: tudo numa linha. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
        <div className="flex items-center gap-2 min-w-0 sm:flex-1">
          <span className="font-mono text-[10px] font-bold text-gray-500 shrink-0">{p.empresaCodigo}</span>
          <span className="font-semibold text-gray-800 truncate flex-1">{p.empresaNome}</span>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="text-gray-500 truncate sm:shrink-0">{p.obrigacao}</span>
          <span className={`shrink-0 font-bold ${corDias}`}>
            {textoDias}{' · '}{formatBR(p.vencimento)}
          </span>
        </div>
      </div>
    </li>
  );
});

type GrupoUrgencia = { titulo: string; cor: string; itens: Pendencia[] };

const ITENS_INICIAIS_POR_GRUPO = 50;

function ListaPendenciasAgrupadas({ pendencias }: { pendencias: Pendencia[] }) {
  const grupos: GrupoUrgencia[] = useMemo(() => {
    const r: GrupoUrgencia[] = [];
    const v: Pendencia[] = [];
    const h: Pendencia[] = [];
    const t3: Pendencia[] = [];
    const t7: Pendencia[] = [];
    const resto: Pendencia[] = [];
    // Single pass — mais barato que 5 .filter() pra listas grandes.
    for (const p of pendencias) {
      if (p.dias < 0) v.push(p);
      else if (p.dias === 0) h.push(p);
      else if (p.dias <= 3) t3.push(p);
      else if (p.dias <= 7) t7.push(p);
      else resto.push(p);
    }
    if (v.length) r.push({ titulo: 'Vencidos', cor: 'text-red-700', itens: v });
    if (h.length) r.push({ titulo: 'Hoje', cor: 'text-orange-700', itens: h });
    if (t3.length) r.push({ titulo: 'Em ≤ 3 dias', cor: 'text-amber-700', itens: t3 });
    if (t7.length) r.push({ titulo: 'Em ≤ 7 dias', cor: 'text-yellow-700', itens: t7 });
    if (resto.length) r.push({ titulo: 'Resto do mês', cor: 'text-gray-600', itens: resto });
    return r;
  }, [pendencias]);

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {grupos.map((g) => (
        <GrupoRender key={g.titulo} grupo={g} />
      ))}
    </div>
  );
}

function GrupoRender({ grupo }: { grupo: GrupoUrgencia }) {
  const [maxVisivel, setMaxVisivel] = useState(ITENS_INICIAIS_POR_GRUPO);
  const visiveis = grupo.itens.slice(0, maxVisivel);
  const restantes = grupo.itens.length - visiveis.length;

  return (
    <div>
      <div className={`text-[11px] font-black uppercase tracking-wider mb-1.5 ${grupo.cor}`}>
        {grupo.titulo} <span className="font-bold opacity-70">({grupo.itens.length})</span>
      </div>
      <ul className="space-y-1">
        {visiveis.map((p) => (
          <PendenciaLinha key={`${p.empresaId}|${p.obrigacao}`} p={p} />
        ))}
      </ul>
      {restantes > 0 && (
        <button
          onClick={() => setMaxVisivel((v) => v + ITENS_INICIAIS_POR_GRUPO)}
          className="mt-1.5 text-[11px] font-bold text-gray-600 hover:text-gray-900 underline"
        >
          Mostrar mais {Math.min(restantes, ITENS_INICIAIS_POR_GRUPO)} (de {restantes} restantes)
        </button>
      )}
    </div>
  );
}
