'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Building2, Calendar, ChevronDown, Download,
  ExternalLink, FileText, Filter, Loader2, ListChecks, Search, ShieldAlert,
  Trash2, Upload,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import {
  fetchObrigacoes,
  fetchObrigacaoTarefas,
  updateObrigacaoTarefaStatus,
  deleteObrigacaoTarefa,
  getGuiaSignedUrl,
} from '@/lib/db';
import ConfirmModal from '@/app/components/ConfirmModal';
import type {
  Empresa,
  Obrigacao,
  ObrigacaoTarefa,
  ObrigacaoTarefaStatus,
} from '@/app/types';

const STATUS_LABELS: Record<ObrigacaoTarefaStatus, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando cliente',
  concluida: 'Concluída',
  atrasada: 'Atrasada',
  cancelada: 'Cancelada',
};

const STATUS_STYLES: Record<ObrigacaoTarefaStatus, string> = {
  aberta: 'bg-gray-100 text-gray-700 border-gray-200',
  em_andamento: 'bg-blue-100 text-blue-700 border-blue-200',
  aguardando_cliente: 'bg-amber-100 text-amber-700 border-amber-200',
  concluida: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  atrasada: 'bg-red-100 text-red-700 border-red-200',
  cancelada: 'bg-gray-100 text-gray-500 border-gray-200',
};

function formatComp(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m)]}/${y}`;
}

function formatBR(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatBRL(v?: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function TarefasObrigacoesPage() {
  const { empresas, currentUser, isPrivileged, canManage, authReady, mostrarAlerta } = useSistema();

  const [obrigacoes, setObrigacoes] = useState<Obrigacao[]>([]);
  const [tarefas, setTarefas] = useState<ObrigacaoTarefa[]>([]);
  const [carregando, setCarregando] = useState(false);

  const [filtroCompetencia, setFiltroCompetencia] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<ObrigacaoTarefaStatus | ''>('');
  const [filtroObrigacao, setFiltroObrigacao] = useState<string>('');
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('');
  const [busca, setBusca] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [abrindoArquivoId, setAbrindoArquivoId] = useState<string | null>(null);

  // Carrega obrigações e tarefas
  useEffect(() => {
    if (!authReady) return;
    let cancelado = false;
    setCarregando(true);
    Promise.all([fetchObrigacoes(), fetchObrigacaoTarefas()])
      .then(([obrs, tars]) => {
        if (cancelado) return;
        setObrigacoes(obrs);
        setTarefas(tars);
      })
      .catch((err) => {
        console.error(err);
        mostrarAlerta('Erro', 'Não foi possível carregar as tarefas.', 'erro');
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [authReady, mostrarAlerta]);

  const empresaPorId = useMemo(() => {
    const m = new Map<string, Empresa>();
    empresas.forEach((e) => m.set(e.id, e));
    return m;
  }, [empresas]);

  const obrigacaoPorId = useMemo(() => {
    const m = new Map<string, Obrigacao>();
    obrigacoes.forEach((o) => m.set(o.id, o));
    return m;
  }, [obrigacoes]);

  const competenciasDisponiveis = useMemo(() => {
    const s = new Set<string>();
    tarefas.forEach((t) => s.add(t.competencia));
    return Array.from(s).sort().reverse();
  }, [tarefas]);

  const tarefasFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase();
    return tarefas.filter((t) => {
      if (filtroCompetencia && t.competencia !== filtroCompetencia) return false;
      if (filtroStatus && t.status !== filtroStatus) return false;
      if (filtroObrigacao && t.obrigacaoId !== filtroObrigacao) return false;
      if (filtroEmpresa && t.empresaId !== filtroEmpresa) return false;
      if (buscaLower) {
        const emp = empresaPorId.get(t.empresaId);
        const obr = obrigacaoPorId.get(t.obrigacaoId);
        const haystack = [
          emp?.razao_social, emp?.apelido, emp?.codigo, emp?.cnpj,
          obr?.nome, obr?.codigo, t.competencia,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(buscaLower)) return false;
      }
      return true;
    });
  }, [tarefas, filtroCompetencia, filtroStatus, filtroObrigacao, filtroEmpresa, busca, empresaPorId, obrigacaoPorId]);

  const totaisPorStatus = useMemo(() => {
    const t: Record<ObrigacaoTarefaStatus, number> = {
      aberta: 0, em_andamento: 0, aguardando_cliente: 0, concluida: 0, atrasada: 0, cancelada: 0,
    };
    tarefasFiltradas.forEach((tar) => { t[tar.status]++; });
    return t;
  }, [tarefasFiltradas]);

  async function alterarStatus(tarefa: ObrigacaoTarefa, novo: ObrigacaoTarefaStatus) {
    try {
      const atualizada = await updateObrigacaoTarefaStatus(tarefa.id, novo, {
        concluidaPorId: novo === 'concluida' ? currentUser?.id ?? null : undefined,
      });
      setTarefas((prev) => prev.map((t) => (t.id === tarefa.id ? atualizada : t)));
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao atualizar status.', 'erro');
    }
  }

  async function excluir(id: string) {
    try {
      await deleteObrigacaoTarefa(id);
      setTarefas((prev) => prev.filter((t) => t.id !== id));
      mostrarAlerta('Excluída', 'Tarefa removida.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao excluir.', 'erro');
    } finally {
      setConfirmDeleteId(null);
    }
  }

  async function abrirArquivo(tarefa: ObrigacaoTarefa) {
    if (!tarefa.arquivoUrl) return;
    setAbrindoArquivoId(tarefa.id);
    try {
      const url = await getGuiaSignedUrl(tarefa.arquivoUrl);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível abrir o arquivo.', 'erro');
    } finally {
      setAbrindoArquivoId(null);
    }
  }

  function limparFiltros() {
    setFiltroCompetencia('');
    setFiltroStatus('');
    setFiltroObrigacao('');
    setFiltroEmpresa('');
    setBusca('');
  }

  if (!authReady) return null;
  if (!currentUser || (!canManage && !isPrivileged)) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">Esta página é apenas para admins/gerentes.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div className="flex items-center gap-2">
        <Link href="/obrigacoes" className="inline-flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Voltar
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shrink-0">
            <ListChecks className="text-white" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Tarefas geradas</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Lista de obrigações pendentes/concluídas por competência. Aqui você acompanha quem precisa pagar o quê.
            </div>
          </div>
          <Link
            href="/obrigacoes/processar"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white px-4 py-2 text-sm font-bold transition shadow-sm"
          >
            <Upload size={16} /> Processar guias
          </Link>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <Filter size={16} className="text-violet-600" /> Filtros
          {(filtroCompetencia || filtroStatus || filtroObrigacao || filtroEmpresa || busca) && (
            <button
              onClick={limparFiltros}
              className="ml-auto text-xs font-bold text-gray-500 hover:text-gray-800 underline"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar empresa, código, CNPJ..."
              className="w-full pl-8 pr-2 py-2 text-sm rounded-lg border border-gray-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 outline-none"
            />
          </div>

          <select
            value={filtroCompetencia}
            onChange={(e) => setFiltroCompetencia(e.target.value)}
            className="w-full px-2 py-2 text-sm rounded-lg border border-gray-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 outline-none"
          >
            <option value="">Todas competências</option>
            {!competenciasDisponiveis.includes(competenciaAtual()) && (
              <option value={competenciaAtual()}>{formatComp(competenciaAtual())} (atual)</option>
            )}
            {competenciasDisponiveis.map((c) => (
              <option key={c} value={c}>{formatComp(c)}</option>
            ))}
          </select>

          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as ObrigacaoTarefaStatus | '')}
            className="w-full px-2 py-2 text-sm rounded-lg border border-gray-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 outline-none"
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABELS) as ObrigacaoTarefaStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>

          <select
            value={filtroObrigacao}
            onChange={(e) => setFiltroObrigacao(e.target.value)}
            className="w-full px-2 py-2 text-sm rounded-lg border border-gray-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 outline-none"
          >
            <option value="">Todas obrigações</option>
            {obrigacoes.map((o) => (
              <option key={o.id} value={o.id}>{o.codigo ?? o.nome}</option>
            ))}
          </select>

          <select
            value={filtroEmpresa}
            onChange={(e) => setFiltroEmpresa(e.target.value)}
            className="w-full px-2 py-2 text-sm rounded-lg border border-gray-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 outline-none"
          >
            <option value="">Todas empresas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} — {e.apelido ?? e.razao_social ?? '(sem nome)'}
              </option>
            ))}
          </select>
        </div>

        {/* Resumo por status */}
        <div className="flex flex-wrap gap-2 pt-1">
          {(Object.keys(STATUS_LABELS) as ObrigacaoTarefaStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(filtroStatus === s ? '' : s)}
              className={`text-xs font-bold px-2.5 py-1 rounded-full border transition ${
                filtroStatus === s ? 'ring-2 ring-violet-400 ' : ''
              }${STATUS_STYLES[s]}`}
            >
              {STATUS_LABELS[s]}: {totaisPorStatus[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {carregando ? (
        <div className="rounded-2xl bg-white p-8 shadow-sm flex items-center justify-center gap-3 text-gray-500">
          <Loader2 size={20} className="animate-spin text-violet-600" />
          <span className="text-sm font-bold">Carregando tarefas...</span>
        </div>
      ) : tarefasFiltradas.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
            <FileText size={24} />
          </div>
          <div className="text-sm font-bold text-gray-700">Nenhuma tarefa encontrada</div>
          <div className="text-xs text-gray-500 mt-1">
            {tarefas.length === 0
              ? 'Comece importando guias em "Processar guias".'
              : 'Tente ajustar os filtros acima.'}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          {/* Tabela em desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-bold">Empresa</th>
                  <th className="text-left px-4 py-3 font-bold">Obrigação</th>
                  <th className="text-left px-4 py-3 font-bold">Competência</th>
                  <th className="text-left px-4 py-3 font-bold">Vencimento</th>
                  <th className="text-right px-4 py-3 font-bold">Valor</th>
                  <th className="text-left px-4 py-3 font-bold">Status</th>
                  <th className="text-center px-4 py-3 font-bold">Guia</th>
                  <th className="text-right px-4 py-3 font-bold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tarefasFiltradas.map((t) => {
                  const emp = empresaPorId.get(t.empresaId);
                  const obr = obrigacaoPorId.get(t.obrigacaoId);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 size={14} className="text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {emp?.apelido ?? emp?.razao_social ?? '(empresa removida)'}
                            </div>
                            {emp?.codigo && (
                              <div className="text-[10px] text-gray-400 font-mono">{emp.codigo}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{obr?.codigo ?? obr?.nome ?? '—'}</div>
                        {obr?.nome && obr.codigo && (
                          <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{obr.nome}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-gray-700">
                          <Calendar size={12} className="text-gray-400" />
                          {formatComp(t.competencia)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatBR(t.vencimentoDetectado ?? t.dataLegal)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">
                        {formatBRL(t.valorDetectado)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusSelect
                          value={t.status}
                          onChange={(s) => alterarStatus(t, s)}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.arquivoUrl ? (
                          <button
                            onClick={() => abrirArquivo(t)}
                            disabled={abrindoArquivoId === t.id}
                            className="inline-flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-800 disabled:opacity-50"
                            title="Abrir guia em PDF"
                          >
                            {abrindoArquivoId === t.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <ExternalLink size={12} />
                            )}
                            PDF
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setConfirmDeleteId(t.id)}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition"
                          title="Excluir tarefa"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cards em mobile */}
          <ul className="md:hidden divide-y divide-gray-100">
            {tarefasFiltradas.map((t) => {
              const emp = empresaPorId.get(t.empresaId);
              const obr = obrigacaoPorId.get(t.obrigacaoId);
              return (
                <li key={t.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-gray-900 truncate">
                        {emp?.apelido ?? emp?.razao_social ?? '(empresa removida)'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {obr?.codigo ?? obr?.nome ?? '—'} · {formatComp(t.competencia)}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmDeleteId(t.id)}
                      className="text-gray-400 hover:text-red-600 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-gray-400">Vencimento</div>
                      <div className="font-medium text-gray-700">{formatBR(t.vencimentoDetectado ?? t.dataLegal)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Valor</div>
                      <div className="font-medium text-gray-700">{formatBRL(t.valorDetectado)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusSelect value={t.status} onChange={(s) => alterarStatus(t, s)} />
                    {t.arquivoUrl && (
                      <button
                        onClick={() => abrirArquivo(t)}
                        disabled={abrindoArquivoId === t.id}
                        className="inline-flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-800 disabled:opacity-50"
                      >
                        {abrindoArquivoId === t.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Download size={12} />}
                        Abrir guia
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDeleteId}
        title="Excluir tarefa?"
        message="A tarefa e o PDF da guia (se houver) serão removidos. Não dá pra desfazer."
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => confirmDeleteId && excluir(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function StatusSelect({
  value, onChange,
}: {
  value: ObrigacaoTarefaStatus;
  onChange: (s: ObrigacaoTarefaStatus) => void;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ObrigacaoTarefaStatus)}
        className={`appearance-none pr-7 pl-2.5 py-1 text-xs font-bold rounded-full border cursor-pointer ${STATUS_STYLES[value]}`}
      >
        {(Object.keys(STATUS_LABELS) as ObrigacaoTarefaStatus[]).map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
    </div>
  );
}
