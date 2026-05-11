'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, FileText, Inbox, Loader2 } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';
import { supabasePortal } from '@/lib/supabasePortal';
import PortalHeader from '@/app/portal/components/PortalHeader';
import PushPrompt from '@/app/portal/components/PushPrompt';

type Documento = {
  id: string;
  obrigacao_nome: string;
  competencia: string | null;
  vencimento: string | null;
  descricao: string | null;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number | null;
  visualizado_em: string | null;
  baixado_em: string | null;
  marcado_pago_em: string | null;
  criado_em: string;
};

type Filtro = 'todas' | 'pendentes' | 'pagas';

type Status = 'pago' | 'vencido' | 'critico' | 'atencao' | 'normal' | 'sem-vencimento';

function calcStatus(doc: Documento): Status {
  if (doc.marcado_pago_em) return 'pago';
  if (!doc.vencimento) return 'sem-vencimento';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(doc.vencimento + 'T00:00:00');
  const dias = Math.floor((venc.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= 7) return 'critico';
  if (dias <= 30) return 'atencao';
  return 'normal';
}

function statusBadge(s: Status) {
  switch (s) {
    case 'pago':
      return { texto: 'Pago', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' };
    case 'vencido':
      return { texto: 'Vencido', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' };
    case 'critico':
      return { texto: 'Vence em breve', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' };
    case 'atencao':
      return { texto: 'Próximo', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' };
    case 'normal':
      return { texto: 'No prazo', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
    case 'sem-vencimento':
      return { texto: 'Disponível', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
}

function formatData(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function formatCompetencia(comp: string | null): string {
  if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return comp ?? '—';
  const [ano, mes] = comp.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[parseInt(mes, 10) - 1]}/${ano}`;
}

export default function PortalHomePage() {
  const router = useRouter();
  const { cliente, authReady } = usePortal();
  const [documentos, setDocumentos] = useState<Documento[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('pendentes');
  const [competenciaFiltro, setCompetenciaFiltro] = useState<string>('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (authReady && !cliente) router.replace('/portal/login');
  }, [authReady, cliente, router]);

  useEffect(() => {
    if (!cliente) return;
    let cancelled = false;
    (async () => {
      setCarregando(true);
      const { data, error } = await supabasePortal
        .from('portal_documentos')
        .select('id, obrigacao_nome, competencia, vencimento, descricao, arquivo_nome_original, arquivo_tamanho_bytes, visualizado_em, baixado_em, marcado_pago_em, criado_em')
        .order('vencimento', { ascending: true, nullsFirst: false })
        .order('criado_em', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('Erro ao carregar documentos do portal:', error);
        setDocumentos([]);
      } else {
        setDocumentos(data as Documento[]);
      }
      setCarregando(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cliente]);

  const competenciasDisponiveis = useMemo(() => {
    if (!documentos) return [];
    const set = new Set<string>();
    documentos.forEach((d) => {
      if (d.competencia) set.add(d.competencia);
    });
    return Array.from(set).sort().reverse();
  }, [documentos]);

  const documentosFiltrados = useMemo(() => {
    if (!documentos) return [];
    return documentos.filter((d) => {
      if (filtro === 'pendentes' && d.marcado_pago_em) return false;
      if (filtro === 'pagas' && !d.marcado_pago_em) return false;
      if (competenciaFiltro && d.competencia !== competenciaFiltro) return false;
      return true;
    });
  }, [documentos, filtro, competenciaFiltro]);

  const contadores = useMemo(() => {
    if (!documentos) return { pendentes: 0, pagas: 0, total: 0 };
    return {
      pendentes: documentos.filter((d) => !d.marcado_pago_em).length,
      pagas: documentos.filter((d) => d.marcado_pago_em).length,
      total: documentos.length,
    };
  }, [documentos]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!cliente) return null;

  return (
    <>
      <PortalHeader />
      <PushPrompt />

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Suas guias</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Aqui ficam as guias e documentos que o escritório envia. Baixe, pague e marque como concluído.
          </p>
        </div>

        {/* Tabs / filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FiltroTab ativo={filtro === 'pendentes'} onClick={() => setFiltro('pendentes')}>
            Pendentes
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {contadores.pendentes}
            </span>
          </FiltroTab>
          <FiltroTab ativo={filtro === 'pagas'} onClick={() => setFiltro('pagas')}>
            Pagas
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {contadores.pagas}
            </span>
          </FiltroTab>
          <FiltroTab ativo={filtro === 'todas'} onClick={() => setFiltro('todas')}>
            Todas
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {contadores.total}
            </span>
          </FiltroTab>

          {competenciasDisponiveis.length > 0 && (
            <select
              value={competenciaFiltro}
              onChange={(e) => setCompetenciaFiltro(e.target.value)}
              className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Todos os meses</option>
              {competenciasDisponiveis.map((c) => (
                <option key={c} value={c}>
                  {formatCompetencia(c)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Conteúdo */}
        {carregando ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : documentosFiltrados.length === 0 ? (
          <EmptyState semNada={documentos?.length === 0} />
        ) : (
          <ul className="space-y-3">
            {documentosFiltrados.map((doc) => (
              <li key={doc.id}>
                <DocumentoCard doc={doc} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function FiltroTab({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        ativo
          ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
          : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      } border border-slate-200 dark:border-slate-800`}
    >
      {children}
    </button>
  );
}

function DocumentoCard({ doc }: { doc: Documento }) {
  const status = calcStatus(doc);
  const badge = statusBadge(status);

  return (
    <Link
      href={`/portal/documentos/${doc.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-slate-100 p-2 dark:bg-slate-800">
          <FileText size={18} className="text-slate-600 dark:text-slate-300" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{doc.obrigacao_nome}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.texto}</span>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span>Competência: <strong>{formatCompetencia(doc.competencia)}</strong></span>
            <span className="flex items-center gap-1">
              <Clock size={12} /> Vence: <strong>{formatData(doc.vencimento)}</strong>
            </span>
          </div>

          {(doc.baixado_em || doc.marcado_pago_em) && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-500">
              {doc.baixado_em && (
                <span className="inline-flex items-center gap-1">
                  <Download size={11} /> Baixado em {formatData(doc.baixado_em)}
                </span>
              )}
              {doc.marcado_pago_em && (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={11} /> Pago em {formatData(doc.marcado_pago_em)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ semNada }: { semNada?: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      <Inbox size={36} className="mx-auto text-slate-400" />
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
        {semNada ? 'Nenhuma guia recebida ainda' : 'Nada por aqui com esse filtro'}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {semNada
          ? 'Quando o escritório enviar uma guia, ela aparecerá aqui automaticamente.'
          : 'Tente trocar de aba ou mudar o mês selecionado.'}
      </p>
    </div>
  );
}
