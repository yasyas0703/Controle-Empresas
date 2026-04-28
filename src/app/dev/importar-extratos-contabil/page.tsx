'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowLeft, Banknote, CheckCircle2, FileSpreadsheet, FileText,
  Loader2, ShieldAlert, Sparkles, Upload, XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useSistema } from '@/app/context/SistemaContext';
import {
  createContaBancaria,
  fetchContasBancarias,
  fetchControleContabilByAno,
  insertEmpresa,
  upsertControleContabilStatus,
} from '@/lib/db';
import type { ContaBancaria, UUID } from '@/app/types';
import { TRIBUTACAO_LABELS } from '@/app/types';
import { INICIAIS_MAP, TAG_ARQUIVADA, type ParsedImportacao } from './parser';
import { parseXlsxImportacao } from './parserXlsx';
import { inspecionarXlsx } from './debugXlsx';

type EtapaResultado = {
  tributacoes: { sucesso: number; falhas: Array<{ codigo: string; erro: string }> };
  arquivadasCriadas: { sucesso: number; falhas: Array<{ codigo: string; nome: string; erro: string }> };
  bancosCriados: { sucesso: number; falhas: Array<{ codigo: string; banco: string; erro: string }> };
  statuses: { sucesso: number; falhas: Array<{ codigo: string; banco: string; mes: string; erro: string }> };
};

export default function ImportarExtratosContabilPage() {
  const { empresas, usuarios, currentUser, isPrivileged, authReady, mostrarAlerta, atualizarEmpresa } = useSistema();

  const [arquivoXlsx, setArquivoXlsx] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [debugTexto, setDebugTexto] = useState<string | null>(null);
  const [debugando, setDebugando] = useState(false);
  const [preservarExistentes, setPreservarExistentes] = useState(true);
  const [ano, setAno] = useState<number>(() => new Date().getFullYear());
  const [contasExistentes, setContasExistentes] = useState<ContaBancaria[]>([]);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [analisado, setAnalisado] = useState<ParsedImportacao | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<EtapaResultado | null>(null);

  // Carrega contas atuais ao montar
  React.useEffect(() => {
    if (!authReady || !isPrivileged) return;
    let cancelado = false;
    setCarregandoContas(true);
    fetchContasBancarias()
      .then((c) => { if (!cancelado) setContasExistentes(c); })
      .catch((err) => {
        console.error(err);
        mostrarAlerta('Erro', 'Não foi possível carregar bancos atuais.', 'erro');
      })
      .finally(() => { if (!cancelado) setCarregandoContas(false); });
    return () => { cancelado = true; };
  }, [authReady, isPrivileged, mostrarAlerta]);

  function selecionarArquivo(file: File) {
    setArquivoXlsx(file);
    setAnalisado(null);
    setResultado(null);
    setDebugTexto(null);
  }

  async function handleDebug() {
    if (!arquivoXlsx) {
      mostrarAlerta('Atenção', 'Selecione um .xlsx primeiro.', 'aviso');
      return;
    }
    setDebugando(true);
    setDebugTexto(null);
    try {
      const txt = await inspecionarXlsx(arquivoXlsx);
      setDebugTexto(txt);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao inspecionar.', 'erro');
    } finally {
      setDebugando(false);
    }
  }

  async function handleAnalisar() {
    if (!arquivoXlsx) {
      mostrarAlerta('Atenção', 'Selecione um arquivo .xlsx primeiro.', 'aviso');
      return;
    }
    setResultado(null);
    setAnalisando(true);
    try {
      const parsed = await parseXlsxImportacao({
        arquivo: arquivoXlsx,
        ano,
        empresas,
        usuarios,
        contasExistentes,
      });
      setAnalisado(parsed);
    } catch (err) {
      console.error(err);
      mostrarAlerta(
        'Erro ao ler arquivo',
        err instanceof Error ? err.message : 'Não foi possível ler o XLSX. Verifique se é um arquivo Excel válido.',
        'erro'
      );
    } finally {
      setAnalisando(false);
    }
  }

  async function handleConfirmarImportacao() {
    if (!analisado) return;
    setImportando(true);
    const out: EtapaResultado = {
      tributacoes: { sucesso: 0, falhas: [] },
      arquivadasCriadas: { sucesso: 0, falhas: [] },
      bancosCriados: { sucesso: 0, falhas: [] },
      statuses: { sucesso: 0, falhas: [] },
    };

    try {
      // 1) Tributações de empresas reais
      for (const t of analisado.tributacoes) {
        try {
          await atualizarEmpresa(t.empresaId, { tributacao: t.tributacaoDepois });
          out.tributacoes.sucesso++;
        } catch (err) {
          out.tributacoes.falhas.push({
            codigo: t.codigo,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      // 2) Empresas arquivadas (selecionadas) — cadastra como nova empresa com tag arquivada
      const arqTempKeyParaId = new Map<string, UUID>();
      const arquivadasSelecionadas = analisado.empresasArquivadas.filter((a) => a.selecionada);
      for (const arq of arquivadasSelecionadas) {
        try {
          const id = await insertEmpresa({
            cadastrada: false,
            codigo: arq.codigoSintetico,
            razao_social: arq.razaoSocial,
            apelido: `[ARQ] ${arq.razaoSocial}`,
            tipoEstabelecimento: '',
            tipoInscricao: '',
            servicos: [],
            tags: [TAG_ARQUIVADA],
            possuiRet: false,
            rets: [],
            vencimentosFiscais: [],
            responsaveis: {},
            documentos: [],
            observacoes: [],
            tributacao: arq.tributacaoSugerida ?? null,
          }, []);
          arqTempKeyParaId.set(arq.tempKey, id);
          out.arquivadasCriadas.sucesso++;
        } catch (err) {
          out.arquivadasCriadas.falhas.push({
            codigo: arq.codigoSintetico,
            nome: arq.razaoSocial,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      // 3) Bancos novos — resolver empresaId (real ou da arquivada recém-criada)
      const tempKeyParaId = new Map<string, UUID>();
      for (const b of analisado.bancosNovos) {
        const empresaId = b.empresaId ?? (b.empresaArquivadaTempKey ? arqTempKeyParaId.get(b.empresaArquivadaTempKey) : undefined);
        if (!empresaId) {
          // arquivada não foi criada (falhou ou foi desmarcada) → pula este banco
          continue;
        }
        try {
          const novo = await createContaBancaria({
            empresaId,
            nome: b.nome,
            ordem: 0,
          });
          tempKeyParaId.set(b.tempKey, novo.id);
          out.bancosCriados.sucesso++;
        } catch (err) {
          out.bancosCriados.falhas.push({
            codigo: b.codigoEmpresa,
            banco: b.nome,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      // 4) Statuses
      // Carrega marcações já existentes do ano pra eventualmente preservá-las
      let statusesExistentes = new Map<string, true>();
      if (preservarExistentes) {
        try {
          const lista = await fetchControleContabilByAno(analisado.ano);
          for (const s of lista) statusesExistentes.set(`${s.contaBancariaId}|${s.mes}`, true);
        } catch (err) {
          console.warn('Falha ao carregar marcações existentes; vai sobrescrever todas.', err);
        }
      }
      let preservadas = 0;
      for (const s of analisado.statuses) {
        const empresaId = s.empresaId ?? (s.empresaArquivadaTempKey ? arqTempKeyParaId.get(s.empresaArquivadaTempKey) : undefined);
        const contaId = s.bancoExistenteId ?? (s.bancoTempKey ? tempKeyParaId.get(s.bancoTempKey) : undefined);
        if (!empresaId || !contaId) continue; // arquivada/banco anterior falhou
        // Preserva marcações já existentes se a opção estiver ligada
        if (preservarExistentes && statusesExistentes.has(`${contaId}|${s.mes}`)) {
          preservadas++;
          continue;
        }
        try {
          await upsertControleContabilStatus({
            empresaId,
            contaBancariaId: contaId,
            mes: s.mes,
            status: s.status,
            marcadoPorId: s.marcadoPorId,
            marcadoPorNome: s.marcadoPorNome ?? undefined,
            observacao: s.observacao,
          });
          out.statuses.sucesso++;
        } catch (err) {
          out.statuses.falhas.push({
            codigo: s.codigoEmpresa, banco: s.bancoNome, mes: s.mes,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      setResultado(out);
      const partes = [
        `${out.tributacoes.sucesso} tributações`,
        `${out.arquivadasCriadas.sucesso} arquivadas`,
        `${out.bancosCriados.sucesso} bancos`,
        `${out.statuses.sucesso} marcações`,
      ];
      if (preservarExistentes && preservadas > 0) partes.push(`${preservadas} preservadas`);
      mostrarAlerta('Importação concluída', partes.join(' · '), 'sucesso');
    } finally {
      setImportando(false);
    }
  }

  function toggleArquivada(tempKey: string) {
    if (!analisado) return;
    setAnalisado({
      ...analisado,
      empresasArquivadas: analisado.empresasArquivadas.map((a) =>
        a.tempKey === tempKey ? { ...a, selecionada: !a.selecionada } : a
      ),
    });
  }

  // ─── Iniciais não reconhecidas (preview) ──────────────────
  const iniciaisDesconhecidas = useMemo(() => {
    if (!analisado) return [] as string[];
    const set = new Set<string>();
    for (const a of analisado.avisos) {
      if (a.tipo === 'inicial_desconhecida') {
        const m = a.mensagem.match(/valor "([^"]+)"/);
        if (m) set.add(m[1]);
      }
    }
    return Array.from(set);
  }, [analisado]);

  // ─── Auth gate ────────────────────────────────────────────
  if (!authReady) return null;
  if (!currentUser || !isPrivileged) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">Esta página é apenas para administradores.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div className="flex items-center gap-2">
        <Link href="/vencimentos-contabil/controle" className="inline-flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Voltar
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-500 flex items-center justify-center shadow-md shrink-0">
            <FileSpreadsheet className="text-white" size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Importar planilha de extratos</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Suba o arquivo <strong>.xlsx</strong> original. O sistema lê a <strong>cor de fundo</strong> de cada célula (verde = feito, laranja = pendente) e a letra (D, B, A...) pra saber quem marcou.
            </div>
          </div>
        </div>
      </div>

      {/* Como funciona */}
      <details className="rounded-2xl bg-white border border-gray-100 p-4 group">
        <summary className="cursor-pointer font-bold text-sm text-gray-800 flex items-center gap-2">
          <Sparkles size={14} className="text-cyan-600" /> Como o XLSX é interpretado
        </summary>
        <div className="mt-3 text-xs text-gray-600 space-y-1.5 leading-relaxed">
          <p><strong>Estrutura esperada:</strong> coluna 1 = código, coluna 2 = nome da empresa, coluna 3 = banco. Os meses são detectados automaticamente pelo cabeçalho (1, 2, 3 ... 12). Se não detectar, assume colunas E até P.</p>
          <p><strong>Seções:</strong> linhas com <code className="font-mono bg-gray-100 px-1 rounded">Lucro Real</code>, <code className="font-mono bg-gray-100 px-1 rounded">Lucro Presumido</code> ou <code className="font-mono bg-gray-100 px-1 rounded">SIMPLES NACIONAL</code> definem a tributação das empresas que vêm depois.</p>
          <p><strong>Cor de fundo da célula determina o status:</strong></p>
          <div className="ml-3 space-y-1">
            <div className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded bg-emerald-500" /> Verde → <strong>feito</strong></div>
            <div className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded bg-orange-400" /> Laranja → <strong>recebido (pendente)</strong></div>
            <div className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border border-dashed border-slate-400 bg-slate-50 text-[7px] font-bold text-slate-500 flex items-center justify-center leading-none">S/M</span> Texto &quot;S/M&quot; → <strong>sem movimento</strong></div>
            <div className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border border-gray-300 bg-white" /> Sem cor + sem texto → não marca nada</div>
          </div>
          <p><strong>Letra (D, B, A, E, N, V, T, P) → quem marcou:</strong></p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 ml-3">
            {Object.entries(INICIAIS_MAP).map(([letra, nome]) => (
              <div key={letra} className="flex items-center gap-1.5">
                <span className="font-mono font-bold w-5 inline-block bg-emerald-100 text-emerald-700 rounded text-center">{letra}</span>
                <span>{nome}</span>
              </div>
            ))}
          </div>
          <p><strong>FILIAL, SEM BANCO:</strong> ignorados (não criam banco).</p>
          <p><strong>Empresa não encontrada / código reciclado:</strong> tratada como cliente antigo (cadastrada como arquivada).</p>
        </div>
      </details>

      {/* Input */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-bold text-gray-700 flex items-center gap-2">
            Ano de referência
            <input
              type="number"
              min={2020}
              max={2099}
              value={ano}
              onChange={(e) => setAno(Number(e.target.value) || ano)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-3 py-2 text-xs font-bold cursor-pointer transition">
            <Upload size={14} /> Selecionar arquivo .xlsx
            <input
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) selecionarArquivo(f);
              }}
            />
          </label>
          {arquivoXlsx && (
            <div className="text-xs text-gray-700 inline-flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1">
              <FileSpreadsheet size={13} className="text-cyan-600" />
              <span className="font-mono">{arquivoXlsx.name}</span>
              <span className="text-gray-400">({(arquivoXlsx.size / 1024).toFixed(0)} KB)</span>
              <button
                onClick={() => { setArquivoXlsx(null); setAnalisado(null); setResultado(null); }}
                className="ml-1 rounded hover:bg-gray-200 p-0.5 text-gray-500"
                title="Remover arquivo"
              >
                <XCircle size={13} />
              </button>
            </div>
          )}
          {carregandoContas && (
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Carregando bancos atuais...</span>
          )}
        </div>

        <label className="inline-flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-emerald-100 transition">
          <input
            type="checkbox"
            checked={preservarExistentes}
            onChange={(e) => setPreservarExistentes(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-600 cursor-pointer shrink-0"
          />
          <div className="text-xs">
            <div className="font-bold text-emerald-800">Preservar marcações já existentes</div>
            <div className="text-emerald-700 mt-0.5">
              Não sobrescreve células que já têm um status no banco. Útil pra reimportar sem perder o que o pessoal marcou manualmente. <strong>Recomendado.</strong>
            </div>
          </div>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleAnalisar}
            disabled={!arquivoXlsx || carregandoContas || analisando}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-4 py-2 text-sm font-bold transition disabled:opacity-50 inline-flex items-center gap-2"
          >
            {analisando && <Loader2 size={16} className="animate-spin" />}
            {analisando ? 'Lendo planilha...' : 'Analisar planilha'}
          </button>
          <button
            onClick={handleDebug}
            disabled={!arquivoXlsx || debugando}
            className="rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-2 text-xs font-bold transition disabled:opacity-50 inline-flex items-center gap-2"
            title="Inspecionar a estrutura crua do XLSX (debug — pra entender por que cores não estão sendo detectadas)"
          >
            {debugando && <Loader2 size={14} className="animate-spin" />}
            {debugando ? 'Inspecionando...' : '🔍 Inspecionar XLSX (debug)'}
          </button>
        </div>

        {debugTexto && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-800">Output do debug — copia tudo e me cola aqui</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(debugTexto);
                  mostrarAlerta('Copiado', 'Output copiado para a área de transferência.', 'sucesso');
                }}
                className="rounded-md bg-amber-200 hover:bg-amber-300 text-amber-900 px-2 py-1 text-[11px] font-bold transition"
              >
                Copiar tudo
              </button>
            </div>
            <textarea
              value={debugTexto}
              readOnly
              rows={20}
              className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-[10px] font-mono resize-y"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* Preview */}
      {analisado && (
        <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-cyan-600" />
            <h2 className="font-bold text-lg text-gray-900">Pré-visualização</h2>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <BlocoStat label="Tributações" valor={analisado.tributacoes.length} cor="emerald" />
            <BlocoStat label="Arquivadas" valor={analisado.empresasArquivadas.filter((a) => a.selecionada).length} cor="slate" />
            <BlocoStat label="Bancos novos" valor={analisado.bancosNovos.length} cor="cyan" />
            <BlocoStat label="Marcações" valor={analisado.statuses.length} cor="blue" />
            <BlocoStat label="Avisos" valor={analisado.avisos.length + analisado.empresasNaoEncontradas.length} cor="amber" />
          </div>

          {/* Empresas arquivadas — código reciclado vira empresa nova histórica */}
          {analisado.empresasArquivadas.length > 0 && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-800 mb-2">
                <Archive size={16} className="text-slate-600" />
                {analisado.empresasArquivadas.length} empresa(s) com código reciclado
              </div>
              <p className="text-[11px] text-slate-700 mb-3">
                Esses códigos hoje pertencem a outra empresa no sistema (provavelmente após exclusão e reaproveitamento). Cada uma será cadastrada como <strong>empresa nova com tag &quot;arquivada&quot;</strong>, com código sintético próprio. Vão aparecer no controle contábil em cinza, no fim da lista.
              </p>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {analisado.empresasArquivadas.map((a) => (
                  <li
                    key={a.tempKey}
                    className={`rounded-lg border p-2.5 transition ${
                      a.selecionada ? 'bg-white border-slate-300' : 'bg-slate-100 border-slate-200 opacity-60'
                    }`}
                  >
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={a.selecionada}
                        onChange={() => toggleArquivada(a.tempKey)}
                        className="mt-1 h-4 w-4 accent-slate-700 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0 text-[11px]">
                        <div className="font-bold text-slate-900">
                          {a.razaoSocial}
                          <span className="ml-2 font-mono text-[10px] text-slate-500 font-normal">
                            código: {a.codigoOriginal} → <strong className="text-cyan-700">{a.codigoSintetico}</strong>
                          </span>
                        </div>
                        <div className="text-slate-600 mt-0.5">
                          Hoje o código <strong>{a.codigoOriginal}</strong> aponta para: <em>{a.nomeEmpresaAtualNoSistema || '(sem nome)'}</em> · similaridade {Math.round(a.similaridade * 100)}%
                        </div>
                        {a.tributacaoSugerida && (
                          <div className="text-slate-700 mt-0.5">Tributação: <strong>{TRIBUTACAO_LABELS[a.tributacaoSugerida]}</strong></div>
                        )}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-500 mt-2">Desmarque as que não quiser importar.</p>
            </div>
          )}

          {/* Empresas não encontradas */}
          {analisado.empresasNaoEncontradas.length > 0 && (
            <Painel
              titulo={`${analisado.empresasNaoEncontradas.length} empresa(s) não encontrada(s) — não serão importadas`}
              cor="red"
              icon={<XCircle size={16} className="text-red-600" />}
            >
              <ul className="space-y-1 max-h-48 overflow-y-auto text-xs">
                {analisado.empresasNaoEncontradas.map((e, i) => (
                  <li key={i} className="font-mono">
                    <span className="font-bold text-red-700">{e.codigo}</span> — {e.nome}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-600 mt-2">Cadastre essas empresas no sistema (mesmo código) e reimporte.</p>
            </Painel>
          )}

          {/* Iniciais não reconhecidas */}
          {iniciaisDesconhecidas.length > 0 && (
            <Painel
              titulo="Valores não reconhecidos no CSV"
              cor="amber"
              icon={<AlertTriangle size={16} className="text-amber-600" />}
            >
              <p className="text-xs">As seguintes iniciais não bateram com nenhum membro conhecido e foram ignoradas:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {iniciaisDesconhecidas.map((v) => (
                  <span key={v} className="font-mono text-[11px] bg-amber-100 text-amber-800 rounded px-2 py-0.5">{v}</span>
                ))}
              </div>
            </Painel>
          )}

          {/* Outros avisos */}
          {analisado.avisos.filter((a) => a.tipo !== 'inicial_desconhecida').length > 0 && (
            <details className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-amber-800">
                Outros avisos ({analisado.avisos.filter((a) => a.tipo !== 'inicial_desconhecida').length})
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-amber-900 max-h-48 overflow-y-auto">
                {analisado.avisos
                  .filter((a) => a.tipo !== 'inicial_desconhecida')
                  .map((a, i) => (
                    <li key={i}>• {a.mensagem}</li>
                  ))}
              </ul>
            </details>
          )}

          {/* Tributações */}
          {analisado.tributacoes.length > 0 && (
            <details className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-emerald-800">
                Tributação será atualizada em {analisado.tributacoes.length} empresa(s)
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-emerald-900 max-h-60 overflow-y-auto">
                {analisado.tributacoes.map((t) => (
                  <li key={t.empresaId} className="font-mono">
                    <span className="font-bold">{t.codigo}</span> {t.nomeEmpresa}: {t.tributacaoAntes ? TRIBUTACAO_LABELS[t.tributacaoAntes] : '—'} → <strong>{TRIBUTACAO_LABELS[t.tributacaoDepois]}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Bancos novos */}
          {analisado.bancosNovos.length > 0 && (
            <details className="rounded-xl bg-cyan-50 border border-cyan-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-cyan-800">
                {analisado.bancosNovos.length} banco(s) novo(s) serão criados
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-cyan-900 max-h-60 overflow-y-auto">
                {analisado.bancosNovos.map((b) => (
                  <li key={b.tempKey} className="font-mono">
                    <Banknote size={10} className="inline mr-1 text-cyan-700" />
                    <span className="font-bold">{b.codigoEmpresa}</span> {b.nomeEmpresa} → <strong>{b.nome}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Confirmar */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
            <p className="text-[11px] text-gray-500">
              Status já existentes (mesmo banco × mês) <strong>serão sobrescritos</strong>. Bancos com mesmo nome <strong>não serão duplicados</strong>.
            </p>
            <button
              onClick={handleConfirmarImportacao}
              disabled={importando || (analisado.tributacoes.length === 0 && analisado.bancosNovos.length === 0 && analisado.statuses.length === 0)}
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-4 py-2 text-sm font-bold transition disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
            >
              {importando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {importando ? 'Importando...' : 'Confirmar e importar'}
            </button>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-3">
          <h2 className="font-bold text-lg text-gray-900 flex items-center gap-2">
            <FileText size={18} className="text-emerald-600" /> Relatório da importação
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <BlocoResultado titulo="Tributações" sucesso={resultado.tributacoes.sucesso} falhas={resultado.tributacoes.falhas.length} />
            <BlocoResultado titulo="Arquivadas" sucesso={resultado.arquivadasCriadas.sucesso} falhas={resultado.arquivadasCriadas.falhas.length} />
            <BlocoResultado titulo="Bancos criados" sucesso={resultado.bancosCriados.sucesso} falhas={resultado.bancosCriados.falhas.length} />
            <BlocoResultado titulo="Marcações" sucesso={resultado.statuses.sucesso} falhas={resultado.statuses.falhas.length} />
          </div>
          {(resultado.tributacoes.falhas.length + resultado.arquivadasCriadas.falhas.length + resultado.bancosCriados.falhas.length + resultado.statuses.falhas.length) > 0 && (
            <details className="rounded-xl bg-red-50 border border-red-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-red-800">Ver erros detalhados</summary>
              <div className="mt-2 space-y-2 text-[11px] text-red-900">
                {resultado.tributacoes.falhas.map((f, i) => (
                  <div key={`t${i}`}>Tributação {f.codigo}: {f.erro}</div>
                ))}
                {resultado.arquivadasCriadas.falhas.map((f, i) => (
                  <div key={`a${i}`}>Arquivada {f.codigo} / {f.nome}: {f.erro}</div>
                ))}
                {resultado.bancosCriados.falhas.map((f, i) => (
                  <div key={`b${i}`}>Banco {f.codigo} / {f.banco}: {f.erro}</div>
                ))}
                {resultado.statuses.falhas.map((f, i) => (
                  <div key={`s${i}`}>Status {f.codigo} / {f.banco} / {f.mes}: {f.erro}</div>
                ))}
              </div>
            </details>
          )}
          <div className="pt-2">
            <Link href="/vencimentos-contabil/controle" className="inline-flex items-center gap-1 text-sm font-bold text-cyan-700 hover:text-cyan-800">
              Ir para o controle contábil →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────

function BlocoStat({ label, valor, cor }: { label: string; valor: number; cor: 'emerald' | 'cyan' | 'blue' | 'amber' | 'slate' }) {
  const corClasses = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    cyan: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    slate: 'bg-slate-100 border-slate-300 text-slate-700',
  }[cor];
  return (
    <div className={`rounded-xl border p-3 ${corClasses}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-black">{valor}</div>
    </div>
  );
}

function Painel({ titulo, cor, icon, children }: { titulo: string; cor: 'red' | 'amber'; icon: React.ReactNode; children: React.ReactNode }) {
  const corClasses = cor === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200';
  const tituloCor = cor === 'red' ? 'text-red-800' : 'text-amber-800';
  return (
    <div className={`rounded-xl border p-3 ${corClasses}`}>
      <div className={`flex items-center gap-2 font-bold text-xs ${tituloCor} mb-2`}>
        {icon}
        {titulo}
      </div>
      {children}
    </div>
  );
}

function BlocoResultado({ titulo, sucesso, falhas }: { titulo: string; sucesso: number; falhas: number }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{titulo}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-lg font-black text-emerald-700">{sucesso}</span>
        <span className="text-xs text-gray-500">ok</span>
        {falhas > 0 && (
          <>
            <span className="text-lg font-black text-red-600 ml-2">{falhas}</span>
            <span className="text-xs text-gray-500">erro{falhas === 1 ? '' : 's'}</span>
          </>
        )}
      </div>
    </div>
  );
}
