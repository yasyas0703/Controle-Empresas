'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Calendar, CheckCircle2, FileSpreadsheet,
  FileText, Loader2, Mail, ShieldAlert, Sparkles, Trash2, Upload, XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useSistema } from '@/app/context/SistemaContext';
import { supabase } from '@/lib/supabase';
import {
  fetchObrigacoes,
  uploadGuiaPdf,
  upsertObrigacaoTarefa,
} from '@/lib/db';
import type { Empresa, Obrigacao } from '@/app/types';
import { processarPdfArquivo, type ItemProcessamento } from './parserClient';

function formatBR(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatComp(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m)]}/${y}`;
}

function formatBRL(v?: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function newItemId(): string {
  return `item_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export default function ProcessarGuiasClient() {
  const { empresas, currentUser, isPrivileged, canManage, authReady, mostrarAlerta } = useSistema();
  const [obrigacoes, setObrigacoes] = useState<Obrigacao[]>([]);
  const [carregandoObr, setCarregandoObr] = useState(false);
  const [itens, setItens] = useState<ItemProcessamento[]>([]);
  const [importando, setImportando] = useState(false);
  const [autoEnviar, setAutoEnviar] = useState(true);
  const autoTriggeredRef = useRef<Set<string>>(new Set());

  // Carrega obrigações ativas
  useEffect(() => {
    if (!authReady) return;
    let cancelado = false;
    setCarregandoObr(true);
    fetchObrigacoes()
      .then((lista) => {
        if (cancelado) return;
        setObrigacoes(lista.filter((o) => o.ativo));
      })
      .catch((err) => {
        console.error(err);
        mostrarAlerta('Erro', 'Não foi possível carregar obrigações.', 'erro');
      })
      .finally(() => { if (!cancelado) setCarregandoObr(false); });
    return () => { cancelado = true; };
  }, [authReady, mostrarAlerta]);

  function adicionarArquivos(files: File[]) {
    const novos: ItemProcessamento[] = files
      .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      .map((f) => ({ id: newItemId(), file: f, status: 'pendente' }));
    if (novos.length === 0) return;
    setItens((prev) => [...prev, ...novos]);
    // Processa em paralelo (mas serializa pra não travar o browser com muitos PDFs grandes)
    novos.forEach((item) => processarItem(item.id));
  }

  async function processarItem(id: string) {
    setItens((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'processando' } : it)));
    const itemAtual = itens.find((it) => it.id === id) ?? { id, file: new File([], ''), status: 'processando' as const };
    // Pega o file do state mais recente
    setItens((prev) => {
      const atual = prev.find((it) => it.id === id);
      if (atual) {
        // dispara processamento com o file correto
        void (async () => {
          const processado = await processarPdfArquivo(atual, empresas, obrigacoes);
          setItens((prev2) => prev2.map((it) => (it.id === id ? processado : it)));
        })();
      }
      return prev;
    });
    void itemAtual; // anti-warning
  }

  // Quando as obrigações terminam de carregar e há itens já processados sem resultado, reprocessa
  useEffect(() => {
    if (carregandoObr || obrigacoes.length === 0) return;
    setItens((prev) => {
      const precisaReprocessar = prev.some((it) => it.status === 'pronto' && !it.resultado);
      if (!precisaReprocessar) return prev;
      return prev;
    });
  }, [carregandoObr, obrigacoes.length]);

  function removerItem(id: string) {
    setItens((prev) => prev.filter((it) => it.id !== id));
  }

  function alterarEmpresa(id: string, empresaId: string | null) {
    setItens((prev) => prev.map((it) => (it.id === id ? { ...it, empresaIdManual: empresaId } : it)));
  }
  function alterarObrigacao(id: string, obrigacaoId: string | null) {
    setItens((prev) => prev.map((it) => (it.id === id ? { ...it, obrigacaoIdManual: obrigacaoId } : it)));
  }
  function alterarCompetencia(id: string, competencia: string | null) {
    setItens((prev) => prev.map((it) => (it.id === id ? { ...it, competenciaManual: competencia } : it)));
  }

  function getEmpresaFinal(item: ItemProcessamento): Empresa | null {
    const id = item.empresaIdManual ?? item.resultado?.empresa?.empresa.id;
    if (!id) return null;
    return empresas.find((e) => e.id === id) ?? null;
  }

  function getObrigacaoFinal(item: ItemProcessamento): Obrigacao | null {
    const id = item.obrigacaoIdManual ?? item.resultado?.obrigacao?.obrigacao.id;
    if (!id) return null;
    return obrigacoes.find((o) => o.id === id) ?? null;
  }

  function getCompetenciaFinal(item: ItemProcessamento): string | null {
    return item.competenciaManual ?? item.resultado?.dados.competencia ?? null;
  }

  const itensProntos = useMemo(
    () => itens.filter((it) => it.status === 'pronto' || it.status === 'importado'),
    [itens]
  );

  const itensImportaveis = useMemo(
    () => itens.filter((it) => {
      if (it.status !== 'pronto') return false;
      const e = getEmpresaFinal(it);
      const o = getObrigacaoFinal(it);
      const c = getCompetenciaFinal(it);
      return !!e && !!o && !!c && /^\d{4}-\d{2}$/.test(c);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itens, empresas, obrigacoes]
  );

  async function importar(item: ItemProcessamento): Promise<string | null> {
    const empresa = getEmpresaFinal(item);
    const obrigacao = getObrigacaoFinal(item);
    const competencia = getCompetenciaFinal(item);
    if (!empresa || !obrigacao || !competencia) {
      mostrarAlerta('Dados incompletos', 'Selecione empresa, obrigação e competência.', 'aviso');
      return null;
    }
    try {
      // 1. Upload da guia
      const arquivoPath = await uploadGuiaPdf({
        file: item.file,
        empresaId: empresa.id,
        obrigacaoId: obrigacao.id,
        competencia,
      });
      // 2. Cria/atualiza tarefa
      await upsertObrigacaoTarefa({
        obrigacaoId: obrigacao.id,
        empresaId: empresa.id,
        competencia,
        status: 'em_andamento',
        arquivoUrl: arquivoPath,
        vencimentoDetectado: item.resultado?.dados.vencimento ?? null,
        competenciaDetectada: item.resultado?.dados.competencia ?? null,
        valorDetectado: item.resultado?.dados.valor ?? null,
      });
      setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'importado', arquivoPath } : it)));
      return arquivoPath;
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao importar.', 'erro');
      return null;
    }
  }

  async function enviarEmail(item: ItemProcessamento) {
    const empresa = getEmpresaFinal(item);
    const obrigacao = getObrigacaoFinal(item);
    const competencia = getCompetenciaFinal(item);
    if (!empresa || !obrigacao || !competencia) {
      mostrarAlerta('Dados incompletos', 'Selecione empresa, obrigação e competência.', 'aviso');
      return;
    }

    let arquivoPath = item.arquivoPath;
    // Se ainda não foi importado, importa antes de enviar
    if (!arquivoPath) {
      const novoPath = await importar(item);
      if (!novoPath) return;
      arquivoPath = novoPath;
    }

    setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, emailEnviando: true, emailErro: undefined } : it)));

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login novamente.', 'aviso');
        setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, emailEnviando: false } : it)));
        return;
      }

      const res = await fetch('/api/obrigacoes/enviar-guia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          empresaId: empresa.id,
          obrigacaoId: obrigacao.id,
          competencia,
          arquivoPath,
          vencimento: item.resultado?.dados.vencimento ?? null,
          valor: item.resultado?.dados.valor ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const erroMsg = json?.error || 'Falha ao enviar email.';
        setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, emailEnviando: false, emailErro: erroMsg } : it)));
        mostrarAlerta('Erro ao enviar', erroMsg, 'erro');
        return;
      }

      const concluida = !!json?.concluida;
      setItens((prev) => prev.map((it) => (it.id === item.id ? {
        ...it,
        emailEnviando: false,
        emailEnviado: true,
        emailErro: undefined,
        tarefaConcluida: concluida,
      } : it)));
      const destinos = Array.isArray(json?.enviadoPara) ? json.enviadoPara.join(', ') : '';
      mostrarAlerta(
        concluida ? 'Enviado e concluído' : 'Email enviado',
        destinos ? `Enviado para: ${destinos}` : 'Guia enviada com sucesso.',
        'sucesso',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro inesperado';
      setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, emailEnviando: false, emailErro: message } : it)));
      mostrarAlerta('Erro', message, 'erro');
    }
  }

  async function importarTodos() {
    setImportando(true);
    try {
      for (const item of itensImportaveis) {
        await importar(item);
      }
      mostrarAlerta('Importação concluída', `${itensImportaveis.length} tarefa(s) criada(s).`, 'sucesso');
    } finally {
      setImportando(false);
    }
  }

  // Mantém referência sempre atualizada para evitar closure velha no auto-trigger
  const enviarEmailRef = useRef(enviarEmail);
  enviarEmailRef.current = enviarEmail;

  // Auto-fluxo: quando o PDF é processado e tudo bate (empresa, obrigação,
  // competência), importa, envia e conclui sozinho — uma única vez por item.
  useEffect(() => {
    if (!autoEnviar) return;
    for (const item of itens) {
      if (autoTriggeredRef.current.has(item.id)) continue;
      if (item.status !== 'pronto') continue;
      const empresa = item.empresaIdManual ?? item.resultado?.empresa?.empresa.id;
      const obrigacao = item.obrigacaoIdManual ?? item.resultado?.obrigacao?.obrigacao.id;
      const competencia = item.competenciaManual ?? item.resultado?.dados.competencia;
      if (!empresa || !obrigacao || !competencia) continue;
      autoTriggeredRef.current.add(item.id);
      void enviarEmailRef.current(item);
    }
  }, [itens, autoEnviar]);

  if (!authReady) return null;
  if (!currentUser || (!canManage && !isPrivileged)) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">Esta página é apenas para admins/gerentes.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div className="flex items-center gap-2">
        <Link href="/obrigacoes" className="inline-flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Voltar
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 flex items-center justify-center shadow-md shrink-0">
            <FileSpreadsheet className="text-white" size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Processar guias (PDF)</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Sobe vários PDFs de uma vez. O sistema lê cada um, identifica empresa, obrigação e competência, e gera as tarefas.
            </div>
          </div>
        </div>
      </div>

      {/* Como funciona */}
      <details className="rounded-2xl bg-white border border-gray-100 p-4">
        <summary className="cursor-pointer font-bold text-sm text-gray-800 flex items-center gap-2">
          <Sparkles size={14} className="text-violet-600" /> Como o reconhecimento funciona
        </summary>
        <div className="mt-3 text-xs text-gray-600 space-y-1.5 leading-relaxed">
          <p><strong>Empresa</strong>: o sistema procura no PDF o CNPJ ou a razão social das empresas cadastradas. Match exato em CNPJ pesa mais; razão social usa similaridade.</p>
          <p><strong>Obrigação</strong>: usa as <strong>palavras-chave</strong> da obrigação (cadastradas em <code className="font-mono bg-gray-100 px-1 rounded">/obrigacoes</code>). Quanto mais palavras encontrar, maior o score.</p>
          <p><strong>Competência</strong>: detecta <code className="font-mono bg-gray-100 px-1 rounded">MM/YYYY</code> ou nome do mês.</p>
          <p><strong>Vencimento e valor</strong>: regex de data e moeda BRL.</p>
          <p>Se algo não bater, você pode <strong>corrigir manualmente</strong> selecionando empresa/obrigação no dropdown de cada item antes de importar.</p>
        </div>
      </details>

      {/* Upload */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <label
          className="flex items-center justify-center gap-3 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 hover:bg-violet-100 cursor-pointer p-8 transition"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files);
            adicionarArquivos(files);
          }}
        >
          <Upload size={28} className="text-violet-600" />
          <div className="text-sm">
            <div className="font-bold text-violet-800">Arraste os PDFs aqui ou clique para selecionar</div>
            <div className="text-xs text-violet-600 mt-0.5">PDFs apenas. Máx 25MB por arquivo. Pode selecionar vários.</div>
          </div>
          <input
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              adicionarArquivos(files);
              e.target.value = '';
            }}
          />
        </label>

        {obrigacoes.length === 0 && !carregandoObr && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Nenhuma obrigação ativa cadastrada. <Link href="/obrigacoes" className="underline font-bold">Cadastre uma obrigação</Link> antes de processar guias.
          </div>
        )}

        <label className="mt-3 flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={autoEnviar}
            onChange={(e) => setAutoEnviar(e.target.checked)}
            className="rounded accent-violet-600"
          />
          <span>
            <strong>Envio automático:</strong> ao reconhecer empresa, obrigação e competência, importa, envia o email e marca como concluída sem precisar clicar.
          </span>
        </label>
      </div>

      {/* Lista de itens processados */}
      {itens.length > 0 && (
        <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 inline-flex items-center gap-2">
              <FileText size={18} className="text-violet-600" />
              {itens.length} arquivo(s) carregado(s)
            </h2>
            {itensImportaveis.length > 0 && (
              <button
                onClick={importarTodos}
                disabled={importando}
                className="rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white px-4 py-2 text-sm font-bold inline-flex items-center gap-2 transition disabled:opacity-50"
              >
                {importando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {importando ? 'Importando...' : `Importar ${itensImportaveis.length} pronto(s)`}
              </button>
            )}
          </div>

          <ul className="space-y-2">
            {itens.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                empresas={empresas}
                obrigacoes={obrigacoes}
                onRemover={() => removerItem(item.id)}
                onAlterarEmpresa={(id) => alterarEmpresa(item.id, id)}
                onAlterarObrigacao={(id) => alterarObrigacao(item.id, id)}
                onAlterarCompetencia={(c) => alterarCompetencia(item.id, c)}
                onImportar={async () => { await importar(item); }}
                onEnviarEmail={() => enviarEmail(item)}
                empresaFinal={getEmpresaFinal(item)}
                obrigacaoFinal={getObrigacaoFinal(item)}
                competenciaFinal={getCompetenciaFinal(item)}
              />
            ))}
          </ul>

          {itensProntos.length === itens.length && itens.every((it) => it.status === 'importado') && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              ✅ Todos os arquivos foram importados.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item, empresas, obrigacoes,
  onRemover, onAlterarEmpresa, onAlterarObrigacao, onAlterarCompetencia, onImportar, onEnviarEmail,
  empresaFinal, obrigacaoFinal, competenciaFinal,
}: {
  item: ItemProcessamento;
  empresas: Empresa[];
  obrigacoes: Obrigacao[];
  onRemover: () => void;
  onAlterarEmpresa: (id: string | null) => void;
  onAlterarObrigacao: (id: string | null) => void;
  onAlterarCompetencia: (c: string | null) => void;
  onImportar: () => Promise<void>;
  onEnviarEmail: () => Promise<void>;
  empresaFinal: Empresa | null;
  obrigacaoFinal: Obrigacao | null;
  competenciaFinal: string | null;
}) {
  const [importando, setImportando] = useState(false);

  const sugEmp = item.resultado?.empresa;
  const sugObr = item.resultado?.obrigacao;
  const podeImportar = (item.status === 'pronto' || item.status === 'importado') && !!empresaFinal && !!obrigacaoFinal && !!competenciaFinal;

  return (
    <li className={`rounded-xl border p-3 ${
      item.status === 'erro' ? 'bg-red-50 border-red-200'
      : item.status === 'importado' ? 'bg-emerald-50 border-emerald-200'
      : 'bg-white border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        <FileText size={18} className="text-violet-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 truncate">{item.file.name}</span>
            <span className="text-[10px] text-gray-400">{(item.file.size / 1024).toFixed(0)} KB</span>
            <StatusBadge status={item.status} erro={item.erro} />
          </div>

          {item.status === 'erro' && item.erro && (
            <div className="text-xs text-red-700 mt-1">⚠ {item.erro}</div>
          )}

          {item.status === 'pronto' && (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* Empresa */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 inline-flex items-center gap-1">
                  <Building2 size={10} /> Empresa
                  {sugEmp && (
                    <span className="text-emerald-600 font-normal normal-case">
                      · sugerida (score {sugEmp.score})
                    </span>
                  )}
                </label>
                <select
                  value={item.empresaIdManual ?? sugEmp?.empresa.id ?? ''}
                  onChange={(e) => onAlterarEmpresa(e.target.value || null)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">— Selecionar —</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.codigo} · {emp.razao_social ?? emp.apelido ?? '(sem nome)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Obrigação */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 inline-flex items-center gap-1">
                  <FileSpreadsheet size={10} /> Obrigação
                  {sugObr && (
                    <span className="text-emerald-600 font-normal normal-case">
                      · sugerida ({sugObr.palavrasEncontradas.length} palavras)
                    </span>
                  )}
                </label>
                <select
                  value={item.obrigacaoIdManual ?? sugObr?.obrigacao.id ?? ''}
                  onChange={(e) => onAlterarObrigacao(e.target.value || null)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">— Selecionar —</option>
                  {obrigacoes.map((o) => (
                    <option key={o.id} value={o.id}>{o.nome}</option>
                  ))}
                </select>
              </div>

              {/* Competência */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 inline-flex items-center gap-1">
                  <Calendar size={10} /> Competência
                  {item.resultado?.dados.competencia && (
                    <span className="text-emerald-600 font-normal normal-case">· detectada</span>
                  )}
                </label>
                <input
                  type="month"
                  value={item.competenciaManual ?? item.resultado?.dados.competencia ?? ''}
                  onChange={(e) => onAlterarCompetencia(e.target.value || null)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          )}

          {(item.status === 'pronto' || item.status === 'importado') && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
              <span><strong>Vencimento:</strong> {formatBR(item.resultado?.dados.vencimento)}</span>
              <span><strong>Valor:</strong> {formatBRL(item.resultado?.dados.valor)}</span>
              {item.numPaginas != null && <span><strong>{item.numPaginas} pág.</strong></span>}
              {empresaFinal && <span className="text-emerald-700">→ {empresaFinal.codigo} {empresaFinal.razao_social ?? ''}</span>}
              {obrigacaoFinal && <span className="text-emerald-700">→ {obrigacaoFinal.nome}</span>}
              {competenciaFinal && <span className="text-emerald-700">→ {formatComp(competenciaFinal)}</span>}
              {item.emailEnviado && <span className="inline-flex items-center gap-1 text-cyan-700 font-bold"><Mail size={11} /> email enviado</span>}
              {item.tarefaConcluida && <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 size={11} /> concluída</span>}
            </div>
          )}

          {item.emailErro && (
            <div className="mt-1 text-xs text-red-700">⚠ Email: {item.emailErro}</div>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {item.status === 'pronto' && (
            <button
              onClick={async () => { setImportando(true); try { await onImportar(); } finally { setImportando(false); } }}
              disabled={!podeImportar || importando}
              className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white p-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              title={podeImportar ? 'Importar este' : 'Selecione empresa, obrigação e competência'}
            >
              {importando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            </button>
          )}
          {(item.status === 'pronto' || item.status === 'importado') && (
            <button
              onClick={onEnviarEmail}
              disabled={!podeImportar || !!item.emailEnviando || !!item.emailEnviado}
              className={`rounded-lg p-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                item.emailEnviado
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-cyan-500 hover:bg-cyan-600 text-white'
              }`}
              title={
                item.emailEnviado
                  ? 'Email já enviado'
                  : podeImportar
                    ? (item.status === 'importado' ? 'Enviar email para o cliente' : 'Importar e enviar email')
                    : 'Selecione empresa, obrigação e competência'
              }
            >
              {item.emailEnviando ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            </button>
          )}
          {item.status !== 'importado' && (
            <button
              onClick={onRemover}
              className="rounded-lg bg-red-50 hover:bg-red-100 text-red-600 p-2 transition"
              title="Remover da lista"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status, erro }: { status: ItemProcessamento['status']; erro?: string }) {
  const map: Record<ItemProcessamento['status'], { label: string; cls: string; icon?: React.ReactNode }> = {
    pendente: { label: 'pendente', cls: 'bg-gray-100 text-gray-700' },
    processando: { label: 'processando...', cls: 'bg-violet-100 text-violet-700', icon: <Loader2 size={10} className="animate-spin" /> },
    pronto: { label: 'pronto', cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={10} /> },
    erro: { label: 'erro', cls: 'bg-red-100 text-red-700', icon: <XCircle size={10} /> },
    importado: { label: 'importado', cls: 'bg-emerald-600 text-white', icon: <CheckCircle2 size={10} /> },
    ignorado: { label: 'ignorado', cls: 'bg-gray-200 text-gray-600' },
  };
  const cfg = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.cls}`} title={erro}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
