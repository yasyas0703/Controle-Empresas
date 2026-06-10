'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import {
  AlertTriangle, ArrowLeft, Building2, Calendar, Check, CheckCircle2, Clock, Eye, ExternalLink, FileText, Loader2,
  MailCheck, MailX, Search, Send, Settings, Shield, ShieldAlert, ToggleLeft, ToggleRight, Upload, X, XCircle,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { garantirVencimentosFiscaisComRegras } from '@/app/utils/vencimentos';
import { extrairTextoPdf } from '@/app/utils/extrairTextoPdf';
import { validarGuia, type ResultadoValidacao } from '@/app/utils/validarGuia';
import { obrigacaoAplicaParaEmpresa, obrigacaoSnAplicaParaEmpresa } from '@/app/utils/regrasVencimentosFiscais';
import {
  enviarAnexoChecklist,
  fetchChecklistFiscalByMes,
  fetchEmpresaEmailsCliente,
  fetchEmpresaObrigacoesConfig,
  fetchObrigacoesAtivasPorEmpresa,
  fetchObrigacoesOverrides,
  getChecklistArquivoSignedUrl,
  registrarEnvioChecklist,
  removerEnvioChecklist,
  setObrigacaoHabilitacao,
  toChecklistItem,
  upsertChecklistFiscal,
  upsertEmpresaObrigacaoConfig,
  uploadChecklistArquivo,
  verificarEntregasChecklist,
} from '@/lib/db';
import StatusPortalCliente from '@/app/vencimentos-fiscais/checklist/StatusPortalCliente';
import { supabase } from '@/lib/supabase';
import { formatBR } from '@/app/utils/date';
import ModalBase from '@/app/components/ModalBase';
import ModalMotivoReenvio from '@/app/components/ModalMotivoReenvio';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';
import type {
  ChecklistFiscalItem, Departamento, Empresa, EmpresaEmailCliente, EmpresaObrigacaoConfig, Tributacao, UUID, VencimentoFiscal,
} from '@/app/types';
import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES } from '@/app/types';

// Lista única de obrigações pra usar no filtro do header (ordem: regime normal + SN sem duplicar)
const TODAS_OBRIGACOES_FILTRO: string[] = [
  ...VENCIMENTOS_FISCAIS_NOMES,
  ...VENCIMENTOS_FISCAIS_SN_NOMES.filter((n) => !(VENCIMENTOS_FISCAIS_NOMES as readonly string[]).includes(n)),
];

// Obrigações que só existem no Simples Nacional — se a empresa tem alguma
// dessas ativa, é SN. Não usa DIFERENCIAL DE ALIQUOTA / ICMS ANTECIPADO
// pois esses também aparecem em regime federal MG.
const OBRIGACOES_SO_SN = new Set([
  'EMISSÃO GUIA DAS', 'RECIBO DAS', 'SINTEGRA', 'DESTDA', 'ST ANTECIPADO',
]);
// Obrigações típicas do regime federal — sinal forte de LR/LP.
const OBRIGACOES_SO_NORMAL = new Set([
  'PIS', 'COFINS', 'IRPJ', 'CSLL', 'REINF', 'SPED CONTRIBUIÇÕES',
  'DARF-SERVIÇOS TOMADOS', 'IPI', 'LIVROS FISCAIS', 'DEMONSTR. APURAÇÃO',
]);

/**
 * Detecta o regime efetivo de uma empresa.
 *   1. Se empresa.tributacao está cadastrada, usa ela (mais confiável).
 *   2. Olha as obrigações ativas da empresa (vindas do import automático).
 *      Se tem DAS/RECIBO/SINTEGRA/DESTDA ativos → SN.
 *      Se tem PIS/COFINS/IRPJ/CSLL/REINF ativos → LP/LR.
 *   3. Senão, infere do departamento responsável (Fiscal-SN vs Fiscal).
 *   4. Default: null (mostra todas).
 */
function regimeEfetivo(
  empresa: Empresa,
  departamentos: Departamento[],
  configs?: EmpresaObrigacaoConfig[],
): Tributacao | null {
  if (empresa.tributacao) return empresa.tributacao;
  if (configs && configs.length > 0) {
    const ativas = configs.filter((c) => c.ativa).map((c) => c.obrigacao);
    const temSn = ativas.some((o) => OBRIGACOES_SO_SN.has(o));
    const temNormal = ativas.some((o) => OBRIGACOES_SO_NORMAL.has(o));
    if (temSn && !temNormal) return 'simples_nacional';
    if (temNormal && !temSn) return 'lucro_presumido';
  }
  const fiscalSn = departamentos.find((d) => /fiscal[\s-]*sn/i.test(d.nome));
  const fiscal = departamentos.find((d) => d.nome.toLowerCase().trim() === 'fiscal');
  const temSnDept = fiscalSn ? !!empresa.responsaveis?.[fiscalSn.id] : false;
  const temNormalDept = fiscal ? !!empresa.responsaveis?.[fiscal.id] : false;
  if (temSnDept && !temNormalDept) return 'simples_nacional';
  if (temNormalDept && !temSnDept) return 'lucro_presumido';
  return null;
}

// Mês padrão = competência (mês ANTERIOR), igual ao Checklist Mensal: em junho,
// o pessoal está fechando/enviando a competência de maio.
function mesPadrao(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(iso: string): string {
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m)]}/${y}`;
}

function formatBRL(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function competenciaOpcoes(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

type StatusEnvio = 'pendente' | 'enviada';

interface ObrigacaoLinha {
  fiscal: VencimentoFiscal;
  status: StatusEnvio;
  checklistItem: ChecklistFiscalItem | null;
  naoEnviaCliente: boolean;
}

interface LinhaSidebar {
  empresa: Empresa;
  total: number;
  pendentes: number;
  enviadas: number;
}

// Row da sidebar virtualizada (react-window v2). Só renderiza ~10 linhas
// visíveis por vez em vez das 290+ — janela rolável de DOM nodes.
function SidebarEmpresaRow({
  index, style, linhas, empresaSelecionadaId, onSelect,
}: RowComponentProps<{
  linhas: LinhaSidebar[];
  empresaSelecionadaId: UUID | null;
  onSelect: (id: UUID) => void;
}>) {
  const { empresa, pendentes, enviadas, total } = linhas[index];
  const ativa = empresaSelecionadaId === empresa.id;
  const tudoFeito = pendentes === 0 && total > 0;
  return (
    <div style={style}>
      <button
        onClick={() => onSelect(empresa.id)}
        className={`w-full h-full text-left px-3.5 py-3 transition flex items-center gap-3 ${
          ativa
            ? 'bg-cyan-50 dark:bg-cyan-950/30 border-l-2 border-cyan-600 dark:border-cyan-400'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 border-l-2 border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-mono ${ativa ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-400 dark:text-slate-500'}`}>
            {empresa.codigo}
          </div>
          <div className={`text-sm font-medium truncate ${ativa ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}`}>
            {empresa.razao_social || empresa.apelido || '(sem nome)'}
          </div>
        </div>
        <div className="shrink-0">
          {total === 0 ? (
            <span className="inline-flex items-center text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/60 rounded-md px-1.5 py-0.5">
              Sem obrigações
            </span>
          ) : tudoFeito ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/60 rounded-md px-1.5 py-0.5">
              <CheckCircle2 size={10} /> {enviadas}/{total}
            </span>
          ) : (
            <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-0.5">
              {enviadas}/{total}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

export default function EnvioGuiasPage() {
  const { empresas, departamentos, currentUser, canManage, isPrivileged, authReady, mostrarAlerta } = useSistema();

  const [mes, setMes] = useState<string>(mesPadrao());
  const [search, setSearch] = useState('');
  const [filtroObrigacao, setFiltroObrigacao] = useState<string>(''); // '' = todas
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'pendentes' | 'enviadas'>('todos');
  const [empresaSelecionadaId, setEmpresaSelecionadaId] = useState<UUID | null>(null);

  const [checklistDoMes, setChecklistDoMes] = useState<ChecklistFiscalItem[]>([]);
  const [carregandoChecklist, setCarregandoChecklist] = useState(false);

  // Mapa: empresaId -> lista de configs (ativa + codigos esperados + motivo) por obrigação
  const [configsPorEmpresa, setConfigsPorEmpresa] = useState<Map<UUID, EmpresaObrigacaoConfig[]>>(new Map());
  // Mapa: empresaId -> conjunto de obrigações ativas. Usado pra contagem correta na sidebar.
  const [obrigacoesAtivasMap, setObrigacoesAtivasMap] = useState<Map<UUID, Set<string>>>(new Map());
  // Mapa: "empresaId|obrigacao" -> habilitada (override manual no Checklist Mensal).
  // Usado pra detectar quando uma obrigação aparece no Envio mas não no Checklist.
  const [obrigacoesOverridesMap, setObrigacoesOverridesMap] = useState<Map<string, boolean>>(new Map());

  const [modalEnvio, setModalEnvio] = useState<{ empresa: Empresa; fiscal: VencimentoFiscal } | null>(null);
  const [modalConfig, setModalConfig] = useState<Empresa | null>(null);
  const [modalDetalhe, setModalDetalhe] = useState<{ empresa: Empresa; linha: ObrigacaoLinha } | null>(null);

  // Departamento fiscal — usado pra filtrar empresas onde o usuário comum é responsável.
  const fiscalDeptIds = useMemo(() => {
    const ids = new Set<UUID>();
    for (const d of departamentos) {
      const n = d.nome.toLowerCase();
      if (n.includes('fiscal')) ids.add(d.id);
    }
    return ids;
  }, [departamentos]);

  // Empresas visíveis. Critérios:
  //  1. Não desligada
  //  2. CNPJ válido (14 dígitos) — esconde CNO/obra/CAEPF
  //  3. TEM responsável fiscal com usuário atribuído
  //  4. Pra usuário comum: ele mesmo é responsável fiscal dela
  //
  //  Mostra TODAS as empresas que passam, mesmo as sem detecção no T: —
  //  essas aparecem com 0/0 e badge "Sem obrigações" pra Yasmin configurar
  //  manualmente. (Antes filtrava as sem obrigações, agora não.)
  const empresasVisiveis = useMemo(() => {
    return empresas.filter((e) => {
      if (e.desligada_em) return false;
      const cnpjDigitos = (e.cnpj ?? '').replace(/\D/g, '');
      if (cnpjDigitos.length !== 14) return false;
      const temRespFiscal = [...fiscalDeptIds].some((d) => !!e.responsaveis?.[d]);
      if (!temRespFiscal) return false;
      if (canManage || isPrivileged) return true;
      if (!currentUser) return false;
      for (const deptId of fiscalDeptIds) {
        if (e.responsaveis?.[deptId] === currentUser.id) return true;
      }
      return false;
    });
  }, [empresas, canManage, isPrivileged, currentUser, fiscalDeptIds]);

  // Recarrega o checklist do mês quando muda o mês ou após envio
  const recarregarChecklist = React.useCallback(() => {
    setCarregandoChecklist(true);
    fetchChecklistFiscalByMes(mes)
      .then((lista) => setChecklistDoMes(lista))
      .catch(() => setChecklistDoMes([]))
      .finally(() => setCarregandoChecklist(false));
  }, [mes]);

  const recarregarOverrides = React.useCallback(() => {
    fetchObrigacoesOverrides()
      .then((lista) => {
        const m = new Map<string, boolean>();
        for (const o of lista) m.set(`${o.empresaId}|${o.obrigacao}`, o.habilitada);
        setObrigacoesOverridesMap(m);
      })
      .catch(() => setObrigacoesOverridesMap(new Map()));
  }, []);

  useEffect(() => {
    if (!authReady) return;
    recarregarChecklist();
    fetchObrigacoesAtivasPorEmpresa()
      .then((m) => setObrigacoesAtivasMap(m))
      .catch(() => setObrigacoesAtivasMap(new Map()));
    recarregarOverrides();
    // Auto-verifica entregas (bounces + aberturas pendentes) sem alerta de
    // UI. Igual ao Checklist Mensal, mantém o histórico atualizado sem
    // exigir clique manual em "Verificar entregas".
    void verificarEntregasChecklist().then((r) => {
      if (r.ok && (r.entregues > 0 || r.bounced > 0)) {
        recarregarChecklist();
      }
    }).catch(() => undefined);
  }, [authReady, mes, recarregarChecklist, recarregarOverrides]);

  // Realtime: quando outra usuária envia/marca uma guia, a linha em
  // checklist_fiscal é atualizada no banco. Em vez de refetch (caro), aplicamos
  // a mudança direto do payload do evento — custo ~zero de banco. Mesmo padrão
  // da aba Checklist Mensal. Filtrado por mês pra só receber o que está na tela.
  useEffect(() => {
    if (!authReady) return;
    const channel = supabase
      .channel(`envio-guias-${mes}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_fiscal', filter: `mes=eq.${mes}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id;
            if (!oldId) return;
            setChecklistDoMes((prev) => prev.filter((it) => it.id !== oldId));
            return;
          }
          const row = payload.new;
          if (!row?.id) return;
          const item = toChecklistItem(row);
          setChecklistDoMes((prev) => {
            const idx = prev.findIndex((it) => it.empresaId === item.empresaId && it.obrigacao === item.obrigacao);
            if (idx === -1) return [...prev, item];
            const next = prev.slice();
            next[idx] = item;
            return next;
          });
        },
      )
      .subscribe();

    // Realtime é fire-and-forget: se o WebSocket cair (notebook dormiu, troca de
    // rede, Wi-Fi caiu), os eventos perdidos NÃO voltam sozinhos. Ao reativar a
    // aba, refaz o fetch pra reconciliar o que escapou — assim o "não precisa dar
    // F5" continua valendo mesmo depois de a máquina ter dormido.
    const onVisible = () => {
      if (document.visibilityState === 'visible') recarregarChecklist();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authReady, mes, recarregarChecklist]);

  // Mapa: "empresaId|obrigacao" -> ChecklistFiscalItem
  const checklistMap = useMemo(() => {
    const m = new Map<string, ChecklistFiscalItem>();
    for (const it of checklistDoMes) {
      m.set(`${it.empresaId}|${it.obrigacao}`, it);
    }
    return m;
  }, [checklistDoMes]);

  // Linhas: empresas filtradas pela busca + obrigação + status + contagem
  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = empresasVisiveis
      .filter((e) => {
        // Busca textual
        if (q) {
          const hay = `${e.codigo} ${e.razao_social ?? ''} ${e.apelido ?? ''} ${e.cnpj ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        // Filtro por obrigação — empresa precisa ter essa obrigação ATIVA
        if (filtroObrigacao) {
          const ativas = obrigacoesAtivasMap.get(e.id);
          if (!ativas || !ativas.has(filtroObrigacao)) return false;
        }
        return true;
      })
      .map((empresa) => {
        const ativasSet = obrigacoesAtivasMap.get(empresa.id) ?? new Set<string>();
        let pendentes = 0;
        let enviadas = 0;
        // Quando filtra por obrigação, conta SÓ aquela obrigação específica
        const obrigacoesParaContar = filtroObrigacao
          ? new Set([filtroObrigacao])
          : ativasSet;
        for (const nome of obrigacoesParaContar) {
          if (filtroObrigacao && !ativasSet.has(nome)) continue;
          const it = checklistMap.get(`${empresa.id}|${nome}`);
          if (it?.concluido) enviadas++;
          else pendentes++;
        }
        return { empresa, total: obrigacoesParaContar.size, pendentes, enviadas };
      })
      .filter((row) => {
        // Filtro de status — só aplica se total > 0 (não filtra empresas "sem obrigações")
        if (filtroStatus === 'pendentes') return row.pendentes > 0;
        if (filtroStatus === 'enviadas') return row.total > 0 && row.pendentes === 0;
        return true;
      })
      .sort((a, b) => {
        // Ordem alfabética por nome (razão social), acento-insensível.
        const na = (a.empresa.razao_social || a.empresa.apelido || '').trim();
        const nb = (b.empresa.razao_social || b.empresa.apelido || '').trim();
        return na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
      });
    return out;
  }, [empresasVisiveis, search, checklistMap, obrigacoesAtivasMap, filtroObrigacao, filtroStatus]);

  const empresaSelecionada = useMemo(() => {
    if (!empresaSelecionadaId) return null;
    return empresasVisiveis.find((e) => e.id === empresaSelecionadaId) ?? null;
  }, [empresasVisiveis, empresaSelecionadaId]);

  // Cache TTL: configsPorEmpresa raramente muda durante a sessão. Antes,
  // clicar na MESMA empresa de novo refetchava — agora cacheia por 5 min.
  // Force=true invalida e busca de novo (usado após salvar config).
  const configsCacheRef = React.useRef<Map<UUID, number>>(new Map());
  const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
  const carregarConfigEmpresa = React.useCallback((empresaId: UUID, force = false) => {
    const expiraEm = configsCacheRef.current.get(empresaId);
    if (!force && expiraEm && expiraEm > Date.now()) return;
    fetchEmpresaObrigacoesConfig(empresaId)
      .then((lista) => {
        configsCacheRef.current.set(empresaId, Date.now() + CONFIG_CACHE_TTL_MS);
        setConfigsPorEmpresa((prev) => {
          const next = new Map(prev);
          next.set(empresaId, lista);
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!empresaSelecionada) return;
    carregarConfigEmpresa(empresaSelecionada.id);
  }, [empresaSelecionada, carregarConfigEmpresa]);

  function configDeObrigacao(empresaId: UUID, obrigacao: string): EmpresaObrigacaoConfig | null {
    const lista = configsPorEmpresa.get(empresaId);
    if (!lista) return null;
    return lista.find((c) => c.obrigacao === obrigacao) ?? null;
  }

  // Obrigações da empresa selecionada para o mês escolhido.
  // Estratégia: se a empresa TEM configs no banco (foi processada), mostra
  // SÓ as ativas (bate com a contagem da sidebar). Se NÃO tem nenhuma config,
  // mostra todas as do regime — fallback pra empresas novas ainda não
  // processadas pelo script de descoberta.
  const obrigacoesEmpresa: ObrigacaoLinha[] = useMemo(() => {
    if (!empresaSelecionada) return [];
    const fiscais = garantirVencimentosFiscaisComRegras(
      empresaSelecionada.vencimentosFiscais,
      empresaSelecionada.estado,
      empresaSelecionada.cidade,
      undefined,
      regimeEfetivo(empresaSelecionada, departamentos, configsPorEmpresa.get(empresaSelecionada.id)),
    );
    const configs = configsPorEmpresa.get(empresaSelecionada.id) ?? [];
    const configPorNome = new Map(configs.map((c) => [c.obrigacao, c]));
    const ativasSet = new Set(configs.filter((c) => c.ativa).map((c) => c.obrigacao));
    const temAlgumaConfig = configs.length > 0;
    return fiscais
      .filter((f) => (temAlgumaConfig ? ativasSet.has(f.nome) : true))
      .filter((f) => (filtroObrigacao ? f.nome === filtroObrigacao : true))
      .map((fiscal) => {
        const it = checklistMap.get(`${empresaSelecionada.id}|${fiscal.nome}`);
        const status: StatusEnvio = it?.concluido ? 'enviada' : 'pendente';
        const cfg = configPorNome.get(fiscal.nome);
        return { fiscal, status, checklistItem: it ?? null, naoEnviaCliente: cfg?.naoEnviaCliente ?? false };
      })
      .filter((row) => {
        if (filtroStatus === 'pendentes') return row.status === 'pendente';
        if (filtroStatus === 'enviadas') return row.status === 'enviada';
        return true;
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'pendente' ? -1 : 1;
        return a.fiscal.nome.localeCompare(b.fiscal.nome);
      });
  }, [empresaSelecionada, checklistMap, configsPorEmpresa, departamentos, filtroObrigacao, filtroStatus]);

  if (!authReady) return null;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <FiscalTabs />

      {/* Header */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <Send size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">Envio de Guias</div>
            <div className="text-xs sm:text-sm text-[var(--text-2)]">
              Selecione a empresa, escolha a guia e envie. O sistema valida o PDF antes do envio e marca como feito automaticamente no checklist.
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 p-3 sm:p-4 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, código, CNPJ..."
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 pl-10 pr-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 focus:bg-white dark:focus:bg-slate-900 outline-none transition"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            <input
              type="month"
              value={mes}
              onChange={(e) => { if (e.target.value) setMes(e.target.value); }}
              aria-label="Competência da guia"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 pl-10 pr-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 border border-transparent focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 focus:bg-white dark:focus:bg-slate-900 outline-none transition [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>
          <select
            value={filtroObrigacao}
            onChange={(e) => setFiltroObrigacao(e.target.value)}
            aria-label="Filtrar por obrigação"
            className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 border border-transparent focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 focus:bg-white dark:focus:bg-slate-900 outline-none transition"
          >
            <option value="">Todas as obrigações</option>
            {TODAS_OBRIGACOES_FILTRO.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as 'todos' | 'pendentes' | 'enviadas')}
            aria-label="Filtrar por status"
            className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 border border-transparent focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 focus:bg-white dark:focus:bg-slate-900 outline-none transition"
          >
            <option value="todos">Todos status</option>
            <option value="pendentes">Só pendentes</option>
            <option value="enviadas">Só com tudo enviado</option>
          </select>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div>Competência: <strong className="text-slate-700 dark:text-slate-200">{formatComp(mes)}</strong></div>
          <div>
            {carregandoChecklist ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="animate-spin" size={12} /> carregando…</span>
            ) : (
              <>{linhas.length} empresa{linhas.length === 1 ? '' : 's'}</>
            )}
          </div>
        </div>
      </div>

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3 sm:gap-4">
        {/* Lista de empresas */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={12} /> Empresas <span className="text-slate-400 dark:text-slate-500">({linhas.length})</span>
          </div>
          <div className="overflow-y-auto">
            {linhas.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                <Shield className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={28} />
                {empresasVisiveis.length === 0
                  ? 'Você não é responsável fiscal por nenhuma empresa.'
                  : 'Nenhuma empresa encontrada com esses filtros.'}
              </div>
            ) : (
              <List
                rowComponent={SidebarEmpresaRow}
                rowCount={linhas.length}
                rowHeight={64}
                rowProps={{
                  linhas,
                  empresaSelecionadaId,
                  onSelect: setEmpresaSelecionadaId,
                }}
                style={{ height: '100%' }}
                className="divide-y divide-slate-100 dark:divide-slate-800"
              />
            )}
          </div>
        </div>

        {/* Painel direito: obrigações da empresa selecionada */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          {!empresaSelecionada ? (
            <div className="p-12 text-center">
              <ArrowLeft className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={32} />
              <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1">Selecione uma empresa</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">As obrigações fiscais do mês aparecerão aqui.</div>
            </div>
          ) : (
            <>
              {/* Header da empresa selecionada */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {empresaSelecionada.razao_social || empresaSelecionada.apelido || '(sem nome)'}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="font-mono">{empresaSelecionada.codigo}</span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span>{empresaSelecionada.cnpj ?? 'sem CNPJ'}</span>
                      {empresaSelecionada.estado && (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span>{empresaSelecionada.estado}</span>
                        </>
                      )}
                      {(() => {
                        const r = regimeEfetivo(empresaSelecionada, departamentos, configsPorEmpresa.get(empresaSelecionada.id));
                        if (!r) return null;
                        const label = r === 'simples_nacional' ? 'Simples Nacional' : r === 'lucro_real' ? 'Lucro Real' : 'Lucro Presumido';
                        return (
                          <>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="font-medium text-cyan-600 dark:text-cyan-400">{label}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {(canManage || isPrivileged) && (
                    <button
                      onClick={() => setModalConfig(empresaSelecionada)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-400 transition shrink-0"
                    >
                      <Settings size={13} /> Configurar
                    </button>
                  )}
                </div>
              </div>

              {/* Grid de obrigações */}
              {obrigacoesEmpresa.length === 0 ? (
                <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  Esta empresa não tem obrigações fiscais ativas para este mês.
                </div>
              ) : (
                <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {obrigacoesEmpresa.map((linha) => (
                    <CardObrigacao
                      key={linha.fiscal.id}
                      linha={linha}
                      preview={configDeObrigacao(empresaSelecionada.id, linha.fiscal.nome)}
                      onAcao={() => setModalEnvio({ empresa: empresaSelecionada, fiscal: linha.fiscal })}
                      onDetalhes={() => setModalDetalhe({ empresa: empresaSelecionada, linha })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {modalEnvio && (() => {
        const e = modalEnvio.empresa;
        const obrigacao = modalEnvio.fiscal.nome;
        // Determina se a obrigação aparece no Checklist Mensal pra essa empresa.
        // Lógica idêntica ao Checklist: override manual sobrescreve, senão usa regra.
        const overrideKey = `${e.id}|${obrigacao}`;
        const override = obrigacoesOverridesMap.get(overrideKey);
        const regime = regimeEfetivo(e, departamentos, configsPorEmpresa.get(e.id));
        const aplicaNoChecklist = typeof override === 'boolean'
          ? override
          : regime === 'simples_nacional'
            ? obrigacaoSnAplicaParaEmpresa(obrigacao, e.estado, e.cidade)
            : obrigacaoAplicaParaEmpresa(obrigacao, e.estado, e.cidade);
        return (
          <ModalEnviarGuia
            empresa={e}
            fiscal={modalEnvio.fiscal}
            mes={mes}
            codigosEsperados={configDeObrigacao(e.id, obrigacao)?.codigos ?? []}
            naoEnviaCliente={configDeObrigacao(e.id, obrigacao)?.naoEnviaCliente ?? false}
            podeForcar={canManage || isPrivileged}
            currentUserNome={currentUser?.nome ?? null}
            aplicaNoChecklist={aplicaNoChecklist}
            onHabilitarNoChecklist={async () => {
              await setObrigacaoHabilitacao({
                empresaId: e.id,
                obrigacao,
                habilitada: true,
                porId: currentUser?.id ?? null,
                porNome: currentUser?.nome ?? null,
              });
              recarregarOverrides();
            }}
            onClose={() => setModalEnvio(null)}
            onEnviado={() => {
              setModalEnvio(null);
              recarregarChecklist();
              mostrarAlerta('Guia enviada', 'Email enviado e checklist marcado como feito.', 'sucesso');
            }}
            onErro={(msg) => mostrarAlerta('Erro', msg, 'erro')}
          />
        );
      })()}

      {modalConfig && (
        <ModalConfigurarObrigacoes
          empresa={modalConfig}
          departamentos={departamentos}
          currentUserId={currentUser?.id ?? null}
          currentUserNome={currentUser?.nome ?? null}
          onClose={() => setModalConfig(null)}
          onSalvo={() => {
            carregarConfigEmpresa(modalConfig.id, /* force */ true);
            setModalConfig(null);
            mostrarAlerta('Configuração salva', 'As obrigações desta empresa foram atualizadas.', 'sucesso');
          }}
          onErro={(msg) => mostrarAlerta('Erro', msg, 'erro')}
        />
      )}

      {modalDetalhe && (
        <ModalDetalheObrigacao
          empresa={modalDetalhe.empresa}
          linha={modalDetalhe.linha}
          mes={mes}
          currentUserEmail={currentUser?.email ?? null}
          onClose={() => setModalDetalhe(null)}
          onEnviar={() => {
            const e = modalDetalhe.empresa;
            const f = modalDetalhe.linha.fiscal;
            setModalDetalhe(null);
            setModalEnvio({ empresa: e, fiscal: f });
          }}
          onErro={(msg) => mostrarAlerta('Erro', msg, 'erro')}
          onInfo={(titulo, msg) => mostrarAlerta(titulo, msg, 'sucesso')}
          onAviso={(titulo, msg) => mostrarAlerta(titulo, msg, 'aviso')}
          onRecarregar={recarregarChecklist}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Preview do PDF exemplo — nome + trecho do texto, expansível ao clicar
// ──────────────────────────────────────────────────────────────────────────

function PreviewExemplo({ arquivo, trecho }: { arquivo: string | null; trecho: string | null }) {
  const [expandido, setExpandido] = useState(false);
  const temTrecho = !!trecho && trecho.length > 0;
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-2.5">
      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
        <FileText size={10} /> Exemplo no servidor T:
      </div>
      <div className="text-[12px] font-mono text-slate-800 dark:text-slate-100 break-all">
        {arquivo}
      </div>
      {temTrecho && (
        <>
          <div className={`mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 italic leading-relaxed border-t border-slate-200 dark:border-slate-700 pt-1.5 ${
            expandido ? '' : 'line-clamp-2'
          }`}>
            "{trecho}"
          </div>
          <button
            onClick={() => setExpandido((v) => !v)}
            className="mt-1 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300"
          >
            {expandido ? 'Mostrar menos' : 'Mostrar trecho completo'}
          </button>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Card de obrigação — bloquinho na grid de obrigações da empresa
// ──────────────────────────────────────────────────────────────────────────

interface CardObrigacaoProps {
  linha: ObrigacaoLinha;
  preview: EmpresaObrigacaoConfig | null;
  onAcao: () => void;
  onDetalhes: () => void;
}

function CardObrigacao({ linha, preview, onAcao, onDetalhes }: CardObrigacaoProps) {
  const { fiscal, status, checklistItem, naoEnviaCliente } = linha;
  const enviada = status === 'enviada';
  const codigos = preview?.codigos ?? [];

  // Estilos por estado (3 estados: enviada, interna pendente, normal pendente)
  const stateStyles = enviada
    ? {
        cardBorder: 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/60 dark:bg-emerald-950/20',
        badgeBg: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
        icon: <CheckCircle2 size={14} />,
      }
    : naoEnviaCliente
    ? {
        cardBorder: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
        badgeBg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        icon: <FileText size={14} />,
      }
    : {
        cardBorder: 'border-slate-200 bg-white hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-cyan-500',
        badgeBg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
        icon: <FileText size={14} />,
      };

  return (
    <div
      className={`rounded-xl border ${stateStyles.cardBorder} p-3.5 transition flex flex-col cursor-pointer hover:shadow-md`}
      onClick={onDetalhes}
    >
      {/* Linha 1: badge de status + nome */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${stateStyles.badgeBg}`}>
              {stateStyles.icon}
              {enviada ? 'Enviada' : naoEnviaCliente ? 'Interna' : 'Pendente'}
            </span>
          </div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={fiscal.nome}>
            {fiscal.nome}
          </div>
        </div>
      </div>

      {/* Linha 2: metadados */}
      <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 mb-2.5">
        {fiscal.vencimento && (
          <div className="flex items-center gap-1.5">
            <Calendar size={11} className="text-slate-400 dark:text-slate-500" />
            <span>vence <strong className="text-slate-700 dark:text-slate-200">{formatBR(fiscal.vencimento)}</strong></span>
          </div>
        )}
        {codigos.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px]">cod</span>
            <span className="font-mono text-[10px] text-slate-700 dark:text-slate-200">{codigos.join(', ')}</span>
          </div>
        )}
        {enviada && checklistItem?.concluidoEm && (
          <div className="text-emerald-700 dark:text-emerald-400 font-medium">
            {naoEnviaCliente ? 'feita' : 'enviada'} em {formatBR(checklistItem.concluidoEm.split('T')[0])}
            {checklistItem.concluidoPorNome ? ` · ${checklistItem.concluidoPorNome}` : ''}
          </div>
        )}
      </div>

      {/* Preview do exemplo */}
      {preview?.exemploArquivo && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 px-2 py-1.5 mb-2.5">
          <div className="text-[9px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">
            <FileText size={9} /> Exemplo de guia
          </div>
          <div className="text-[11px] font-mono text-slate-700 dark:text-slate-200 break-all" title={preview.exemploArquivo}>
            {preview.exemploArquivo}
          </div>
        </div>
      )}

      {/* Ação */}
      <button
        onClick={(e) => { e.stopPropagation(); onAcao(); }}
        className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          enviada
            ? 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            : naoEnviaCliente
            ? 'bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800 dark:hover:bg-slate-600'
            : 'bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-500 dark:hover:bg-cyan-400'
        }`}
      >
        {enviada ? (
          <><Upload size={12} /> Reenviar</>
        ) : naoEnviaCliente ? (
          <><CheckCircle2 size={12} /> Marcar feito</>
        ) : (
          <><Send size={12} /> Enviar guia</>
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de detalhe: histórico de envios + status portal + visualizar PDF
// ──────────────────────────────────────────────────────────────────────────

interface ModalDetalheProps {
  empresa: Empresa;
  linha: ObrigacaoLinha;
  mes: string;
  currentUserEmail: string | null;
  onClose: () => void;
  onEnviar: () => void;
  onErro: (msg: string) => void;
  onInfo: (titulo: string, msg: string) => void;
  onAviso: (titulo: string, msg: string) => void;
  onRecarregar: () => void | Promise<void>;
}

function ModalDetalheObrigacao({
  empresa, linha, mes, currentUserEmail, onClose, onEnviar, onErro, onInfo, onAviso, onRecarregar,
}: ModalDetalheProps) {
  const { fiscal, status, checklistItem, naoEnviaCliente } = linha;
  const enviada = status === 'enviada';
  const [abrindo, setAbrindo] = useState(false);
  const [verificandoEntregas, setVerificandoEntregas] = useState(false);

  const podeApagarHistoricoEnvios = (currentUserEmail ?? '').toLowerCase() === 'admin@triarcontabilidade.com.br';

  async function verificarEntregas() {
    if (verificandoEntregas) return;
    setVerificandoEntregas(true);
    try {
      const r = await verificarEntregasChecklist();
      if (!r.ok) {
        if (r.reconexaoNecessaria) {
          onAviso('Reconectar Gmail', r.mensagem);
        } else {
          onErro(r.mensagem);
        }
        return;
      }
      await onRecarregar();
      if (r.verificados === 0) {
        onInfo('Tudo em dia', 'Nenhum envio pendente para verificar.');
      } else {
        const partes: string[] = [];
        if (r.entregues > 0) partes.push(`${r.entregues} entregue(s)`);
        if (r.bounced > 0) partes.push(`${r.bounced} não entregue(s)`);
        if (partes.length === 0) partes.push('aguardando confirmação');
        onInfo('Verificação concluída', `${r.verificados} envio(s) verificados — ${partes.join(', ')}.`);
      }
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setVerificandoEntregas(false);
    }
  }

  async function apagarEnvio(envioId: UUID) {
    if (!podeApagarHistoricoEnvios) return;
    const ok = window.confirm('Apagar este envio do histórico? Esta ação não pode ser desfeita.');
    if (!ok) return;
    try {
      await removerEnvioChecklist(empresa.id, mes, fiscal.nome, envioId);
      await onRecarregar();
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Erro inesperado');
    }
  }

  async function abrirPdfArmazenado() {
    if (!checklistItem?.arquivoUrl) return;
    setAbrindo(true);
    try {
      const url = await getChecklistArquivoSignedUrl(checklistItem.arquivoUrl);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao abrir arquivo.';
      onErro(msg);
    } finally {
      setAbrindo(false);
    }
  }

  // Abre PDF de uma versão específica do histórico (arquivoStoragePath do evento).
  async function abrirPdfHistorico(storagePath: string) {
    try {
      const url = await getChecklistArquivoSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Falha ao abrir arquivo.');
    }
  }

  const envios = checklistItem?.enviosHistorico ?? [];

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="max-w-3xl">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              Detalhes da obrigação
            </div>
            <div className="text-lg font-semibold truncate flex items-center gap-2">
              {fiscal.nome}
              {naoEnviaCliente && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-slate-700 text-slate-200 rounded px-1.5 py-0.5">
                  Interna
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 truncate mt-0.5">
              {empresa.razao_social || empresa.apelido} · <span className="font-mono">{empresa.cnpj}</span> · {formatComp(mes)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
            aria-label="Fechar"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-4">
          {/* Status atual */}
          <div className={`rounded-lg border p-3 ${
            enviada
              ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30'
              : 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              {enviada ? (
                <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={16} />
              ) : (
                <AlertTriangle className="text-amber-600 dark:text-amber-400" size={16} />
              )}
              <span className={`text-sm font-semibold ${
                enviada ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'
              }`}>
                {enviada ? (naoEnviaCliente ? 'Concluída' : 'Enviada ao cliente') : 'Pendente'}
              </span>
            </div>
            {enviada && checklistItem?.concluidoEm && (
              <div className="text-xs text-emerald-700 dark:text-emerald-300">
                {naoEnviaCliente ? 'Feita' : 'Enviada'} em {formatBR(checklistItem.concluidoEm.split('T')[0])}
                {checklistItem.concluidoPorNome ? ` por ${checklistItem.concluidoPorNome}` : ''}
              </div>
            )}
            {!enviada && fiscal.vencimento && (
              <div className="text-xs text-amber-700 dark:text-amber-300">
                Vence em {formatBR(fiscal.vencimento)}
              </div>
            )}
          </div>

          {/* Arquivo armazenado */}
          {checklistItem?.arquivoUrl && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3">
              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText size={11} /> Arquivo armazenado
              </div>
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                <div className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 truncate" title={checklistItem.arquivoNome ?? ''}>
                  {checklistItem.arquivoNome || 'arquivo.pdf'}
                </div>
                <button
                  onClick={abrirPdfArmazenado}
                  disabled={abrindo}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white transition disabled:opacity-50 shrink-0"
                >
                  {abrindo ? <Loader2 className="animate-spin" size={12} /> : <ExternalLink size={12} />}
                  Visualizar
                </button>
              </div>
            </div>
          )}

          {/* Status no portal do cliente */}
          {!naoEnviaCliente && checklistItem?.id && (
            <StatusPortalCliente checklistId={checklistItem.id} />
          )}

          {/* Histórico de envios por email (sucesso / falha + entrega) */}
          {envios.length > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-2">
                <Send size={12} className="text-emerald-600 dark:text-emerald-400" />
                Histórico de envios
                <span className="rounded-full bg-emerald-200 dark:bg-emerald-800/60 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 dark:text-emerald-200">
                  {envios.length}
                </span>
                <button
                  onClick={() => void verificarEntregas()}
                  disabled={verificandoEntregas}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                  title="Consulta a inbox Gmail procurando bounces e atualiza o status de entrega"
                >
                  {verificandoEntregas ? <Loader2 size={10} className="animate-spin" /> : <MailCheck size={10} />}
                  {verificandoEntregas ? 'Verificando…' : 'Verificar entregas'}
                </button>
              </div>
              <ol className="space-y-1.5">
                {envios.map((ev) => {
                  let cor = ev.sucesso
                    ? { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/60', txt: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' }
                    : { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/60', txt: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' };
                  if (ev.sucesso && ev.entregaStatus === 'bounced') {
                    cor = { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/60', txt: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' };
                  }
                  const dataFmt = ev.enviadoEm
                    ? new Date(ev.enviadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '';
                  return (
                    <li key={ev.id} className={`relative rounded-lg border ${cor.border} ${cor.bg} px-2.5 py-1.5`}>
                      {podeApagarHistoricoEnvios && (
                        <button
                          type="button"
                          onClick={() => void apagarEnvio(ev.id)}
                          className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-red-500 hover:text-white hover:border-red-500 shadow-sm transition"
                          title="Apagar este envio do histórico"
                          aria-label="Apagar envio"
                        >
                          <X size={11} strokeWidth={3} />
                        </button>
                      )}
                      <div className="flex items-start gap-2">
                        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${cor.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${cor.txt}`}>
                              {ev.sucesso ? (
                                <><MailCheck size={11} /> Enviado</>
                              ) : (
                                <><MailX size={11} /> Falhou</>
                              )}
                            </span>
                            {ev.sucesso && (
                              <>
                                {ev.entregaStatus === 'bounced' ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                                    <MailX size={9} /> Não entregue
                                  </span>
                                ) : (ev.aberturas ?? 0) > 0 ? (
                                  <>
                                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                                      <Check size={9} strokeWidth={3} /> Entregue
                                    </span>
                                    <span
                                      className="inline-flex items-center gap-0.5 rounded-full bg-sky-500 px-1.5 py-0.5 text-[9px] font-bold text-white"
                                      title={`Email aberto ${ev.aberturas}× — última vez em ${ev.abertoEmUltimo ? new Date(ev.abertoEmUltimo).toLocaleString('pt-BR') : '?'}. Atenção: alguns clientes (Apple Mail) pré-carregam imagens automaticamente, então pode haver falso positivo.`}
                                    >
                                      <Eye size={9} /> Visualizado{(ev.aberturas ?? 0) > 1 ? ` (${ev.aberturas}×)` : ''}
                                    </span>
                                  </>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300"
                                    title="Email enviado. Status muda para Entregue + Visualizado quando o destinatário abrir o email."
                                  >
                                    <Clock size={9} /> Enviado
                                  </span>
                                )}
                              </>
                            )}
                            <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{dataFmt}</span>
                          </div>
                          {ev.enviadoPorNome && (
                            <div className="text-[10px] text-slate-600 dark:text-slate-300">
                              por <span className="font-semibold">{ev.enviadoPorNome}</span>
                              {ev.remetenteEmail && (
                                <span className="text-slate-400 dark:text-slate-500"> · {ev.remetenteEmail}</span>
                              )}
                            </div>
                          )}
                          {ev.destinatarios.length > 0 && (
                            <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate" title={ev.destinatarios.join(', ')}>
                              para <span className="font-medium">{ev.destinatarios.join(', ')}</span>
                            </div>
                          )}
                          {ev.motivoReenvio && (
                            <div className="mt-1 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-1.5 py-1 text-[10px] text-amber-800 dark:text-amber-200">
                              <span className="font-semibold">Motivo do reenvio:</span> {ev.motivoReenvio}
                            </div>
                          )}
                          {ev.arquivoStoragePath && (
                            <button
                              type="button"
                              onClick={() => void abrirPdfHistorico(ev.arquivoStoragePath!)}
                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300"
                            >
                              <ExternalLink size={9} /> Ver PDF desta versão
                            </button>
                          )}
                          {ev.erro && (
                            <div className="mt-1 rounded bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 px-1.5 py-1 text-[10px] text-red-700 dark:text-red-300">
                              {ev.erro}
                            </div>
                          )}
                          {ev.entregaStatus === 'bounced' && (ev.bounceMotivo || (ev.bounceDestinatarios?.length ?? 0) > 0) && (
                            <div className="mt-1 rounded bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 px-1.5 py-1 text-[10px] text-red-700 dark:text-red-300">
                              {ev.bounceMotivo && <div className="font-semibold">{ev.bounceMotivo}</div>}
                              {(ev.bounceDestinatarios?.length ?? 0) > 0 && (
                                <div>Endereços com falha: {ev.bounceDestinatarios?.join(', ')}</div>
                              )}
                            </div>
                          )}
                          {ev.entregaVerificadaEm && (
                            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                              Verificado em {new Date(ev.entregaVerificadaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                          {(ev.aberturas ?? 0) > 0 && ev.abertoEmUltimo && (
                            <div className="text-[9px] text-sky-600 dark:text-sky-400 mt-0.5">
                              Aberto em {new Date(ev.abertoEmUltimo).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              {ev.abertoEm && ev.abertoEm !== ev.abertoEmUltimo && (
                                <span className="text-slate-400 dark:text-slate-500"> · 1ª: {new Date(ev.abertoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Empty state quando não tem nada */}
          {!checklistItem?.arquivoUrl && envios.length === 0 && (
            <div className="rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhum arquivo enviado ainda para esta competência.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            Fechar
          </button>
          <button
            onClick={onEnviar}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              naoEnviaCliente
                ? 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600'
                : 'bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-500 dark:hover:bg-cyan-400'
            }`}
          >
            {enviada ? (
              <><Upload size={14} /> {naoEnviaCliente ? 'Substituir arquivo' : 'Reenviar'}</>
            ) : naoEnviaCliente ? (
              <><CheckCircle2 size={14} /> Marcar feito</>
            ) : (
              <><Send size={14} /> Enviar guia</>
            )}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de envio: upload + validação + preview + envio
// ──────────────────────────────────────────────────────────────────────────

interface ModalEnviarGuiaProps {
  empresa: Empresa;
  fiscal: VencimentoFiscal;
  mes: string;
  codigosEsperados: string[];
  naoEnviaCliente: boolean;
  podeForcar: boolean;
  currentUserNome: string | null;
  aplicaNoChecklist: boolean;
  onHabilitarNoChecklist: () => Promise<void>;
  onClose: () => void;
  onEnviado: () => void;
  onErro: (msg: string) => void;
}

const OBRIGACOES_MULTI_UPLOAD = new Set(['LIVROS FISCAIS']);

// Os 5 livros que precisam ser enviados pra concluir LIVROS FISCAIS.
// Cada arquivo é classificado pelo CONTEÚDO do PDF (não pelo nome) pra
// impedir duplicado e garantir que todos os tipos estão presentes.
const LIVROS_FISCAIS_TIPOS = [
  { id: 'entrada', label: 'Livro de Entrada' },
  { id: 'saida', label: 'Livro de Saída' },
  { id: 'icms', label: 'ICMS Normal (M)' },
  { id: 'ipi', label: 'IPI (M)' },
  { id: 'iss', label: 'ISS (M)' },
] as const;
type TipoLivroFiscal = (typeof LIVROS_FISCAIS_TIPOS)[number]['id'];

/**
 * Classifica um livro fiscal pelo conteúdo do PDF. O pdfjs retorna texto com
 * espaços entre caracteres ("r e g i s t r o"), então removemos todos os
 * espaços antes de procurar os marcadores. Ordem importa: entrada/saída antes
 * de ICMS porque o livro de entrada também menciona "entradas".
 */
function classificarLivroFiscal(textoPdf: string): TipoLivroFiscal | null {
  const sem = textoPdf
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
  if (sem.includes('livroregistrodeentradas') || sem.includes('dadeentradaespecieserie')) return 'entrada';
  if (sem.includes('livroregistrodesaidas') || sem.includes('registrodesaidas')) return 'saida';
  if (sem.includes('registrodeapuracaodoipi')) return 'ipi';
  if (sem.includes('registrodenotasfiscaiseservicosprestados')) return 'iss';
  if (sem.includes('entradasicms') || sem.includes('icms-valoresfiscais')) return 'icms';
  return null;
}

function ModalEnviarGuia({
  empresa, fiscal, mes, codigosEsperados, naoEnviaCliente, podeForcar, currentUserNome,
  aplicaNoChecklist: aplicaNoChecklistInicial, onHabilitarNoChecklist,
  onClose, onEnviado, onErro,
}: ModalEnviarGuiaProps) {
  const isMulti = OBRIGACOES_MULTI_UPLOAD.has(fiscal.nome);
  // Cópia local que vira true quando a usuária clica "Habilitar agora".
  const [aplicaNoChecklist, setAplicaNoChecklist] = useState(aplicaNoChecklistInicial);
  const [habilitando, setHabilitando] = useState(false);

  async function habilitarNoChecklist() {
    if (habilitando) return;
    setHabilitando(true);
    try {
      await onHabilitarNoChecklist();
      setAplicaNoChecklist(true);
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Falha ao habilitar no checklist.');
    } finally {
      setHabilitando(false);
    }
  }

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arquivosMulti, setArquivosMulti] = useState<Array<{
    file: File;
    tipo: TipoLivroFiscal | null;
    analisando: boolean;
  }>>([]);
  const [analisando, setAnalisando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoValidacao | null>(null);
  const [emails, setEmails] = useState<EmpresaEmailCliente[]>([]);
  const [carregandoEmails, setCarregandoEmails] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [motivoForcar, setMotivoForcar] = useState('');
  // Estado do modal de reenvio (quando há envio anterior — HTTP 409 da API).
  // Usa resolver pattern: enviar() aguarda promise; modal chama resolver no
  // confirm/cancel pra continuar o fluxo.
  const [modalReenvio, setModalReenvio] = useState<{
    enviadoEm: string | null;
    enviadoPorNome: string | null;
    destinatarios: string[];
    resolver: (motivo: string | null) => void;
  } | null>(null);

  function pedirMotivoReenvio(meta: { enviadoEm?: unknown; enviadoPorNome?: unknown; destinatarios?: unknown }): Promise<string | null> {
    return new Promise((resolve) => {
      setModalReenvio({
        enviadoEm: typeof meta.enviadoEm === 'string' ? meta.enviadoEm : null,
        enviadoPorNome: typeof meta.enviadoPorNome === 'string' ? meta.enviadoPorNome : null,
        destinatarios: Array.isArray(meta.destinatarios) ? (meta.destinatarios as string[]) : [],
        resolver: resolve,
      });
    });
  }

  useEffect(() => {
    if (naoEnviaCliente) {
      setCarregandoEmails(false);
      setEmails([]);
      return;
    }
    setCarregandoEmails(true);
    fetchEmpresaEmailsCliente(empresa.id)
      .then((lista) => setEmails(lista.filter((e) => e.ativo)))
      .catch(() => setEmails([]))
      .finally(() => setCarregandoEmails(false));
  }, [empresa.id, naoEnviaCliente]);

  async function analisar(file: File) {
    setAnalisando(true);
    setResultado(null);
    try {
      const { texto } = await extrairTextoPdf(file);
      const r = validarGuia(texto, empresa, fiscal.nome, codigosEsperados);
      setResultado(r);
    } catch (err) {
      console.error('[ModalEnviarGuia] falha ao extrair texto:', err);
      onErro('Não foi possível ler este PDF. Pode ser uma imagem scanneada ou um PDF protegido.');
    } finally {
      setAnalisando(false);
    }
  }

  function escolherArquivo(f: File) {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      onErro('Por enquanto só aceitamos PDF.');
      return;
    }
    setArquivo(f);
    setMotivoForcar('');
    void analisar(f);
  }

  const bloqueios = resultado?.problemas.filter((p) => p.severidade === 'bloqueio') ?? [];
  const avisos = resultado?.problemas.filter((p) => p.severidade === 'aviso') ?? [];
  const valido = resultado?.valido ?? false;
  const precisaForcar = !valido && bloqueios.length > 0;

  // ─── Validação multi (LIVROS FISCAIS) ──────────────────────────────────
  // Conta cada tipo detectado; bloqueia envio se faltam tipos, há duplicados
  // ou algum arquivo não foi reconhecido.
  const contagemPorTipo = new Map<TipoLivroFiscal, number>();
  for (const a of arquivosMulti) {
    if (a.tipo) contagemPorTipo.set(a.tipo, (contagemPorTipo.get(a.tipo) ?? 0) + 1);
  }
  const tiposFaltando = LIVROS_FISCAIS_TIPOS.filter((t) => !contagemPorTipo.has(t.id));
  const tiposDuplicados = LIVROS_FISCAIS_TIPOS.filter((t) => (contagemPorTipo.get(t.id) ?? 0) > 1);
  const naoReconhecidos = arquivosMulti.filter((a) => !a.analisando && a.tipo === null);
  const algumAnalisando = arquivosMulti.some((a) => a.analisando);
  const multiOk =
    arquivosMulti.length === LIVROS_FISCAIS_TIPOS.length &&
    tiposFaltando.length === 0 &&
    tiposDuplicados.length === 0 &&
    naoReconhecidos.length === 0 &&
    !algumAnalisando;

  const podeEnviar = aplicaNoChecklist && (isMulti
    ? multiOk && emails.length > 0 && !enviando
    : !!arquivo &&
      !!resultado &&
      (naoEnviaCliente || emails.length > 0) &&
      !enviando &&
      !analisando &&
      (valido || (precisaForcar && podeForcar && motivoForcar.trim().length >= 10)));

  async function enviarMulti() {
    if (!multiOk) {
      onErro('Anexe os 5 livros fiscais (Entrada, Saída, ICMS, IPI, ISS) sem duplicar nenhum.');
      return;
    }
    setEnviando(true);
    try {
      // 1. Upload de TODOS os arquivos no storage em PARALELO (Promise.all).
      // Antes era sequencial — 5 PDFs em fila levavam ~10s. Paralelo corta
      // pela metade. Supabase Storage suporta uploads concorrentes sem rate
      // limit pra esse volume baixo.
      const obrSlug = fiscal.nome.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'obrigacao';

      // Valida tamanho ANTES de subir (falha rápido sem desperdiçar uploads)
      for (const a of arquivosMulti) {
        if (a.file.size > 10 * 1024 * 1024) {
          throw new Error(`Arquivo ${a.file.name} excede 10MB.`);
        }
      }

      const arquivosUpload = await Promise.all(arquivosMulti.map(async (a) => {
        const f = a.file;
        const ext = f.name.split('.').pop()?.toLowerCase() ?? 'pdf';
        const path = `empresas/${empresa.id}/checklist/${mes}/${obrSlug}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('documentos').upload(path, f, { upsert: false });
        if (upErr) throw new Error(`Falha no upload de ${f.name}: ${upErr.message}`);
        return { path, nome: f.name };
      }));

      // 2. Pega/cria checklist_id (chama uploadChecklistArquivo só pra criar a linha
      //    com o PRIMEIRO arquivo registrado — pra envios_historico funcionar)
      const primeiro = arquivosMulti[0].file;
      const { item } = await uploadChecklistArquivo(
        empresa.id, mes, fiscal.nome, primeiro,
        { autorId: null, autorNome: currentUserNome ?? undefined },
      );
      const checklistId = item.id;

      // 3. Chama API multi (com retry em caso de envio duplicado)
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error('Sessão expirada.');
      const chamarMultiApi = async (confirmarReenvio: boolean) => {
        return fetch('/api/checklist-fiscal/enviar-multiplos-anexos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            empresaId: empresa.id, mes, obrigacao: fiscal.nome,
            checklistId, arquivos: arquivosUpload,
            codigosEsperados,
            confirmarReenvio,
          }),
        });
      };
      let resp = await chamarMultiApi(false);
      let motivoReenvio: string | null = null;
      if (resp.status === 409) {
        const erro = await resp.json().catch(() => ({}));
        motivoReenvio = await pedirMotivoReenvio(erro?.meta ?? {});
        if (!motivoReenvio) {
          onErro('Envio cancelado.');
          return;
        }
        resp = await chamarMultiApi(true);
      }
      if (!resp.ok) {
        const erro = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(erro.error || `Falha (HTTP ${resp.status})`);
      }
      const env = await resp.json() as {
        enviadoPara: string[]; de: string; enviadoEm: string;
        gmailMessageId?: string; gmailThreadId?: string;
        envioId?: string;
      };

      // 4. Registra evento usando o envioId retornado (essencial pra o pixel
      //    de tracking de abertura conseguir achar e marcar como aberto).
      // arquivoStoragePath aponta pro PRIMEIRO arquivo do batch (suficiente
      // pra UI mostrar "esta versão"; os outros 4 ficam acessíveis via
      // portal_documentos com mesmo checklist_id).
      await registrarEnvioChecklist({
        empresaId: empresa.id, mes, obrigacao: fiscal.nome,
        evento: {
          id: env.envioId,
          enviadoEm: env.enviadoEm,
          enviadoPorNome: currentUserNome ?? undefined,
          remetenteEmail: env.de,
          destinatarios: env.enviadoPara,
          arquivoNome: `${arquivosMulti.length} arquivos: ${arquivosMulti.map((a) => a.file.name).join(', ')}`,
          arquivoStoragePath: arquivosUpload[0]?.path,
          motivoReenvio: motivoReenvio ?? undefined,
          sucesso: true,
          gmailMessageId: env.gmailMessageId,
          gmailThreadId: env.gmailThreadId,
          entregaStatus: 'pendente',
        },
        marcarComoFeito: true,
        autor: { autorId: null, autorNome: currentUserNome ?? undefined },
      });
      onEnviado();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado no envio.';
      onErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  async function enviar() {
    if (isMulti) { await enviarMulti(); return; }
    if (!arquivo || !resultado) return;
    setEnviando(true);
    try {
      // 1. Upload do arquivo no storage + cria/atualiza checklist_fiscal
      const { arquivoUrl, item } = await uploadChecklistArquivo(
        empresa.id, mes, fiscal.nome, arquivo,
        { autorId: null, autorNome: currentUserNome ?? undefined },
      );
      const checklistId = item.id;

      const obsForcar = precisaForcar
        ? `[ENVIO FORÇADO por ${currentUserNome ?? 'admin'}] ${motivoForcar.trim()}`
        : undefined;

      // 2. Interna: só marca feito e termina (sem Gmail/portal)
      if (naoEnviaCliente) {
        await upsertChecklistFiscal({
          empresaId: empresa.id, mes, obrigacao: fiscal.nome,
          status: 'feito',
          concluidoPorNome: currentUserNome ?? undefined,
          observacao: obsForcar ?? '[INTERNA] arquivo armazenado para controle do escritório',
        });
        onEnviado();
        return;
      }

      // 3. Chama a API de envio (mesma usada pelo Checklist Mensal).
      // Se houver envio anterior com sucesso, o servidor retorna 409 com
      // code='duplicado' — perguntamos motivo via modal e reenviamos.
      let motivoReenvio: string | null = null;
      let env = await enviarAnexoChecklist({
        empresaId: empresa.id,
        mes,
        obrigacao: fiscal.nome,
        arquivoPath: arquivoUrl,
        arquivoNome: arquivo.name,
        checklistId,
        codigosEsperados,
        forcarEnvio: precisaForcar,
        motivoForcar: precisaForcar ? motivoForcar.trim() : undefined,
      });
      if (!env.ok && env.code === 'duplicado') {
        motivoReenvio = await pedirMotivoReenvio(env.meta ?? {});
        if (!motivoReenvio) {
          onErro('Envio cancelado.');
          return;
        }
        env = await enviarAnexoChecklist({
          empresaId: empresa.id,
          mes,
          obrigacao: fiscal.nome,
          arquivoPath: arquivoUrl,
          arquivoNome: arquivo.name,
          checklistId,
          codigosEsperados,
          forcarEnvio: precisaForcar,
          motivoForcar: precisaForcar ? motivoForcar.trim() : undefined,
          confirmarReenvio: true,
          motivoReenvio,
        });
      }

      // 4. Registra o evento em envios_historico com o ENVIOID retornado.
      //    Isso é o que faltava: sem isso, o pixel de tracking nunca acha o
      //    evento e o "email aberto" nunca aparece. Marca também como feito.
      await registrarEnvioChecklist({
        empresaId: empresa.id,
        mes,
        obrigacao: fiscal.nome,
        evento: {
          id: env.ok ? env.envioId : undefined,
          enviadoEm: env.ok ? env.enviadoEm : new Date().toISOString(),
          enviadoPorNome: currentUserNome ?? undefined,
          remetenteEmail: env.ok ? env.de : undefined,
          destinatarios: env.ok ? env.enviadoPara : [],
          arquivoNome: arquivo.name,
          // Path no Storage — preserva versão pra ver depois no histórico.
          arquivoStoragePath: arquivoUrl,
          motivoReenvio: motivoReenvio ?? undefined,
          sucesso: env.ok,
          erro: env.ok ? undefined : env.mensagem,
          gmailMessageId: env.ok ? env.gmailMessageId : undefined,
          gmailThreadId: env.ok ? env.gmailThreadId : undefined,
          entregaStatus: env.ok ? 'pendente' : undefined,
        },
        marcarComoFeito: env.ok,
        autor: { autorId: null, autorNome: currentUserNome ?? undefined },
      });

      if (!env.ok) {
        onErro(`Anexo salvo, mas falhou ao enviar: ${env.mensagem}`);
        return;
      }
      // Se precisava forçar, adiciona observação extra
      if (obsForcar) {
        await upsertChecklistFiscal({
          empresaId: empresa.id, mes, obrigacao: fiscal.nome,
          status: 'feito',
          concluidoPorNome: currentUserNome ?? undefined,
          observacao: obsForcar,
        });
      }
      onEnviado();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado no envio.';
      onErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  const competenciaDivergente =
    resultado?.detectado.competencia && resultado.detectado.competencia !== mes;

  return (
    <ModalBase isOpen={true} onClose={enviando ? () => undefined : onClose} dialogClassName="max-w-2xl">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              {naoEnviaCliente ? 'Marcar feito (interna)' : 'Enviar guia ao cliente'}
            </div>
            <div className="text-lg font-semibold truncate">{fiscal.nome}</div>
            <div className="text-xs text-slate-300 truncate mt-0.5">
              {empresa.razao_social || empresa.apelido} · <span className="font-mono">{empresa.cnpj}</span> · {formatComp(mes)}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50 shrink-0"
            aria-label="Fechar"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Aviso bloqueador: obrigação não habilitada no Checklist Mensal */}
          {!aplicaNoChecklist && (
            <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-amber-900 dark:text-amber-100">
                    Obrigação não habilitada no Checklist Mensal
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                    <strong>{fiscal.nome}</strong> não aparece no controle mensal dessa empresa. Se enviar agora, a guia
                    vai pro cliente mas <em>não</em> fica registrada como concluída no checklist. Habilite primeiro pra
                    manter tudo sincronizado.
                  </div>
                </div>
              </div>
              <button
                onClick={() => void habilitarNoChecklist()}
                disabled={habilitando}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 text-white text-sm font-semibold px-3 py-2 transition disabled:opacity-60"
              >
                {habilitando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {habilitando ? 'Habilitando…' : 'Habilitar agora no Checklist Mensal'}
              </button>
            </div>
          )}
          {naoEnviaCliente ? (
            <div className="rounded-lg bg-slate-100 border border-slate-300 p-3 text-xs text-slate-700">
              <strong>Obrigação interna do escritório.</strong> O arquivo será apenas armazenado para controle (não envia email ao cliente).
            </div>
          ) : carregandoEmails ? (
            <div className="text-xs text-gray-500 flex items-center gap-1.5">
              <Loader2 className="animate-spin" size={12} /> Carregando emails…
            </div>
          ) : emails.length === 0 ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              <strong>Empresa sem emails cadastrados.</strong> Cadastre pelo menos um email do cliente em Empresas antes de enviar.
            </div>
          ) : (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
              <strong>Destinatários:</strong> {emails.map((e) => e.email).join(', ')}
            </div>
          )}

          {/* Upload — modo MULTI (LIVROS FISCAIS) */}
          {isMulti ? (
            <div className="space-y-2">
              {/* Checklist visual dos 5 tipos esperados */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3">
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Os 5 livros (validação pelo conteúdo do PDF)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {LIVROS_FISCAIS_TIPOS.map((t) => {
                    const qtd = contagemPorTipo.get(t.id) ?? 0;
                    const ok = qtd === 1;
                    const dup = qtd > 1;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                          dup
                            ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
                            : ok
                            ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                            : 'bg-slate-100 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {dup ? <AlertTriangle size={12} /> : ok ? <CheckCircle2 size={12} /> : <X size={12} />}
                        <span className="font-medium">{t.label}</span>
                        {dup && <span className="ml-auto text-[10px] font-bold">{qtd}× duplicado</span>}
                      </div>
                    );
                  })}
                </div>
                {naoReconhecidos.length > 0 && (
                  <div className="mt-2 text-[11px] text-red-700 dark:text-red-300 flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    {naoReconhecidos.length} arquivo(s) com layout não reconhecido — remova antes de enviar.
                  </div>
                )}
              </div>

              <label className="block rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition">
                <Upload className="mx-auto mb-2 text-slate-400 dark:text-slate-500" size={28} />
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {arquivosMulti.length === 0 ? 'Selecionar os PDFs dos livros' : 'Adicionar mais arquivos'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  São 5 arquivos: Entrada, Saída, ICMS, IPI, ISS. O Créd. Pres. vai em DEMONSTR. APURAÇÃO.
                </div>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const novos = Array.from(e.target.files ?? []).filter((f) =>
                      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
                    );
                    if (novos.length === 0) { e.target.value = ''; return; }
                    const entradas = novos.map((file) => ({ file, tipo: null as TipoLivroFiscal | null, analisando: true }));
                    setArquivosMulti((prev) => [...prev, ...entradas]);
                    // Classifica cada novo arquivo extraindo texto do PDF
                    for (const f of novos) {
                      extrairTextoPdf(f)
                        .then(({ texto }) => {
                          const tipo = classificarLivroFiscal(texto);
                          setArquivosMulti((prev) =>
                            prev.map((a) => (a.file === f ? { ...a, tipo, analisando: false } : a)),
                          );
                        })
                        .catch(() => {
                          setArquivosMulti((prev) =>
                            prev.map((a) => (a.file === f ? { ...a, tipo: null, analisando: false } : a)),
                          );
                        });
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              {arquivosMulti.length > 0 && (
                <ul className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {arquivosMulti.map((a, idx) => {
                    const f = a.file;
                    const tipoLabel = a.tipo ? LIVROS_FISCAIS_TIPOS.find((t) => t.id === a.tipo)?.label : null;
                    const duplicado = a.tipo && (contagemPorTipo.get(a.tipo) ?? 0) > 1;
                    return (
                      <li key={idx} className="px-3 py-2 flex items-center gap-3">
                        <FileText className="text-cyan-600 dark:text-cyan-400 shrink-0" size={16} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{f.name}</div>
                          <div className="text-[10px] mt-0.5 flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                            {a.analisando ? (
                              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                                <Loader2 size={9} className="animate-spin" /> analisando layout…
                              </span>
                            ) : a.tipo ? (
                              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-bold ${
                                duplicado
                                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
                                  : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
                              }`}>
                                {duplicado ? <AlertTriangle size={9} /> : <Check size={9} strokeWidth={3} />}
                                {tipoLabel}{duplicado ? ' (duplicado)' : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 font-bold">
                                <X size={9} strokeWidth={3} /> layout não reconhecido
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setArquivosMulti((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={enviando}
                          className="text-xs text-slate-500 hover:text-red-600 font-medium"
                        >
                          Remover
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : !arquivo ? (
            <label className="block rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-8 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition">
              <Upload className="mx-auto mb-2 text-slate-400 dark:text-slate-500" size={32} />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Escolher PDF da guia</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Clique para selecionar o arquivo</div>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) escolherArquivo(f);
                  e.target.value = '';
                }}
              />
            </label>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 flex items-center gap-3">
              <FileText className="text-cyan-600 dark:text-cyan-400 shrink-0" size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{arquivo.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {(arquivo.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                onClick={() => { setArquivo(null); setResultado(null); setMotivoForcar(''); }}
                disabled={enviando}
                className="text-xs text-slate-500 hover:text-red-600 font-medium"
              >
                Trocar
              </button>
            </div>
          )}

          {/* Análise */}
          {analisando && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600 flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Analisando PDF…
            </div>
          )}

          {/* Bloqueios */}
          {resultado && bloqueios.length > 0 && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-800 font-bold">
                <ShieldAlert size={20} className="text-red-600" />
                <span className="text-base">Esta guia não confere</span>
              </div>
              <ul className="space-y-2 text-sm text-red-900">
                {bloqueios.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-red-600 font-bold">•</span>
                    <div>
                      <strong>{p.motivo}.</strong> {p.detalhe}
                    </div>
                  </li>
                ))}
              </ul>
              {podeForcar ? (
                <div className="mt-3 border-t border-red-200 pt-3">
                  <div className="text-xs font-bold text-red-900 mb-1">Forçar envio (admin/gerente)</div>
                  <p className="text-[11px] text-red-700 mb-2">
                    Se você tem certeza que a guia está correta, descreva o motivo (mínimo 10 caracteres). Isto fica registrado no log.
                  </p>
                  <textarea
                    value={motivoForcar}
                    onChange={(e) => setMotivoForcar(e.target.value)}
                    placeholder="Ex: PDF foi reemitido sem o CNPJ no cabeçalho, mas é da empresa correta — conferi manualmente."
                    className="w-full text-xs rounded-lg border border-red-300 bg-white p-2 focus:ring-2 focus:ring-red-400 outline-none"
                    rows={2}
                  />
                </div>
              ) : (
                <div className="mt-3 text-xs text-red-700 italic border-t border-red-200 pt-3">
                  Só gerente ou admin pode forçar o envio neste caso. Suba o PDF correto ou peça a um responsável.
                </div>
              )}
            </div>
          )}

          {/* Avisos */}
          {resultado && avisos.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                <AlertTriangle size={16} />
                Avisos
              </div>
              <ul className="space-y-1 text-xs text-amber-900">
                {avisos.map((p, i) => (
                  <li key={i}>
                    <strong>{p.motivo}.</strong> {p.detalhe}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview detectado */}
          {resultado && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5 text-xs">
              <div className="font-bold text-gray-700 mb-1">Detectado no PDF:</div>
              <div className="grid grid-cols-2 gap-2">
                <PreviewLine label="Perfil" valor={resultado.perfilUsado ?? '(sem perfil)'} />
                <PreviewLine label="CNPJ" valor={resultado.detectado.cnpjEncontrado ? formatarCnpj(resultado.detectado.cnpjEncontrado) : null} bom={!!resultado.detectado.cnpjEncontrado} />
                <PreviewLine label="Denominação" valor={resultado.detectado.denominacaoEncontrada} bom={!!resultado.detectado.denominacaoEncontrada} />
                <PreviewLine label="Código receita" valor={resultado.detectado.codigoReceitaEncontrado} />
                <PreviewLine label="Cidade" valor={resultado.detectado.cidadeEncontrada} />
                <PreviewLine
                  label="Competência"
                  valor={resultado.detectado.competencia ? formatComp(resultado.detectado.competencia) : null}
                  alerta={competenciaDivergente
                    ? `mês selecionado (${formatComp(mes)}) é diferente do detectado no PDF`
                    : undefined}
                />
                <PreviewLine label="Vencimento" valor={resultado.detectado.vencimento ? formatBR(resultado.detectado.vencimento) : null} />
                <PreviewLine label="Valor" valor={resultado.detectado.valor != null ? formatBRL(resultado.detectado.valor) : null} />
              </div>
            </div>
          )}

          {/* Sucesso */}
          {resultado && valido && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span><strong>Guia validada.</strong> Tudo confere — pode enviar.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={!podeEnviar}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${
              precisaForcar ? 'bg-red-600 hover:bg-red-700'
              : naoEnviaCliente ? 'bg-slate-900 hover:bg-slate-800'
              : 'bg-cyan-600 hover:bg-cyan-700'
            }`}
          >
            {enviando ? (
              <><Loader2 className="animate-spin" size={14} /> {naoEnviaCliente ? 'Salvando…' : 'Enviando…'}</>
            ) : isMulti ? (
              <><Send size={14} /> Enviar {arquivosMulti.length} arquivo{arquivosMulti.length === 1 ? '' : 's'}</>
            ) : precisaForcar ? (
              <><ShieldAlert size={14} /> {naoEnviaCliente ? 'Forçar marcação' : 'Forçar envio'}</>
            ) : naoEnviaCliente ? (
              <><CheckCircle2 size={14} /> Marcar feito</>
            ) : (
              <><Send size={14} /> Enviar e marcar feito</>
            )}
          </button>
        </div>
      </div>

      {/* Modal de motivo de reenvio (HTTP 409 do servidor) */}
      {modalReenvio && (
        <ModalMotivoReenvio
          isOpen={true}
          enviadoEm={modalReenvio.enviadoEm}
          enviadoPorNome={modalReenvio.enviadoPorNome}
          destinatariosAnteriores={modalReenvio.destinatarios}
          onClose={() => { modalReenvio.resolver(null); setModalReenvio(null); }}
          onConfirmar={(m) => { modalReenvio.resolver(m); setModalReenvio(null); }}
        />
      )}
    </ModalBase>
  );
}

function PreviewLine({
  label, valor, bom, alerta,
}: { label: string; valor: string | null; bom?: boolean; alerta?: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xs font-semibold truncate ${
        alerta ? 'text-amber-700' : bom === false ? 'text-red-600' : valor ? 'text-gray-900' : 'text-gray-400'
      }`}>
        {valor || '—'}
      </div>
      {alerta && <div className="text-[10px] text-amber-600 italic">{alerta}</div>}
    </div>
  );
}

function formatarCnpj(s: string): string {
  if (s.length !== 14) return s;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de configuração: ativa/desativa obrigações por empresa
// ──────────────────────────────────────────────────────────────────────────

interface ModalConfigurarObrigacoesProps {
  empresa: Empresa;
  departamentos: Departamento[];
  currentUserId: UUID | null;
  currentUserNome: string | null;
  onClose: () => void;
  onSalvo: () => void;
  onErro: (msg: string) => void;
}

interface PendingState { ativa: boolean; motivo: string; codigos: string[]; naoEnviaCliente: boolean }
interface PreviewInfo { arquivo: string | null; trecho: string | null }

function ModalConfigurarObrigacoes({
  empresa, departamentos, currentUserId, currentUserNome, onClose, onSalvo, onErro,
}: ModalConfigurarObrigacoesProps) {
  const [configs, setConfigs] = useState<EmpresaObrigacaoConfig[]>([]);
  const [pendentes, setPendentes] = useState<Map<string, PendingState>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Obrigações relevantes ao regime tributário da empresa.
  // Detecta o regime via empresa.tributacao OU configs ativas OU departamento responsável.
  const obrigacoesDisponiveis = useMemo(() => {
    return garantirVencimentosFiscaisComRegras(empresa.vencimentosFiscais, empresa.estado, empresa.cidade, undefined, regimeEfetivo(empresa, departamentos, configs))
      .map((f) => f.nome);
  }, [empresa, departamentos, configs]);

  useEffect(() => {
    setCarregando(true);
    fetchEmpresaObrigacoesConfig(empresa.id)
      .then((lista) => setConfigs(lista))
      .catch(() => setConfigs([]))
      .finally(() => setCarregando(false));
  }, [empresa.id]);

  function estadoAtual(obrigacao: string): PendingState {
    const pendente = pendentes.get(obrigacao);
    if (pendente) return pendente;
    const config = configs.find((c) => c.obrigacao === obrigacao);
    return {
      ativa: config ? config.ativa : true,
      motivo: config?.motivo ?? '',
      codigos: config?.codigos ?? [],
      naoEnviaCliente: config?.naoEnviaCliente ?? false,
    };
  }

  function previewDe(obrigacao: string): PreviewInfo {
    const config = configs.find((c) => c.obrigacao === obrigacao);
    return { arquivo: config?.exemploArquivo ?? null, trecho: config?.exemploTrecho ?? null };
  }

  function atualizarPendente(obrigacao: string, patch: Partial<PendingState>) {
    const atual = estadoAtual(obrigacao);
    setPendentes((prev) => {
      const next = new Map(prev);
      next.set(obrigacao, { ...atual, ...patch });
      return next;
    });
  }

  async function salvar() {
    if (pendentes.size === 0) {
      onClose();
      return;
    }
    setSalvando(true);
    try {
      for (const [obrigacao, estado] of pendentes) {
        await upsertEmpresaObrigacaoConfig({
          empresaId: empresa.id,
          obrigacao,
          ativa: estado.ativa,
          motivo: estado.motivo,
          codigos: estado.codigos,
          naoEnviaCliente: estado.naoEnviaCliente,
          currentUserId,
          currentUserNome: currentUserNome ?? undefined,
        });
      }
      onSalvo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar configuração.';
      onErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  const totalAtivas = obrigacoesDisponiveis.filter((o) => estadoAtual(o).ativa).length;
  const totalDesativadas = obrigacoesDisponiveis.length - totalAtivas;

  return (
    <ModalBase isOpen={true} onClose={salvando ? () => undefined : onClose} dialogClassName="max-w-3xl">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Configurar obrigações</div>
            <div className="text-lg font-semibold truncate">{empresa.razao_social || empresa.apelido}</div>
            <div className="text-xs text-slate-300 flex items-center gap-2 mt-0.5">
              <span className="font-mono">{empresa.codigo}</span>
              <span className="text-slate-500">·</span>
              <span>{totalAtivas} ativa{totalAtivas === 1 ? '' : 's'}</span>
              <span className="text-slate-500">·</span>
              <span>{totalDesativadas} desativada{totalDesativadas === 1 ? '' : 's'}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={salvando}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/60 p-3 text-xs text-cyan-900 dark:text-cyan-200 mb-4 leading-relaxed">
            <strong>Como funciona:</strong> desligue as obrigações que esta empresa NÃO tem.
            Obrigações desligadas somem da aba <em>Envio de Guias</em>. Códigos de receita servem para o validador rejeitar PDFs errados.
          </div>

          {carregando ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 py-4">
              <Loader2 className="animate-spin" size={14} /> Carregando configuração…
            </div>
          ) : obrigacoesDisponiveis.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
              Esta empresa não tem obrigações cadastradas.
            </div>
          ) : (
            <div className="space-y-2.5">
              {obrigacoesDisponiveis.map((obrigacao) => {
                const estado = estadoAtual(obrigacao);
                const tinhaPendencia = pendentes.has(obrigacao);
                const codigosStr = estado.codigos.join(', ');
                const preview = previewDe(obrigacao);
                return (
                  <div
                    key={obrigacao}
                    className={`rounded-xl border transition ${
                      estado.ativa
                        ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40'
                    } ${tinhaPendencia ? 'ring-2 ring-cyan-200 dark:ring-cyan-700/60' : ''}`}
                  >
                    {/* Header do card */}
                    <div className="flex items-center gap-3 p-3">
                      <button
                        onClick={() => atualizarPendente(obrigacao, { ativa: !estado.ativa })}
                        disabled={salvando}
                        className="shrink-0"
                        aria-label={estado.ativa ? 'Desativar' : 'Ativar'}
                      >
                        {estado.ativa ? (
                          <ToggleRight className="text-cyan-600 dark:text-cyan-400" size={32} />
                        ) : (
                          <ToggleLeft className="text-slate-400 dark:text-slate-500" size={32} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold ${estado.ativa ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-500 line-through'}`}>
                          {obrigacao}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {tinhaPendencia && (
                            <span className="text-[10px] text-cyan-700 dark:text-cyan-300 font-semibold uppercase tracking-wider bg-cyan-100 dark:bg-cyan-900/40 rounded-md px-1.5 py-0.5">
                              Alteração não salva
                            </span>
                          )}
                          {estado.ativa && estado.naoEnviaCliente && (
                            <span className="text-[10px] text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-0.5">
                              Interna
                            </span>
                          )}
                          {estado.ativa && estado.codigos.length > 0 && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                              {estado.codigos.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Motivo (quando desativada) */}
                    {!estado.ativa && (
                      <div className="px-3 pb-3">
                        <input
                          type="text"
                          value={estado.motivo}
                          onChange={(e) => atualizarPendente(obrigacao, { motivo: e.target.value })}
                          placeholder="Motivo (opcional, ex: empresa só de serviços)"
                          disabled={salvando}
                          className="w-full text-xs rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 outline-none transition"
                        />
                      </div>
                    )}

                    {/* Body (quando ativa) */}
                    {estado.ativa && (
                      <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-3 space-y-3">
                        {/* Preview do PDF exemplo */}
                        {preview.arquivo && (
                          <PreviewExemplo arquivo={preview.arquivo} trecho={preview.trecho} />
                        )}

                        {/* Códigos */}
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">
                            Códigos de receita esperados
                          </label>
                          <input
                            type="text"
                            value={codigosStr}
                            onChange={(e) => {
                              const codigos = e.target.value
                                .split(',')
                                .map((c) => c.trim())
                                .filter(Boolean);
                              atualizarPendente(obrigacao, { codigos });
                            }}
                            placeholder="ex: 0120-6, 0121-4  (separe por vírgula, deixe vazio se não validar)"
                            disabled={salvando}
                            className="w-full text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:focus:ring-cyan-900/40 outline-none transition"
                          />
                          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                            {estado.codigos.length > 0
                              ? `${estado.codigos.length} código${estado.codigos.length === 1 ? '' : 's'} · validador bloqueia se o PDF trouxer outro`
                              : 'sem código — validador usa só denominação'}
                          </div>
                        </div>

                        {/* Toggle não envia ao cliente */}
                        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={estado.naoEnviaCliente}
                            onChange={(e) => atualizarPendente(obrigacao, { naoEnviaCliente: e.target.checked })}
                            disabled={salvando}
                            className="rounded border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500"
                          />
                          <span><strong>Não envia ao cliente</strong> — obrigação interna do escritório (SPED, REINF, Livros etc)</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {pendentes.size > 0 ? `${pendentes.size} altera${pendentes.size === 1 ? 'ção' : 'ções'} pendente${pendentes.size === 1 ? '' : 's'}` : 'Nenhuma alteração'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={salvando}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando || pendentes.size === 0}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {salvando ? (
                <><Loader2 className="animate-spin" size={14} /> Salvando…</>
              ) : (
                <>Salvar alterações</>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalBase>
  );
}
