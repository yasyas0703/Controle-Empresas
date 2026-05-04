'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote, Calendar, ChevronDown, Folder, Loader2, ListChecks, Plus,
  Search, ShieldAlert, User as UserIcon, Users, XCircle, Sparkles,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import {
  DEPARTAMENTO_CONFIG,
  DepartamentoTabs,
} from '@/app/components/DepartamentoPlaceholder';
import { normalizarNomeDepartamento } from '@/app/utils/departamento';
import { sortByPtBr } from '@/lib/sort';
import {
  fetchContasBancarias,
  fetchControleContabilByAno,
  fetchExtratosByEmpresa,
} from '@/lib/db';
import type {
  ContaBancaria,
  ControleContabilExtrato,
  Empresa,
  Tributacao,
  UUID,
  Usuario,
} from '@/app/types';
import { TRIBUTACAO_LABELS, TRIBUTACAO_ORDEM, TRIBUTACAO_SIGLAS } from '@/app/types';

const TAG_ARQUIVADA = 'arquivada';
function isArquivada(empresa: Empresa): boolean {
  return Array.isArray(empresa.tags) && empresa.tags.includes(TAG_ARQUIVADA);
}
import ModalGerenciarBancos from '@/app/components/ModalGerenciarBancos';
import ModalConferenciaCelula from '@/app/components/ModalConferenciaCelula';
import ModalCentralExtratos from '@/app/components/ModalCentralExtratos';

const MESES_NOMES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_NOMES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

type StatusKey = string;

function statusKey(contaId: UUID, mes: string): StatusKey {
  return `${contaId}|${mes}`;
}

function mesIso(ano: number, mes1a12: number): string {
  return `${ano}-${String(mes1a12).padStart(2, '0')}`;
}

function classBadgeTrib(t: Tributacao | null | undefined): string {
  switch (t) {
    case 'lucro_real': return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'lucro_presumido': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'simples_nacional': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

// ─── Badge editável de tributação ─────────────────────────────
function BadgeTributacao({ empresa }: { empresa: Empresa }) {
  const { atualizarEmpresa } = useSistema();
  const [open, setOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function aplicar(novo: Tributacao | null) {
    setSalvando(true);
    try {
      await atualizarEmpresa(empresa.id, { tributacao: novo });
      setOpen(false);
    } finally {
      setSalvando(false);
    }
  }

  const t = empresa.tributacao ?? null;
  const label = t ? TRIBUTACAO_SIGLAS[t] : '?';
  const tooltip = t ? TRIBUTACAO_LABELS[t] : 'Tributação não definida — clique para escolher';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide hover:opacity-80 transition ${classBadgeTrib(t)}`}
        title={tooltip}
      >
        {salvando ? <Loader2 size={10} className="animate-spin" /> : null}
        {label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
          {(Object.keys(TRIBUTACAO_LABELS) as Tributacao[]).map((opt) => (
            <button
              key={opt}
              onClick={(e) => { e.stopPropagation(); aplicar(opt); }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition ${
                t === opt ? 'bg-cyan-50 font-bold text-cyan-700' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <span>{TRIBUTACAO_LABELS[opt]}</span>
              <span className={`text-[10px] font-bold rounded-md border px-1.5 ${classBadgeTrib(opt)}`}>{TRIBUTACAO_SIGLAS[opt]}</span>
            </button>
          ))}
          {t && (
            <button
              onClick={(e) => { e.stopPropagation(); aplicar(null); }}
              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-100"
            >
              Limpar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────
export default function ControleContabilPage() {
  const {
    empresas, departamentos, usuarios, currentUser, currentUserId,
    canAdmin, isPrivileged, authReady, mostrarAlerta,
  } = useSistema();

  const [bancos, setBancos] = useState<ContaBancaria[]>([]);
  const [statusMap, setStatusMap] = useState<Map<StatusKey, ControleContabilExtrato>>(new Map());
  const [extratosCount, setExtratosCount] = useState<Map<StatusKey, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // mostrarAlerta do contexto não é estável; uso ref pra evitar recriar `carregar` a cada render.
  const mostrarAlertaRef = useRef(mostrarAlerta);
  useEffect(() => { mostrarAlertaRef.current = mostrarAlerta; }, [mostrarAlerta]);

  const [ano, setAno] = useState<number>(() => new Date().getFullYear());
  const [search, setSearch] = useState('');
  const [filtroResp, setFiltroResp] = useState('');
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(true);
  const apenasMinhasInitRef = useRef(false);

  const [empresaBancos, setEmpresaBancos] = useState<Empresa | null>(null);
  const [empresaCentral, setEmpresaCentral] = useState<Empresa | null>(null);
  const [celulaAberta, setCelulaAberta] = useState<{ empresa: Empresa; banco: ContaBancaria; mes: string } | null>(null);

  const config = DEPARTAMENTO_CONFIG.contabil;

  const contabilDept = useMemo(
    () => departamentos.find((d) => normalizarNomeDepartamento(d.nome) === 'contabil') ?? null,
    [departamentos]
  );

  const userSlug = useMemo(() => {
    if (!currentUser?.departamentoId) return null;
    const dep = departamentos.find((d) => d.id === currentUser.departamentoId);
    return normalizarNomeDepartamento(dep?.nome);
  }, [currentUser, departamentos]);

  const podeVer = canAdmin || isPrivileged || userSlug === 'contabil';

  const carregar = useCallback(async (anoAlvo: number, opts?: { silencioso?: boolean }) => {
    if (!opts?.silencioso) setLoading(true);
    try {
      const [todasContas, statuses] = await Promise.all([
        fetchContasBancarias(),
        fetchControleContabilByAno(anoAlvo),
      ]);
      setBancos(todasContas);
      const sMap = new Map<StatusKey, ControleContabilExtrato>();
      for (const s of statuses) sMap.set(statusKey(s.contaBancariaId, s.mes), s);
      setStatusMap(sMap);

      const empresasComBanco = new Set(todasContas.map((c) => c.empresaId));
      const counts = new Map<StatusKey, number>();
      const promessas = Array.from(empresasComBanco).map((eid) =>
        fetchExtratosByEmpresa(eid).then((lista) => {
          for (const ex of lista) {
            if (!ex.mes.startsWith(`${anoAlvo}-`)) continue;
            const k = statusKey(ex.contaBancariaId, ex.mes);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }).catch(() => undefined)
      );
      await Promise.all(promessas);
      setExtratosCount(counts);
    } catch (err) {
      console.error(err);
      mostrarAlertaRef.current('Erro', 'Não foi possível carregar o controle contábil.', 'erro');
    } finally {
      if (!opts?.silencioso) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !podeVer) return;
    carregar(ano);
  }, [ano, authReady, podeVer, carregar]);

  useEffect(() => {
    if (apenasMinhasInitRef.current) return;
    if (!authReady) return;
    if (currentUserId && userSlug === 'contabil' && !canAdmin && !isPrivileged) {
      setApenasMinhas(true);
    }
    apenasMinhasInitRef.current = true;
  }, [authReady, currentUserId, userSlug, canAdmin, isPrivileged]);

  // Bancos visíveis no ano selecionado.
  //  - Ano corrente: mostra todos os bancos ativos (workflow normal — bancos
  //    recém-criados aparecem mesmo sem marcação ainda).
  //  - Anos anteriores: só bancos que têm pelo menos uma marcação naquele
  //    ano. Isso garante que import de 2023 não polua a visão de 2024 e
  //    vice-versa — cada ano é isolado pelos próprios statuses.
  const bancosVisiveisIds = useMemo(() => {
    const anoCorrente = new Date().getFullYear();
    if (ano === anoCorrente) {
      const set = new Set<UUID>();
      for (const b of bancos) if (b.ativo) set.add(b.id);
      return set;
    }
    const set = new Set<UUID>();
    for (const s of statusMap.values()) set.add(s.contaBancariaId);
    return set;
  }, [bancos, statusMap, ano]);

  const bancosPorEmpresa = useMemo(() => {
    const map = new Map<UUID, ContaBancaria[]>();
    for (const b of bancos) {
      if (!b.ativo) continue;
      if (!bancosVisiveisIds.has(b.id)) continue; // não tem nada nesse ano
      const list = map.get(b.empresaId) ?? [];
      list.push(b);
      map.set(b.empresaId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    return map;
  }, [bancos, bancosVisiveisIds]);

  const contabilUsers: Usuario[] = useMemo(() => {
    if (!contabilDept) return [];
    const idsResp = new Set<UUID>();
    for (const e of empresas) {
      const uid = e.responsaveis?.[contabilDept.id];
      if (uid) idsResp.add(uid);
    }
    const doDepto = usuarios.filter((u) => u.ativo && u.departamentoId === contabilDept.id);
    const extras = usuarios.filter((u) => u.ativo && idsResp.has(u.id) && u.departamentoId !== contabilDept.id);
    return sortByPtBr([...doDepto, ...extras], (u) => u.nome);
  }, [contabilDept, empresas, usuarios]);

  const getRespContabil = useCallback((empresa: Empresa): UUID | null => {
    if (!contabilDept) return null;
    return empresa.responsaveis?.[contabilDept.id] ?? null;
  }, [contabilDept]);

  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return empresas
      .map((e) => ({
        empresa: e,
        bancos: bancosPorEmpresa.get(e.id) ?? [],
        respId: getRespContabil(e),
      }))
      .filter((l) => {
        // Sem bancos no ano E sem responsável contábil → fica de fora.
        // Empresa recém-cadastrada com responsável contábil aparece mesmo sem banco
        // (a UI mostra "Nenhum banco cadastrado" + botão de adicionar), pra propagar
        // o cadastro pra essa view sem o usuário precisar criar um banco antes.
        if (l.bancos.length === 0 && !l.respId) return false;
        if (!mostrarArquivadas && isArquivada(l.empresa)) return false;
        if (q) {
          const hay = `${l.empresa.codigo} ${l.empresa.razao_social ?? ''} ${l.empresa.apelido ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filtroResp) {
          if (filtroResp === 'sem') {
            if (l.respId) return false;
          } else if (l.respId !== filtroResp) return false;
        }
        if (apenasMinhas && currentUserId) {
          if (l.respId !== currentUserId) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Arquivadas sempre no fim
        const arqA = isArquivada(a.empresa) ? 1 : 0;
        const arqB = isArquivada(b.empresa) ? 1 : 0;
        if (arqA !== arqB) return arqA - arqB;
        const oa = a.empresa.tributacao ? TRIBUTACAO_ORDEM[a.empresa.tributacao] : 99;
        const ob = b.empresa.tributacao ? TRIBUTACAO_ORDEM[b.empresa.tributacao] : 99;
        if (oa !== ob) return oa - ob;
        return (a.empresa.codigo ?? '').localeCompare(b.empresa.codigo ?? '');
      });
  }, [empresas, bancosPorEmpresa, getRespContabil, search, filtroResp, apenasMinhas, currentUserId, mostrarArquivadas]);

  const stats = useMemo(() => {
    let totalCelulas = 0;
    let feitas = 0;
    let pendentes = 0;
    let semMov = 0;
    let totalBancos = 0;
    for (const l of linhas) {
      totalBancos += l.bancos.length;
      for (const b of l.bancos) {
        for (let m = 1; m <= 12; m++) {
          totalCelulas++;
          const k = statusKey(b.id, mesIso(ano, m));
          const s = statusMap.get(k);
          if (s?.status === 'feito') feitas++;
          else if (s?.status === 'recebido_pendente') pendentes++;
          else if (s?.status === 'sem_movimento') semMov++;
        }
      }
    }
    // % conta como "tratado": feito + sem_movimento (ambos foram conferidos)
    const tratadas = feitas + semMov;
    const pct = totalCelulas === 0 ? 0 : Math.round((tratadas / totalCelulas) * 100);
    return { totalCelulas, feitas, pendentes, semMov, totalBancos, pct };
  }, [linhas, statusMap, ano]);

  const hasFilters = !!search || !!filtroResp || apenasMinhas;
  const anosOpcoes = useMemo(() => {
    const atual = new Date().getFullYear();
    // Vai de 2023 até o próximo ano (cobre imports históricos disponíveis).
    const inicio = Math.min(atual - 2, 2023);
    const arr: number[] = [];
    for (let y = inicio; y <= atual + 1; y++) arr.push(y);
    return arr;
  }, []);

  if (!authReady) return null;

  if (!currentUser || !podeVer) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">
            Esta área é exclusiva do departamento Contábil.
          </div>
        </div>
      </div>
    );
  }

  if (!contabilDept) {
    return (
      <div className="space-y-4">
        <DepartamentoTabs tabs={config.tabs} />
        <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
          <ListChecks className="mx-auto mb-4 text-gray-300" size={48} />
          <div className="text-lg font-bold text-gray-700 mb-1">Departamento Contábil não encontrado</div>
          <div className="text-sm text-gray-500">
            Cadastre um departamento chamado &quot;Contábil&quot; (ou &quot;Contabilidade&quot;) para usar este controle.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <DepartamentoTabs tabs={config.tabs} />

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-md shrink-0">
            <ListChecks className="text-white" size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Controle Contábil — Extratos</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Confira extratos por empresa, banco e mês. Anexe o arquivo e marque conforme avança.
            </div>
          </div>
        </div>
      </div>

      {/* Seletor de ano + filtros */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border-2 border-emerald-100 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white rounded-xl px-3 sm:px-4 py-2 shadow-sm">
            <Calendar size={18} className="text-emerald-600 shrink-0" />
            <div>
              <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Ano</div>
              <select
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="text-sm sm:text-base font-bold text-gray-900 bg-transparent focus:outline-none cursor-pointer"
              >
                {anosOpcoes.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            {ano === new Date().getFullYear() && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                <Sparkles size={10} /> ATUAL
              </span>
            )}
          </div>

          <div className="flex-1 min-w-[180px] relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar empresa por código ou nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm">
            <Users size={14} className="text-emerald-600" />
            <select
              value={filtroResp}
              onChange={(e) => setFiltroResp(e.target.value)}
              className="text-sm bg-transparent focus:outline-none cursor-pointer min-w-[140px]"
            >
              <option value="">Todos os responsáveis</option>
              <option value="sem">Sem responsável</option>
              {contabilUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          {currentUserId && (
            <label className="inline-flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={apenasMinhas}
                onChange={(e) => setApenasMinhas(e.target.checked)}
                className="h-4 w-4 accent-emerald-600 cursor-pointer"
              />
              <UserIcon size={14} className="text-emerald-600" />
              <span className="text-xs font-bold text-gray-700">Apenas minhas</span>
            </label>
          )}

          <label className="inline-flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={mostrarArquivadas}
              onChange={(e) => setMostrarArquivadas(e.target.checked)}
              className="h-4 w-4 accent-slate-600 cursor-pointer"
            />
            <span className="text-xs font-bold text-gray-700">Mostrar arquivadas</span>
          </label>

          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFiltroResp(''); setApenasMinhas(false); }}
              className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-gray-800 px-2 py-1"
            >
              <XCircle size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Progresso geral" valor={`${stats.pct}%`} accent="emerald" />
        <StatCard label="Lançados" valor={stats.feitas} accent="emerald" sub={`de ${stats.totalCelulas}`} />
        <StatCard label="Recebidos pendentes" valor={stats.pendentes} accent="orange" />
        <StatCard label="Bancos cadastrados" valor={stats.totalBancos} accent="cyan" sub={`em ${linhas.length} empresa${linhas.length === 1 ? '' : 's'}`} />
      </div>

      {/* Legenda */}
      <div className="rounded-xl bg-white border border-gray-100 px-4 py-2 flex items-center gap-4 flex-wrap text-[11px] text-gray-600">
        <span className="font-bold text-gray-500 uppercase tracking-wider text-[10px]">Legenda:</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded bg-emerald-500" /> Lançado</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded bg-orange-400" /> Recebido (pendente)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-slate-400 bg-slate-50 text-[7px] font-bold text-slate-500 flex items-center justify-center leading-none">S/M</span> Sem movimento</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-gray-300 bg-white" /> Sem marcação</span>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-gray-400 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : linhas.length === 0 ? (
          <div className="py-16 text-center">
            <Banknote size={36} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">
              {hasFilters ? 'Nenhuma empresa encontrada com esses filtros.' : 'Nenhuma empresa cadastrada.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 font-bold text-xs text-gray-700 uppercase tracking-wider min-w-[260px] border-r border-gray-200">
                    Empresa
                  </th>
                  <th className="sticky left-[260px] z-20 bg-gray-50 text-left px-3 py-2 font-bold text-xs text-gray-700 uppercase tracking-wider min-w-[160px] border-r border-gray-200">
                    Banco
                  </th>
                  {MESES_NOMES_CURTOS.map((m, i) => (
                    <th key={m} className="text-center px-2 py-2 font-bold text-[11px] text-gray-700 uppercase tracking-wider min-w-[60px]" title={`${MESES_NOMES_LONGOS[i]} ${ano}`}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <LinhaEmpresa
                    key={linha.empresa.id}
                    linha={linha}
                    ano={ano}
                    statusMap={statusMap}
                    extratosCount={extratosCount}
                    contabilUsers={contabilUsers}
                    onAbrirCelula={(banco, mes) => setCelulaAberta({ empresa: linha.empresa, banco, mes })}
                    onAbrirBancos={() => setEmpresaBancos(linha.empresa)}
                    onAbrirExtratos={() => setEmpresaCentral(linha.empresa)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modais */}
      {empresaBancos && (
        <ModalGerenciarBancos
          isOpen
          onClose={() => setEmpresaBancos(null)}
          empresa={empresaBancos}
          onChange={() => carregar(ano, { silencioso: true })}
        />
      )}

      {empresaCentral && (
        <ModalCentralExtratos
          isOpen
          onClose={() => setEmpresaCentral(null)}
          empresa={empresaCentral}
          onChange={() => carregar(ano, { silencioso: true })}
        />
      )}

      {celulaAberta && (
        <ModalConferenciaCelula
          isOpen
          onClose={() => setCelulaAberta(null)}
          empresa={celulaAberta.empresa}
          banco={celulaAberta.banco}
          mes={celulaAberta.mes}
          mesLabel={`${MESES_NOMES_LONGOS[Number(celulaAberta.mes.split('-')[1]) - 1]} ${celulaAberta.mes.split('-')[0]}`}
          statusAtual={statusMap.get(statusKey(celulaAberta.banco.id, celulaAberta.mes)) ?? null}
          onChange={(novo, count) => {
            const k = statusKey(celulaAberta.banco.id, celulaAberta.mes);
            setStatusMap((prev) => {
              const next = new Map(prev);
              if (novo) next.set(k, novo);
              else next.delete(k);
              return next;
            });
            setExtratosCount((prev) => {
              const next = new Map(prev);
              if (count > 0) next.set(k, count);
              else next.delete(k);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────

function StatCard({ label, valor, sub, accent }: { label: string; valor: string | number; sub?: string; accent: 'emerald' | 'orange' | 'cyan' }) {
  const cor = accent === 'emerald' ? 'text-emerald-700' : accent === 'orange' ? 'text-orange-600' : 'text-cyan-700';
  return (
    <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={`text-xl sm:text-2xl font-black ${cor}`}>{valor}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function LinhaEmpresa({
  linha, ano, statusMap, extratosCount, contabilUsers,
  onAbrirCelula, onAbrirBancos, onAbrirExtratos,
}: {
  linha: { empresa: Empresa; bancos: ContaBancaria[]; respId: UUID | null };
  ano: number;
  statusMap: Map<StatusKey, ControleContabilExtrato>;
  extratosCount: Map<StatusKey, number>;
  contabilUsers: Usuario[];
  onAbrirCelula: (banco: ContaBancaria, mes: string) => void;
  onAbrirBancos: () => void;
  onAbrirExtratos: () => void;
}) {
  const { empresa, bancos, respId } = linha;
  const respNome = respId ? contabilUsers.find((u) => u.id === respId)?.nome : null;
  const rowSpan = Math.max(bancos.length, 1) + 1; // +1 pra linha "+ adicionar banco"

  const arquivada = isArquivada(empresa);
  const empresaCell = (
    <td rowSpan={rowSpan} className={`sticky left-0 z-10 ${arquivada ? 'bg-slate-50' : 'bg-white'} text-left px-3 py-2 align-top border-r border-gray-200 min-w-[260px]`}>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {arquivada ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-200 text-slate-700 px-1.5 py-0.5 text-[10px] font-bold tracking-wide" title="Empresa arquivada (código antigo, importada do histórico)">
              ARQUIVADA
            </span>
          ) : (
            <BadgeTributacao empresa={empresa} />
          )}
          <span className="font-mono text-xs font-bold text-gray-500">{empresa.codigo}</span>
        </div>
        <div className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">
          {empresa.razao_social ?? empresa.apelido ?? <span className="text-gray-400 italic">Sem nome</span>}
        </div>
        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          <UserIcon size={10} />
          <span className="truncate">{respNome ?? <span className="italic text-gray-400">Sem responsável</span>}</span>
        </div>
        {empresa.cliente_desde && (() => {
          const [y, m] = empresa.cliente_desde.split('-');
          if (!y || !m) return null;
          const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
          return (
            <div className="text-[10px] text-violet-700 flex items-center gap-1 font-semibold" title={`Cliente desde ${empresa.cliente_desde}`}>
              <Calendar size={10} />
              <span>Cliente desde {meses[Number(m) - 1] ?? m}/{y}</span>
            </div>
          );
        })()}
        <div className="flex items-center gap-1 pt-1">
          <button
            onClick={onAbrirBancos}
            className="inline-flex items-center gap-1 text-[10px] font-bold rounded-md bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-1.5 py-0.5 transition"
            title="Gerenciar bancos"
          >
            <Banknote size={10} /> Bancos
          </button>
          <button
            onClick={onAbrirExtratos}
            className="inline-flex items-center gap-1 text-[10px] font-bold rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 px-1.5 py-0.5 transition"
            title="Central de extratos"
          >
            <Folder size={10} /> Extratos
          </button>
        </div>
      </div>
    </td>
  );

  if (bancos.length === 0) {
    return (
      <>
        <tr className="border-b border-gray-100 hover:bg-gray-50/50">
          {empresaCell}
          <td className="sticky left-[260px] z-10 bg-white px-3 py-2 text-xs italic text-gray-400 border-r border-gray-200">
            Nenhum banco cadastrado
          </td>
          {Array.from({ length: 12 }).map((_, i) => (
            <td key={i} className="px-2 py-2 text-center">
              <span className="inline-block h-7 w-7 rounded border border-dashed border-gray-200" />
            </td>
          ))}
        </tr>
        <tr className="border-b border-gray-200">
          <td colSpan={13} className="sticky left-[260px] z-10 bg-white px-3 py-1.5 text-left">
            <button
              onClick={onAbrirBancos}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:text-cyan-800 hover:underline"
            >
              <Plus size={12} /> Adicionar banco
            </button>
          </td>
        </tr>
      </>
    );
  }

  return (
    <>
      {bancos.map((banco, idx) => (
        <tr key={banco.id} className={`hover:bg-gray-50/50 ${idx === bancos.length - 1 ? '' : 'border-b border-gray-100'}`}>
          {idx === 0 && empresaCell}
          <td className="sticky left-[260px] z-10 bg-white px-3 py-2 border-r border-gray-200 min-w-[160px]">
            <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Banknote size={12} className="text-cyan-600 shrink-0" />
              <span className="truncate">{banco.nome}</span>
            </div>
            {(banco.agencia || banco.conta) && (
              <div className="text-[10px] text-gray-500 ml-4 font-mono">
                {banco.agencia && <>Ag {banco.agencia}</>}
                {banco.agencia && banco.conta && ' · '}
                {banco.conta && <>Cc {banco.conta}</>}
              </div>
            )}
          </td>
          {Array.from({ length: 12 }).map((_, i) => {
            const mes = mesIso(ano, i + 1);
            const k = statusKey(banco.id, mes);
            const s = statusMap.get(k);
            const count = extratosCount.get(k) ?? 0;
            return (
              <td key={i} className="px-1.5 py-1.5 text-center">
                <CelulaConferencia
                  status={s?.status ?? null}
                  marcadoPorNome={s?.marcadoPorNome}
                  arquivosCount={count}
                  onClick={() => onAbrirCelula(banco, mes)}
                />
              </td>
            );
          })}
        </tr>
      ))}
      <tr className="border-b border-gray-200">
        <td className="sticky left-[260px] z-10 bg-white px-3 py-1.5 text-left border-r border-gray-200" colSpan={13}>
          <button
            onClick={onAbrirBancos}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:text-cyan-800 hover:underline"
          >
            <Plus size={12} /> Adicionar banco
          </button>
        </td>
      </tr>
    </>
  );
}

function CelulaConferencia({
  status, marcadoPorNome, arquivosCount, onClick,
}: {
  status: 'feito' | 'recebido_pendente' | 'sem_movimento' | null;
  marcadoPorNome?: string;
  arquivosCount: number;
  onClick: () => void;
}) {
  let cor: string;
  let conteudo: React.ReactNode = null;

  // Inicial de quem marcou (D, B, A, E, N, V, T, P...)
  const inicial = (marcadoPorNome ?? '').trim().charAt(0).toUpperCase();

  if (status === 'feito') {
    cor = 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600';
    if (inicial) conteudo = <span className="text-[10px] font-black tracking-tight leading-none">{inicial}</span>;
  } else if (status === 'recebido_pendente') {
    cor = 'bg-orange-400 hover:bg-orange-500 text-white border-orange-500';
    if (inicial) conteudo = <span className="text-[10px] font-black tracking-tight leading-none">{inicial}</span>;
  } else if (status === 'sem_movimento') {
    cor = 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-300 border-dashed';
    conteudo = <span className="text-[8px] font-bold tracking-tight">S/M</span>;
  } else {
    cor = 'bg-white hover:bg-gray-100 text-gray-300 border-gray-200';
  }

  const tooltip =
    status === 'feito'
      ? `Lançado${marcadoPorNome ? ' por ' + marcadoPorNome : ''}${arquivosCount > 0 ? ` · ${arquivosCount} extrato${arquivosCount > 1 ? 's' : ''}` : ''}`
      : status === 'recebido_pendente'
        ? `Recebido (pendente)${marcadoPorNome ? ' por ' + marcadoPorNome : ''}`
        : status === 'sem_movimento'
          ? `Sem movimento — conferido${marcadoPorNome ? ' por ' + marcadoPorNome : ''}`
          : 'Sem marcação — clique para marcar';

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`relative h-7 w-7 rounded border transition cursor-pointer flex items-center justify-center ${cor}`}
    >
      {conteudo}
      {arquivosCount > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-3.5 min-w-[14px] px-0.5 rounded-full bg-blue-600 text-white text-[8px] font-bold shadow ring-1 ring-white">
          {arquivosCount > 9 ? '9+' : arquivosCount}
        </span>
      )}
    </button>
  );
}
