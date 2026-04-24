'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  FileStack, Plus, Pencil, Trash2, Search, XCircle, Shield,
  Building2, Calendar, Bell, Award, Target, Clock, Sparkles, Mail, AlertTriangle, CheckCircle, FileText, Tags, ListChecks,
  FlaskConical, Wand2, Link2, Unlink,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import { supabase } from '@/lib/supabase';
import ModalBase from '@/app/components/ModalBase';
import ConfirmModal from '@/app/components/ConfirmModal';
import { comparePtBr } from '@/lib/sort';
import type {
  Obrigacao,
  ObrigacaoDepartamento,
  ObrigacaoEsfera,
  ObrigacaoFrequencia,
  ObrigacaoTipoData,
  UUID,
} from '@/app/types';
import { isoNow } from '@/app/utils/date';
import { reconhecerGuia, type ResultadoReconhecimento } from '@/app/utils/reconhecerGuia';

const STORAGE_KEY = 'triar-obrigacoes-v1';

function newId(): UUID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

const DEPARTAMENTOS: { value: ObrigacaoDepartamento; label: string }[] = [
  { value: 'fiscal', label: 'Fiscal' },
  { value: 'pessoal', label: 'Pessoal' },
  { value: 'contabil', label: 'Contábil' },
  { value: 'cadastro', label: 'Cadastro' },
];

const ESFERAS: { value: ObrigacaoEsfera; label: string }[] = [
  { value: 'federal', label: 'Federal' },
  { value: 'estadual', label: 'Estadual' },
  { value: 'municipal', label: 'Municipal' },
  { value: 'interna', label: 'Interna' },
];

const FREQUENCIAS: { value: ObrigacaoFrequencia; label: string; meses: number }[] = [
  { value: 'mensal', label: 'Mensal', meses: 1 },
  { value: 'bimestral', label: 'Bimestral', meses: 2 },
  { value: 'trimestral', label: 'Trimestral', meses: 3 },
  { value: 'quadrimestral', label: 'Quadrimestral', meses: 4 },
  { value: 'semestral', label: 'Semestral', meses: 6 },
  { value: 'anual', label: 'Anual', meses: 12 },
  { value: 'eventual', label: 'Eventual', meses: 0 },
];

const TIPOS_DATA: { value: ObrigacaoTipoData; label: string }[] = [
  { value: 'dia_util', label: 'Dia útil' },
  { value: 'dia_corrido', label: 'Dia corrido' },
  { value: 'dia_fixo', label: 'Dia fixo' },
];

const DEPT_BADGE: Record<ObrigacaoDepartamento, string> = {
  fiscal: 'bg-red-100 text-red-700 border-red-300',
  pessoal: 'bg-violet-100 text-violet-700 border-violet-300',
  contabil: 'bg-blue-100 text-blue-700 border-blue-300',
  cadastro: 'bg-amber-100 text-amber-700 border-amber-300',
};

const ESFERA_BADGE: Record<ObrigacaoEsfera, string> = {
  federal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  estadual: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  municipal: 'bg-orange-50 text-orange-700 border-orange-200',
  interna: 'bg-slate-50 text-slate-700 border-slate-200',
};

function obrigacaoVazia(): Obrigacao {
  const now = isoNow();
  return {
    id: newId(),
    nome: '',
    codigo: '',
    departamento: 'fiscal',
    esfera: 'federal',
    frequencia: 'mensal',
    tipoDataLegal: 'dia_util',
    diaDataLegal: 20,
    tipoDataMeta: 'dia_util',
    diaDataMeta: 15,
    competenciaOffset: -1,
    pontuacao: 1,
    agrupador: '',
    notificarCliente: true,
    geraMulta: true,
    autoConcluir: true,
    palavrasChave: [],
    templateEmailAssunto: '',
    templateEmailCorpo: '',
    descricao: '',
    empresasVinculadas: [],
    ativo: true,
    criadoEm: now,
    atualizadoEm: now,
  };
}

export default function ObrigacoesPage() {
  const { isGhost, mostrarAlerta, empresas } = useSistema();
  const [obrigacoes, setObrigacoes] = useLocalStorageState<Obrigacao[]>(STORAGE_KEY, []);

  const [search, setSearch] = useState('');
  const [filtroDep, setFiltroDep] = useState<'' | ObrigacaoDepartamento>('');
  const [filtroFreq, setFiltroFreq] = useState<'' | ObrigacaoFrequencia>('');
  const [filtroAtivo, setFiltroAtivo] = useState<'' | 'ativo' | 'inativo'>('');
  const [editOpen, setEditOpen] = useState(false);
  const [editando, setEditando] = useState<Obrigacao | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string; conectado_em?: string } | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [confirmDisconnectGmail, setConfirmDisconnectGmail] = useState(false);

  const carregarGmailStatus = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setGmailStatus({ connected: false }); return; }
      const res = await fetch('/api/auth/google/status', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setGmailStatus(json);
    } catch {
      setGmailStatus({ connected: false });
    }
  }, []);

  useEffect(() => { if (isGhost) carregarGmailStatus(); }, [isGhost, carregarGmailStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('gmail');
    if (!status) return;
    if (status === 'connected') {
      const email = params.get('email');
      mostrarAlerta('Gmail conectado', email ? `Conta ${email} conectada com sucesso.` : 'Conta conectada com sucesso.', 'sucesso');
      carregarGmailStatus();
    } else if (status === 'error') {
      const reason = params.get('reason') || 'erro desconhecido';
      mostrarAlerta('Erro ao conectar Gmail', `Motivo: ${reason}. Tente novamente.`, 'aviso');
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [mostrarAlerta, carregarGmailStatus]);

  const conectarGmail = useCallback(async () => {
    setGmailLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login novamente.', 'aviso');
        return;
      }
      const res = await fetch('/api/auth/google/connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.authUrl) {
        mostrarAlerta('Erro', json.error || 'Não foi possível iniciar a conexão com o Google.', 'aviso');
        return;
      }
      window.location.href = json.authUrl;
    } catch (err) {
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Erro inesperado', 'aviso');
    } finally {
      setGmailLoading(false);
    }
  }, [mostrarAlerta]);

  const desconectarGmail = useCallback(async () => {
    setGmailLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/auth/google/status', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        mostrarAlerta('Erro', json.error || 'Falha ao desconectar.', 'aviso');
        return;
      }
      setGmailStatus({ connected: false });
      mostrarAlerta('Gmail desconectado', 'Você precisará autorizar novamente para enviar emails.', 'sucesso');
    } finally {
      setGmailLoading(false);
      setConfirmDisconnectGmail(false);
    }
  }, [mostrarAlerta]);

  if (!isGhost) {
    return (
      <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <Shield size={28} />
        </div>
        <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
        <div className="mt-1 text-sm text-gray-500">
          Esta área está em testes e é visível somente para o usuário ghost.
        </div>
      </div>
    );
  }

  const abrirNovo = () => {
    setEditando(obrigacaoVazia());
    setEditOpen(true);
  };

  const abrirEdicao = (o: Obrigacao) => {
    setEditando({ ...o });
    setEditOpen(true);
  };

  const salvar = () => {
    if (!editando) return;
    if (!editando.nome.trim()) {
      mostrarAlerta('Campo obrigatório', 'Informe o nome da obrigação.', 'aviso');
      return;
    }
    if (editando.diaDataLegal < 1 || editando.diaDataLegal > 31) {
      mostrarAlerta('Data legal inválida', 'O dia precisa estar entre 1 e 31.', 'aviso');
      return;
    }
    if (editando.diaDataMeta < 1 || editando.diaDataMeta > 31) {
      mostrarAlerta('Data meta inválida', 'O dia precisa estar entre 1 e 31.', 'aviso');
      return;
    }
    const atualizado: Obrigacao = { ...editando, atualizadoEm: isoNow() };
    setObrigacoes((prev) => {
      const idx = prev.findIndex((o) => o.id === atualizado.id);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = atualizado;
        return copia;
      }
      return [...prev, atualizado];
    });
    setEditOpen(false);
    setEditando(null);
    mostrarAlerta('Obrigação salva', 'Configuração salva com sucesso.', 'sucesso');
  };

  const remover = (id: string) => {
    setObrigacoes((prev) => prev.filter((o) => o.id !== id));
    setConfirmDeleteId(null);
    mostrarAlerta('Obrigação removida', 'A obrigação foi excluída.', 'sucesso');
  };

  const toggleAtivo = (id: string) => {
    setObrigacoes((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ativo: !o.ativo, atualizadoEm: isoNow() } : o))
    );
  };

  const lista = useMemo(() => {
    const q = search.trim().toLowerCase();
    return obrigacoes
      .filter((o) => {
        if (filtroDep && o.departamento !== filtroDep) return false;
        if (filtroFreq && o.frequencia !== filtroFreq) return false;
        if (filtroAtivo === 'ativo' && !o.ativo) return false;
        if (filtroAtivo === 'inativo' && o.ativo) return false;
        if (q) {
          const hay = `${o.nome} ${o.codigo ?? ''} ${o.agrupador ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => comparePtBr(a.nome, b.nome));
  }, [obrigacoes, search, filtroDep, filtroFreq, filtroAtivo]);

  const stats = useMemo(() => {
    const total = obrigacoes.length;
    const ativas = obrigacoes.filter((o) => o.ativo).length;
    const porDep = DEPARTAMENTOS.reduce<Record<string, number>>((acc, d) => {
      acc[d.value] = obrigacoes.filter((o) => o.departamento === d.value).length;
      return acc;
    }, {});
    return { total, ativas, porDep };
  }, [obrigacoes]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-5 sm:p-6 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-11 w-11 rounded-2xl bg-white/10 flex items-center justify-center">
            <FileStack size={22} />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-extrabold tracking-tight">Obrigações</div>
            <div className="text-xs sm:text-sm text-slate-300">
              Templates de tarefas recorrentes — configurar uma vez e aplicar a várias empresas
            </div>
          </div>
          <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-[11px] font-bold text-amber-200">
            <Sparkles size={12} />
            Em testes (ghost)
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-slate-300">Total</div>
            <div className="text-lg font-bold">{stats.total}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-slate-300">Ativas</div>
            <div className="text-lg font-bold">{stats.ativas}</div>
          </div>
          {DEPARTAMENTOS.map((d) => (
            <div key={d.value} className="rounded-xl bg-white/10 px-3 py-2">
              <div className="text-slate-300">{d.label}</div>
              <div className="text-lg font-bold">{stats.porDep[d.value] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Conexão Gmail */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${gmailStatus?.connected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
            <Mail size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900">
              {gmailStatus?.connected ? 'Gmail conectado' : 'Conectar Gmail'}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {gmailStatus?.connected
                ? `Emails serão enviados da conta ${gmailStatus.email}.`
                : 'Autorize seu Gmail para que os envios de guia saiam da sua própria conta.'}
            </div>
          </div>
          {gmailStatus?.connected ? (
            <button
              onClick={() => setConfirmDisconnectGmail(true)}
              disabled={gmailLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Unlink size={14} /> Desconectar
            </button>
          ) : (
            <button
              onClick={conectarGmail}
              disabled={gmailLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Link2 size={14} /> {gmailLoading ? 'Conectando…' : 'Conectar Gmail'}
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, código ou agrupador"
              className="w-full rounded-xl bg-gray-50 pl-9 pr-9 py-2.5 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filtroDep}
              onChange={(e) => setFiltroDep(e.target.value as '' | ObrigacaoDepartamento)}
              className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-cyan-400"
            >
              <option value="">Todos os departamentos</option>
              {DEPARTAMENTOS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <select
              value={filtroFreq}
              onChange={(e) => setFiltroFreq(e.target.value as '' | ObrigacaoFrequencia)}
              className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-cyan-400"
            >
              <option value="">Todas as frequências</option>
              {FREQUENCIAS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <select
              value={filtroAtivo}
              onChange={(e) => setFiltroAtivo(e.target.value as '' | 'ativo' | 'inativo')}
              className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-cyan-400"
            >
              <option value="">Ativas e inativas</option>
              <option value="ativo">Só ativas</option>
              <option value="inativo">Só inativas</option>
            </select>
            <button
              onClick={abrirNovo}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-2.5 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-md text-sm"
            >
              <Plus size={16} />
              Nova obrigação
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {lista.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
            <FileStack size={30} />
          </div>
          <div className="text-lg font-bold text-gray-900">Nenhuma obrigação cadastrada</div>
          <div className="mt-1 text-sm text-gray-500 max-w-md mx-auto">
            Crie templates de obrigações (DARF, DAS, GPS...) para que as tarefas sejam geradas
            automaticamente para cada empresa vinculada.
          </div>
          <button
            onClick={abrirNovo}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-5 py-2.5 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-md text-sm"
          >
            <Plus size={16} />
            Criar primeira obrigação
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lista.map((o) => {
            const freqLabel = FREQUENCIAS.find((f) => f.value === o.frequencia)?.label ?? o.frequencia;
            const esferaLabel = ESFERAS.find((e) => e.value === o.esfera)?.label ?? o.esfera;
            return (
              <div
                key={o.id}
                className={`rounded-2xl bg-white shadow-sm border p-4 transition hover:shadow-md ${
                  o.ativo ? 'border-gray-100' : 'border-gray-200 bg-gray-50/50 opacity-75'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${DEPT_BADGE[o.departamento]}`}>
                        {o.departamento}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ESFERA_BADGE[o.esfera]}`}>
                        {esferaLabel}
                      </span>
                      {!o.ativo && (
                        <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">
                          Inativa
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-base font-bold text-gray-900 truncate">{o.nome}</div>
                    {o.codigo && (
                      <div className="text-xs text-gray-500 font-mono">{o.codigo}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleAtivo(o.id)}
                      title={o.ativo ? 'Desativar' : 'Ativar'}
                      className={`p-1.5 rounded-lg transition ${o.ativo ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100'}`}
                    >
                      <CheckCircle size={16} />
                    </button>
                    <button
                      onClick={() => abrirEdicao(o)}
                      title="Editar"
                      className="p-1.5 rounded-lg text-cyan-600 hover:bg-cyan-50 transition"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(o.id)}
                      title="Excluir"
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Calendar size={12} className="text-gray-400" />
                    <span className="font-semibold">{freqLabel}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Clock size={12} className="text-gray-400" />
                    <span>Legal: dia <strong>{o.diaDataLegal}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Target size={12} className="text-gray-400" />
                    <span>Meta: dia <strong>{o.diaDataMeta}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Award size={12} className="text-gray-400" />
                    <span>{o.pontuacao} pts</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Building2 size={12} className="text-gray-400" />
                    <span>{o.empresasVinculadas.length} empresa(s)</span>
                  </div>
                  {o.agrupador && (
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Tags size={12} className="text-gray-400" />
                      <span className="truncate">{o.agrupador}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {o.notificarCliente && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 border border-cyan-200 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
                      <Bell size={10} />
                      Notifica cliente
                    </span>
                  )}
                  {o.geraMulta && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-700">
                      <AlertTriangle size={10} />
                      Gera multa
                    </span>
                  )}
                  {o.autoConcluir && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      <ListChecks size={10} />
                      Auto-concluir
                    </span>
                  )}
                  {o.palavrasChave.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                      <Sparkles size={10} />
                      {o.palavrasChave.length} palavra(s)-chave
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Testador de reconhecimento */}
      <TestadorReconhecimento obrigacoes={obrigacoes} />

      {/* Edit modal */}
      <ModalBase
        isOpen={editOpen && !!editando}
        onClose={() => { setEditOpen(false); setEditando(null); }}
        dialogClassName="w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {editando && (
          <ObrigacaoForm
            value={editando}
            onChange={setEditando}
            empresas={empresas}
            onCancel={() => { setEditOpen(false); setEditando(null); }}
            onSave={salvar}
          />
        )}
      </ModalBase>

      <ConfirmModal
        open={!!confirmDeleteId}
        title="Excluir obrigação?"
        message="Essa obrigação será removida permanentemente dos testes. Tarefas já geradas não são afetadas."
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => confirmDeleteId && remover(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmModal
        open={confirmDisconnectGmail}
        title="Desconectar Gmail?"
        message="Você precisará autorizar novamente para enviar guias por email. Tokens já salvos serão removidos."
        confirmText="Desconectar"
        variant="danger"
        onConfirm={desconectarGmail}
        onCancel={() => setConfirmDisconnectGmail(false)}
      />
    </div>
  );
}

interface ObrigacaoFormProps {
  value: Obrigacao;
  onChange: (o: Obrigacao) => void;
  empresas: { id: UUID; codigo: string; razao_social?: string; apelido?: string }[];
  onCancel: () => void;
  onSave: () => void;
}

function ObrigacaoForm({ value, onChange, empresas, onCancel, onSave }: ObrigacaoFormProps) {
  const [palavraInput, setPalavraInput] = useState('');
  const [empresaBusca, setEmpresaBusca] = useState('');

  const set = <K extends keyof Obrigacao>(key: K, v: Obrigacao[K]) => {
    onChange({ ...value, [key]: v });
  };

  const addPalavra = () => {
    const p = palavraInput.trim();
    if (!p) return;
    if (value.palavrasChave.includes(p)) {
      setPalavraInput('');
      return;
    }
    set('palavrasChave', [...value.palavrasChave, p]);
    setPalavraInput('');
  };

  const removerPalavra = (p: string) => {
    set('palavrasChave', value.palavrasChave.filter((x) => x !== p));
  };

  const toggleEmpresa = (id: UUID) => {
    if (value.empresasVinculadas.includes(id)) {
      set('empresasVinculadas', value.empresasVinculadas.filter((x) => x !== id));
    } else {
      set('empresasVinculadas', [...value.empresasVinculadas, id]);
    }
  };

  const empresasFiltradas = useMemo(() => {
    const q = empresaBusca.trim().toLowerCase();
    const ordenadas = [...empresas].sort((a, b) =>
      comparePtBr(a.razao_social || a.apelido || a.codigo, b.razao_social || b.apelido || b.codigo)
    );
    if (!q) return ordenadas;
    return ordenadas.filter((e) => {
      const hay = `${e.codigo} ${e.razao_social ?? ''} ${e.apelido ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [empresas, empresaBusca]);

  return (
    <div className="flex flex-col h-full max-h-[90vh]">
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
            <FileStack size={20} />
          </div>
          <div>
            <div className="text-lg font-bold">
              {value.nome || 'Nova obrigação'}
            </div>
            <div className="text-xs text-slate-300">Configure os detalhes do template de tarefa</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Identificação */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <FileText size={14} className="text-cyan-600" />
            Identificação
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nome *">
              <input
                value={value.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Ex.: DARF 2373 - PIS Cumulativo"
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Código">
              <input
                value={value.codigo ?? ''}
                onChange={(e) => set('codigo', e.target.value)}
                placeholder="Ex.: DARF-2373"
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Departamento *">
              <select
                value={value.departamento}
                onChange={(e) => set('departamento', e.target.value as ObrigacaoDepartamento)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              >
                {DEPARTAMENTOS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Esfera *">
              <select
                value={value.esfera}
                onChange={(e) => set('esfera', e.target.value as ObrigacaoEsfera)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              >
                {ESFERAS.map((es) => (
                  <option key={es.value} value={es.value}>{es.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Agrupador">
              <input
                value={value.agrupador ?? ''}
                onChange={(e) => set('agrupador', e.target.value)}
                placeholder="Ex.: Tributos Federais"
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Pontuação">
              <input
                type="number"
                min={0}
                value={value.pontuacao}
                onChange={(e) => set('pontuacao', Number(e.target.value) || 0)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
          </div>
        </section>

        {/* Prazos */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Calendar size={14} className="text-cyan-600" />
            Frequência e prazos
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Frequência *">
              <select
                value={value.frequencia}
                onChange={(e) => set('frequencia', e.target.value as ObrigacaoFrequencia)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              >
                {FREQUENCIAS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Competência (offset em meses)" hint="Ex.: -1 = competência é o mês anterior ao mês de geração">
              <input
                type="number"
                value={value.competenciaOffset}
                onChange={(e) => set('competenciaOffset', Number(e.target.value) || 0)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Data legal (tipo)">
              <select
                value={value.tipoDataLegal}
                onChange={(e) => set('tipoDataLegal', e.target.value as ObrigacaoTipoData)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              >
                {TIPOS_DATA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Data legal (dia)">
              <input
                type="number"
                min={1}
                max={31}
                value={value.diaDataLegal}
                onChange={(e) => set('diaDataLegal', Number(e.target.value) || 1)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Data meta (tipo)" hint="Prazo interno, normalmente antes da data legal">
              <select
                value={value.tipoDataMeta}
                onChange={(e) => set('tipoDataMeta', e.target.value as ObrigacaoTipoData)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              >
                {TIPOS_DATA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Data meta (dia)">
              <input
                type="number"
                min={1}
                max={31}
                value={value.diaDataMeta}
                onChange={(e) => set('diaDataMeta', Number(e.target.value) || 1)}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
          </div>
        </section>

        {/* Comportamento */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <ListChecks size={14} className="text-cyan-600" />
            Comportamento
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Toggle
              checked={value.autoConcluir}
              onChange={(v) => set('autoConcluir', v)}
              title="Concluir automaticamente"
              subtitle="Marca a tarefa como concluída quando todos os anexos forem enviados"
            />
            <Toggle
              checked={value.notificarCliente}
              onChange={(v) => set('notificarCliente', v)}
              title="Notificar cliente por e-mail"
              subtitle="Envia a guia automaticamente para os e-mails cadastrados na empresa"
            />
            <Toggle
              checked={value.geraMulta}
              onChange={(v) => set('geraMulta', v)}
              title="Gera multa em caso de atraso"
              subtitle="Usado para cálculo de penalidade e alertas"
            />
            <Toggle
              checked={value.ativo}
              onChange={(v) => set('ativo', v)}
              title="Obrigação ativa"
              subtitle="Quando inativa, não gera novas tarefas"
            />
          </div>
        </section>

        {/* Template de e-mail */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Mail size={14} className="text-cyan-600" />
            Template de e-mail
            <span className="text-[10px] font-normal text-gray-400">
              (variáveis: <code className="text-cyan-600">&#123;&#123;empresa&#125;&#125;</code>,{' '}
              <code className="text-cyan-600">&#123;&#123;competencia&#125;&#125;</code>,{' '}
              <code className="text-cyan-600">&#123;&#123;vencimento&#125;&#125;</code>,{' '}
              <code className="text-cyan-600">&#123;&#123;valor&#125;&#125;</code>)
            </span>
          </h3>
          <div className="space-y-3">
            <Field label="Assunto">
              <input
                value={value.templateEmailAssunto ?? ''}
                onChange={(e) => set('templateEmailAssunto', e.target.value)}
                placeholder="Ex.: Guia {{empresa}} - competência {{competencia}}"
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
              />
            </Field>
            <Field label="Corpo">
              <textarea
                rows={5}
                value={value.templateEmailCorpo ?? ''}
                onChange={(e) => set('templateEmailCorpo', e.target.value)}
                placeholder={'Olá,\n\nSegue em anexo a guia referente à competência {{competencia}}, com vencimento em {{vencimento}}.\n\nValor: R$ {{valor}}\n\nAtenciosamente.'}
                className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition font-mono text-xs"
              />
            </Field>
          </div>
        </section>

        {/* Palavras-chave */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-1 flex items-center gap-2">
            <Sparkles size={14} className="text-cyan-600" />
            Palavras-chave para detecção automática
          </h3>
          <div className="text-xs text-gray-500 mb-3">
            Quando a usuária fizer upload de um PDF, o sistema procura essas palavras no conteúdo para identificar
            qual obrigação é.
          </div>
          <div className="flex gap-2">
            <input
              value={palavraInput}
              onChange={(e) => setPalavraInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPalavra();
                }
              }}
              placeholder="Digite e pressione Enter"
              className="flex-1 rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
            <button
              type="button"
              onClick={addPalavra}
              className="rounded-xl bg-cyan-600 text-white px-3 py-2 text-sm font-bold hover:bg-cyan-700 transition"
            >
              Adicionar
            </button>
          </div>
          {value.palavrasChave.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {value.palavrasChave.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-xs font-semibold text-violet-700"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removerPalavra(p)}
                    className="text-violet-400 hover:text-violet-700"
                  >
                    <XCircle size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Empresas vinculadas */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-1 flex items-center gap-2">
            <Building2 size={14} className="text-cyan-600" />
            Empresas vinculadas
            <span className="ml-auto text-[11px] font-normal text-gray-500">
              {value.empresasVinculadas.length} selecionada(s)
            </span>
          </h3>
          <div className="text-xs text-gray-500 mb-3">
            Selecione as empresas onde essa obrigação se aplica. As tarefas serão geradas para cada uma delas.
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={empresaBusca}
              onChange={(e) => setEmpresaBusca(e.target.value)}
              placeholder="Buscar empresa"
              className="w-full rounded-xl bg-gray-50 pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <div className="rounded-xl border border-gray-200 max-h-56 overflow-y-auto divide-y divide-gray-100">
            {empresasFiltradas.length === 0 ? (
              <div className="p-3 text-center text-xs text-gray-400">Nenhuma empresa encontrada</div>
            ) : (
              empresasFiltradas.map((e) => {
                const sel = value.empresasVinculadas.includes(e.id);
                const nome = e.razao_social || e.apelido || e.codigo;
                return (
                  <label
                    key={e.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleEmpresa(e.id)}
                      className="rounded accent-cyan-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-900 truncate">{nome}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{e.codigo}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </section>

        {/* Descrição */}
        <section>
          <Field label="Observações (opcional)">
            <textarea
              rows={3}
              value={value.descricao ?? ''}
              onChange={(e) => set('descricao', e.target.value)}
              placeholder="Notas internas sobre essa obrigação"
              className="w-full rounded-xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </Field>
        </section>
      </div>

      <div className="border-t border-gray-100 p-4 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-5 py-2 text-sm font-bold hover:from-cyan-700 hover:to-teal-700 shadow-md"
        >
          Salvar obrigação
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-bold text-gray-600 mb-1">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-gray-400">{hint}</div>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`text-left rounded-xl border px-3 py-2.5 transition ${
        checked ? 'border-cyan-300 bg-cyan-50/50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-5 w-9 rounded-full transition ${
            checked ? 'bg-cyan-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow transition ${
              checked ? 'translate-x-4' : ''
            }`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-800">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-500 leading-snug">{subtitle}</div>}
        </div>
      </div>
    </button>
  );
}

function TestadorReconhecimento({ obrigacoes }: { obrigacoes: Obrigacao[] }) {
  const { empresas } = useSistema();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoReconhecimento | null>(null);

  const rodar = () => {
    setResultado(reconhecerGuia(texto, empresas, obrigacoes));
  };

  const limpar = () => {
    setTexto('');
    setResultado(null);
  };

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-violet-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-violet-50/50 transition"
      >
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center shadow-sm">
          <FlaskConical size={18} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-gray-900">Testador de reconhecimento</div>
          <div className="text-xs text-gray-500">
            Cola o texto extraído de uma guia e veja qual obrigação e empresa seriam identificadas.
          </div>
        </div>
        <div className="text-xs font-bold text-violet-600">{aberto ? 'Ocultar' : 'Abrir'}</div>
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3 border-t border-violet-100">
          <div className="pt-3">
            <label className="block text-xs font-bold text-gray-600 mb-1">
              Texto do PDF (cole o conteúdo da guia para testar)
            </label>
            <textarea
              rows={8}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={
                'Cole aqui o texto extraído de uma guia real (por enquanto manualmente).\n' +
                'Inclua coisas como "CNPJ 12.345.678/0001-99", "Vencimento: 20/05/2026", "Competência: 04/2026", palavras-chave da obrigação, etc.'
              }
              className="w-full rounded-xl bg-gray-50 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-violet-400 focus:bg-white transition"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={rodar}
              disabled={!texto.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-2 text-sm font-bold hover:from-violet-700 hover:to-purple-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Wand2 size={14} />
              Rodar reconhecimento
            </button>
            {(texto || resultado) && (
              <button
                type="button"
                onClick={limpar}
                className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Limpar
              </button>
            )}
          </div>

          {resultado && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <ResultadoBloco
                titulo="Empresa identificada"
                icon={<Building2 size={14} className="text-cyan-600" />}
                vazio={resultado.empresa == null ? 'Nenhum CNPJ / razão social bateu com empresas cadastradas.' : null}
              >
                {resultado.empresa && (
                  <>
                    <div className="text-sm font-bold text-gray-900">
                      {resultado.empresa.empresa.razao_social ||
                        resultado.empresa.empresa.apelido ||
                        resultado.empresa.empresa.codigo}
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      {resultado.empresa.empresa.cnpj || resultado.empresa.empresa.codigo}
                    </div>
                    <div className="mt-1 text-[11px] text-cyan-700 font-semibold">
                      Score: {resultado.empresa.score}
                    </div>
                    <ul className="mt-1 text-[11px] text-gray-600 list-disc list-inside">
                      {resultado.empresa.motivos.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                    {resultado.empresasAlternativas.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
                        <div className="font-semibold text-gray-600">Alternativas:</div>
                        {resultado.empresasAlternativas.map((c) => (
                          <div key={c.empresa.id}>
                            {c.empresa.razao_social || c.empresa.apelido || c.empresa.codigo} ·{' '}
                            <span className="text-gray-400">score {c.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </ResultadoBloco>

              <ResultadoBloco
                titulo="Obrigação identificada"
                icon={<FileStack size={14} className="text-violet-600" />}
                vazio={
                  resultado.obrigacao == null
                    ? 'Nenhuma obrigação ativa teve palavras-chave encontradas no texto.'
                    : null
                }
              >
                {resultado.obrigacao && (
                  <>
                    <div className="text-sm font-bold text-gray-900">
                      {resultado.obrigacao.obrigacao.nome}
                    </div>
                    {resultado.obrigacao.obrigacao.codigo && (
                      <div className="text-[11px] text-gray-500 font-mono">
                        {resultado.obrigacao.obrigacao.codigo}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-violet-700 font-semibold">
                      Score: {resultado.obrigacao.score} ·{' '}
                      {resultado.obrigacao.palavrasEncontradas.length}/
                      {resultado.obrigacao.palavrasEncontradas.length +
                        resultado.obrigacao.palavrasFaltando.length}{' '}
                      palavras-chave
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {resultado.obrigacao.palavrasEncontradas.map((p, i) => (
                        <span
                          key={`ok-${i}`}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                        >
                          <CheckCircle size={10} />
                          {p}
                        </span>
                      ))}
                      {resultado.obrigacao.palavrasFaltando.map((p, i) => (
                        <span
                          key={`no-${i}`}
                          className="inline-flex items-center gap-1 rounded-full bg-gray-50 border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500"
                        >
                          <XCircle size={10} />
                          {p}
                        </span>
                      ))}
                    </div>
                    {resultado.obrigacoesAlternativas.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
                        <div className="font-semibold text-gray-600">Alternativas:</div>
                        {resultado.obrigacoesAlternativas.map((c) => (
                          <div key={c.obrigacao.id}>
                            {c.obrigacao.nome} ·{' '}
                            <span className="text-gray-400">score {c.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </ResultadoBloco>

              <ResultadoBloco
                titulo="Vencimento detectado"
                icon={<Clock size={14} className="text-red-600" />}
                vazio={resultado.dados.vencimento ? null : 'Nenhuma data com padrão "Vencimento: dd/mm/aaaa" encontrada.'}
              >
                {resultado.dados.vencimento && (
                  <div className="text-sm font-bold text-gray-900">
                    {formatDateBR(resultado.dados.vencimento)}
                  </div>
                )}
              </ResultadoBloco>

              <ResultadoBloco
                titulo="Competência detectada"
                icon={<Calendar size={14} className="text-amber-600" />}
                vazio={resultado.dados.competencia ? null : 'Nenhuma competência "mm/aaaa" ou "mês/ano" encontrada.'}
              >
                {resultado.dados.competencia && (
                  <div className="text-sm font-bold text-gray-900">
                    {formatCompetencia(resultado.dados.competencia)}
                  </div>
                )}
                {resultado.dados.valor != null && (
                  <div className="mt-1 text-xs text-gray-600">
                    Valor: <strong>R$ {resultado.dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                )}
              </ResultadoBloco>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultadoBloco({
  titulo,
  icon,
  vazio,
  children,
}: {
  titulo: string;
  icon: React.ReactNode;
  vazio: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-gray-700 mb-2">
        {icon}
        {titulo}
      </div>
      {vazio ? (
        <div className="text-xs text-gray-400 italic">{vazio}</div>
      ) : (
        children
      )}
    </div>
  );
}

function formatDateBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function formatCompetencia(comp: string): string {
  const [ano, mes] = comp.split('-');
  if (!ano || !mes) return comp;
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const idx = Number(mes) - 1;
  const nome = nomes[idx] ?? mes;
  return `${nome}/${ano}`;
}
