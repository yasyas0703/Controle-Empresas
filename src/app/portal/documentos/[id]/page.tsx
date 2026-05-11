'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, FileText, Loader2, Undo2 } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';
import { supabasePortal } from '@/lib/supabasePortal';
import PortalHeader from '@/app/portal/components/PortalHeader';

type Documento = {
  id: string;
  obrigacao_nome: string;
  competencia: string | null;
  vencimento: string | null;
  descricao: string | null;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number | null;
  enviado_email: boolean;
  enviado_email_em: string | null;
  visualizado_em: string | null;
  baixado_em: string | null;
  marcado_pago_em: string | null;
  criado_em: string;
};

function formatDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatData(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function formatTamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentoDetalhePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { cliente, authReady } = usePortal();
  const [doc, setDoc] = useState<Documento | null | 'not-found'>(null);
  const [baixando, setBaixando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function getAccessToken(): Promise<string | null> {
    const { data } = await supabasePortal.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function handleBaixar() {
    if (!doc || doc === 'not-found' || baixando) return;
    setBaixando(true);
    setErroAcao(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setErroAcao('Sua sessão expirou. Faça login novamente.');
        return;
      }
      const res = await fetch(`/api/portal/documentos/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        setErroAcao(json?.error || 'Falha ao gerar link de download.');
        return;
      }
      // Dispara download via anchor (preserva nome do arquivo).
      const a = document.createElement('a');
      a.href = json.url;
      a.download = json.filename || doc.arquivo_nome_original;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Atualiza estado local pra refletir baixado_em + visualizado_em (baixar implica visualizar).
      const nowIso = new Date().toISOString();
      setDoc((prev) => {
        if (!prev || prev === 'not-found') return prev;
        return {
          ...prev,
          baixado_em: prev.baixado_em ?? json.baixado_em ?? nowIso,
          visualizado_em: prev.visualizado_em ?? json.visualizado_em ?? nowIso,
        };
      });
    } finally {
      setBaixando(false);
    }
  }

  async function handleMarcarPago(acao: 'marcar' | 'desmarcar') {
    if (!doc || doc === 'not-found' || marcando) return;
    setMarcando(true);
    setErroAcao(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setErroAcao('Sua sessão expirou. Faça login novamente.');
        return;
      }
      const res = await fetch(`/api/portal/documentos/${doc.id}/marcar-pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acao }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setErroAcao(json?.error || 'Falha ao atualizar status.');
        return;
      }
      setDoc((prev) =>
        prev && prev !== 'not-found' ? { ...prev, marcado_pago_em: json.marcado_pago_em } : prev
      );
    } finally {
      setMarcando(false);
    }
  }

  useEffect(() => {
    if (authReady && !cliente) router.replace('/portal/login');
  }, [authReady, cliente, router]);

  useEffect(() => {
    if (!cliente || !params?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabasePortal
        .from('portal_documentos')
        .select('id, obrigacao_nome, competencia, vencimento, descricao, arquivo_nome_original, arquivo_tamanho_bytes, enviado_email, enviado_email_em, visualizado_em, baixado_em, marcado_pago_em, criado_em')
        .eq('id', params.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setDoc('not-found');
        return;
      }
      setDoc(data as Documento);

      // Registra "visualizou" — uma vez por sessão por doc (sessionStorage
      // evita spam em refresh; nova aba/login reinicia o flag).
      const flag = `portal-visualizou-${data.id}`;
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, '1');
        void (async () => {
          const { data: session } = await supabasePortal.auth.getSession();
          const token = session.session?.access_token;
          if (!token) return;
          try {
            const res = await fetch(`/api/portal/documentos/${data.id}/visualizar`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const json = (await res.json().catch(() => ({}))) as { visualizado_em?: string };
            const visualizadoEm = json.visualizado_em || new Date().toISOString();
            if (cancelled) return;
            // Atualiza estado local pra refletir na timeline sem precisar reabrir.
            setDoc((prev) => {
              if (!prev || prev === 'not-found') return prev;
              return prev.visualizado_em ? prev : { ...prev, visualizado_em: visualizadoEm };
            });
          } catch {
            // Silencioso — não bloqueia UX.
          }
        })();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cliente, params?.id]);

  if (!authReady || (cliente && doc === null)) {
    return (
      <>
        <PortalHeader backHref="/portal" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </>
    );
  }
  if (!cliente) return null;

  if (doc === 'not-found') {
    return (
      <>
        <PortalHeader backHref="/portal" />
        <main className="mx-auto max-w-3xl px-4 py-10 text-center">
          <p className="text-base font-medium text-slate-700 dark:text-slate-200">Guia não encontrada</p>
          <p className="mt-1 text-sm text-slate-500">Esse documento não existe ou foi removido.</p>
        </main>
      </>
    );
  }
  if (!doc) return null;

  const naoPago = !doc.marcado_pago_em;

  return (
    <>
      <PortalHeader backHref="/portal" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <section className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-cyan-50 p-3 dark:bg-cyan-900/30">
              <FileText size={24} className="text-cyan-700 dark:text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{doc.obrigacao_nome}</h1>
              <p className="mt-0.5 truncate text-sm text-slate-500">{doc.arquivo_nome_original}</p>
            </div>
          </div>

          {doc.descricao && (
            <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
              {doc.descricao}
            </p>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Info label="Competência" valor={doc.competencia ?? '—'} />
            <Info label="Vencimento" valor={formatData(doc.vencimento)} />
            <Info label="Tamanho" valor={formatTamanho(doc.arquivo_tamanho_bytes) || '—'} />
            <Info label="Recebido em" valor={formatDataHora(doc.criado_em)} />
            <Info label="Email enviado" valor={doc.enviado_email ? formatDataHora(doc.enviado_email_em) : 'Não'} />
          </dl>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleBaixar}
              disabled={baixando}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-cyan-700 disabled:opacity-60"
            >
              {baixando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Baixar guia
            </button>
            {naoPago ? (
              <button
                onClick={() => handleMarcarPago('marcar')}
                disabled={marcando}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-emerald-600 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                {marcando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Marcar como pago
              </button>
            ) : (
              <div className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 size={16} /> Pago em {formatData(doc.marcado_pago_em)}
                <button
                  onClick={() => handleMarcarPago('desmarcar')}
                  disabled={marcando}
                  title="Desfazer marcação"
                  className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                >
                  <Undo2 size={12} /> desfazer
                </button>
              </div>
            )}
          </div>

          {erroAcao && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {erroAcao}
            </div>
          )}
        </section>

        {/* Timeline */}
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Clock size={16} /> Histórico
          </h2>
          <ul className="space-y-2 text-sm">
            <TimelineItem label="Recebido no portal" data={doc.criado_em} ativo />
            <TimelineItem label="Email enviado" data={doc.enviado_email_em} ativo={doc.enviado_email} />
            <TimelineItem label="Visualizado por você" data={doc.visualizado_em} ativo={!!doc.visualizado_em} />
            <TimelineItem label="Baixado por você" data={doc.baixado_em} ativo={!!doc.baixado_em} />
            <TimelineItem label="Marcado como pago" data={doc.marcado_pago_em} ativo={!!doc.marcado_pago_em} />
          </ul>
        </section>
      </main>
    </>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">{valor}</dd>
    </div>
  );
}

function TimelineItem({ label, data, ativo }: { label: string; data: string | null; ativo: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className={`flex items-center gap-2 ${ativo ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>
        <span className={`h-2 w-2 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
        {label}
      </span>
      <span className={`text-xs ${ativo ? 'text-slate-500' : 'text-slate-400'}`}>{data ? formatDataHora(data) : '—'}</span>
    </li>
  );
}
