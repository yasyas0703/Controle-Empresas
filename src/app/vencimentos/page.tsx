'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Shield, Search, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  FileText, CalendarClock, Filter, XCircle, Eye, User, Settings, CheckCircle2,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR, isRetRenovado } from '@/app/utils/date';
import type { ChecklistFiscalItem, HistoricoVencimentoItem, UUID, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import ModalLimiares from '@/app/components/ModalLimiares';
import ModalHistoricoVencimento from '@/app/components/ModalHistoricoVencimento';
import { garantirVencimentosFiscaisComRegras } from '@/app/utils/vencimentos';
import { fetchChecklistFiscalByMes } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { sortByPtBr, sortResponsaveisByNome, sortStringsPtBr } from '@/lib/sort';

function mesAtualKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type StatusVenc = 'vencido' | 'critico' | 'atencao' | 'proximo' | 'ok' | 'renovado';

interface VencimentoItem {
  empresaId: UUID;
  itemId: UUID;
  empresaCodigo: string;
  empresaNome: string;
  tipo: 'Documento' | 'RET' | 'Fiscal';
  nome: string;
  vencimento: string;
  dias: number;
  status: StatusVenc;
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
  responsaveis: Record<string, string | null>;
  departamentosIds: UUID[]; // departamentos responsáveis pelo documento (vazio = todos)
}

function getStatus(dias: number, lim: Limiares): StatusVenc {
  if (dias < 0) return 'vencido';
  if (dias <= lim.critico) return 'critico';
  if (dias <= lim.atencao) return 'atencao';
  if (dias <= lim.proximo) return 'proximo';
  return 'ok';
}

const statusConfig: Record<StatusVenc, { label: string; bg: string; text: string; dot: string; border: string }> = {
  vencido: { label: 'VENCIDO', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200' },
  critico: { label: 'CRÍTICO', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border-orange-200' },
  atencao: { label: 'ATENÇÃO', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', border: 'border-amber-200' },
  proximo: { label: 'PRÓXIMO', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', border: 'border-green-200' },
  ok: { label: 'EM DIA', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  renovado: { label: 'RENOVADO', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
};

const DEPT_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  1: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  3: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  4: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  5: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  6: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  7: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};

export default function VencimentosPage() {
  const { empresas, departamentos, usuarios, currentUserId, canManage, atualizarEmpresa, atualizarDocumento, mostrarAlerta, tags: tagsCadastradas } = useSistema();

  const [limiares, setLimiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);
  const [showLimiares, setShowLimiares] = useState(false);

  const [search, setSearch] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos-risco');
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroResp, setFiltroResp] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroTag, setFiltroTag] = useState('');
  const [meusVencimentos, setMeusVencimentos] = useState(false);
  const [orderBy, setOrderBy] = useState<'dias' | 'empresa' | 'tipo'>('dias');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('asc');

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [historicoItem, setHistoricoItem] = useState<VencimentoItem | null>(null);
  const [savingHistorico, setSavingHistorico] = useState(false);

  // Paginação da lista por empresa (50 por página, configurável)
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useLocalStorageState<number>('triar-vencimentos-per-page', 50);

  // Checklist fiscal do mês corrente — usado pra marcar com ✓ as obrigações
  // que a usuária já marcou como feitas no checklist.
  const [checklistFeitas, setChecklistFeitas] = useState<Set<string>>(new Set());
  const mesCorrente = mesAtualKey();
  useEffect(() => {
    let cancelado = false;
    fetchChecklistFiscalByMes(mesCorrente)
      .then((lista: ChecklistFiscalItem[]) => {
        if (cancelado) return;
        const feitas = new Set<string>();
        for (const it of lista) if (it.concluido) feitas.add(`${it.empresaId}|${it.obrigacao}`);
        setChecklistFeitas(feitas);
      })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, [mesCorrente]);

  // Realtime: atualiza ✓ verde na hora quando alguém marca/desmarca
  useEffect(() => {
    const channel = supabase
      .channel(`vencimentos-page-checklist-${mesCorrente}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_fiscal', filter: `mes=eq.${mesCorrente}` }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        const chave = `${row.empresa_id}|${row.obrigacao}`;
        setChecklistFeitas((prev) => {
          const next = new Set(prev);
          if (payload.eventType === 'DELETE' || !row.concluido) next.delete(chave);
          else next.add(chave);
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [mesCorrente]);

  const getDepName = (dId: string) => departamentos.find((d) => d.id === dId)?.nome ?? '';
  const getDepIndex = (dId: string) => departamentos.findIndex((d) => d.id === dId);
  const getUserName = (uId: string | null) => {
    if (!uId) return '';
    return usuarios.find((u) => u.id === uId)?.nome ?? '';
  };

  // Build all vencimento items
  const allItems: VencimentoItem[] = useMemo(() => {
    const items: VencimentoItem[] = [];
    for (const e of empresas) {
      for (const d of e.documentos) {
        const dias = daysUntil(d.validade);
        if (dias === null) continue;
        items.push({
          empresaId: e.id,
          itemId: d.id,
          empresaCodigo: e.codigo,
          empresaNome: e.razao_social || e.apelido || '-',
          tipo: 'Documento',
          nome: d.nome,
          vencimento: d.validade,
          dias,
          status: getStatus(dias, limiares),
          tagVencimento: d.tagVencimento,
          historicoVencimento: d.historicoVencimento,
          responsaveis: e.responsaveis,
          departamentosIds: d.departamentosIds ?? [],
        });
      }
      for (const r of e.rets) {
        const dias = daysUntil(r.vencimento);
        if (dias === null) continue;
        const renovado = isRetRenovado(r.vencimento, r.ultimaRenovacao);
        items.push({
          empresaId: e.id,
          itemId: r.id,
          empresaCodigo: e.codigo,
          empresaNome: e.razao_social || e.apelido || '-',
          tipo: 'RET',
          nome: r.nome,
          vencimento: r.vencimento,
          dias,
          status: renovado ? 'renovado' : getStatus(dias, limiares),
          tagVencimento: r.tagVencimento,
          historicoVencimento: r.historicoVencimento,
          responsaveis: e.responsaveis,
          departamentosIds: [],
        });
      }
      for (const f of e.vencimentosFiscais ?? []) {
        const dias = daysUntil(f.vencimento);
        if (dias === null) continue;
        items.push({
          empresaId: e.id,
          itemId: f.id,
          empresaCodigo: e.codigo,
          empresaNome: e.razao_social || e.apelido || '-',
          tipo: 'Fiscal',
          nome: f.nome,
          vencimento: f.vencimento,
          dias,
          status: getStatus(dias, limiares),
          tagVencimento: f.tagVencimento,
          historicoVencimento: f.historicoVencimento,
          responsaveis: e.responsaveis,
          departamentosIds: [],
        });
      }
    }
    return items;
  }, [empresas, limiares]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) for (const t of e.tags || []) set.add(t);
    return sortStringsPtBr(Array.from(set));
  }, [empresas]);

  // Filtered
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems
      .filter((item) => {
        // Status filter
        if (filtroStatus === 'todos-risco') {
          if (item.status === 'ok') return false;
        } else if (filtroStatus === 'vencido') {
          if (item.status !== 'vencido') return false;
        } else if (filtroStatus === 'critico') {
          if (item.status !== 'critico') return false;
        } else if (filtroStatus === 'atencao') {
          if (item.status !== 'atencao') return false;
        } else if (filtroStatus === 'proximo') {
          if (item.status !== 'proximo') return false;
        } else if (filtroStatus === 'renovado') {
          if (item.status !== 'renovado') return false;
        }
        // filtroStatus === 'todos' → show all

        // Search
        if (q) {
          const hay = [item.empresaCodigo, item.empresaNome, item.nome].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }

        // Tipo
        if (filtroTipo && item.tipo !== filtroTipo) return false;

        // Tag
        if (filtroTag) {
          const empresa = empresas.find((emp) => emp.id === item.empresaId);
          if (!empresa || !(empresa.tags || []).includes(filtroTag)) return false;
        }

        // Departamento & Responsável
        if (filtroDep) {
          const resp = item.responsaveis[filtroDep];
          if (!resp) return false;
          if (filtroResp && resp !== filtroResp) return false;
        } else if (filtroResp) {
          const anyResp = Object.values(item.responsaveis).some((uid) => uid === filtroResp);
          if (!anyResp) return false;
        }

        // Meus vencimentos
        if (meusVencimentos && currentUserId) {
          if (item.departamentosIds.length > 0) {
            // Documento com departamentos específicos: verificar se o usuário é responsável
            // por algum dos departamentos selecionados no documento
            const isResponsavel = item.departamentosIds.some((depId) => item.responsaveis[depId] === currentUserId);
            if (!isResponsavel) return false;
          } else {
            // RET ou documento sem departamento específico: usa responsáveis gerais da empresa
            const isResponsavel = Object.values(item.responsaveis).some((uid) => uid === currentUserId);
            if (!isResponsavel) return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (orderBy === 'dias') cmp = a.dias - b.dias;
        else if (orderBy === 'empresa') cmp = a.empresaCodigo.localeCompare(b.empresaCodigo);
        else if (orderBy === 'tipo') cmp = a.tipo.localeCompare(b.tipo);
        return orderDir === 'desc' ? -cmp : cmp;
      });
  }, [allItems, search, filtroStatus, filtroDep, filtroResp, filtroTipo, filtroTag, empresas, meusVencimentos, currentUserId, orderBy, orderDir]);

  // Counts
  const counts = useMemo(() => {
    const c = { vencido: 0, critico: 0, atencao: 0, proximo: 0, ok: 0, renovado: 0, total: allItems.length };
    for (const item of allItems) c[item.status]++;
    return c;
  }, [allItems]);

  // Agrupamento por empresa: em vez de mostrar "yasmin · ICMS", "yasmin · DAPI"
  // como linhas separadas, junta tudo numa linha só por empresa, com chips
  // pra cada obrigação (e ✓ verde nas que já estão marcadas no checklist fiscal).
  type EmpresaGrupo = {
    empresaId: UUID;
    empresaCodigo: string;
    empresaNome: string;
    items: VencimentoItem[];
    obrigacoesFeitasNoChecklist: string[];
    diasMaisUrgente: number;
    piorStatus: StatusVenc;
    responsaveis: Record<string, string | null>;
  };
  const STATUS_RANK: Record<StatusVenc, number> = { vencido: 0, critico: 1, atencao: 2, proximo: 3, ok: 4, renovado: 5 };
  const empresasAgrupadas: EmpresaGrupo[] = useMemo(() => {
    const mapa = new Map<UUID, EmpresaGrupo>();
    for (const item of filtered) {
      let g = mapa.get(item.empresaId);
      if (!g) {
        g = {
          empresaId: item.empresaId,
          empresaCodigo: item.empresaCodigo,
          empresaNome: item.empresaNome,
          items: [],
          obrigacoesFeitasNoChecklist: [],
          diasMaisUrgente: Number.POSITIVE_INFINITY,
          piorStatus: 'ok',
          responsaveis: item.responsaveis,
        };
        mapa.set(item.empresaId, g);
      }
      g.items.push(item);
      if (item.dias < g.diasMaisUrgente) g.diasMaisUrgente = item.dias;
      if (STATUS_RANK[item.status] < STATUS_RANK[g.piorStatus]) g.piorStatus = item.status;
    }

    // Adiciona ✓ pras obrigações fiscais marcadas no checklist (mesmo que NÃO
    // estejam no `filtered` — pode ter sido filtrada como "em dia").
    for (const empresa of empresas) {
      const fiscaisDaEmpresa = (empresa.vencimentosFiscais ?? [])
        .filter((f) => checklistFeitas.has(`${empresa.id}|${f.nome}`))
        .map((f) => f.nome);
      if (fiscaisDaEmpresa.length === 0) continue;
      const g = mapa.get(empresa.id);
      if (g) g.obrigacoesFeitasNoChecklist = fiscaisDaEmpresa;
    }

    // Ordena items dentro de cada grupo pela mesma regra global de orderBy/orderDir
    for (const g of mapa.values()) {
      g.items.sort((a, b) => {
        let cmp = 0;
        if (orderBy === 'dias') cmp = a.dias - b.dias;
        else if (orderBy === 'empresa') cmp = a.empresaCodigo.localeCompare(b.empresaCodigo);
        else if (orderBy === 'tipo') cmp = a.tipo.localeCompare(b.tipo);
        return orderDir === 'desc' ? -cmp : cmp;
      });
    }

    // Ordena empresas: mais urgente primeiro; em empate, código
    return Array.from(mapa.values()).sort((a, b) => {
      const sa = STATUS_RANK[a.piorStatus];
      const sb = STATUS_RANK[b.piorStatus];
      if (sa !== sb) return sa - sb;
      if (a.diasMaisUrgente !== b.diasMaisUrgente) return a.diasMaisUrgente - b.diasMaisUrgente;
      return a.empresaCodigo.localeCompare(b.empresaCodigo);
    });
  }, [filtered, empresas, checklistFeitas, orderBy, orderDir]);

  // Reseta pra página 1 quando filtros/ordem/perPage mudam
  useEffect(() => {
    setPage(1);
  }, [search, filtroStatus, filtroDep, filtroResp, filtroTipo, filtroTag, meusVencimentos, orderBy, orderDir, perPage]);

  const totalPages = Math.max(1, Math.ceil(empresasAgrupadas.length / perPage));
  const pageClamped = Math.min(page, totalPages);
  const sliceInicio = (pageClamped - 1) * perPage;
  const sliceFim = sliceInicio + perPage;
  const empresasVisiveis = empresasAgrupadas.slice(sliceInicio, sliceFim);

  const sortedDepartamentos = useMemo(() => sortByPtBr(departamentos, (d) => d.nome), [departamentos]);

  // Responsáveis options based on department filter
  const responsaveisOptions = useMemo(() => {
    const base = filtroDep
      ? usuarios.filter((u) => u.ativo && u.departamentoId === filtroDep)
      : usuarios.filter((u) => u.ativo);
    return sortByPtBr(base, (u) => u.nome);
  }, [usuarios, filtroDep]);

  const toggleSort = (col: typeof orderBy) => {
    if (orderBy === col) setOrderDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setOrderBy(col); setOrderDir('asc'); }
  };

  const toggleRow = (key: string) => setExpandedRows((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const SortIcon = ({ col }: { col: typeof orderBy }) => {
    if (orderBy !== col) return null;
    return orderDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const hasFilters = search || filtroStatus !== 'todos-risco' || filtroDep || filtroResp || filtroTipo || filtroTag || meusVencimentos;
  const atalhoFiscaisVencidosAtivo = filtroTipo === 'Fiscal' && filtroStatus === 'vencido';

  const canEditHistoricoItem = (item: VencimentoItem | null) => {
    if (!item) return false;
    if (canManage) return true;
    if (!currentUserId) return false;
    if (item.departamentosIds.length > 0) {
      return item.departamentosIds.some((depId) => item.responsaveis[depId] === currentUserId);
    }
    return Object.values(item.responsaveis).some((uid) => uid === currentUserId);
  };

  const salvarHistorico = async (payload: { tagVencimento?: string; historicoVencimento: HistoricoVencimentoItem[] }) => {
    if (!historicoItem) return;
    setSavingHistorico(true);
    try {
      if (historicoItem.tipo === 'Documento') {
        const ok = await atualizarDocumento(historicoItem.empresaId, historicoItem.itemId, payload);
        if (ok === false) return;
      } else if (historicoItem.tipo === 'Fiscal') {
        const empresa = empresas.find((item) => item.id === historicoItem.empresaId);
        if (!empresa) {
          mostrarAlerta('Empresa não encontrada', 'Não foi possível localizar a empresa desse vencimento fiscal.', 'erro');
          return;
        }
        const fiscaisAtuais = garantirVencimentosFiscaisComRegras(empresa.vencimentosFiscais, empresa.estado, empresa.cidade);
        const vencimentosFiscais = fiscaisAtuais.map((f) =>
          f.id === historicoItem.itemId
            ? { ...f, tagVencimento: payload.tagVencimento, historicoVencimento: payload.historicoVencimento }
            : f
        );
        const ok = await atualizarEmpresa(empresa.id, { vencimentosFiscais });
        if (ok === false) return;
      } else {
        const empresa = empresas.find((item) => item.id === historicoItem.empresaId);
        if (!empresa) {
          mostrarAlerta('Empresa não encontrada', 'Não foi possível localizar a empresa desse RET.', 'erro');
          return;
        }
        const rets = empresa.rets.map((ret) =>
          ret.id === historicoItem.itemId
            ? { ...ret, tagVencimento: payload.tagVencimento, historicoVencimento: payload.historicoVencimento }
            : ret
        );
        const ok = await atualizarEmpresa(empresa.id, { rets, possuiRet: rets.length > 0 });
        if (ok === false) return;
      }

      mostrarAlerta('Histórico atualizado', 'As informações desse vencimento foram salvas.', 'sucesso');
      setHistoricoItem(null);
    } finally {
      setSavingHistorico(false);
    }
  };

  const buildExportRows = (items: VencimentoItem[]) => items.map((item) => {
    const responsaveis = sortResponsaveisByNome(
      Object.entries(item.responsaveis)
        .filter(([, uid]) => uid)
        .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid) }))
        .filter((r) => r.dep && r.user)
    )
      .map(({ dep, user }) => `${dep}: ${user}`)
      .join(' | ');

    return [
      statusConfig[item.status].label,
      item.dias < 0 ? `${Math.abs(item.dias)}d atras` : `${item.dias}d`,
      item.empresaCodigo,
      item.empresaNome,
      item.tipo,
      item.nome,
      formatBR(item.vencimento),
      responsaveis,
    ];
  });

  // Export CSV
  const exportCSV = () => {
    const header = ['Status', 'Dias', 'Código', 'Empresa', 'Tipo', 'Nome', 'Vencimento', 'Responsáveis'];
    const rows = buildExportRows(filtered);

    const csvContent = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vencimentos_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export PDF
  const exportPDF = async () => {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Controle de Vencimentos', 14, 15);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 14, 21);
    doc.text(`Total: ${filtered.length} itens`, 14, 26);

    const header = [['Status', 'Dias', 'Código', 'Empresa', 'Tipo', 'Nome', 'Vencimento', 'Responsáveis']];
    const rows = buildExportRows(filtered);
    const fiscaisRows = buildExportRows(filtered.filter((item) => item.tipo === 'Fiscal'));
    const _unusedRows = filtered.map((item) => {
      const responsaveis = sortResponsaveisByNome(
        Object.entries(item.responsaveis)
          .filter(([, uid]) => uid)
          .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid) }))
          .filter((r) => r.dep && r.user)
      )
        .map(({ dep, user }) => `${dep}: ${user}`)
        .join(' | ');
      return [
        statusConfig[item.status].label,
        item.dias < 0 ? `${Math.abs(item.dias)}d atrás` : `${item.dias}d`,
        item.empresaCodigo,
        item.empresaNome,
        item.tipo,
        item.nome,
        formatBR(item.vencimento),
        responsaveis,
      ];
    });

    autoTable(doc, {
      head: header,
      body: rows,
      startY: 30,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 20 },
        3: { cellWidth: 45 },
        4: { cellWidth: 15 },
        5: { cellWidth: 50 },
        6: { cellWidth: 25 },
        7: { cellWidth: 55 },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 0) {
          const status = (data.row.raw as string[])[0];
          if (status === 'VENCIDO') { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
          else if (status === 'CRÍTICO') { data.cell.styles.textColor = [194, 65, 12]; data.cell.styles.fontStyle = 'bold'; }
          else if (status === 'ATENÇÃO') { data.cell.styles.textColor = [161, 98, 7]; }
          else if (status === 'PRÓXIMO') { data.cell.styles.textColor = [21, 128, 61]; }
          else { data.cell.styles.textColor = [5, 150, 105]; }
        }
      },
    });

    if (fiscaisRows.length > 0) {
      doc.addPage('a4', 'landscape');
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Relatorio Fiscal', 14, 15);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total de fiscais: ${fiscaisRows.length}`, 14, 21);
      doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} Ã s ${new Date().toLocaleTimeString('pt-BR')}`, 14, 26);

      autoTable(doc, {
        head: header,
        body: fiscaisRows,
        startY: 30,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [127, 29, 29], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 18, halign: 'center' },
          2: { cellWidth: 20 },
          3: { cellWidth: 45 },
          4: { cellWidth: 18 },
          5: { cellWidth: 58 },
          6: { cellWidth: 25 },
          7: { cellWidth: 55 },
        },
      });
    }

    doc.save(`vencimentos_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-md">
              <Shield className="text-white" size={22} />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-gray-900">Controle de Vencimentos</div>
              <div className="text-sm text-gray-500">Monitoramento completo de documentos, RETs e fiscais com prazos</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canManage && (
              <button
                onClick={() => setShowLimiares(true)}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-violet-200 text-violet-700 px-3 sm:px-4 py-2 sm:py-2.5 font-bold hover:bg-violet-50 transition"
                title="Configurar limiares de vencimento"
              >
                <Settings size={18} />
                <span className="hidden sm:inline">Limiares</span>
              </button>
            )}
            <button
              onClick={() => {
                if (atalhoFiscaisVencidosAtivo) {
                  setFiltroTipo('');
                  setFiltroStatus('todos-risco');
                  return;
                }
                setFiltroTipo('Fiscal');
                setFiltroStatus('vencido');
              }}
              className={`inline-flex items-center gap-2 rounded-xl border-2 px-3 sm:px-4 py-2 sm:py-2.5 font-bold transition ${
                atalhoFiscaisVencidosAtivo
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-red-200 text-red-700 hover:bg-red-50'
              }`}
              title="Filtrar apenas fiscais vencidos"
            >
              <CalendarClock size={18} />
              <span>So fiscais vencidos</span>
            </button>
            <button
              onClick={exportPDF}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-2.5 font-bold hover:bg-red-50 transition"
            >
              <FileText size={18} />
              <span className="hidden sm:inline">Exportar</span> PDF
            </button>
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-200 text-emerald-700 px-3 sm:px-4 py-2 sm:py-2.5 font-bold hover:bg-emerald-50 transition"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Exportar</span> CSV
            </button>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-3 sm:gap-4">
        {[
          { key: 'vencido' as const, label: 'Vencidos', count: counts.vencido, dotColor: 'bg-red-500', textColor: 'text-red-700', ring: 'ring-red-400', activeBg: 'bg-red-50' },
          { key: 'critico' as const, label: `Críticos (≤${limiares.critico}d)`, count: counts.critico, dotColor: 'bg-orange-500', textColor: 'text-orange-700', ring: 'ring-orange-400', activeBg: 'bg-orange-50' },
          { key: 'atencao' as const, label: `Atenção (≤${limiares.atencao}d)`, count: counts.atencao, dotColor: 'bg-amber-400', textColor: 'text-amber-700', ring: 'ring-amber-400', activeBg: 'bg-amber-50' },
          { key: 'proximo' as const, label: `Próximo (≤${limiares.proximo}d)`, count: counts.proximo, dotColor: 'bg-green-500', textColor: 'text-green-700', ring: 'ring-green-400', activeBg: 'bg-green-50' },
          { key: 'renovado' as const, label: 'Renovados', count: counts.renovado, dotColor: 'bg-blue-500', textColor: 'text-blue-700', ring: 'ring-blue-400', activeBg: 'bg-blue-50' },
          { key: 'todos' as const, label: 'Em Dia', count: counts.ok, dotColor: 'bg-emerald-500', textColor: 'text-emerald-700', ring: 'ring-emerald-400', activeBg: 'bg-emerald-50' },
          { key: 'todos-risco' as const, label: 'Total Geral', count: counts.total, dotColor: 'bg-gray-400', textColor: 'text-gray-700', ring: 'ring-gray-400', activeBg: 'bg-gray-50' },
        ].map((c) => (
          <button
            key={c.key}
            onClick={() => setFiltroStatus(c.key)}
            className={`rounded-2xl p-5 text-left transition-all hover:shadow-md border ${
              filtroStatus === c.key ? `ring-2 ${c.ring} ${c.activeBg} border-transparent shadow-md` : 'bg-white border-gray-100 shadow-sm'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`h-2.5 w-2.5 rounded-full ${c.dotColor} ${c.key === 'vencido' && c.count > 0 ? 'animate-pulse' : ''}`} />
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wide ${filtroStatus === c.key ? c.textColor : 'text-gray-500'}`}>{c.label}</span>
            </div>
            <div className={`text-2xl sm:text-3xl font-black ${filtroStatus === c.key ? c.textColor : 'text-gray-800'}`}>{c.count}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-lg font-bold text-gray-800">
            <Filter size={18} className="text-gray-400" />
            Filtros
          </div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFiltroStatus('todos-risco'); setFiltroDep(''); setFiltroResp(''); setFiltroTipo(''); setFiltroTag(''); setMeusVencimentos(false); }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold"
            >
              <XCircle size={14} />
              Limpar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, código, documento..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
            />
          </div>
          <select value={filtroDep} onChange={(e) => { setFiltroDep(e.target.value); setFiltroResp(''); }} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos departamentos</option>
            {sortedDepartamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos responsáveis</option>
            {responsaveisOptions.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Doc, RET & Fiscal</option>
            <option value="Documento">Documentos</option>
            <option value="RET">RETs</option>
            <option value="Fiscal">Fiscais</option>
          </select>
          {allTags.length > 0 && (
            <select value={filtroTag} onChange={(e) => setFiltroTag(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400">
              <option value="">Tag</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button
            onClick={() => setMeusVencimentos((v) => !v)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border-2 transition ${
              meusVencimentos
                ? 'bg-cyan-50 border-cyan-400 text-cyan-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-cyan-300'
            }`}
          >
            <User size={16} />
            {meusVencimentos ? 'Mostrando meus' : 'Meus vencimentos'}
          </button>
        </div>
      </div>

      {/* Lista agrupada por empresa */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
        <div className="px-3 sm:px-5 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-[10px] text-gray-400">Ordem:</span>
            <button onClick={() => toggleSort('dias')} className={`px-2 py-1 rounded-md border text-[11px] font-bold transition ${orderBy === 'dias' ? 'border-cyan-300 bg-cyan-50 text-cyan-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              Dias <SortIcon col="dias" />
            </button>
            <button onClick={() => toggleSort('empresa')} className={`px-2 py-1 rounded-md border text-[11px] font-bold transition ${orderBy === 'empresa' ? 'border-cyan-300 bg-cyan-50 text-cyan-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              Empresa <SortIcon col="empresa" />
            </button>
            <button onClick={() => toggleSort('tipo')} className={`px-2 py-1 rounded-md border text-[11px] font-bold transition ${orderBy === 'tipo' ? 'border-cyan-300 bg-cyan-50 text-cyan-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              Tipo <SortIcon col="tipo" />
            </button>
          </div>
          <span className="text-[11px] font-bold text-gray-400">{empresasAgrupadas.length} empresa(s) · {filtered.length} item(ns)</span>
        </div>

        <ul className="divide-y divide-gray-100">
          {empresasVisiveis.map((g) => {
            const sc = statusConfig[g.piorStatus];
            const responsaveis = sortResponsaveisByNome(
              Object.entries(g.responsaveis)
                .filter(([, uid]) => uid)
                .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
                .filter((r) => r.dep && r.user)
            );
            const dias = g.diasMaisUrgente;
            const corDias = dias < 0 ? 'text-red-700' : dias === 0 ? 'text-orange-700' : dias <= 3 ? 'text-amber-700' : dias <= 7 ? 'text-yellow-700' : dias <= 30 ? 'text-green-700' : 'text-emerald-700';
            return (
              <li key={g.empresaId} className="px-3 sm:px-5 py-3.5 hover:bg-gray-50/60 transition">
                {/* Linha principal: empresa + responsáveis + dias mais urgente */}
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[10px] font-bold border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sc.dot} ${g.piorStatus === 'vencido' ? 'animate-pulse' : ''}`} />
                        {sc.label}
                      </span>
                      <span className="font-mono text-[10px] font-bold text-gray-500">{g.empresaCodigo}</span>
                      <span className="font-bold text-gray-900 truncate">{g.empresaNome}</span>
                    </div>
                    {responsaveis.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {responsaveis.map((r) => {
                          const c = DEPT_COLORS[r.depIdx % 8];
                          return (
                            <span key={r.dep} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${c.bg} ${c.text} ${c.border}`}>
                              <span className="font-bold">{r.dep}:</span> {r.user}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className={`shrink-0 text-right ${corDias}`}>
                    <div className="font-black text-xl tabular-nums leading-none">
                      {dias < 0 ? `${Math.abs(dias)}d` : dias === 0 ? 'HOJE' : `${dias}d`}
                    </div>
                    <div className="text-[10px] font-semibold opacity-80 mt-0.5">
                      {dias < 0 ? 'em atraso' : dias === 0 ? 'vence hoje' : 'mais urgente'}
                    </div>
                  </div>
                </div>

                {/* Lista de itens da empresa em chips */}
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((item) => {
                    const tipoCor = item.tipo === 'Documento'
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : item.tipo === 'Fiscal'
                        ? 'border-red-300 bg-red-50 text-red-800'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-800';
                    const corUrg = item.dias < 0
                      ? 'ring-2 ring-red-400'
                      : item.dias === 0
                        ? 'ring-2 ring-orange-400'
                        : item.dias <= 3
                          ? 'ring-2 ring-amber-400'
                          : '';
                    return (
                      <button
                        key={`${item.tipo}-${item.itemId}`}
                        type="button"
                        onClick={() => setHistoricoItem(item)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition hover:shadow-sm ${tipoCor} ${corUrg}`}
                        title={`${item.tipo} · ${item.nome} · ${formatBR(item.vencimento)} · ${item.dias < 0 ? `${Math.abs(item.dias)}d em atraso` : item.dias === 0 ? 'vence hoje' : `vence em ${item.dias}d`}`}
                      >
                        {item.tipo === 'Documento' ? <FileText size={11} /> : <CalendarClock size={11} />}
                        <span className="truncate max-w-[180px]">{item.nome}</span>
                        <span className="opacity-70 font-mono text-[10px]">
                          {item.dias < 0 ? `${Math.abs(item.dias)}d⬇` : item.dias === 0 ? 'hoje' : `${item.dias}d`}
                        </span>
                      </button>
                    );
                  })}
                  {/* ✓ Verde: obrigações fiscais já marcadas no checklist do mês */}
                  {g.obrigacoesFeitasNoChecklist.map((nome) => (
                    <span
                      key={`feito-${nome}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700"
                      title={`${nome} já marcado como feito no checklist fiscal deste mês`}
                    >
                      <CheckCircle2 size={11} strokeWidth={3} />
                      {nome}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}

          {empresasAgrupadas.length === 0 && (
            <li className="px-5 py-16 text-center">
              <div className="text-gray-400">
                <Shield className="mx-auto mb-3 text-gray-300" size={40} />
                <div className="font-semibold text-gray-500">Nenhum item encontrado</div>
                <div className="text-sm">{allItems.length === 0 ? 'Nenhum documento ou RET com data de vencimento cadastrado.' : 'Tente ajustar os filtros.'}</div>
              </div>
            </li>
          )}
        </ul>

        {empresasAgrupadas.length > 0 && (
          <div className="px-3 sm:px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex flex-col gap-2">
            {/* Totais por status */}
            <div className="flex items-center gap-3 font-bold flex-wrap justify-center sm:justify-start">
              <span className="text-gray-600">Total:</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> {filtered.filter((i) => i.status === 'vencido').length} vencido(s)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> {filtered.filter((i) => i.status === 'critico').length} crítico(s)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> {filtered.filter((i) => i.status === 'atencao').length} atenção</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> {filtered.filter((i) => i.status === 'proximo').length} próximo(s)</span>
            </div>

            {/* Paginação */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-gray-200">
              <span className="text-gray-600">
                Mostrando <span className="font-bold text-gray-800">{sliceInicio + 1}–{Math.min(sliceFim, empresasAgrupadas.length)}</span> de <span className="font-bold text-gray-800">{empresasAgrupadas.length}</span> empresa(s)
              </span>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="hidden sm:inline-flex items-center gap-1.5 text-[11px]">
                  <span className="text-gray-500">por pagina:</span>
                  <select
                    value={perPage}
                    onChange={(e) => setPerPage(Number(e.target.value))}
                    className="rounded-lg bg-white border border-gray-200 px-2 py-1 text-[11px] font-bold focus:ring-2 focus:ring-cyan-400"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </label>

                <span className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-bold text-gray-800 tabular-nums text-[11px]">
                  Página {pageClamped} <span className="text-gray-400">/ {totalPages}</span>
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={pageClamped <= 1}
                    className="rounded-lg px-2 py-1.5 text-xs font-bold bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="Primeira página"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pageClamped <= 1}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft size={14} />
                    <span className="hidden sm:inline">Anterior</span>
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={pageClamped >= totalPages}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-cyan-600 to-teal-500 text-white hover:from-cyan-700 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
                  >
                    <span className="hidden sm:inline">Próxima</span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={pageClamped >= totalPages}
                    className="rounded-lg px-2 py-1.5 text-xs font-bold bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="Última página"
                  >
                    »
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showLimiares && (
        <ModalLimiares
          limiares={limiares}
          onSave={setLimiares}
          onClose={() => setShowLimiares(false)}
        />
      )}

      <ModalHistoricoVencimento
        key={historicoItem ? `${historicoItem.empresaId}-${historicoItem.itemId}-${historicoItem.tagVencimento ?? ''}-${historicoItem.historicoVencimento?.length ?? 0}` : 'historico-vencimentos-fechado'}
        open={!!historicoItem}
        item={historicoItem ? {
          ...historicoItem,
          statusLabel: statusConfig[historicoItem.status].label,
          statusClassName: `${statusConfig[historicoItem.status].bg} ${statusConfig[historicoItem.status].text} ${statusConfig[historicoItem.status].border}`,
        } : null}
        canEdit={canEditHistoricoItem(historicoItem)}
        saving={savingHistorico}
        onClose={() => {
          if (savingHistorico) return;
          setHistoricoItem(null);
        }}
        onSave={salvarHistorico}
      />
    </div>
  );
}
