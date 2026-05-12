'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, Eye, FileText, Loader2, Undo2 } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';
import { supabasePortal } from '@/lib/supabasePortal';
import PortalHeader from '@/app/portal/components/PortalHeader';

type AcaoTipo = 'visualizou' | 'baixou' | 'marcou_pago' | 'desmarcou_pago';

type Acesso = {
  id: string;
  acao: AcaoTipo;
  criado_em: string;
  documento_id: string | null;
  documento: { id: string; obrigacao_nome: string; competencia: string | null } | null;
};

type FiltroAcao = 'todas' | AcaoTipo;

const ACAO_INFO: Record<AcaoTipo, { texto: string; icon: React.ComponentType<{ size?: number; className?: string }>; cor: string }> = {
  visualizou: { texto: 'Visualizou', icon: Eye, cor: 'text-blue-600 dark:text-blue-400' },
  baixou: { texto: 'Baixou', icon: Download, cor: 'text-emerald-600 dark:text-emerald-400' },
  marcou_pago: { texto: 'Marcou como pago', icon: CheckCircle2, cor: 'text-emerald-700 dark:text-emerald-300' },
  desmarcou_pago: { texto: 'Desfez marcação de pago', icon: Undo2, cor: 'text-slate-500 dark:text-slate-400' },
};

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatCompetencia(comp: string | null): string {
  if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return comp ?? '';
  const [ano, mes] = comp.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[parseInt(mes, 10) - 1]}/${ano}`;
}

function dataChave(iso: string): string {
  // YYYY-MM-DD pra agrupar por dia
  return iso.slice(0, 10);
}

function formatDataAmigavel(chave: string): string {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const hojeKey = hoje.toISOString().slice(0, 10);
  const ontemKey = ontem.toISOString().slice(0, 10);
  if (chave === hojeKey) return 'Hoje';
  if (chave === ontemKey) return 'Ontem';
  const d = new Date(chave + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export default function HistoricoPage() {
  const router = useRouter();
  const { cliente, acessos: acessosPortal, authReady } = usePortal();
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [filtro, setFiltro] = useState<FiltroAcao>('todas');

  useEffect(() => {
    if (authReady && !cliente && acessosPortal.length === 0) router.replace('/portal/login');
  }, [authReady, cliente, acessosPortal.length, router]);

  useEffect(() => {
    if (!cliente) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabasePortal
        .from('portal_acessos')
        .select('id, acao, criado_em, documento_id, documento:portal_documentos(id, obrigacao_nome, competencia)')
        .eq('cliente_id', cliente.id)
        .in('acao', ['visualizou', 'baixou', 'marcou_pago', 'desmarcou_pago'])
        .order('criado_em', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.error('Erro ao carregar histórico:', error);
        setAcessos([]);
      } else {
        type DocShape = { id: string; obrigacao_nome: string; competencia: string | null };
        const normalizado = (data ?? []).map((row) => {
          const docField = (row as unknown as { documento: DocShape | DocShape[] | null }).documento;
          const doc: DocShape | null = Array.isArray(docField)
            ? (docField[0] ?? null)
            : (docField ?? null);
          return { ...row, documento: doc } as Acesso;
        });
        setAcessos(normalizado);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cliente]);

  const acessosFiltrados = useMemo(() => {
    if (!acessos) return [];
    return acessos.filter((a) => filtro === 'todas' || a.acao === filtro);
  }, [acessos, filtro]);

  const agrupados = useMemo(() => {
    const grupos = new Map<string, Acesso[]>();
    for (const a of acessosFiltrados) {
      const key = dataChave(a.criado_em);
      const arr = grupos.get(key) ?? [];
      arr.push(a);
      grupos.set(key, arr);
    }
    return Array.from(grupos.entries());
  }, [acessosFiltrados]);

  const contadores = useMemo(() => {
    if (!acessos) return { todas: 0, visualizou: 0, baixou: 0, marcou_pago: 0 };
    return {
      todas: acessos.length,
      visualizou: acessos.filter((a) => a.acao === 'visualizou').length,
      baixou: acessos.filter((a) => a.acao === 'baixou').length,
      marcou_pago: acessos.filter((a) => a.acao === 'marcou_pago').length,
    };
  }, [acessos]);

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
      <PortalHeader backHref="/portal" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-xl font-semibold">Histórico de acessos</h1>
        <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
          Registro de todas as ações que você fez nas suas guias. Útil pra consulta e comprovação.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <FiltroChip ativo={filtro === 'todas'} onClick={() => setFiltro('todas')}>
            Todas ({contadores.todas})
          </FiltroChip>
          <FiltroChip ativo={filtro === 'visualizou'} onClick={() => setFiltro('visualizou')}>
            <Eye size={12} /> Visualizou ({contadores.visualizou})
          </FiltroChip>
          <FiltroChip ativo={filtro === 'baixou'} onClick={() => setFiltro('baixou')}>
            <Download size={12} /> Baixou ({contadores.baixou})
          </FiltroChip>
          <FiltroChip ativo={filtro === 'marcou_pago'} onClick={() => setFiltro('marcou_pago')}>
            <CheckCircle2 size={12} /> Marcou pago ({contadores.marcou_pago})
          </FiltroChip>
        </div>

        {acessos === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : agrupados.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-900">
            <Clock size={36} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              Nenhum acesso registrado ainda
            </p>
            <p className="mt-1 text-xs text-slate-500">Suas ações nas guias aparecerão aqui.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {agrupados.map(([dia, eventos]) => (
              <section key={dia}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatDataAmigavel(dia)}
                </h2>
                <ul className="space-y-2">
                  {eventos.map((a) => (
                    <EventoItem key={a.id} acesso={a} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
        ativo
          ? 'border-cyan-600 bg-cyan-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function EventoItem({ acesso }: { acesso: Acesso }) {
  const info = ACAO_INFO[acesso.acao];
  const Icon = info.icon;
  const hora = new Date(acesso.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const conteudo = (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition hover:border-cyan-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-700">
      <div className={`mt-0.5 rounded-md bg-slate-100 p-2 dark:bg-slate-800 ${info.cor}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={`font-medium ${info.cor}`}>{info.texto}</span>
          {acesso.documento && (
            <>
              {' — '}
              <span className="font-medium text-slate-800 dark:text-slate-200">{acesso.documento.obrigacao_nome}</span>
              {acesso.documento.competencia && (
                <span className="ml-1 text-xs text-slate-500">({formatCompetencia(acesso.documento.competencia)})</span>
              )}
            </>
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">{hora} · {formatDataHora(acesso.criado_em)}</p>
      </div>
      {acesso.documento && (
        <FileText size={14} className="mt-2 shrink-0 text-slate-400" />
      )}
    </div>
  );

  return (
    <li>
      {acesso.documento ? (
        <Link href={`/portal/documentos/${acesso.documento.id}`} className="block">
          {conteudo}
        </Link>
      ) : (
        conteudo
      )}
    </li>
  );
}
