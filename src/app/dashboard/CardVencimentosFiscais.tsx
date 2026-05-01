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
import { supabase } from '@/lib/supabase';
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

type EmpresaAgrupada = {
  empresaId: UUID;
  empresaCodigo: string;
  empresaNome: string;
  obrigacoesPendentes: { obrigacao: string; vencimento: string; dias: number }[];
  obrigacoesFeitas: string[];
  diasMaisUrgente: number;
};

function mesAtualKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

  // Realtime: atualiza contadores automaticamente quando marca/desmarca em
  // outra aba/usuário, sem precisar F5.
  useEffect(() => {
    if (!podeVer) return;
    const channel = supabase
      .channel(`dashboard-fiscal-checklist-${mes}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_fiscal', filter: `mes=eq.${mes}` }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        const chave = `${row.empresa_id}|${row.obrigacao}`;
        setChecklistMap((prev) => {
          const next = new Map(prev);
          if (payload.eventType === 'DELETE') {
            next.delete(chave);
          } else {
            next.set(chave, {
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
            });
          }
          return next;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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
  const { pendencias, empresasAgrupadas, concluidos, totalImpostosMes } = useMemo(() => {
    const pendencias: Pendencia[] = [];
    // empresaId → grupo (acumula obrigações pendentes e feitas da mesma empresa)
    const grupoPorEmpresa = new Map<UUID, EmpresaAgrupada>();
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
        const data = dataManual ?? vencimentoDoMes(nomeObrigacao, empresa.estado, anoMesAtual, empresa.cidade);
        if (!data) continue;
        if (!data.startsWith(`${anoMesAtual}-`)) continue;

        const dias = daysUntil(data);
        if (dias === null) continue;
        if (dias < 0) continue; // já passou — não interessa

        totalImpostosMes++;

        const item = checklistMap.get(`${empresa.id}|${nomeObrigacao}`);
        const feito = !!item?.concluido;
        if (feito) concluidos++;

        // Garante o grupo da empresa
        let g = grupoPorEmpresa.get(empresa.id);
        if (!g) {
          g = {
            empresaId: empresa.id,
            empresaCodigo: empresa.codigo,
            empresaNome: empresa.razao_social || empresa.apelido || empresa.codigo,
            obrigacoesPendentes: [],
            obrigacoesFeitas: [],
            diasMaisUrgente: Number.POSITIVE_INFINITY,
          };
          grupoPorEmpresa.set(empresa.id, g);
        }

        if (feito) {
          g.obrigacoesFeitas.push(nomeObrigacao);
        } else {
          g.obrigacoesPendentes.push({ obrigacao: nomeObrigacao, vencimento: data, dias });
          if (dias < g.diasMaisUrgente) g.diasMaisUrgente = dias;

          pendencias.push({
            empresaId: empresa.id,
            empresaCodigo: empresa.codigo,
            empresaNome: g.empresaNome,
            obrigacao: nomeObrigacao,
            vencimento: data,
            dias,
          });
        }
      }
    }

    pendencias.sort((a, b) => a.dias - b.dias);

    // Só mostra empresas com pelo menos 1 obrigação pendente.
    // Ordena: mais urgente primeiro; em empate, código da empresa.
    const empresasAgrupadas: EmpresaAgrupada[] = Array.from(grupoPorEmpresa.values())
      .filter((g) => g.obrigacoesPendentes.length > 0)
      .map((g) => {
        // Pendentes ordenadas por dias (mais urgente primeiro)
        g.obrigacoesPendentes.sort((a, b) => a.dias - b.dias);
        g.obrigacoesFeitas.sort((a, b) => a.localeCompare(b, 'pt-BR'));
        return g;
      })
      .sort((a, b) => {
        if (a.diasMaisUrgente !== b.diasMaisUrgente) return a.diasMaisUrgente - b.diasMaisUrgente;
        return a.empresaCodigo.localeCompare(b.empresaCodigo);
      });

    return { pendencias, empresasAgrupadas, concluidos, totalImpostosMes };
  }, [empresasFiltradas, checklistMap, mes]);

  const hoje = pendencias.filter((p) => p.dias === 0).length;
  const tresDias = pendencias.filter((p) => p.dias > 0 && p.dias <= 3).length;
  const seteDias = pendencias.filter((p) => p.dias > 3 && p.dias <= 7).length;
  const top5Empresas = empresasAgrupadas.slice(0, 5);

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

        {!carregando && !erro && empresasAgrupadas.length > 0 && (
          <div>
            {expandido ? (
              <ListaEmpresasAgrupadas empresas={empresasAgrupadas} />
            ) : (
              <>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Empresas com pendências (mais urgentes)
                </div>
                <ul className="space-y-1.5">
                  {top5Empresas.map((g) => (
                    <EmpresaAgrupadaLinha key={g.empresaId} g={g} />
                  ))}
                </ul>
              </>
            )}

            {empresasAgrupadas.length > 5 && (
              <button
                onClick={() => setExpandido((v) => !v)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition"
              >
                {expandido ? (
                  <>
                    <ChevronUp size={14} /> Ver menos
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} /> Ver todas as {empresasAgrupadas.length} empresas com pendências
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

/**
 * Linha por empresa: mostra todas as obrigações pendentes inline (chips coloridos
 * por urgência) + as obrigações já marcadas como feitas no checklist (chip verde
 * com check). Em vez de "yasmin - icms / yasmin - dapi" repetindo a empresa,
 * fica "yasmin · ICMS · DAPI · ✓ SPED".
 */
const EmpresaAgrupadaLinha = React.memo(function EmpresaAgrupadaLinha({ g }: { g: EmpresaAgrupada }) {
  const dias = g.diasMaisUrgente;
  const bg = dias < 0
    ? 'bg-red-50 border-red-200'
    : dias === 0
      ? 'bg-orange-50 border-orange-200'
      : dias <= 3
        ? 'bg-amber-50 border-amber-200'
        : dias <= 7
          ? 'bg-yellow-50 border-yellow-200'
          : 'bg-gray-50 border-gray-200';
  const corDias = dias < 0
    ? 'text-red-700'
    : dias === 0
      ? 'text-orange-700'
      : dias <= 3
        ? 'text-amber-700'
        : dias <= 7
          ? 'text-yellow-700'
          : 'text-gray-600';
  const textoDias = dias < 0
    ? `${Math.abs(dias)}d atraso`
    : dias === 0
      ? 'hoje'
      : `em ${dias}d`;

  return (
    <li className={`rounded-lg border px-2.5 py-2 text-xs ${bg}`}>
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[10px] font-bold text-gray-500 shrink-0">{g.empresaCodigo}</span>
          <span className="font-bold text-gray-800 truncate">{g.empresaNome}</span>
        </div>
        <span className={`shrink-0 font-bold ${corDias}`}>{textoDias}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {g.obrigacoesPendentes.map((o) => (
          <ChipObrigacao key={o.obrigacao} nome={o.obrigacao} dias={o.dias} />
        ))}
        {g.obrigacoesFeitas.map((nome) => (
          <ChipFeito key={nome} nome={nome} />
        ))}
      </div>
    </li>
  );
});

function ChipObrigacao({ nome, dias }: { nome: string; dias: number }) {
  const cor = dias < 0
    ? 'bg-red-200 text-red-800 border-red-300'
    : dias === 0
      ? 'bg-orange-200 text-orange-800 border-orange-300'
      : dias <= 3
        ? 'bg-amber-200 text-amber-800 border-amber-300'
        : dias <= 7
          ? 'bg-yellow-200 text-yellow-800 border-yellow-400'
          : 'bg-white text-gray-700 border-gray-300';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${cor}`}
      title={`${nome} — ${dias < 0 ? `${Math.abs(dias)}d atraso` : dias === 0 ? 'vence hoje' : `vence em ${dias}d`}`}
    >
      {nome}
    </span>
  );
}

function ChipFeito({ nome }: { nome: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"
      title={`${nome} — já marcado como feito no checklist`}
    >
      <CheckCircle2 size={10} strokeWidth={3} />
      {nome}
    </span>
  );
}

type GrupoUrgencia = { titulo: string; cor: string; itens: EmpresaAgrupada[] };

const ITENS_INICIAIS_POR_GRUPO = 50;

function ListaEmpresasAgrupadas({ empresas }: { empresas: EmpresaAgrupada[] }) {
  const grupos: GrupoUrgencia[] = useMemo(() => {
    const r: GrupoUrgencia[] = [];
    const v: EmpresaAgrupada[] = [];
    const h: EmpresaAgrupada[] = [];
    const t3: EmpresaAgrupada[] = [];
    const t7: EmpresaAgrupada[] = [];
    const resto: EmpresaAgrupada[] = [];
    // Agrupa pelas dias da obrigação MAIS URGENTE da empresa
    for (const e of empresas) {
      const d = e.diasMaisUrgente;
      if (d < 0) v.push(e);
      else if (d === 0) h.push(e);
      else if (d <= 3) t3.push(e);
      else if (d <= 7) t7.push(e);
      else resto.push(e);
    }
    if (v.length) r.push({ titulo: 'Vencidos', cor: 'text-red-700', itens: v });
    if (h.length) r.push({ titulo: 'Hoje', cor: 'text-orange-700', itens: h });
    if (t3.length) r.push({ titulo: 'Em ≤ 3 dias', cor: 'text-amber-700', itens: t3 });
    if (t7.length) r.push({ titulo: 'Em ≤ 7 dias', cor: 'text-yellow-700', itens: t7 });
    if (resto.length) r.push({ titulo: 'Resto do mês', cor: 'text-gray-600', itens: resto });
    return r;
  }, [empresas]);

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
        {grupo.titulo} <span className="font-bold opacity-70">({grupo.itens.length} empresa{grupo.itens.length === 1 ? '' : 's'})</span>
      </div>
      <ul className="space-y-1.5">
        {visiveis.map((g) => (
          <EmpresaAgrupadaLinha key={g.empresaId} g={g} />
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
