'use client';

// Painel pra resolver problemas/pendências do envio automático de guias.
// Quando o watcher detecta um PDF em T:\Fiscal\... e o servidor não consegue
// processar (empresa não bate, nome fora padrão, validação falhou, etc),
// a linha vira problema aqui. Sem este painel, a única forma de ver erros
// seria SQL direto no Supabase.
//
// Decisões de UX:
//   - 2 listas separadas (Problemas / Pendências de aprovação) — são fluxos
//     diferentes: problemas exigem CORREÇÃO em outro lugar (cadastro, pasta),
//     pendências exigem APROVAÇÃO/REJEIÇÃO desta usuária.
//   - Cada linha mostra arquivo + empresa + tipo + detalhe + ações inline.
//   - Ações destrutivas (ignorar/rejeitar) exigem comentário ≥ 5 chars.
//   - Auto-refresh a cada 30s — usuária pode estar resolvendo no T:\
//     enquanto olha a tela.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Loader2,
  RefreshCw, Send, X, XCircle,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { supabase } from '@/lib/supabase';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';
import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES } from '@/app/types';

interface Problema {
  id: string;
  caminho_servidor: string;
  nome_arquivo: string;
  empresa_id: string | null;
  empresa_nome: string | null;
  empresa_codigo: string | null;
  empresa_nome_pasta: string | null;
  tipo_problema: string;
  detalhes: Record<string, unknown> | null;
  competencia_parseada: string | null;
  obrigacao_parseada: string | null;
  criado_em: string | null;
}

interface Pendencia {
  id: string;
  caminho_servidor: string;
  nome_arquivo: string;
  empresa_id: string | null;
  empresa_nome: string | null;
  empresa_codigo: string | null;
  competencia: string | null;
  obrigacao: string | null;
  status: string;
  detalhes: Record<string, unknown> | null;
  processado_em: string | null;
}

interface Resposta {
  problemas: Problema[];
  pendencias: Pendencia[];
  contagens: { problemasPendentes: number; pendenciasAprovacao: number };
}

const TIPO_PROBLEMA_LABEL: Record<string, { label: string; comoResolver: string }> = {
  empresa_nao_encontrada: {
    label: 'Empresa não cadastrada',
    comoResolver: 'Cadastre a empresa em /empresas com o apelido EXATO do nome da pasta no T:\\, ou renomeie a pasta.',
  },
  obrigacao_desconhecida: {
    label: 'Obrigação não reconhecida',
    comoResolver: 'Nome do arquivo não bateu com nenhuma obrigação conhecida. Renomeie seguindo o padrão (ex: "2026-04 ICMS.pdf").',
  },
  nome_fora_padrao: {
    label: 'Nome do arquivo fora do padrão',
    comoResolver: 'Esperado: "AAAA-MM OBRIGAÇÃO.pdf". Renomeie e salve de novo no T:\\.',
  },
  obrigacao_nao_configurada: {
    label: 'Obrigação não configurada',
    comoResolver: 'Vá em /vencimentos-fiscais/envio → "Configurar Obrigações" da empresa, e cadastre.',
  },
  obrigacao_inativa: {
    label: 'Obrigação marcada como inativa',
    comoResolver: 'Se deveria estar ativa, vá em "Configurar Obrigações" e ative.',
  },
  validacao_falhou: {
    label: 'PDF não confere com a empresa/obrigação',
    comoResolver: 'O CNPJ/código de receita no PDF não bate com o cadastro. Confira se o PDF está na pasta certa.',
  },
  competencia_antiga: {
    label: 'Competência > 60 dias',
    comoResolver: 'PDF retroativo não envia sozinho. Se realmente quiser enviar, use /vencimentos-fiscais/envio (UI manual).',
  },
  gmail_nao_conectado: {
    label: 'Gmail do envio automático desconectado',
    comoResolver: 'Reconecte a conta Gmail do usuário automático (ghost) em /obrigacoes ou similar.',
  },
  sem_emails: {
    label: 'Empresa sem emails cadastrados',
    comoResolver: 'Cadastre pelo menos 1 email do cliente em /empresas → aba "Emails".',
  },
  erro_envio: {
    label: 'Erro técnico no envio',
    comoResolver: 'Veja detalhes. Se for falha do Gmail/Storage, tente de novo depois.',
  },
  primeira_vez_precisa_aprovacao: {
    label: '1ª vez — precisa aprovação',
    comoResolver: 'Envio inaugural dessa empresa+obrigação. Aprove via /vencimentos-fiscais/envio (manual) — próximos sairão automáticos.',
  },
};

function formatTipo(tipo: string): { label: string; comoResolver: string } {
  return TIPO_PROBLEMA_LABEL[tipo] ?? { label: tipo, comoResolver: 'Verifique detalhes técnicos.' };
}

function formatData(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function AutoProblemasPage() {
  const { canManage, authReady, mostrarAlerta } = useSistema();
  const [data, setData] = useState<Resposta | null>(null);
  const [loading, setLoading] = useState(false);
  const [aba, setAba] = useState<'problemas' | 'pendencias'>('problemas');
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tipo: 'ignorar' | 'rejeitar'; id: string; nome: string } | null>(null);
  const [comentario, setComentario] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login de novo.', 'erro');
        return;
      }
      const res = await fetch('/api/admin/guias-auto/listar?tipo=todos&limit=200', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        mostrarAlerta('Erro ao carregar', String(j.error || res.status), 'erro');
        return;
      }
      const json = await res.json() as Resposta;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [mostrarAlerta]);

  useEffect(() => {
    if (!authReady) return;
    carregar();
    // Auto-refresh: enquanto a página tá aberta, atualiza a cada 30s
    const interval = setInterval(carregar, 30_000);
    return () => clearInterval(interval);
  }, [authReady, carregar]);

  const executarAcao = useCallback(async (acao: 'marcar_resolvido' | 'ignorar_definitivo' | 'rejeitar_pendencia', id: string, comentarioInput?: string) => {
    setAcaoEmAndamento(id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login de novo.', 'erro');
        return;
      }
      const res = await fetch('/api/admin/guias-auto/acao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acao, id, comentario: comentarioInput }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        mostrarAlerta('Falha na ação', String(j.error || `HTTP ${res.status}`), 'erro');
        return;
      }
      mostrarAlerta('Pronto', 'Ação aplicada com sucesso.', 'sucesso');
      await carregar();
    } finally {
      setAcaoEmAndamento(null);
    }
  }, [mostrarAlerta, carregar]);

  const aprovarEEnviar = useCallback(async (id: string, nome: string) => {
    // Confirm UX simples — esta ação dispara email REAL pro cliente, então
    // não é "clicou sem querer". Confirm nativo do browser é suficiente
    // (não vale a pena modal só pra isso).
    const ok = window.confirm(
      `Aprovar e enviar agora?\n\n${nome}\n\nO email vai pro cliente imediatamente, e o checklist será marcado como feito.`,
    );
    if (!ok) return;
    setAcaoEmAndamento(id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login de novo.', 'erro');
        return;
      }
      const res = await fetch('/api/admin/guias-auto/aprovar-e-enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        mostrarAlerta('Falha ao aprovar', String(j.error || `HTTP ${res.status}`), 'erro');
        return;
      }
      const j = await res.json() as { destinatarios?: string[] };
      mostrarAlerta(
        'Enviado',
        `Email enviado para ${(j.destinatarios ?? []).join(', ')}.`,
        'sucesso',
      );
      await carregar();
    } finally {
      setAcaoEmAndamento(null);
    }
  }, [mostrarAlerta, carregar]);

  if (!authReady) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--text-2)]" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <FiscalTabs />
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-6 text-center text-[var(--text-2)]">
          Apenas administradores e gerentes podem acessar este painel.
        </div>
      </div>
    );
  }

  const problemas = data?.problemas ?? [];
  const pendencias = data?.pendencias ?? [];
  const cntProblemas = data?.contagens.problemasPendentes ?? 0;
  const cntPendencias = data?.contagens.pendenciasAprovacao ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <FiscalTabs />

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-1)]">Envios Automáticos — Pendências</h1>
          <p className="text-xs text-[var(--text-2)] mt-0.5">
            Guias que o daemon do T:\ não conseguiu processar sozinho. Atualiza a cada 30s.
          </p>
        </div>
        <button
          onClick={carregar}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Referência fixa de como nomear as guias — pra equipe não esquecer.
          Os nomes vêm direto de types.ts, então nunca ficam desatualizados. */}
      <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
        <summary className="flex items-center gap-2 cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[var(--text-1)] hover:bg-[var(--surface-2)]">
          <FileText size={15} className="text-[var(--text-2)]" />
          Como nomear as guias (clique para abrir)
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-3 text-xs text-[var(--text-2)] border-t border-[var(--border)]">
          <div>
            <p className="text-[var(--text-1)] font-medium mb-1">Formato do nome do arquivo:</p>
            <p className="font-mono text-[13px] text-[var(--text-1)] bg-[var(--surface-2)] rounded px-2 py-1 inline-block">
              AAAA-MM OBRIGAÇÃO.pdf
            </p>
            <p className="mt-1.5">
              A data vem <strong>no começo</strong> (ano-mês). Exemplos:{' '}
              <span className="font-mono">2026-05 ICMS TDD.pdf</span>,{' '}
              <span className="font-mono">2026-04 PIS.pdf</span>,{' '}
              <span className="font-mono">2026-05 IPI.pdf</span>.
              Salve dentro da pasta da empresa, em <span className="font-mono">FECHAMENTO</span> ou{' '}
              <span className="font-mono">SIMPLES NACIONAL</span>, na pasta do ano.
            </p>
            <p className="mt-1">
              Pode usar maiúscula/minúscula e acento à vontade — o sistema entende. Alguns apelidos
              também valem (ex: <span className="font-mono">SPED FISCAL</span> = SPED ICMS/IPI,{' '}
              <span className="font-mono">DAS</span> = EMISSÃO GUIA DAS).
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[var(--text-1)] font-medium mb-1.5">Regime Normal</p>
              <div className="flex flex-wrap gap-1">
                {VENCIMENTOS_FISCAIS_NOMES.map((n) => (
                  <span key={n} className="font-mono text-[11px] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-1)]">
                    {n}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[var(--text-1)] font-medium mb-1.5">Simples Nacional</p>
              <div className="flex flex-wrap gap-1">
                {VENCIMENTOS_FISCAIS_SN_NOMES.map((n) => (
                  <span key={n} className="font-mono text-[11px] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-1)]">
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* Tabs internas */}
      <div className="inline-flex items-center gap-1 rounded-[var(--radius)] bg-[var(--surface-2)] p-1 border border-[var(--border)]">
        <button
          onClick={() => setAba('problemas')}
          className={`flex items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold transition-colors ${
            aba === 'problemas'
              ? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm'
              : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
          }`}
        >
          <AlertTriangle size={14} /> Problemas
          {cntProblemas > 0 && (
            <span className="rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center">
              {cntProblemas}
            </span>
          )}
        </button>
        <button
          onClick={() => setAba('pendencias')}
          className={`flex items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold transition-colors ${
            aba === 'pendencias'
              ? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm'
              : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
          }`}
        >
          <Clock size={14} /> Aprovações pendentes
          {cntPendencias > 0 && (
            <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center">
              {cntPendencias}
            </span>
          )}
        </button>
      </div>

      {/* Conteúdo aba problemas */}
      {aba === 'problemas' && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
          {problemas.length === 0 ? (
            <div className="p-10 text-center text-[var(--text-2)] flex flex-col items-center gap-2">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm">Nenhum problema pendente. Tudo limpo.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {problemas.map((p) => {
                const tipo = formatTipo(p.tipo_problema);
                const empresaLabel = p.empresa_nome
                  ? `${p.empresa_codigo ?? '—'} · ${p.empresa_nome}`
                  : p.empresa_nome_pasta
                    ? `(pasta T:\\) ${p.empresa_nome_pasta}`
                    : '(empresa desconhecida)';
                const motivoDetalhe = (p.detalhes && typeof p.detalhes === 'object' && 'motivo' in p.detalhes)
                  ? String(p.detalhes.motivo)
                  : null;
                return (
                  <div key={p.id} className="p-4 hover:bg-[var(--surface-2)]/40 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md px-2 py-0.5">
                            <AlertTriangle size={11} /> {tipo.label}
                          </span>
                          <span className="text-[11px] text-[var(--text-3)]">{formatData(p.criado_em)}</span>
                        </div>
                        <div className="mt-1.5 text-sm font-medium text-[var(--text-1)] flex items-center gap-1.5">
                          <FileText size={13} className="text-[var(--text-3)] shrink-0" />
                          <span className="truncate">{p.nome_arquivo}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--text-2)]">{empresaLabel}</div>
                        {(p.competencia_parseada || p.obrigacao_parseada) && (
                          <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
                            {p.obrigacao_parseada && <span>{p.obrigacao_parseada}</span>}
                            {p.competencia_parseada && p.obrigacao_parseada && <span> · </span>}
                            {p.competencia_parseada && <span>{p.competencia_parseada}</span>}
                          </div>
                        )}
                        {motivoDetalhe && (
                          <div className="mt-2 text-xs text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--border)] rounded-md p-2">
                            <strong className="text-[var(--text-1)]">Motivo:</strong> {motivoDetalhe}
                          </div>
                        )}
                        <div className="mt-2 text-[11px] text-[var(--text-3)] italic">
                          Como resolver: {tipo.comoResolver}
                        </div>
                        <div className="mt-1.5 text-[10px] text-[var(--text-3)] font-mono truncate">
                          {p.caminho_servidor}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <button
                          onClick={() => executarAcao('marcar_resolvido', p.id)}
                          disabled={acaoEmAndamento === p.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 disabled:opacity-50"
                        >
                          <CheckCircle2 size={12} /> Marcar resolvido
                        </button>
                        <button
                          onClick={() => { setModal({ tipo: 'ignorar', id: p.id, nome: p.nome_arquivo }); setComentario(''); }}
                          disabled={acaoEmAndamento === p.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-2)] hover:bg-[var(--surface-3)] disabled:opacity-50"
                        >
                          <X size={12} /> Ignorar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo aba pendências */}
      {aba === 'pendencias' && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
          {pendencias.length === 0 ? (
            <div className="p-10 text-center text-[var(--text-2)] flex flex-col items-center gap-2">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm">Nenhuma aprovação pendente.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {pendencias.map((p) => {
                const isPrimeira = p.status === 'pendente_aprovacao_primeira_vez';
                const empresaLabel = p.empresa_nome
                  ? `${p.empresa_codigo ?? '—'} · ${p.empresa_nome}`
                  : '(empresa desconhecida)';
                return (
                  <div key={p.id} className="p-4 hover:bg-[var(--surface-2)]/40 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md px-2 py-0.5">
                            <Clock size={11} /> {isPrimeira ? '1ª vez — precisa aprovar' : 'Competência antiga'}
                          </span>
                          <span className="text-[11px] text-[var(--text-3)]">{formatData(p.processado_em)}</span>
                        </div>
                        <div className="mt-1.5 text-sm font-medium text-[var(--text-1)] flex items-center gap-1.5">
                          <FileText size={13} className="text-[var(--text-3)] shrink-0" />
                          <span className="truncate">{p.nome_arquivo}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--text-2)]">{empresaLabel}</div>
                        {(p.competencia || p.obrigacao) && (
                          <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
                            {p.obrigacao && <span>{p.obrigacao}</span>}
                            {p.competencia && p.obrigacao && <span> · </span>}
                            {p.competencia && <span>{p.competencia}</span>}
                          </div>
                        )}
                        {(() => {
                          const temArquivo = p.detalhes && typeof p.detalhes === 'object'
                            && 'arquivo_pendente_path' in p.detalhes
                            && !!p.detalhes.arquivo_pendente_path;
                          return temArquivo ? (
                            <div className="mt-2 text-[11px] text-[var(--text-3)] italic">
                              Clique em <strong>Aprovar e enviar</strong> pra disparar o email agora — o PDF já está
                              guardado no servidor.
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 italic">
                              ⚠ Pendência sem arquivo guardado (criada antes da feature). Use a aba <strong>Envio de
                              Guias</strong> pra subir manualmente.
                            </div>
                          );
                        })()}
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        {p.detalhes && typeof p.detalhes === 'object'
                          && 'arquivo_pendente_path' in p.detalhes
                          && !!p.detalhes.arquivo_pendente_path && (
                          <button
                            onClick={() => aprovarEEnviar(p.id, p.nome_arquivo)}
                            disabled={acaoEmAndamento === p.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 disabled:opacity-50"
                          >
                            {acaoEmAndamento === p.id
                              ? <><Loader2 size={12} className="animate-spin" /> Enviando…</>
                              : <><Send size={12} /> Aprovar e enviar</>}
                          </button>
                        )}
                        <button
                          onClick={() => { setModal({ tipo: 'rejeitar', id: p.id, nome: p.nome_arquivo }); setComentario(''); }}
                          disabled={acaoEmAndamento === p.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50"
                        >
                          <XCircle size={12} /> Rejeitar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal comentário (ignorar / rejeitar) */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius)] p-5 max-w-md w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-1)]">
              {modal.tipo === 'ignorar' ? 'Ignorar problema definitivamente' : 'Rejeitar pendência'}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-2)] truncate">{modal.nome}</p>
            <p className="mt-2 text-[11px] text-[var(--text-3)]">
              {modal.tipo === 'ignorar'
                ? 'O problema some da lista mas fica no histórico. Use pra arquivos antigos que não vão ser corrigidos.'
                : 'A guia NÃO será enviada. Pra forçar envio, use a UI manual de Envio de Guias.'}
            </p>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Motivo (mín. 5 caracteres)..."
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--brand-strong)]"
              rows={3}
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)]"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (comentario.trim().length < 5) {
                    mostrarAlerta('Comentário obrigatório', 'Precisa ter pelo menos 5 caracteres.', 'erro');
                    return;
                  }
                  const acao = modal.tipo === 'ignorar' ? 'ignorar_definitivo' : 'rejeitar_pendencia';
                  void executarAcao(acao, modal.id, comentario.trim());
                  setModal(null);
                }}
                disabled={comentario.trim().length < 5}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
