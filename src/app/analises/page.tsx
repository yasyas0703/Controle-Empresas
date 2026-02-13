'use client';

import React, { useMemo, useState } from 'react';
import { BarChart3, PieChart, TrendingUp, Building2, MapPin, Briefcase, FileCheck, Users, Eye, List } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { detectTipoEstabelecimento, getTipoInscricaoDisplay, formatarDocumento, detectTipoInscricao } from '@/app/utils/validation';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import type { Empresa } from '@/app/types';

function countBy(values: string[]) {
  const map: Record<string, number> = {};
  for (const v of values) {
    const key = v?.trim();
    if (!key) continue;
    map[key] = (map[key] ?? 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

const barColors = [
  'bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-teal-500', 'bg-amber-500', 'bg-teal-500',
  'bg-pink-500', 'bg-sky-500', 'bg-lime-500', 'bg-cyan-500',
];

const donutColors = [
  '#3b82f6', '#10b981', '#f97316', '#f43f5e',
  '#06b6d4', '#14b8a6', '#f59e0b', '#14b8a6',
  '#ec4899', '#0ea5e9', '#84cc16', '#06b6d4',
];

export default function AnalisesPage() {
  const { empresas, departamentos, usuarios } = useSistema();

  const [filtroRegime, setFiltroRegime] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);

  const allEstados = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) if (e.estado) set.add(e.estado);
    return Array.from(set).sort();
  }, [empresas]);

  const filteredEmpresas = useMemo(() => {
    return empresas.filter((e) => {
      if (filtroRegime && (e.regime_federal || '') !== filtroRegime) return false;
      if (filtroTipo) {
        const computed = detectTipoEstabelecimento(e.cnpj || '');
        const effective = computed || e.tipoEstabelecimento;
        if (filtroTipo === 'cpf') {
          const digits = (e.cnpj || '').replace(/\D/g, '');
          if (digits.length !== 11) return false;
        } else if (filtroTipo === 'caepf') {
          if ((e.tipoInscricao || '') !== 'CAEPF') return false;
        } else if (filtroTipo === 'cno') {
          const digits = (e.cnpj || '').replace(/\D/g, '');
          if (digits.length !== 12 && (e.tipoInscricao || '') !== 'CNO') return false;
        } else if (effective !== filtroTipo) {
          return false;
        }
      }
      if (filtroDep) {
        const resp = (e.responsaveis || {})[filtroDep];
        if (!resp) return false;
      }
      if (filtroEstado && (e.estado || '') !== filtroEstado) return false;
      return true;
    });
  }, [empresas, filtroRegime, filtroTipo, filtroDep, filtroEstado]);

  const stats = useMemo(() => {
    const servicos = filteredEmpresas.flatMap((e) => e.servicos || []);
    const regimes = filteredEmpresas.map((e) => e.regime_federal || 'Não informado');
    const estados = filteredEmpresas.map((e) => e.estado || 'Não informado');
    const tipos = filteredEmpresas.map((e) => {
      const digits = (e.cnpj || '').replace(/\D/g, '');
      if (digits.length === 11) return 'CPF';
      const computed = detectTipoEstabelecimento(e.cnpj || '');
      const effective = computed || e.tipoEstabelecimento;
      if (effective === 'matriz') return 'Matriz';
      if (effective === 'filial') return 'Filial';
      const tipoIns = getTipoInscricaoDisplay(e.cnpj, e.tipoInscricao);
      if (tipoIns) return tipoIns;
      return 'Não informado';
    });
    const inscricoes = filteredEmpresas.map((e) => e.tipoInscricao || 'Não informado');

    const byServico = countBy(servicos);
    const byRegime = countBy(regimes);
    const byEstado = countBy(estados);
    const byTipo = countBy(tipos);
    const byInscricao = countBy(inscricoes);

    // Departamento usage
    const byDep: Record<string, number> = {};
    for (const e of filteredEmpresas) {
      for (const [dId, uid] of Object.entries(e.responsaveis || {})) {
        if (uid) byDep[dId] = (byDep[dId] ?? 0) + 1;
      }
    }
    const byDepartamento = Object.entries(byDep)
      .map(([dId, n]) => [departamentos.find(d => d.id === dId)?.nome || dId, n] as [string, number])
      .sort((a, b) => b[1] - a[1]);

    // Documentos por status
    let docOk = 0;
    let docRisco = 0;
    let docVencido = 0;
    const now = new Date();
    for (const e of filteredEmpresas) {
      for (const d of e.documentos) {
        if (!d.validade) { docOk++; continue; }
        const diff = Math.ceil((new Date(d.validade).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 0) docVencido++;
        else if (diff <= 60) docRisco++;
        else docOk++;
      }
    }
    const docStatus = ([
      ['Em dia', docOk],
      ['Em risco (≤60d)', docRisco],
      ['Vencido', docVencido],
    ] as Array<[string, number]>).filter(([, n]) => n > 0);

    return { byServico, byRegime, byEstado, byTipo, byInscricao, byDepartamento, docStatus };
  }, [filteredEmpresas, departamentos]);

  const hasFilters = filtroRegime || filtroTipo || filtroDep || filtroEstado;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md">
              <BarChart3 className="text-white" size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">Dashboard de Análises</div>
              <div className="text-sm text-gray-500">Gráficos e estatísticas • {filteredEmpresas.length} empresas</div>
            </div>
          </div>
          {hasFilters && (
            <button
              onClick={() => { setFiltroRegime(''); setFiltroTipo(''); setFiltroDep(''); setFiltroEstado(''); }}
              className="text-sm text-teal-600 hover:text-teal-700 font-bold"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 sm:flex gap-3 flex-wrap">
          <select value={filtroRegime} onChange={(e) => setFiltroRegime(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os regimes</option>
            <option value="Simples Nacional">Simples Nacional</option>
            <option value="Lucro Presumido">Lucro Presumido</option>
            <option value="Lucro Real">Lucro Real</option>
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os tipos</option>
            <option value="matriz">Matriz</option>
            <option value="filial">Filial</option>
            <option value="cpf">CPF</option>
            <option value="caepf">CAEPF</option>
            <option value="cno">CNO</option>
          </select>
          <select value={filtroDep} onChange={(e) => setFiltroDep(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os departamentos</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os estados</option>
            {allEstados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>
      </div>

      {/* Resumo rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        <MiniCard label="Empresas" value={filteredEmpresas.length} gradient="from-blue-500 to-blue-600" icon={<Building2 size={20} />} />
        <MiniCard label="Serviços" value={stats.byServico.length} gradient="from-cyan-500 to-teal-600" icon={<Briefcase size={20} />} />
        <MiniCard label="Estados" value={stats.byEstado.length} gradient="from-emerald-500 to-emerald-600" icon={<MapPin size={20} />} />
        <MiniCard label="Documentos" value={filteredEmpresas.reduce((a, e) => a + e.documentos.length, 0)} gradient="from-orange-400 to-amber-500" icon={<FileCheck size={20} />} />
        <MiniCard label="Departamentos" value={stats.byDepartamento.length} gradient="from-rose-500 to-pink-500" icon={<Users size={20} />} />
      </div>

      {/* Gráficos - Linha 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel title="Empresas por Serviço" icon={<BarChart3 size={18} />} color="text-cyan-600">
          {stats.byServico.length === 0 ? <Empty /> : <Bars rows={stats.byServico} />}
        </Panel>

        <Panel title="Empresas por Regime Federal" icon={<PieChart size={18} />} color="text-blue-600">
          {stats.byRegime.length === 0 ? <Empty /> : <DonutChart rows={stats.byRegime} />}
        </Panel>
      </div>

      {/* Gráficos - Linha 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Panel title="Matriz vs Filial" icon={<Building2 size={18} />} color="text-teal-600">
          {stats.byTipo.length === 0 ? <Empty /> : <DonutChart rows={stats.byTipo} />}
        </Panel>

        <Panel title="Status dos Documentos" icon={<FileCheck size={18} />} color="text-emerald-600">
          {stats.docStatus.length === 0 ? <Empty /> : <DonutChart rows={stats.docStatus} statusColors />}
        </Panel>

        <Panel title="Empresas por Departamento" icon={<Users size={18} />} color="text-rose-600">
          {stats.byDepartamento.length === 0 ? <Empty /> : <Bars rows={stats.byDepartamento} />}
        </Panel>
      </div>

      {/* Gráficos - Linha 3 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel title="Empresas por Estado (UF)" icon={<MapPin size={18} />} color="text-teal-600">
          {stats.byEstado.length === 0 ? <Empty /> : <HorizontalBars rows={stats.byEstado} />}
        </Panel>

        <Panel title="Top Serviços (ranking)" icon={<TrendingUp size={18} />} color="text-amber-600">
          {stats.byServico.length === 0 ? <Empty /> : <RankingList rows={stats.byServico.slice(0, 10)} />}
        </Panel>
      </div>

      {/* Tipo de Inscrição */}
      <div className="grid grid-cols-1 gap-6">
        <Panel title="Tipo de Inscrição" icon={<Briefcase size={18} />} color="text-teal-600">
          {stats.byInscricao.length === 0 ? <Empty /> : <HorizontalBars rows={stats.byInscricao} />}
        </Panel>
      </div>

      {/* Lista de Empresas Filtradas */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <List size={18} className="text-blue-600" />
          <div className="text-lg font-bold text-gray-900">
            Empresas {hasFilters ? 'filtradas' : ''} ({filteredEmpresas.length})
          </div>
        </div>
        {filteredEmpresas.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-6 text-center text-gray-500 text-sm">
            Nenhuma empresa encontrada com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-700">
                  <th className="text-left px-4 py-2.5 rounded-tl-xl font-bold">Código</th>
                  <th className="text-left px-4 py-2.5 font-bold">Empresa</th>
                  <th className="text-left px-4 py-2.5 font-bold">CNPJ/CPF</th>
                  <th className="text-left px-4 py-2.5 font-bold">Tipo</th>
                  <th className="text-left px-4 py-2.5 font-bold">Regime</th>
                  <th className="text-left px-4 py-2.5 font-bold">Estado</th>
                  <th className="text-center px-4 py-2.5 font-bold">Docs</th>
                  <th className="text-center px-4 py-2.5 font-bold">RETs</th>
                  <th className="text-center px-4 py-2.5 rounded-tr-xl font-bold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmpresas.map((emp) => {
                  const nome = emp.razao_social || emp.apelido || '-';
                  const digits = (emp.cnpj || '').replace(/\D/g, '');
                  const tipo = (() => {
                    if (digits.length === 11) return { label: 'CPF', cls: 'bg-sky-100 text-sky-700' };
                    const computed = detectTipoEstabelecimento(emp.cnpj || '');
                    const effective = computed || emp.tipoEstabelecimento;
                    if (effective === 'matriz') return { label: 'Matriz', cls: 'bg-teal-100 text-teal-700' };
                    if (effective === 'filial') return { label: 'Filial', cls: 'bg-teal-100 text-teal-700' };
                    const tipoIns = getTipoInscricaoDisplay(emp.cnpj, emp.tipoInscricao);
                    if (tipoIns && tipoIns !== 'CNPJ') return { label: tipoIns, cls: 'bg-gray-100 text-gray-600' };
                    return { label: 'CNPJ', cls: 'bg-gray-100 text-gray-600' };
                  })();
                  const docFormatted = emp.cnpj ? formatarDocumento(emp.cnpj, detectTipoInscricao(emp.cnpj) || emp.tipoInscricao || '') : '-';
                  return (
                    <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-2 py-0.5 text-xs font-bold">
                          {emp.codigo}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900 truncate max-w-[200px]">{nome}</td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{docFormatted}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${tipo.cls}`}>{tipo.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{emp.regime_federal || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{emp.estado || '-'}</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-700">{emp.documentos.length}</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-700">{emp.rets.length}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setEmpresaView(emp)}
                          className="rounded-lg p-1.5 hover:bg-blue-50 transition"
                          title="Ver detalhes"
                        >
                          <Eye size={16} className="text-blue-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}
    </div>
  );
}

/* ---- Sub-components ---- */

function MiniCard({ label, value, gradient, icon }: { label: string; value: number; gradient: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
        </div>
        <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-sm`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon, color, children }: { title: string; icon?: React.ReactNode; color?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        {icon && <span className={color || 'text-cyan-600'}>{icon}</span>}
        <div className="text-lg font-bold text-gray-900">{title}</div>
      </div>
      {children}
    </div>
  );
}

function Bars({ rows }: { rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="space-y-3">
      {rows.slice(0, 12).map(([label, n], idx) => (
        <div key={label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <div className="font-semibold text-gray-800 truncate pr-3">{label}</div>
            <div className="text-gray-600 font-bold">{n}</div>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-3 rounded-full ${barColors[idx % barColors.length]} transition-all duration-500`}
              style={{ width: `${(n / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({ rows }: { rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="space-y-2">
      {rows.slice(0, 15).map(([label, n], idx) => (
        <div key={label} className="flex items-center gap-3">
          <div className="w-16 text-right text-sm font-bold text-gray-700 shrink-0 truncate">{label}</div>
          <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden">
            <div
              className={`h-6 rounded-lg ${barColors[idx % barColors.length]} transition-all duration-500 flex items-center px-2`}
              style={{ width: `${Math.max((n / max) * 100, 8)}%` }}
            >
              <span className="text-[10px] font-bold text-white">{n}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ rows, statusColors }: { rows: Array<[string, number]>; statusColors?: boolean }) {
  const total = rows.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return <Empty />;

  const statusColorMap: Record<string, string> = {
    'Em dia': '#10b981',
    'Em risco (≤60d)': '#f59e0b',
    'Vencido': '#ef4444',
  };

  let cumPercent = 0;
  const segments = rows.map(([label, n], idx) => {
    const percent = n / total;
    const offset = cumPercent;
    cumPercent += percent;
    const color = statusColors ? (statusColorMap[label] || donutColors[idx % donutColors.length]) : donutColors[idx % donutColors.length];
    return { label, n, percent, offset, color };
  });

  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
      <div className="shrink-0">
        <svg width="150" height="150" viewBox="0 0 150 150">
          {segments.map((s, i) => (
            <circle
              key={i}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="24"
              strokeDasharray={`${s.percent * circumference} ${circumference}`}
              strokeDashoffset={-s.offset * circumference}
              transform="rotate(-90 75 75)"
            />
          ))}
          <text x="75" y="75" textAnchor="middle" dominantBaseline="middle" fill="#111827" fontSize="22" fontWeight="bold">
            {total}
          </text>
        </svg>
      </div>
      <div className="space-y-2 min-w-0">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <div className="text-sm text-gray-800 truncate">{s.label}</div>
            <div className="text-sm font-bold text-gray-600 ml-auto whitespace-nowrap">{s.n} <span className="text-gray-400 font-normal">({Math.round(s.percent * 100)}%)</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingList({ rows }: { rows: Array<[string, number]> }) {
  const medals = ['from-amber-400 to-yellow-500', 'from-gray-300 to-gray-400', 'from-orange-400 to-amber-500'];
  return (
    <div className="space-y-2">
      {rows.map(([label, n], idx) => (
        <div key={label} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 hover:bg-gray-100 transition">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold text-white bg-gradient-to-br ${idx < 3 ? medals[idx] : 'from-gray-200 to-gray-300'}`}>
            {idx + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate">{label}</div>
          </div>
          <div className="text-lg font-bold text-gray-700">{n}</div>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">Sem dados para exibir.</div>;
}
