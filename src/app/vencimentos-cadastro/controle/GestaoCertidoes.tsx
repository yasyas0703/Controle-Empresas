'use client';

// Aba "Gestão de Certidões" do Controle Cadastro — controle de VALIDADE.
// O chefe vê o que está vigente, a vencer (30/15/7 dias) e vencido, com os
// detalhes de cada certidão e o PDF original a um clique.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, XCircle, Loader2, FileCheck2, Clock, AlertTriangle, FileQuestion,
  FileText, Eye, RefreshCw, MailCheck, ListChecks,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { ChecklistCadastroItem, Empresa, CadastroResultado } from '@/app/types';
import { CADASTRO_CERTIDAO_COLUNAS, CADASTRO_CERTIDAO_LABEL } from '@/app/types';
import type { CadastroCertidaoColuna } from '@/app/types';
import * as db from '@/lib/db';
import { daysUntil, formatBR } from '@/app/utils/date';
import { colunaDaCertidao, ufDaEmpresa } from '@/app/utils/certidoes';

// Faixas de alerta (sugeridas no levantamento: 30 / 15 / 7 dias).
const DIAS_A_VENCER = 30;
const DIAS_ALERTA_15 = 15;
const DIAS_ALERTA_7 = 7;

type StatusValidade = 'vigente' | 'a_vencer' | 'vencida' | 'sem_validade';

function statusValidade(item: ChecklistCadastroItem): { status: StatusValidade; dias: number | null } {
  if (!item.validadeEm) return { status: 'sem_validade', dias: null };
  const dias = daysUntil(item.validadeEm);
  if (dias === null) return { status: 'sem_validade', dias: null };
  if (dias < 0) return { status: 'vencida', dias };
  if (dias <= DIAS_A_VENCER) return { status: 'a_vencer', dias };
  return { status: 'vigente', dias };
}

const STATUS_STYLE: Record<StatusValidade, { badge: string; dot: string; label: string }> = {
  vigente:      { badge: 'bg-emerald-50 border-emerald-300 text-emerald-700', dot: 'bg-emerald-500', label: 'Vigente' },
  a_vencer:     { badge: 'bg-amber-50 border-amber-300 text-amber-700',       dot: 'bg-amber-500',   label: 'A vencer' },
  vencida:      { badge: 'bg-red-50 border-red-300 text-red-700',             dot: 'bg-red-500',     label: 'Vencida' },
  sem_validade: { badge: 'bg-slate-50 border-slate-300 text-slate-600',       dot: 'bg-slate-400',   label: 'Sem validade' },
};

const RESULTADO_BADGE: Record<CadastroResultado, string> = {
  Negativa: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  PEN: 'bg-amber-50 border-amber-300 text-amber-700',
  Positiva: 'bg-red-50 border-red-300 text-red-700',
};

function fmtCnpj(c?: string): string {
  const d = (c ?? '').replace(/\D/g, '');
  if (d.length !== 14) return c ?? '';
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function mesLabel(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

interface Linha {
  item: ChecklistCadastroItem;
  empresa: Empresa | undefined;
  coluna: CadastroCertidaoColuna;
  subLabel: string | null;
  status: StatusValidade;
  dias: number | null;
  enviadaEm: string | null;
}

export default function GestaoCertidoes() {
  const { empresas, mostrarAlerta } = useSistema();

  const [items, setItems] = useState<ChecklistCadastroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [abrindoId, setAbrindoId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroUf, setFiltroUf] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'' | StatusValidade>('');
  const [filtroMes, setFiltroMes] = useState('');
  // Default: só a certidão MAIS RECENTE de cada empresa × tipo (estado atual).
  // Desligado = histórico completo (todas as competências).
  const [soMaisRecente, setSoMaisRecente] = useState(true);
  const [paginaTamanho, setPaginaTamanho] = useState(100);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await db.fetchChecklistCadastroTodos());
    } catch (err) {
      console.error('[gestao-certidoes] erro ao carregar:', err);
      mostrarAlerta('Erro ao carregar', 'Não foi possível carregar as certidões.', 'erro');
    } finally {
      setLoading(false);
    }
  }, [mostrarAlerta]);

  useEffect(() => { void carregar(); }, [carregar]);

  const empresaById = useMemo(() => new Map(empresas.map((e) => [e.id, e])), [empresas]);

  const meses = useMemo(
    () => Array.from(new Set(items.map((i) => i.mes))).sort().reverse(),
    [items],
  );
  const ufs = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      const e = empresaById.get(i.empresaId);
      const uf = i.uf || (e ? ufDaEmpresa(e) : '');
      if (uf) s.add(uf.toUpperCase());
    }
    return Array.from(s).sort();
  }, [items, empresaById]);

  // Linhas: monta, deduplica (mais recente por empresa×certidão) e filtra.
  const linhas = useMemo(() => {
    let base = items;
    if (soMaisRecente) {
      // items já vêm ordenados por mes DESC — o primeiro de cada chave é o mais novo.
      const vistos = new Set<string>();
      base = items.filter((i) => {
        const k = `${i.empresaId}|${i.certidao}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    const qDig = q.replace(/\D/g, '');
    const out: Linha[] = [];
    for (const item of base) {
      const empresa = empresaById.get(item.empresaId);
      const coluna = colunaDaCertidao(item.certidao);
      const { status, dias } = statusValidade(item);
      if (filtroTipo && coluna !== filtroTipo) continue;
      if (filtroMes && item.mes !== filtroMes) continue;
      if (filtroStatus && status !== filtroStatus) continue;
      const uf = (item.uf || (empresa ? ufDaEmpresa(empresa) : '')).toUpperCase();
      if (filtroUf && uf !== filtroUf) continue;
      if (q) {
        const alvo = [
          empresa?.razao_social, empresa?.apelido, empresa?.codigo,
          item.numeroCertidao, item.codigoAutenticidade,
        ].filter(Boolean).join(' ').toLowerCase();
        const cnpjDig = (empresa?.cnpj ?? '').replace(/\D/g, '');
        const bateTexto = alvo.includes(q);
        const bateCnpj = qDig.length >= 4 && cnpjDig.includes(qDig);
        if (!bateTexto && !bateCnpj) continue;
      }
      const envio = (item.enviosHistorico ?? []).find((e) => e.sucesso);
      out.push({
        item, empresa, coluna,
        subLabel: item.certidao === 'ESTADUAL_ADM' ? 'Adm.' : item.certidao === 'ESTADUAL_DA' ? 'Dív. Ativa' : null,
        status, dias,
        enviadaEm: envio?.enviadoEm ?? null,
      });
    }
    // Ordena pelo que precisa de atenção: vencidas primeiro, depois mais próximas
    // de vencer; sem validade no fim (dentro de cada grupo, por empresa).
    const peso = (l: Linha) => (l.dias === null ? Number.MAX_SAFE_INTEGER : l.dias);
    out.sort((a, b) => {
      const d = peso(a) - peso(b);
      if (d !== 0) return d;
      const na = a.empresa?.apelido || a.empresa?.razao_social || '';
      const nb = b.empresa?.apelido || b.empresa?.razao_social || '';
      return na.localeCompare(nb, 'pt-BR');
    });
    return out;
  }, [items, empresaById, soMaisRecente, search, filtroTipo, filtroUf, filtroStatus, filtroMes]);

  useEffect(() => { setPaginaTamanho(100); }, [search, filtroTipo, filtroUf, filtroStatus, filtroMes, soMaisRecente]);

  // Dashboard (sobre as linhas filtradas)
  const stats = useMemo(() => {
    let vigentes = 0, aVencer = 0, aVencer15 = 0, aVencer7 = 0, vencidas = 0, semValidade = 0, soRelatorio = 0;
    for (const l of linhas) {
      if (l.status === 'vigente') vigentes++;
      else if (l.status === 'a_vencer') {
        aVencer++;
        if (l.dias !== null && l.dias <= DIAS_ALERTA_15) aVencer15++;
        if (l.dias !== null && l.dias <= DIAS_ALERTA_7) aVencer7++;
      } else if (l.status === 'vencida') vencidas++;
      else {
        semValidade++;
        if (!l.item.arquivoUrl && (l.item.relatorioUrl || l.item.relatorioTexto)) soRelatorio++;
      }
    }
    return { total: linhas.length, vigentes, aVencer, aVencer15, aVencer7, vencidas, semValidade, soRelatorio };
  }, [linhas]);

  const visiveis = linhas.slice(0, paginaTamanho);

  const abrirPdf = async (l: Linha) => {
    const url = l.item.arquivoUrl ?? l.item.relatorioUrl;
    if (!url) return;
    setAbrindoId(l.item.id);
    try {
      const signed = await db.getCadastroArquivoSignedUrl(url);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível abrir o arquivo.', 'erro');
    } finally {
      setAbrindoId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Cards do painel */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <CardStat icon={<ListChecks size={15} className="text-[var(--text-3)]" />} label="Total de certidões" valor={stats.total} cor="text-[var(--text-1)]" />
        <CardStat icon={<FileCheck2 size={15} className="text-emerald-500" />} label="Vigentes" valor={stats.vigentes} cor="text-emerald-600" />
        <CardStat
          icon={<Clock size={15} className="text-amber-500" />}
          label={`A vencer (≤${DIAS_A_VENCER}d)`}
          valor={stats.aVencer}
          cor="text-amber-600"
          detalhe={`≤${DIAS_ALERTA_15}d: ${stats.aVencer15} · ≤${DIAS_ALERTA_7}d: ${stats.aVencer7}`}
        />
        <CardStat icon={<AlertTriangle size={15} className="text-red-500" />} label="Vencidas" valor={stats.vencidas} cor="text-red-600" />
        <CardStat
          icon={<FileQuestion size={15} className="text-[var(--text-3)]" />}
          label="Sem validade"
          valor={stats.semValidade}
          cor="text-[var(--text-2)]"
          detalhe={stats.soRelatorio ? `só relatório: ${stats.soRelatorio}` : undefined}
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa, CNPJ, nº da certidão ou código de autenticidade…"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] py-2.5 pl-9 pr-9 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]">
              <XCircle size={16} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2.5 text-sm text-[var(--text-1)]">
            <option value="">Todos os tipos</option>
            {CADASTRO_CERTIDAO_COLUNAS.map((c) => <option key={c} value={c}>{CADASTRO_CERTIDAO_LABEL[c]}</option>)}
          </select>
          <select value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2.5 text-sm text-[var(--text-1)]">
            <option value="">Todas as UF</option>
            {ufs.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as '' | StatusValidade)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2.5 text-sm text-[var(--text-1)]">
            <option value="">Todos os status</option>
            <option value="vigente">Vigente</option>
            <option value="a_vencer">A vencer (≤{DIAS_A_VENCER}d)</option>
            <option value="vencida">Vencida</option>
            <option value="sem_validade">Sem validade</option>
          </select>
          <select value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2.5 text-sm capitalize text-[var(--text-1)]">
            <option value="">Todos os meses</option>
            {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2.5 text-xs text-[var(--text-2)]">
            <input type="checkbox" checked={soMaisRecente} onChange={(e) => setSoMaisRecente(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
            Só a mais recente
          </label>
          <button onClick={() => void carregar()} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[var(--text-2)] hover:bg-[var(--surface-3)]" title="Recarregar">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-2)]">
        {(['vigente', 'a_vencer', 'vencida', 'sem_validade'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[s].dot}`} />
            {STATUS_STYLE[s].label}{s === 'a_vencer' ? ` (≤${DIAS_A_VENCER} dias)` : ''}
          </span>
        ))}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-10 text-sm text-[var(--text-2)]">
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]" style={{ maxHeight: '68vh' }}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {['Empresa', 'CNPJ / Inscrição', 'Tipo', 'UF', 'Resultado', 'Emissão', 'Validade', 'Dias', 'Status', 'Nº certidão', 'Órgão', 'Enviada', 'Arquivo'].map((h) => (
                  <th key={h} className="sticky top-0 z-10 whitespace-nowrap border-b border-r border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-2)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const st = STATUS_STYLE[l.status];
                return (
                  <tr key={l.item.id} className="hover:bg-[var(--surface-2)]/40">
                    <td className="max-w-[230px] border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      <div className="truncate font-semibold text-[var(--text-1)]">{l.empresa?.apelido || l.empresa?.razao_social || '—'}</div>
                      {!soMaisRecente && <div className="text-[10px] capitalize text-[var(--text-3)]">{mesLabel(l.item.mes)}</div>}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      <div className="font-mono text-xs text-[var(--text-2)]">{fmtCnpj(l.empresa?.cnpj) || '—'}</div>
                      {l.empresa?.inscricao_estadual && <div className="font-mono text-[10px] text-[var(--text-3)]">IE {l.empresa.inscricao_estadual}</div>}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5 text-[var(--text-1)]">
                      {CADASTRO_CERTIDAO_LABEL[l.coluna]}{l.subLabel ? <span className="text-xs text-[var(--text-3)]"> · {l.subLabel}</span> : null}
                    </td>
                    <td className="border-b border-r border-[var(--border)] px-2.5 py-1.5 text-[var(--text-2)]">{l.item.uf || (l.empresa ? ufDaEmpresa(l.empresa) : '') || '—'}</td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      {l.item.resultado ? (
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RESULTADO_BADGE[l.item.resultado]}`}>
                          {l.item.resultado === 'PEN' ? 'PEN' : l.item.resultado}
                        </span>
                      ) : (l.item.relatorioUrl || l.item.relatorioTexto) ? (
                        <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Relatório</span>
                      ) : <span className="text-[var(--text-3)]">—</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5 text-[var(--text-2)]">{l.item.emissaoEm ? formatBR(l.item.emissaoEm) : '—'}</td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5 font-semibold text-[var(--text-1)]">{l.item.validadeEm ? formatBR(l.item.validadeEm) : '—'}</td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      {l.dias === null ? <span className="text-[var(--text-3)]">—</span>
                        : l.dias < 0 ? <span className="font-semibold text-red-600">{Math.abs(l.dias)}d atrás</span>
                        : <span className={l.dias <= DIAS_A_VENCER ? 'font-semibold text-amber-600' : 'text-[var(--text-2)]'}>{l.dias}d</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                      </span>
                    </td>
                    <td className="max-w-[150px] truncate border-b border-r border-[var(--border)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-2)]" title={l.item.numeroCertidao ?? undefined}>
                      {l.item.numeroCertidao ?? '—'}
                    </td>
                    <td className="max-w-[160px] truncate border-b border-r border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-2)]" title={l.item.orgaoEmissor ?? undefined}>
                      {l.item.orgaoEmissor ?? '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5 text-xs">
                      {l.enviadaEm ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600"><MailCheck size={13} /> {formatBR(l.enviadaEm)}</span>
                      ) : <span className="text-[var(--text-3)]">não</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-[var(--border)] px-2.5 py-1.5">
                      {(l.item.arquivoUrl || l.item.relatorioUrl) ? (
                        <button
                          onClick={() => void abrirPdf(l)}
                          disabled={abrindoId === l.item.id}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold text-[var(--text-1)] hover:bg-[var(--surface-3)]"
                          title={l.item.arquivoNome ?? l.item.relatorioNome ?? 'Abrir PDF'}
                        >
                          {abrindoId === l.item.id ? <Loader2 size={13} className="animate-spin" /> : l.item.arquivoUrl ? <Eye size={13} /> : <FileText size={13} />}
                          {l.item.arquivoUrl ? 'Ver PDF' : 'Relatório'}
                        </button>
                      ) : <span className="text-[var(--text-3)]">—</span>}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-sm text-[var(--text-3)]">
                    Nenhuma certidão encontrada com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {linhas.length > paginaTamanho && (
        <div className="flex justify-center">
          <button onClick={() => setPaginaTamanho((p) => p + 100)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--text-1)] hover:bg-[var(--surface-3)]">
            Mostrar mais ({linhas.length - paginaTamanho} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

function CardStat({ icon, label, valor, cor, detalhe }: {
  icon: React.ReactNode; label: string; valor: number; cor: string; detalhe?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">{icon}{label}</div>
      <div className={`text-xl font-bold ${cor}`}>{valor}</div>
      {detalhe && <div className="text-[11px] text-[var(--text-3)]">{detalhe}</div>}
    </div>
  );
}
