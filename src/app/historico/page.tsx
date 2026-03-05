'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, UserCircle, Search, ChevronDown, ChevronUp, ArrowRight, Calendar, Trash2, CheckSquare, Square } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { formatBR } from '@/app/utils/date';
import type { LogEntry } from '@/app/types';
import { sortByPtBr, sortResponsaveisByNome } from '@/lib/sort';

/** Formata número do RET no padrão XX.XXXXXXXXX-XX (13 dígitos) */
function formatRetNumber(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 11) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 11)}-${digits.slice(11)}`;
}

/** Labels amigáveis para os campos da empresa */
const FIELD_LABELS: Record<string, string> = {
  codigo: 'Código',
  razao_social: 'Razão Social',
  apelido: 'Apelido / Nome Fantasia',
  cnpj: 'CNPJ/CPF',
  inscricao_estadual: 'Inscrição Estadual',
  inscricao_municipal: 'Inscrição Municipal',
  regime_federal: 'Regime Federal',
  regime_estadual: 'Regime Estadual',
  regime_municipal: 'Regime Municipal',
  tipoEstabelecimento: 'Tipo de Estabelecimento',
  tipoInscricao: 'Tipo de Inscrição',
  estado: 'Estado',
  cidade: 'Cidade',
  bairro: 'Bairro',
  logradouro: 'Logradouro',
  numero: 'Número',
  cep: 'CEP',
  email: 'E-mail',
  telefone: 'Telefone',
  data_abertura: 'Data de Abertura',
  cadastrada: 'Cadastrada',
  possuiRet: 'Possui RET',
  servicos: 'Serviços',
  responsaveis: 'Responsáveis',
  documentos: 'Documentos',
  rets: 'RETs',
  atualizadoEm: 'Atualizado em',
  criadoEm: 'Criado em',
  nome: 'Nome',
  senha: 'Senha',
  role: 'Perfil',
  departamentoId: 'Departamento',
  ativo: 'Ativo',
};

/** Campos que devem ser ignorados no diff (metadados internos) */
const IGNORED_FIELDS = new Set(['id', 'atualizadoEm', 'criadoEm']);

type RetDiffItem = {
  id: string;
  nome: string;
  numeroPta: string;
  vencimento?: string;
  ultimaRenovacao?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRetDiffItem(value: unknown): RetDiffItem | null {
  if (!isRecord(value)) return null;
  return {
    id: asString(value.id),
    nome: asString(value.nome),
    numeroPta: asString(value.numeroPta),
    vencimento: asString(value.vencimento) || undefined,
    ultimaRenovacao: asString(value.ultimaRenovacao) || undefined,
  };
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (isRecord(err) && typeof err.message === 'string' && err.message) return err.message;
  return fallback;
}

export default function HistoricoPage() {
  const { logs, usuarios, departamentos, canAdmin, isGhost, limparHistorico, removerLogsSelecionados, mostrarAlerta } = useSistema();
  const [search, setSearch] = useState('');
  const [filtroAction, setFiltroAction] = useState('');
  const [filtroEntity, setFiltroEntity] = useState('');
  const [filtroUser, setFiltroUser] = useState('');
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [qtdExibir, setQtdExibir] = useState(100);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [textoConfirm, setTextoConfirm] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excluindoSelecionados, setExcluindoSelecionados] = useState(false);
  const canViewHistory = canAdmin || isGhost;
  const canDeleteLogs = canAdmin && !isGhost;
  const visibleLogs = useMemo(
    () => (isGhost ? logs : logs.filter((log) => !log.deletedEm)),
    [isGhost, logs]
  );
  const activeLogIds = useMemo(
    () => new Set(visibleLogs.filter((log) => !log.deletedEm).map((log) => log.id)),
    [visibleLogs]
  );
  const activeLogsCount = useMemo(
    () => logs.filter((log) => !log.deletedEm).length,
    [logs]
  );
  const selectedActiveIds = useMemo(
    () => Array.from(selectedIds).filter((id) => activeLogIds.has(id)),
    [activeLogIds, selectedIds]
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => activeLogIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [activeLogIds]);

  // Controle de permissão: admins e ghost podem ver; só admin comum pode excluir
  if (!canViewHistory) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-white p-12 shadow-sm text-center">
          <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="text-red-500" size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Acesso Restrito</h2>
          <p className="text-gray-500 text-sm">
            Apenas administradores e a conta ghost têm acesso ao histórico de alterações do sistema.
          </p>
          <p className="text-gray-400 text-xs mt-2">
            Entre em contato com o administrador caso precise consultar o histórico.
          </p>
        </div>
      </div>
    );
  }

  const getUserName = (userId: string | null | undefined, userNome?: string | null) => {
    if (!userId) return userNome || 'Sistema';
    const user = usuarios.find((u) => u.id === userId);
    return user ? user.nome : (userNome || 'Desconhecido');
  };

  const getDeptName = (deptId: string) => {
    const dep = departamentos.find((d) => d.id === deptId);
    return dep ? dep.nome : deptId;
  };

  const getDeletedInfo = (log: LogEntry) => {
    if (!log.deletedEm) return '';
    const deletedBy = log.deletedByNome || 'Desconhecido';
    return `Apagado por ${deletedBy} em ${new Date(log.deletedEm).toLocaleString('pt-BR')}`;
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    if (!activeLogIds.has(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const exibidosIds = exibidos.filter((l) => !l.deletedEm).map((l) => l.id);
    if (exibidosIds.length === 0) return;
    const allSelected = exibidosIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of exibidosIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of exibidosIds) next.add(id);
        return next;
      });
    }
  };

  const handleExcluirSelecionados = async () => {
    if (selectedActiveIds.length === 0) return;
    setExcluindoSelecionados(true);
    try {
      await removerLogsSelecionados(selectedActiveIds);
      mostrarAlerta('Registros excluídos', `${selectedActiveIds.length} registro(s) excluído(s) do histórico.`, 'sucesso');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of selectedActiveIds) next.delete(id);
        return next;
      });
    } catch (err: unknown) {
      mostrarAlerta('Erro', getErrorMessage(err, 'Não foi possível excluir os registros.'), 'erro');
    } finally {
      setExcluindoSelecionados(false);
    }
  };

  const q = search.trim().toLowerCase();
  const deMs = dataDe ? new Date(dataDe + 'T00:00:00').getTime() : 0;
  const ateMs = dataAte ? new Date(dataAte + 'T23:59:59').getTime() : Infinity;
  const filtered = visibleLogs.filter((l) => {
    if (filtroAction && l.action !== filtroAction) return false;
    if (filtroEntity && l.entity !== filtroEntity) return false;
    if (filtroUser && l.userId !== filtroUser) return false;
    if (deMs || ateMs < Infinity) {
      const logMs = new Date(l.em).getTime();
      if (logMs < deMs || logMs > ateMs) return false;
    }
    if (q) {
      const hay = [l.action, l.entity, l.message, getUserName(l.userId, l.userNome)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Unique users that appear in logs
  const logUsers = (() => {
    const map = new Map<string, string>();
    for (const l of visibleLogs) {
      if (l.userId && !map.has(l.userId)) {
        const user = usuarios.find((u) => u.id === l.userId);
        map.set(l.userId, user ? user.nome : (l.userNome || 'Desconhecido'));
      }
    }
    return sortByPtBr(
      Array.from(map.entries()).map(([id, nome]) => ({ id, nome })),
      (user) => user.nome
    );
  })();

  const hasFilters = search || filtroAction || filtroEntity || filtroUser || dataDe || dataAte;
  const exibidos = filtered.slice(0, qtdExibir);
  const temMais = filtered.length > qtdExibir;

  /** Formata um valor do diff para exibição legível */
  const formatValue = (key: string, val: unknown): string => {
    if (val === null || val === undefined || val === '') return '(vazio)';
    if (typeof val === 'boolean') return val ? 'Sim' : 'Não';

    // Responsáveis: é um Record<deptId, userId | null>
    if (key === 'responsaveis' && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, string | null>;
      const parts = sortResponsaveisByNome(
        Object.entries(obj).map(([deptId, userId]) => ({
          dep: getDeptName(deptId),
          user: userId ? getUserName(userId) : '(vazio)',
        }))
      ).map(({ dep, user }) => `${dep}: ${user}`);
      return parts.length > 0 ? parts.join(', ') : '(vazio)';
    }

    // Departamento ID
    if (key === 'departamentoId' && typeof val === 'string') {
      return getDeptName(val);
    }

    // Arrays
    if (Array.isArray(val)) {
      if (val.length === 0) return '(vazio)';
      // Serviços: array de strings simples
      if (typeof val[0] === 'string') return val.join(', ');
      // RETs: array de objetos com nome e numeroPta
      if (val[0] && typeof val[0] === 'object' && 'numeroPta' in val[0]) {
        return val
          .map(toRetDiffItem)
          .filter((item): item is RetDiffItem => item !== null)
          .map((item) => `${item.nome || '(sem nome)'} (${formatRetNumber(item.numeroPta)})`)
          .join(', ');
      }
      // Documentos: array de objetos com nome
      if (val[0] && typeof val[0] === 'object' && 'nome' in val[0]) {
        return val
          .map((item) => (isRecord(item) ? asString(item.nome) : ''))
          .filter(Boolean)
          .join(', ');
      }
      return `${val.length} item(ns)`;
    }

    return String(val);
  };

  /** Renderiza o diff detalhado de um log entry */
  const renderDiff = (log: LogEntry) => {
    if (!log.diff || Object.keys(log.diff).length === 0) {
      return <div className="text-xs text-gray-400 italic px-5 py-2">Sem detalhes registrados para esta alteração.</div>;
    }

    const entries = Object.entries(log.diff).filter(([key]) => !IGNORED_FIELDS.has(key));
    if (entries.length === 0) {
      return <div className="text-xs text-gray-400 italic px-5 py-2">Apenas metadados internos foram alterados.</div>;
    }

    return (
      <div className="px-5 py-3 space-y-2">
        {entries.map(([key, change]) => {
          const label = FIELD_LABELS[key] || key;
          const fromStr = formatValue(key, change.from);
          const toStr = formatValue(key, change.to);

          // Para responsáveis, mostrar apenas as diferenças específicas
          if (key === 'responsaveis' && typeof change.from === 'object' && typeof change.to === 'object' && change.from && change.to) {
            const fromObj = change.from as Record<string, string | null>;
            const toObj = change.to as Record<string, string | null>;
            const allDeptIds = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
            const changedDepts: { dept: string; from: string; to: string }[] = [];

            for (const dId of allDeptIds) {
              const oldVal = fromObj[dId] ?? null;
              const newVal = toObj[dId] ?? null;
              if (oldVal !== newVal) {
                changedDepts.push({
                  dept: getDeptName(dId),
                  from: oldVal ? getUserName(oldVal) : '(vazio)',
                  to: newVal ? getUserName(newVal) : '(vazio)',
                });
              }
            }

            if (changedDepts.length === 0) return null;
            const sortedChangedDepts = sortByPtBr(changedDepts, (item) => item.dept);

            return (
              <div key={key} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <div className="text-xs font-bold text-blue-800 mb-2">{label}</div>
                {sortedChangedDepts.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs ml-2 mb-1">
                    <span className="font-semibold text-gray-700 min-w-[100px]">{c.dept}:</span>
                    <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded line-through">{c.from}</span>
                    <ArrowRight size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">{c.to}</span>
                  </div>
                ))}
              </div>
            );
          }

          // RETs: mostrar detalhes de quais RETs mudaram
          if (key === 'rets' && Array.isArray(change.from) && Array.isArray(change.to)) {
            const fromArr = change.from
              .map(toRetDiffItem)
              .filter((item): item is RetDiffItem => item !== null);
            const toArr = change.to
              .map(toRetDiffItem)
              .filter((item): item is RetDiffItem => item !== null);

            const changes: { type: 'added' | 'removed' | 'changed'; ret: string; detail?: string }[] = [];

            // RETs removidos
            for (const oldRet of fromArr) {
              const match = toArr.find((r) => r.id === oldRet.id);
              if (!match) {
                changes.push({ type: 'removed', ret: `${oldRet.nome} (${formatRetNumber(oldRet.numeroPta)})` });
              } else {
                // Checar mudanças nos campos
                const diffs: string[] = [];
                if (oldRet.numeroPta !== match.numeroPta) diffs.push(`Nº PTA: ${formatRetNumber(oldRet.numeroPta)} → ${formatRetNumber(match.numeroPta)}`);
                if (oldRet.nome !== match.nome) diffs.push(`Nome: ${oldRet.nome} → ${match.nome}`);
                if (oldRet.vencimento !== match.vencimento) diffs.push(`Vencimento: ${oldRet.vencimento ? formatBR(oldRet.vencimento) : '(vazio)'} → ${match.vencimento ? formatBR(match.vencimento) : '(vazio)'}`);
                if (oldRet.ultimaRenovacao !== match.ultimaRenovacao) diffs.push(`Última Renovação: ${oldRet.ultimaRenovacao ? formatBR(oldRet.ultimaRenovacao) : '(vazio)'} → ${match.ultimaRenovacao ? formatBR(match.ultimaRenovacao) : '(vazio)'}`);
                if (diffs.length > 0) {
                  changes.push({ type: 'changed', ret: `${match.nome} (${formatRetNumber(match.numeroPta)})`, detail: diffs.join(' | ') });
                }
              }
            }

            // RETs adicionados
            for (const newRet of toArr) {
              const match = fromArr.find((r) => r.id === newRet.id);
              if (!match) {
                changes.push({ type: 'added', ret: `${newRet.nome} (${formatRetNumber(newRet.numeroPta)})` });
              }
            }

            if (changes.length === 0) return null;

            return (
              <div key={key} className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                <div className="text-xs font-bold text-emerald-800 mb-2">{label}</div>
                {changes.map((c, i) => (
                  <div key={i} className="text-xs ml-2 mb-1">
                    {c.type === 'added' && (
                      <div className="flex items-center gap-2">
                        <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">+ Adicionado</span>
                        <span className="text-gray-700">{c.ret}</span>
                      </div>
                    )}
                    {c.type === 'removed' && (
                      <div className="flex items-center gap-2">
                        <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">− Removido</span>
                        <span className="text-gray-700 line-through">{c.ret}</span>
                      </div>
                    )}
                    {c.type === 'changed' && (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">✎ Alterado</span>
                          <span className="font-semibold text-gray-700">{c.ret}</span>
                        </div>
                        {c.detail && <div className="text-gray-500 ml-[80px] mt-0.5">{c.detail}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div key={key} className="flex items-start gap-2 text-xs">
              <span className="font-semibold text-gray-700 min-w-[140px] shrink-0">{label}:</span>
              <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded line-through break-all">{fromStr}</span>
              <ArrowRight size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold break-all">{toStr}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const actionLabels: Record<string, string> = {
    create: 'Criação',
    update: 'Atualização',
    delete: 'Exclusão',
    login: 'Login',
    logout: 'Logout',
    alert: 'Alerta',
  };

  const actionColors: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    login: 'bg-teal-100 text-teal-700',
    logout: 'bg-gray-100 text-gray-600',
    alert: 'bg-amber-100 text-amber-700',
  };

  const entityLabels: Record<string, string> = {
    empresa: 'Empresa',
    usuario: 'Usuário',
    departamento: 'Departamento',
    documento: 'Documento',
    ret: 'RET',
    notificacao: 'Notificação',
    servico: 'Serviço',
  };

  const entityColors: Record<string, string> = {
    empresa: 'bg-blue-50 text-blue-600',
    usuario: 'bg-purple-50 text-purple-600',
    departamento: 'bg-cyan-50 text-cyan-600',
    documento: 'bg-orange-50 text-orange-600',
    ret: 'bg-emerald-50 text-emerald-600',
    notificacao: 'bg-gray-50 text-gray-500',
    servico: 'bg-pink-50 text-pink-600',
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow">
              <ClipboardList className="text-white" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">Histórico de Alterações</div>
              <div className="text-sm text-gray-500">Todas as ações registradas no sistema ({filtered.length} registros)</div>
              {isGhost && (
                <div className="mt-1 text-xs font-semibold text-amber-700">
                  A conta ghost também enxerga registros apagados, com quem apagou e quando.
                </div>
              )}
            </div>
          </div>
          {canDeleteLogs && activeLogsCount > 0 && (
            <div className="flex items-center gap-2 self-start flex-wrap">
              {selectedActiveIds.length > 0 && (
                <button
                  onClick={handleExcluirSelecionados}
                  disabled={excluindoSelecionados}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  {excluindoSelecionados ? 'Excluindo...' : `Excluir ${selectedActiveIds.length} selecionado(s)`}
                </button>
              )}
              <button
                onClick={() => { setConfirmExcluir(true); setTextoConfirm(''); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 border-2 border-red-200 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-50 transition"
              >
                <Trash2 size={16} />
                Excluir histórico
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ação, detalhe ou usuário..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <select
            value={filtroUser}
            onChange={(e) => setFiltroUser(e.target.value)}
            className="rounded-xl bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
          >
            <option value="">Todos os usuários</option>
            {logUsers.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select
            value={filtroAction}
            onChange={(e) => setFiltroAction(e.target.value)}
            className="rounded-xl bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
          >
            <option value="">Todas as ações</option>
            <option value="update">Atualização</option>
            <option value="create">Criação</option>
            <option value="delete">Exclusão</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
          </select>
          <select
            value={filtroEntity}
            onChange={(e) => setFiltroEntity(e.target.value)}
            className="rounded-xl bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
          >
            <option value="">Todos os tipos</option>
            <option value="departamento">Departamento</option>
            <option value="documento">Documento</option>
            <option value="empresa">Empresa</option>
            <option value="ret">RET</option>
            <option value="servico">Serviço</option>
            <option value="usuario">Usuário</option>
          </select>
        </div>

        {/* Filtro por data */}
        <div className="mt-3 flex flex-col sm:flex-row gap-3 items-end flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <label className="text-xs font-semibold text-gray-600">De:</label>
            <input
              type="date"
              value={dataDe}
              onChange={(e) => { setDataDe(e.target.value); setQtdExibir(100); }}
              className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Até:</label>
            <input
              type="date"
              value={dataAte}
              onChange={(e) => { setDataAte(e.target.value); setQtdExibir(100); }}
              className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFiltroAction(''); setFiltroEntity(''); setFiltroUser(''); setDataDe(''); setDataAte(''); setQtdExibir(100); }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold px-3 py-2.5"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-teal-50 to-cyan-50 text-gray-600">
              <tr>
                {canDeleteLogs && (
                  <th className="px-3 py-4 w-10">
                    <button onClick={toggleSelectAll} className="text-gray-400 hover:text-teal-600 transition">
                      {exibidos.filter((l) => !l.deletedEm).length > 0 && exibidos.filter((l) => !l.deletedEm).every((l) => selectedIds.has(l.id))
                        ? <CheckSquare size={18} className="text-teal-600" />
                        : <Square size={18} />}
                    </button>
                  </th>
                )}
                <th className="text-left px-5 py-4 font-semibold">Quando</th>
                <th className="text-left px-5 py-4 font-semibold">Quem</th>
                <th className="text-left px-5 py-4 font-semibold">Ação</th>
                <th className="text-left px-5 py-4 font-semibold">Tipo</th>
                <th className="text-left px-5 py-4 font-semibold">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {exibidos.map((l, idx) => {
                const hasDiff = l.diff && Object.keys(l.diff).filter(k => !IGNORED_FIELDS.has(k)).length > 0;
                const isExpanded = expandedIds.has(l.id);
                const isUpdate = l.action === 'update';

                return (
                  <React.Fragment key={l.id}>
                    <tr
                      className={`${l.deletedEm ? 'bg-amber-50/70' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${isUpdate ? 'cursor-pointer hover:bg-blue-50/50' : ''} ${canDeleteLogs && selectedIds.has(l.id) ? 'bg-red-50/40' : ''}`}
                      onClick={() => isUpdate && toggleExpand(l.id)}
                    >
                      {canDeleteLogs && (
                        <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => toggleSelect(l.id)} className="text-gray-400 hover:text-teal-600 transition">
                            {selectedIds.has(l.id)
                              ? <CheckSquare size={18} className="text-teal-600" />
                              : <Square size={18} />}
                          </button>
                        </td>
                      )}
                      <td className="px-5 py-3.5 text-gray-500 whitespace-nowrap text-xs">{new Date(l.em).toLocaleString('pt-BR')}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 text-teal-700 px-2.5 py-1 text-xs font-semibold">
                          <UserCircle size={13} />
                          {getUserName(l.userId, l.userNome)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${actionColors[l.action] || 'bg-gray-100 text-gray-600'}`}>
                          {actionLabels[l.action] || l.action}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${entityColors[l.entity] || 'bg-gray-50 text-gray-500'}`}>
                          {entityLabels[l.entity] || l.entity}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-700">
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <div>{l.message}</div>
                            {l.deletedEm && (
                              <div className="mt-1 text-xs font-semibold text-amber-700">{getDeletedInfo(l)}</div>
                            )}
                          </div>
                          {isUpdate && hasDiff && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-500 font-semibold shrink-0">
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              {isExpanded ? 'Ocultar' : 'Ver detalhes'}
                            </span>
                          )}
                          {isUpdate && !hasDiff && (
                            <span className="text-xs text-gray-400 italic shrink-0">sem detalhes</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && isUpdate && (
                      <tr className={l.deletedEm ? 'bg-amber-50/70' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td colSpan={canDeleteLogs ? 6 : 5} className="border-t border-blue-100 bg-blue-50/30">
                          {renderDiff(l)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canDeleteLogs ? 6 : 5} className="px-5 py-10 text-center text-gray-400">
                    Sem registros de atividade.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {exibidos.map((l) => {
            const hasDiff = l.diff && Object.keys(l.diff).filter(k => !IGNORED_FIELDS.has(k)).length > 0;
            const isExpanded = expandedIds.has(l.id);
            const isUpdate = l.action === 'update';
            return (
              <div
                key={`mobile-${l.id}`}
                className={`p-4 ${l.deletedEm ? 'bg-amber-50/70' : ''} ${isUpdate ? 'cursor-pointer' : ''} ${canDeleteLogs && selectedIds.has(l.id) ? 'bg-red-50/40' : ''}`}
                onClick={() => isUpdate && toggleExpand(l.id)}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {canDeleteLogs && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSelect(l.id); }}
                        className="text-gray-400 hover:text-teal-600 transition"
                      >
                        {selectedIds.has(l.id)
                          ? <CheckSquare size={16} className="text-teal-600" />
                          : <Square size={16} />}
                      </button>
                    )}
                    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${actionColors[l.action] || 'bg-gray-100 text-gray-600'}`}>
                      {actionLabels[l.action] || l.action}
                    </span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${entityColors[l.entity] || 'bg-gray-50 text-gray-500'}`}>
                      {entityLabels[l.entity] || l.entity}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{new Date(l.em).toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <UserCircle size={13} className="text-teal-500 shrink-0" />
                  <span className="text-xs font-semibold text-teal-700">{getUserName(l.userId, l.userNome)}</span>
                </div>
                <div className="text-sm text-gray-700">{l.message}</div>
                {l.deletedEm && (
                  <div className="mt-1 text-xs font-semibold text-amber-700">{getDeletedInfo(l)}</div>
                )}
                {isUpdate && hasDiff && (
                  <div className="flex items-center gap-1 text-xs text-blue-500 font-semibold mt-2">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                  </div>
                )}
                {isExpanded && isUpdate && (
                  <div className="mt-2 border-t border-blue-100 pt-2">
                    {renderDiff(l)}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-gray-400">Sem registros de atividade.</div>
          )}
        </div>

        {/* Carregar mais + contador */}
        <div className="p-4 border-t border-gray-100 text-center space-y-2">
          <div className="text-xs text-gray-500">
            Exibindo {exibidos.length} de {filtered.length} registros
            {visibleLogs.length !== filtered.length && ` (total visível: ${visibleLogs.length})`}
          </div>
          {temMais && (
            <button
              onClick={() => setQtdExibir((prev) => prev + 100)}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all"
            >
              Carregar mais 100 registros
            </button>
          )}
        </div>
      </div>

      {/* Modal de confirmação para excluir histórico */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" onMouseDown={(e) => e.currentTarget === e.target && setConfirmExcluir(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-red-600 p-5">
              <div className="text-lg font-bold text-white">Excluir todo o histórico</div>
              <div className="text-sm text-red-100 mt-1">Os registros sairão da visão padrão e ficarão preservados para auditoria ghost.</div>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                <p className="text-sm text-red-800 font-semibold">
                  Todos os {activeLogsCount} registros ativos do histórico serão removidos da visão padrão.
                </p>
                <p className="text-sm text-red-700 mt-2">
                  Recomendação: faça um backup antes de excluir.
                </p>
                <p className="text-sm text-red-700 mt-2">
                  Digite <strong>EXCLUIR</strong> para confirmar:
                </p>
              </div>
              <input
                type="text"
                value={textoConfirm}
                onChange={(e) => setTextoConfirm(e.target.value)}
                placeholder="Digite EXCLUIR"
                className="w-full px-4 py-3 border border-red-300 rounded-xl text-center text-lg font-bold tracking-widest uppercase"
                disabled={excluindo}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmExcluir(false)}
                  disabled={excluindo}
                  className="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-200 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    if (textoConfirm !== 'EXCLUIR') {
                      mostrarAlerta('Confirmação necessária', 'Digite EXCLUIR em maiúsculas para confirmar.', 'aviso');
                      return;
                    }
                    setExcluindo(true);
                    try {
                      await limparHistorico();
                      setConfirmExcluir(false);
                      setTextoConfirm('');
                      mostrarAlerta('Histórico excluído', 'Os registros foram removidos da visão padrão do histórico.', 'sucesso');
                    } catch (err: unknown) {
                      mostrarAlerta('Erro', getErrorMessage(err, 'Não foi possível excluir o histórico.'), 'erro');
                    } finally {
                      setExcluindo(false);
                    }
                  }}
                  disabled={excluindo || textoConfirm !== 'EXCLUIR'}
                  className="flex-1 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white px-4 py-3 font-bold hover:from-red-600 hover:to-red-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {excluindo ? 'Excluindo...' : 'Excluir tudo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
