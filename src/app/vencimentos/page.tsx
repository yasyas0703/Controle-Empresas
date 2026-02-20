'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Clock, Shield, Search, Download, ChevronDown, ChevronUp,
  FileText, CalendarClock, Building2, Users, Filter, XCircle, Eye, User, Settings
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, formatBR } from '@/app/utils/date';
import type { UUID, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import ModalLimiares from '@/app/components/ModalLimiares';

type StatusVenc = 'vencido' | 'critico' | 'atencao' | 'proximo' | 'ok';

interface VencimentoItem {
  empresaId: UUID;
  empresaCodigo: string;
  empresaNome: string;
  tipo: 'Documento' | 'RET';
  nome: string;
  vencimento: string;
  dias: number;
  status: StatusVenc;
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
  const { empresas, departamentos, usuarios, currentUserId, canManage } = useSistema();

  const [limiares, setLimiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);
  const [showLimiares, setShowLimiares] = useState(false);

  const [search, setSearch] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos-risco');
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroResp, setFiltroResp] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [meusVencimentos, setMeusVencimentos] = useState(false);
  const [orderBy, setOrderBy] = useState<'dias' | 'empresa' | 'tipo'>('dias');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('asc');

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
          empresaCodigo: e.codigo,
          empresaNome: e.razao_social || e.apelido || '-',
          tipo: 'Documento',
          nome: d.nome,
          vencimento: d.validade,
          dias,
          status: getStatus(dias, limiares),
          responsaveis: e.responsaveis,
          departamentosIds: d.departamentosIds ?? [],
        });
      }
      for (const r of e.rets) {
        const dias = daysUntil(r.vencimento);
        if (dias === null) continue;
        items.push({
          empresaId: e.id,
          empresaCodigo: e.codigo,
          empresaNome: e.razao_social || e.apelido || '-',
          tipo: 'RET',
          nome: r.nome,
          vencimento: r.vencimento,
          dias,
          status: getStatus(dias, limiares),
          responsaveis: e.responsaveis,
          departamentosIds: [],
        });
      }
    }
    return items;
  }, [empresas, limiares]);

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
        }
        // filtroStatus === 'todos' → show all

        // Search
        if (q) {
          const hay = [item.empresaCodigo, item.empresaNome, item.nome].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }

        // Tipo
        if (filtroTipo && item.tipo !== filtroTipo) return false;

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
  }, [allItems, search, filtroStatus, filtroDep, filtroResp, filtroTipo, meusVencimentos, currentUserId, orderBy, orderDir]);

  // Counts
  const counts = useMemo(() => {
    const c = { vencido: 0, critico: 0, atencao: 0, proximo: 0, ok: 0, total: allItems.length };
    for (const item of allItems) c[item.status]++;
    return c;
  }, [allItems]);

  // Responsáveis options based on department filter
  const responsaveisOptions = useMemo(() => {
    if (!filtroDep) return usuarios.filter((u) => u.ativo);
    return usuarios.filter((u) => u.ativo && u.departamentoId === filtroDep);
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

  const hasFilters = search || filtroStatus !== 'todos-risco' || filtroDep || filtroResp || filtroTipo || meusVencimentos;

  // Export CSV
  const exportCSV = () => {
    const header = ['Status', 'Dias', 'Código', 'Empresa', 'Tipo', 'Nome', 'Vencimento', 'Responsáveis'];
    const rows = filtered.map((item) => {
      const responsaveis = Object.entries(item.responsaveis)
        .filter(([, uid]) => uid)
        .map(([dId, uid]) => `${getDepName(dId)}: ${getUserName(uid)}`)
        .join(' | ');
      return [
        statusConfig[item.status].label,
        item.dias.toString(),
        item.empresaCodigo,
        item.empresaNome,
        item.tipo,
        item.nome,
        formatBR(item.vencimento),
        responsaveis,
      ];
    });

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
    const rows = filtered.map((item) => {
      const responsaveis = Object.entries(item.responsaveis)
        .filter(([, uid]) => uid)
        .map(([dId, uid]) => `${getDepName(dId)}: ${getUserName(uid)}`)
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
              <div className="text-sm text-gray-500">Monitoramento completo de documentos e RETs com prazos</div>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
        {[
          { key: 'vencido' as const, label: 'Vencidos', count: counts.vencido, dotColor: 'bg-red-500', textColor: 'text-red-700', ring: 'ring-red-400', activeBg: 'bg-red-50' },
          { key: 'critico' as const, label: `Críticos (≤${limiares.critico}d)`, count: counts.critico, dotColor: 'bg-orange-500', textColor: 'text-orange-700', ring: 'ring-orange-400', activeBg: 'bg-orange-50' },
          { key: 'atencao' as const, label: `Atenção (≤${limiares.atencao}d)`, count: counts.atencao, dotColor: 'bg-amber-400', textColor: 'text-amber-700', ring: 'ring-amber-400', activeBg: 'bg-amber-50' },
          { key: 'proximo' as const, label: `Próximo (≤${limiares.proximo}d)`, count: counts.proximo, dotColor: 'bg-green-500', textColor: 'text-green-700', ring: 'ring-green-400', activeBg: 'bg-green-50' },
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
              onClick={() => { setSearch(''); setFiltroStatus('todos-risco'); setFiltroDep(''); setFiltroResp(''); setFiltroTipo(''); setMeusVencimentos(false); }}
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
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos responsáveis</option>
            {responsaveisOptions.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Doc & RET</option>
            <option value="Documento">Documentos</option>
            <option value="RET">RETs</option>
          </select>
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

      {/* Tabela Desktop / Cards Mobile */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 text-gray-800">
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('dias')}>
                  <span className="inline-flex items-center gap-1">Dias <SortIcon col="dias" /></span>
                </th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('empresa')}>
                  <span className="inline-flex items-center gap-1">Empresa <SortIcon col="empresa" /></span>
                </th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('tipo')}>
                  <span className="inline-flex items-center gap-1">Tipo <SortIcon col="tipo" /></span>
                </th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider">Nome</th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider">Vencimento</th>
                <th className="text-left px-5 py-4 font-semibold text-xs uppercase tracking-wider">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.slice(0, 200).map((item, idx) => {
                const sc = statusConfig[item.status];
                const responsaveis = Object.entries(item.responsaveis)
                  .filter(([, uid]) => uid)
                  .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
                  .filter((r) => r.dep && r.user);
                const rowKey = `${item.empresaId}-${item.nome}-${idx}`;
                const isExpanded = expandedRows.has(rowKey);
                const mainResp = responsaveis[0];
                const moreCount = responsaveis.length - 1;

                return (
                  <tr
                    key={rowKey}
                    className={`transition-colors ${
                      item.status === 'vencido' ? 'bg-red-50/70 hover:bg-red-100/60' :
                      item.status === 'critico' ? 'bg-orange-50/50 hover:bg-orange-100/40' :
                      item.status === 'atencao' ? 'bg-amber-50/40 hover:bg-amber-100/30' :
                      item.status === 'proximo' ? 'bg-green-50/40 hover:bg-green-100/30' :
                      'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`h-2 w-2 rounded-full ${sc.dot} ${item.status === 'vencido' ? 'animate-pulse' : ''}`} />
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`font-black text-lg tabular-nums ${
                        item.status === 'vencido' ? 'text-red-700' :
                        item.status === 'critico' ? 'text-orange-700' :
                        item.status === 'atencao' ? 'text-amber-600' :
                        item.status === 'proximo' ? 'text-green-600' :
                        'text-emerald-600'
                      }`}>
                        {item.dias < 0 ? `${Math.abs(item.dias)}d` : `${item.dias}d`}
                      </span>
                      {item.dias < 0 && <div className="text-[10px] text-red-500 font-semibold">atrás</div>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-gray-900">{item.empresaCodigo}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[180px]" title={item.empresaNome}>{item.empresaNome}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                        item.tipo === 'Documento'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {item.tipo === 'Documento' ? <FileText size={13} /> : <CalendarClock size={13} />}
                        {item.tipo === 'Documento' ? 'DOC' : 'RET'}
                      </span>
                    </td>
                    <td className="px-5 py-4" style={{ overflow: 'visible', textOverflow: 'clip' }}>
                      <div className="font-semibold text-gray-800" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'visible', textOverflow: 'clip' }}>{item.nome}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap font-medium">{formatBR(item.vencimento)}</td>
                    <td className="px-5 py-4">
                      {responsaveis.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">Sem responsável</span>
                      ) : (
                        <div>
                          {/* Primeiro responsável sempre visível */}
                          {mainResp && (
                            <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border ${DEPT_COLORS[mainResp.depIdx % 8].bg} ${DEPT_COLORS[mainResp.depIdx % 8].text} ${DEPT_COLORS[mainResp.depIdx % 8].border}`}>
                              <span className="font-bold">{mainResp.dep}:</span> {mainResp.user}
                            </div>
                          )}
                          {/* Botão expandir */}
                          {moreCount > 0 && (
                            <button
                              onClick={(ev) => { ev.stopPropagation(); toggleRow(rowKey); }}
                              className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-cyan-600 hover:text-cyan-800 font-bold transition"
                            >
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              {isExpanded ? 'menos' : `+${moreCount}`}
                            </button>
                          )}
                          {/* Demais responsáveis expandidos */}
                          {isExpanded && (
                            <div className="mt-1.5 space-y-1">
                              {responsaveis.slice(1).map((r) => (
                                <div
                                  key={r.dep}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border ${DEPT_COLORS[r.depIdx % 8].bg} ${DEPT_COLORS[r.depIdx % 8].text} ${DEPT_COLORS[r.depIdx % 8].border}`}
                                >
                                  <span className="font-bold">{r.dep}:</span> {r.user}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="text-gray-400">
                      <Shield className="mx-auto mb-3 text-gray-300" size={40} />
                      <div className="font-semibold text-gray-500">Nenhum item encontrado</div>
                      <div className="text-sm">{allItems.length === 0 ? 'Nenhum documento ou RET com data de vencimento cadastrado.' : 'Tente ajustar os filtros.'}</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {filtered.slice(0, 200).map((item, idx) => {
            const sc = statusConfig[item.status];
            const responsaveis = Object.entries(item.responsaveis)
              .filter(([, uid]) => uid)
              .map(([dId, uid]) => ({ dep: getDepName(dId), user: getUserName(uid), depIdx: getDepIndex(dId) }))
              .filter((r) => r.dep && r.user);
            return (
              <div key={`mobile-${item.empresaId}-${item.nome}-${idx}`} className={`p-4 ${item.status === 'vencido' ? 'bg-red-50/70' : item.status === 'critico' ? 'bg-orange-50/50' : item.status === 'atencao' ? 'bg-amber-50/40' : item.status === 'proximo' ? 'bg-green-50/40' : ''}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold border ${sc.bg} ${sc.text} ${sc.border}`}>
                    <span className={`h-2 w-2 rounded-full ${sc.dot} ${item.status === 'vencido' ? 'animate-pulse' : ''}`} />
                    {sc.label}
                  </span>
                  <span className={`font-black text-lg tabular-nums ${item.status === 'vencido' ? 'text-red-700' : item.status === 'critico' ? 'text-orange-700' : item.status === 'atencao' ? 'text-amber-600' : item.status === 'proximo' ? 'text-green-600' : 'text-emerald-600'}`}>
                    {item.dias < 0 ? `${Math.abs(item.dias)}d atrás` : `${item.dias}d`}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-gray-900">{item.empresaCodigo}</span>
                  <span className="text-xs text-gray-500 truncate">{item.empresaNome}</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ${item.tipo === 'Documento' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {item.tipo === 'Documento' ? <FileText size={12} /> : <CalendarClock size={12} />}
                    {item.tipo === 'Documento' ? 'DOC' : 'RET'}
                  </span>
                  <span className="text-sm font-semibold text-gray-800 break-words">{item.nome}</span>
                  <span className="text-xs text-gray-500 ml-auto whitespace-nowrap">{formatBR(item.vencimento)}</span>
                </div>
                {responsaveis.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {responsaveis.map((r) => {
                      const c = DEPT_COLORS[r.depIdx % 8];
                      return (
                        <span key={r.dep} className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold border ${c.bg} ${c.text} ${c.border}`}>
                          <span className="font-bold">{r.dep}:</span> {r.user}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-5 py-16 text-center">
              <div className="text-gray-400">
                <Shield className="mx-auto mb-3 text-gray-300" size={40} />
                <div className="font-semibold text-gray-500">Nenhum item encontrado</div>
                <div className="text-sm">{allItems.length === 0 ? 'Nenhum documento ou RET com data de vencimento cadastrado.' : 'Tente ajustar os filtros.'}</div>
              </div>
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="px-3 sm:px-5 py-3 sm:py-3.5 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <span>Exibindo {Math.min(filtered.length, 200)} de {filtered.length} itens</span>
            <div className="flex items-center gap-3 font-bold flex-wrap">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> {filtered.filter((i) => i.status === 'vencido').length} vencido(s)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> {filtered.filter((i) => i.status === 'critico').length} crítico(s)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> {filtered.filter((i) => i.status === 'atencao').length} atenção</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> {filtered.filter((i) => i.status === 'proximo').length} próximo(s)</span>
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
    </div>
  );
}
