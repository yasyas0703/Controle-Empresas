'use client';

import React, { useMemo, useState } from 'react';
import { BarChart3, PieChart, TrendingUp, Building2, MapPin, Briefcase, FileCheck, Users, Eye, List } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil } from '@/app/utils/date';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';
import { formatarDocumento, detectTipoEstabelecimento, detectTipoInscricao } from '@/app/utils/validation';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import type { Empresa, Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';

function countBy(values: Array<string | null | undefined>) {
  const map: Record<string, number> = {};
  for (const v of values) {
    const key = v?.trim();
    if (!key) continue;
    map[key] = (map[key] ?? 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function requerTipoEstabelecimento(empresa: Empresa) {
  const tipoInscricao = getTipoInscricaoAnalise(empresa);
  return tipoInscricao === 'CNPJ' || tipoInscricao === 'MEI';
}

function getTipoInscricaoAnalise(empresa: Empresa) {
  return detectTipoInscricao(empresa.cnpj || '', empresa.tipoInscricao);
}

function getTipoEstabelecimentoAnalise(empresa: Empresa) {
  const tipoEstabelecimento = detectTipoEstabelecimento(empresa.cnpj || '') || (empresa.tipoEstabelecimento || '').trim();
  if (tipoEstabelecimento === 'matriz') return 'Matriz';
  if (tipoEstabelecimento === 'filial') return 'Filial';
}


function getBadgeTipoAnalise(empresa: Empresa) {
  const tipoEstabelecimento = getTipoEstabelecimentoAnalise(empresa);
  if (tipoEstabelecimento === 'Matriz') {
    return { label: 'Matriz', cls: 'bg-teal-100 text-teal-700' };
  }
  if (tipoEstabelecimento === 'Filial') {
    return { label: 'Filial', cls: 'bg-teal-100 text-teal-700' };
  }
  const tipoInscricao = getTipoInscricaoAnalise(empresa);
  if (tipoInscricao) {
    return { label: tipoInscricao, cls: 'bg-gray-100 text-gray-600' };
  }
  return { label: 'Nao informado', cls: 'bg-amber-100 text-amber-700' };
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

  const [limiares] = useLocalStorageState<Limiares>('triar-limiares', LIMIARES_DEFAULTS);

  const [filtroRegime, setFiltroRegime] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroTipoInscricao, setFiltroTipoInscricao] = useState('');
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [statusVenc, setStatusVenc] = useState('');
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);

  const allEstados = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) if (e.estado) set.add(e.estado);
    return Array.from(set).sort();
  }, [empresas]);

  const responsaveisOptions = useMemo(() => {
    if (!filtroDep) return usuarios.filter((u) => u.ativo);
    return usuarios.filter((u) => u.ativo && u.departamentoId === filtroDep);
  }, [usuarios, filtroDep]);

  const departamentoSelecionadoNome = filtroDep
    ? departamentos.find((d) => d.id === filtroDep)?.nome || 'Departamento'
    : '';

  const filteredEmpresas = useMemo(() => {
    return empresas.filter((e) => {
      if (filtroRegime) {
        if (filtroRegime === '__nao_informado__') {
          if (e.regime_federal && e.regime_federal.trim()) return false;
        } else if ((e.regime_federal || '') !== filtroRegime) {
          return false;
        }
      }
      if (filtroTipo) {
        const tipoEstabelecimento = (detectTipoEstabelecimento(e.cnpj || '') || e.tipoEstabelecimento || '').trim();
        if (filtroTipo === '__nao_informado__') {
          if (!requerTipoEstabelecimento(e) || tipoEstabelecimento) return false;
        } else if (tipoEstabelecimento !== filtroTipo) {
          return false;
        }
      }
      if (filtroTipoInscricao) {
        const tipoInscricao = getTipoInscricaoAnalise(e).trim();
        if (filtroTipoInscricao === '__nao_informado__') {
          if (tipoInscricao) return false;
        } else if (tipoInscricao !== filtroTipoInscricao) {
          return false;
        }
      }
      if (filtroDep) {
        const resp = (e.responsaveis || {})[filtroDep];
        if (!resp) return false;
        if (filtroResponsavel && resp !== filtroResponsavel) return false;
      } else if (filtroResponsavel) {
        const anyResp = Object.values(e.responsaveis || {}).some((uid) => uid === filtroResponsavel);
        if (!anyResp) return false;
      }
      if (filtroEstado && (e.estado || '') !== filtroEstado) return false;
      if (statusVenc) {
        const allItems = [
          ...e.documentos.map((d) => d.validade),
          ...e.rets.map((r) => r.vencimento),
        ];
        const temVencido = allItems.some((v) => { const d = daysUntil(v); return d !== null && d < 0; });
        const temRisco = allItems.some((v) => { const d = daysUntil(v); return d !== null && d >= 0 && d <= limiares.atencao; });
        if (statusVenc === 'vencidos' && !temVencido) return false;
        if (statusVenc === 'risco' && !temRisco) return false;
        if (statusVenc === 'emdia' && (temVencido || temRisco)) return false;
      }
      return true;
    }).sort((a, b) => (a.razao_social || a.apelido || '').localeCompare(b.razao_social || b.apelido || ''));
  }, [empresas, filtroRegime, filtroTipo, filtroTipoInscricao, filtroDep, filtroResponsavel, filtroEstado, statusVenc, limiares]);

  const stats = useMemo(() => {
    const servicos = filteredEmpresas.flatMap((e) => e.servicos || []);
    const regimes = filteredEmpresas.map((e) => e.regime_federal || 'Não informado');
    const estados = filteredEmpresas.map((e) => e.estado || 'Não informado');
    const tipos = filteredEmpresas
      .filter(requerTipoEstabelecimento)
      .map((e) => getTipoEstabelecimentoAnalise(e));
    const inscricoes = filteredEmpresas.map((e) => getTipoInscricaoAnalise(e) || 'Não informado');

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

    const usuariosBase = (filtroDep
      ? usuarios.filter((u) => u.ativo && u.departamentoId === filtroDep)
      : usuarios.filter((u) => u.ativo)
    ).map((u) => {
      const totalEmpresas = filteredEmpresas.filter((empresa) => {
        if (filtroDep) return (empresa.responsaveis || {})[filtroDep] === u.id;
        return Object.values(empresa.responsaveis || {}).some((uid) => uid === u.id);
      }).length;
      return [u.nome, totalEmpresas] as [string, number];
    });

    const byResponsavel = usuariosBase.sort((a, b) => b[1] - a[1]);

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

    // Departamento → Usuário drill-down (usa todas as empresas filtradas, mas ignora filtro de dep/resp para mostrar todos os deps)
    const byDepUsuario = departamentos
      .map((dept) => {
        const usersInDept = usuarios.filter((u) => u.ativo && u.departamentoId === dept.id);
        const usersData = usersInDept
          .map((user) => {
            const count = filteredEmpresas.filter((e) => (e.responsaveis || {})[dept.id] === user.id).length;
            return { id: user.id, nome: user.nome, count };
          })
          .filter((u) => u.count > 0)
          .sort((a, b) => b.count - a.count);
        const total = filteredEmpresas.filter((e) => !!(e.responsaveis || {})[dept.id]).length;
        return { dept, users: usersData, total };
      })
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total);

    return { byServico, byRegime, byEstado, byTipo, byInscricao, byDepartamento, byResponsavel, docStatus, byDepUsuario };
  }, [filteredEmpresas, departamentos, usuarios, filtroDep]);

  const hasFilters = filtroRegime || filtroTipo || filtroTipoInscricao || filtroDep || filtroResponsavel || filtroEstado || statusVenc;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md">
              <BarChart3 className="text-white" size={22} />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard de Análises</div>
              <div className="text-sm text-gray-500">Gráficos e estatísticas • {filteredEmpresas.length} empresas</div>
            </div>
          </div>
          {hasFilters && (
            <button
              onClick={() => { setFiltroRegime(''); setFiltroTipo(''); setFiltroTipoInscricao(''); setFiltroDep(''); setFiltroResponsavel(''); setFiltroEstado(''); setStatusVenc(''); }}
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
            <option value="__nao_informado__">Não informado</option>
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Matriz / Filial</option>
            <option value="matriz">Matriz</option>
            <option value="filial">Filial</option>
            <option value="__nao_informado__">Não informado</option>
          </select>
          <select value={filtroTipoInscricao} onChange={(e) => setFiltroTipoInscricao(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Tipo de inscrição</option>
            <option value="CNPJ">CNPJ</option>
            <option value="CPF">CPF</option>
            <option value="CNO">CNO</option>
            <option value="__nao_informado__">Não informado</option>
          </select>
          <select value={filtroDep} onChange={(e) => { setFiltroDep(e.target.value); setFiltroResponsavel(''); }} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os departamentos</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <select value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os responsáveis</option>
            {responsaveisOptions.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Todos os estados</option>
            {allEstados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <select value={statusVenc} onChange={(e) => setStatusVenc(e.target.value)} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-cyan-400">
            <option value="">Vencimento</option>
            <option value="vencidos">Tem vencidos</option>
            <option value="risco">Em risco</option>
            <option value="emdia">Em dia</option>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel title="Regime Federal" icon={<PieChart size={16} />} color="text-blue-600">
          {stats.byRegime.length === 0 ? <Empty /> : <DonutChart rows={stats.byRegime} compact />}
        </Panel>

        <Panel title="Matriz vs Filial" icon={<Building2 size={16} />} color="text-teal-600">
          {stats.byTipo.length === 0 ? <Empty /> : <DonutChart rows={stats.byTipo} compact />}
        </Panel>

        <Panel title="Por Departamento" icon={<Users size={16} />} color="text-rose-600">
          {stats.byDepartamento.length === 0 ? <Empty /> : <Bars rows={stats.byDepartamento} />}
        </Panel>

        <Panel title="Por Estado (UF)" icon={<MapPin size={16} />} color="text-teal-600">
          {stats.byEstado.length === 0 ? <Empty /> : <HorizontalBars rows={stats.byEstado} />}
        </Panel>
      </div>

      {/* Gráficos secundários */}
      <div className="grid grid-cols-1 gap-6">
        <Panel
          title={filtroDep ? `Responsáveis de ${departamentoSelecionadoNome}` : 'Empresas por Responsável'}
          icon={<Users size={18} />}
          color="text-violet-600"
        >
          {stats.byResponsavel.length === 0 ? (
            <Empty />
          ) : (
            <Bars rows={stats.byResponsavel} limit={filtroDep ? Math.max(stats.byResponsavel.length, 1) : 12} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel title="Empresas por Serviço" icon={<BarChart3 size={18} />} color="text-cyan-600">
          {stats.byServico.length === 0 ? <Empty /> : <Bars rows={stats.byServico} />}
        </Panel>

        <Panel title="Tipo de inscrição" icon={<Briefcase size={18} />} color="text-teal-600">
          {stats.byInscricao.length === 0 ? <Empty /> : <HorizontalBars rows={stats.byInscricao} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel title="Top Serviços (ranking)" icon={<TrendingUp size={18} />} color="text-amber-600">
          {stats.byServico.length === 0 ? <Empty /> : <RankingList rows={stats.byServico.slice(0, 10)} />}
        </Panel>

        <Panel title="Status dos Documentos" icon={<FileCheck size={18} />} color="text-emerald-600">
          {stats.docStatus.length === 0 ? <Empty /> : <DonutChart rows={stats.docStatus} statusColors />}
        </Panel>
      </div>

      {/* Responsáveis e Departamentos */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-indigo-600"><Users size={18} /></span>
          <div className="text-base sm:text-lg font-bold text-gray-900">Responsáveis e Departamentos</div>
        </div>
        <p className="text-xs text-gray-400 mb-4">Clique em um departamento para filtrar · Clique em um usuário para ver só as empresas dele</p>
        {stats.byDepUsuario.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">Sem dados para exibir.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {stats.byDepUsuario.map(({ dept, users, total }) => {
              const isDepSel = filtroDep === dept.id;
              return (
                <div
                  key={dept.id}
                  className={`rounded-xl border p-4 transition-all ${isDepSel ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-slate-50 hover:border-indigo-200 cursor-pointer'}`}
                  onClick={() => { setFiltroDep(isDepSel ? '' : dept.id); setFiltroResponsavel(''); }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-slate-800 truncate pr-2">{dept.nome}</div>
                    <span className="shrink-0 text-xs font-bold text-slate-600 bg-white rounded-full px-2.5 py-0.5 border border-slate-200">{total} empresa{total !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="space-y-1.5">
                    {users.map((u) => {
                      const isUserSel = isDepSel && filtroResponsavel === u.id;
                      return (
                        <div
                          key={u.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isUserSel) {
                              setFiltroResponsavel('');
                            } else {
                              setFiltroDep(dept.id);
                              setFiltroResponsavel(u.id);
                            }
                          }}
                          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition ${isUserSel ? 'bg-indigo-500 text-white' : 'bg-white hover:bg-indigo-50 border border-slate-100'}`}
                        >
                          <span className="font-medium truncate">{u.nome}</span>
                          <span className={`font-bold shrink-0 ${isUserSel ? 'text-white' : 'text-slate-700'}`}>{u.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lista de Empresas Filtradas */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <List size={18} className="text-blue-600" />
          <div className="text-base sm:text-lg font-bold text-gray-900">
            Empresas {hasFilters ? 'filtradas' : ''} ({filteredEmpresas.length})
          </div>
        </div>
        {filteredEmpresas.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-6 text-center text-gray-500 text-sm">
            Nenhuma empresa encontrada com os filtros atuais.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
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
                    const tipo = getBadgeTipoAnalise(emp);
                    const docFormatted = emp.cnpj ? formatarDocumento(emp.cnpj, getTipoInscricaoAnalise(emp) || '') : '-';
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

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {filteredEmpresas.map((emp) => {
                const nome = emp.razao_social || emp.apelido || '-';
                const tipo = getBadgeTipoAnalise(emp);
                const docFormatted = emp.cnpj ? formatarDocumento(emp.cnpj, getTipoInscricaoAnalise(emp) || '') : '-';
                return (
                  <div key={emp.id} className="p-3 hover:bg-gray-50 transition">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="rounded-md bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-2 py-0.5 text-xs font-bold shrink-0">
                          {emp.codigo}
                        </span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase shrink-0 ${tipo.cls}`}>{tipo.label}</span>
                        <span className="font-semibold text-gray-900 truncate text-sm">{nome}</span>
                      </div>
                      <button
                        onClick={() => setEmpresaView(emp)}
                        className="rounded-lg p-1.5 hover:bg-blue-50 transition shrink-0"
                        title="Ver detalhes"
                      >
                        <Eye size={16} className="text-blue-500" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="font-mono">{docFormatted}</span>
                      <span>{emp.regime_federal || '-'}</span>
                      <span>{emp.estado || '-'}</span>
                      <span className="ml-auto font-bold text-gray-700">{emp.documentos.length} docs / {emp.rets.length} RETs</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
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
    <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        {icon && <span className={color || 'text-cyan-600'}>{icon}</span>}
        <div className="text-base sm:text-lg font-bold text-gray-900">{title}</div>
      </div>
      {children}
    </div>
  );
}

function Bars({ rows, limit = 12 }: { rows: Array<[string, number]>; limit?: number }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="space-y-3">
      {rows.slice(0, limit).map(([label, n], idx) => (
        <div key={label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <div className="font-semibold text-gray-800 truncate pr-3">{label}</div>
            <div className="text-gray-600 font-bold">{n}</div>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-3 rounded-full ${barColors[idx % barColors.length]} transition-all duration-500`}
              style={{ width: `${n > 0 ? Math.max((n / max) * 100, 6) : 0}%` }}
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

function DonutChart({ rows, statusColors, compact }: { rows: Array<[string, number]>; statusColors?: boolean; compact?: boolean }) {
  const total = rows.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return <Empty />;

  const statusColorMap: Record<string, string> = {
    'Em dia': '#10b981',
    'Em risco (≤60d)': '#f59e0b',
    'Vencido': '#ef4444',
  };

  const segments = rows.reduce<Array<{ label: string; n: number; percent: number; offset: number; color: string }>>((acc, [label, n], idx) => {
    const percent = n / total;
    const offset = acc.length === 0 ? 0 : acc[acc.length - 1].offset + acc[acc.length - 1].percent;
    const color = statusColors ? (statusColorMap[label] || donutColors[idx % donutColors.length]) : donutColors[idx % donutColors.length];
    acc.push({ label, n, percent, offset, color });
    return acc;
  }, []);

  const radius = compact ? 44 : 60;
  const size = compact ? 110 : 150;
  const strokeWidth = compact ? 18 : 24;
  const circumference = 2 * Math.PI * radius;

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-3">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={radius}
              fill="none" stroke={s.color} strokeWidth={strokeWidth}
              strokeDasharray={`${s.percent * circumference} ${circumference}`}
              strokeDashoffset={-s.offset * circumference}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
          <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle" fill="#111827" fontSize="16" fontWeight="bold">
            {total}
          </text>
        </svg>
        <div className="w-full space-y-1">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <div className="text-xs text-gray-700 truncate flex-1">{s.label}</div>
              <div className="text-xs font-bold text-gray-600 whitespace-nowrap">{s.n} <span className="text-gray-400 font-normal">({Math.round(s.percent * 100)}%)</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
      <div className="shrink-0">
        <svg width="150" height="150" viewBox="0 0 150 150">
          {segments.map((s, i) => (
            <circle
              key={i}
              cx="75" cy="75" r={radius}
              fill="none" stroke={s.color} strokeWidth="24"
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

