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
  upsertControleContabilStatusesBatch,
} from '@/lib/db';
import type { ContaBancaria, UUID } from '@/app/types';
import { TRIBUTACAO_LABELS } from '@/app/types';
import { getIniciaisMapPorAno, TAG_DESLIGADA_HISTORICA, type ParsedImportacao } from './parser';
import { parseXlsxImportacao } from './parserXlsx';
import { inspecionarXlsx } from './debugXlsx';

type EmpresaCriadaLog = {
  codigoOriginal: string;
  codigoSintetico: string;
  nome: string;
  motivo: 'codigo_reciclado' | 'nao_encontrada';
  similaridade: number;
  nomeEmpresaAtualNoSistema: string;
};

type EtapaResultado = {
  tributacoes: { sucesso: number; falhas: Array<{ codigo: string; erro: string }> };
  arquivadasCriadas: {
    sucesso: number;
    falhas: Array<{ codigo: string; nome: string; erro: string }>;
    criadas: EmpresaCriadaLog[];
  };
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
  // Filtro do preview de "código reciclado": esconde matches com similaridade
  // muito baixa (provavelmente empresas realmente diferentes) pra focar nas
  // suspeitas — beirando o threshold de match (0.4).
  const [minSimReciclada, setMinSimReciclada] = useState(0);
  // Default: empresas novas viram DESLIGADAS HISTÓRICAS (são clientes
  // antigos que precisam ficar no controle). Marca pra criar como ATIVAS
  // se forem clientes novos do ano atual.
  const [criarComoAtivas, setCriarComoAtivas] = useState(false);

  // Carrega contas atuais ao montar.
  // mostrarAlerta NÃO entra nas deps: ela não é memoizada no provider e
  // re-renders frequentes faziam o effect cancelar o próprio ciclo antes
  // do .finally rodar, deixando "Carregando bancos atuais..." pra sempre.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, isPrivileged]);

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
      // Refaz o fetch de contas existentes antes de parsear. Sem isso, se o
      // user limpou contas_bancarias via SQL depois de abrir a página, o
      // parser usa IDs já deletados → FK violation na hora do upsert do status.
      const contasFresh = await fetchContasBancarias();
      setContasExistentes(contasFresh);
      const parsed = await parseXlsxImportacao({
        arquivo: arquivoXlsx,
        ano,
        empresas,
        usuarios,
        contasExistentes: contasFresh,
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
      arquivadasCriadas: { sucesso: 0, falhas: [], criadas: [] },
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

      // 2) Empresas que não bateram com nenhum cadastro existente.
      //    Default: criadas como DESLIGADAS HISTÓRICAS (clientes antigos
      //    que precisam ficar pro controle). Usa código sintético se o
      //    original já está em uso. Toggle "criarComoAtivas" inverte isso
      //    pra quando forem clientes novos do ano atual.
      const arqTempKeyParaId = new Map<string, UUID>();
      const arquivadasSelecionadas = analisado.empresasArquivadas.filter((a) => a.selecionada);
      const hojeIso = new Date().toISOString().slice(0, 10);
      for (const arq of arquivadasSelecionadas) {
        try {
          const id = await insertEmpresa({
            cadastrada: false,
            codigo: arq.codigoSintetico,
            razao_social: arq.razaoSocial,
            apelido: arq.razaoSocial,
            tipoEstabelecimento: '',
            tipoInscricao: '',
            servicos: [],
            tags: criarComoAtivas ? [] : [TAG_DESLIGADA_HISTORICA],
            possuiRet: false,
            rets: [],
            vencimentosFiscais: [],
            responsaveis: {},
            documentos: [],
            observacoes: [],
            tributacao: arq.tributacaoSugerida ?? null,
            desligada_em: criarComoAtivas ? null : hojeIso,
          }, []);
          arqTempKeyParaId.set(arq.tempKey, id);
          out.arquivadasCriadas.sucesso++;
          out.arquivadasCriadas.criadas.push({
            codigoOriginal: arq.codigoOriginal,
            codigoSintetico: arq.codigoSintetico,
            nome: arq.razaoSocial,
            motivo: arq.motivo,
            similaridade: arq.similaridade,
            nomeEmpresaAtualNoSistema: arq.nomeEmpresaAtualNoSistema,
          });
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
      // Monta batch dos statuses, pulando os que dependem de empresa/banco que
      // falharam de criar e os preservados (caso a opção esteja ligada).
      let preservadas = 0;
      let semContexto = 0;
      const payloadsBatch: Parameters<typeof upsertControleContabilStatusesBatch>[0] = [];
      const refsBatch: Array<{ codigoEmpresa: string; bancoNome: string; mes: string }> = [];
      for (const s of analisado.statuses) {
        const empresaId = s.empresaId ?? (s.empresaArquivadaTempKey ? arqTempKeyParaId.get(s.empresaArquivadaTempKey) : undefined);
        const contaId = s.bancoExistenteId ?? (s.bancoTempKey ? tempKeyParaId.get(s.bancoTempKey) : undefined);
        if (!empresaId || !contaId) {
          semContexto++;
          continue;
        }
        if (preservarExistentes && statusesExistentes.has(`${contaId}|${s.mes}`)) {
          preservadas++;
          continue;
        }
        payloadsBatch.push({
          empresaId,
          contaBancariaId: contaId,
          mes: s.mes,
          status: s.status,
          marcadoPorId: s.marcadoPorId,
          marcadoPorNome: s.marcadoPorNome ?? undefined,
          observacao: s.observacao,
        });
        refsBatch.push({ codigoEmpresa: s.codigoEmpresa, bancoNome: s.bancoNome, mes: s.mes });
      }

      // Upsert em batch (chunks de 500). Muito mais rápido e estável que
      // sequencial: uma round-trip por chunk em vez de uma por linha.
      const resBatch = await upsertControleContabilStatusesBatch(payloadsBatch);
      out.statuses.sucesso += resBatch.sucesso;
      // Mapeia falhas do batch de volta pros refs originais (por (conta,mes))
      const indexFalhas = new Map<string, string>();
      for (const f of resBatch.falhas) indexFalhas.set(`${f.contaBancariaId}|${f.mes}`, f.erro);
      for (let i = 0; i < payloadsBatch.length; i++) {
        const p = payloadsBatch[i];
        const erro = indexFalhas.get(`${p.contaBancariaId}|${p.mes}`);
        if (erro) {
          out.statuses.falhas.push({
            codigo: refsBatch[i].codigoEmpresa,
            banco: refsBatch[i].bancoNome,
            mes: refsBatch[i].mes,
            erro,
          });
        }
      }
      // Loga quem ficou sem contexto (banco/empresa anterior falhou de criar)
      if (semContexto > 0) {
        console.warn(`[import] ${semContexto} marcações ignoradas — banco/empresa associada não foi criada.`);
      }

      // Audit trail no console: lista nominal das empresas que viraram
      // arquivada/desligada, com a empresa "concorrente" do sistema. Útil
      // pra revisar depois se algum match veio errado.
      if (out.arquivadasCriadas.criadas.length > 0) {
        const recicladas = out.arquivadasCriadas.criadas.filter((c) => c.motivo === 'codigo_reciclado');
        const desligadas = out.arquivadasCriadas.criadas.filter((c) => c.motivo === 'nao_encontrada');
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[import] ${out.arquivadasCriadas.criadas.length} empresa(s) criadas como arquivada/desligada`);
        if (recicladas.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`Código reciclado (criadas como [ARQ] com código sintético): ${recicladas.length}`);
          // eslint-disable-next-line no-console
          console.table(recicladas.map((c) => ({
            'código planilha': c.codigoOriginal,
            'código novo': c.codigoSintetico,
            'nome planilha': c.nome,
            'nome no sistema (mesmo código)': c.nomeEmpresaAtualNoSistema,
            'similaridade %': Math.round(c.similaridade * 100),
          })));
        }
        if (desligadas.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`Não encontradas no sistema (criadas como desligadas históricas): ${desligadas.length}`);
          // eslint-disable-next-line no-console
          console.table(desligadas.map((c) => ({
            'código': c.codigoOriginal,
            'nome': c.nome,
          })));
        }
        // eslint-disable-next-line no-console
        console.groupEnd();
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
          <p><strong>Letras → quem marcou (mapa do ano {ano}):</strong></p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 ml-3">
            {Object.entries(getIniciaisMapPorAno(ano)).map(([letra, nome]) => (
              <div key={letra} className="flex items-center gap-1.5">
                <span className="font-mono font-bold w-5 inline-block bg-emerald-100 text-emerald-700 rounded text-center">{letra}</span>
                <span>{nome}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 ml-3">
            Aceita célula com inicial (&quot;D&quot;) ou com nome completo (&quot;Diana&quot;) — pega só a primeira letra.
            Texto <strong>&quot;OK&quot;</strong> ou letra de pessoa que saiu da empresa: fica só verde, sem usuário associado.
          </p>
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

        <label className="inline-flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-orange-100 transition">
          <input
            type="checkbox"
            checked={criarComoAtivas}
            onChange={(e) => setCriarComoAtivas(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-orange-600 cursor-pointer shrink-0"
          />
          <div className="text-xs">
            <div className="font-bold text-orange-800">Criar empresas novas como ATIVAS</div>
            <div className="text-orange-700 mt-0.5">
              Por padrão, empresas que não existem no sistema são criadas como <strong>desligadas históricas</strong> (clientes antigos pra controle). Marque isso só se forem clientes novos do ano atual que ainda não foram cadastrados.
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
          {(() => {
            const recicladas = analisado.empresasArquivadas.filter((a) => a.motivo === 'codigo_reciclado');
            const desligadasNovas = analisado.empresasArquivadas.filter((a) => a.motivo === 'nao_encontrada');
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <BlocoStat label="Tributações" valor={analisado.tributacoes.length} cor="emerald" />
                  <BlocoStat label="Novas (cód. existente)" valor={recicladas.filter((a) => a.selecionada).length} cor="slate" />
                  <BlocoStat label="Novas (cód. inédito)" valor={desligadasNovas.filter((a) => a.selecionada).length} cor="orange" />
                  <BlocoStat label="Bancos novos" valor={analisado.bancosNovos.length} cor="cyan" />
                  <BlocoStat label="Marcações" valor={analisado.statuses.length} cor="blue" />
                  <BlocoStat label="Avisos" valor={analisado.avisos.length} cor="amber" />
                </div>

                {/* Empresas a criar com código sintético (código original já está em uso) */}
                {recicladas.length > 0 && (() => {
                  const recicladasOrdenadas = [...recicladas].sort((a, b) => b.similaridade - a.similaridade);
                  const recicladasVisiveis = recicladasOrdenadas.filter((a) => a.similaridade >= minSimReciclada);
                  const ocultas = recicladasOrdenadas.length - recicladasVisiveis.length;
                  return (
                  <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-800 mb-2">
                      <Archive size={16} className="text-slate-600" />
                      {recicladas.length} empresa(s) novas (código já em uso → será sintético)
                    </div>
                    <p className="text-[11px] text-slate-700 mb-3">
                      O código da planilha hoje pertence a outra empresa. Cada uma será cadastrada como <strong>{criarComoAtivas ? 'empresa ATIVA' : 'desligada histórica'}</strong> com código sintético próprio (tipo <code className="font-mono bg-slate-200 px-1 rounded">71-A</code>).
                      <strong className="block mt-1 text-amber-700">⚠ Revise as do topo (similaridade alta) — podem ser a mesma empresa só com nome abreviado. Se for, desmarque e ajuste o cadastro existente depois.</strong>
                    </p>

                    {/* Filtro de similaridade mínima */}
                    <div className="flex items-center gap-2 mb-3 bg-white rounded-lg p-2 border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-700 whitespace-nowrap">Esconder matches &lt;</span>
                      <input
                        type="range"
                        min={0}
                        max={40}
                        step={5}
                        value={Math.round(minSimReciclada * 100)}
                        onChange={(e) => setMinSimReciclada(Number(e.target.value) / 100)}
                        className="flex-1 accent-slate-700"
                      />
                      <span className="text-[10px] font-mono font-bold text-slate-800 w-10 text-right">{Math.round(minSimReciclada * 100)}%</span>
                      {ocultas > 0 && (
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">({ocultas} ocultas)</span>
                      )}
                    </div>

                    <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                      {recicladasVisiveis.map((a) => (
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
                              {a.melhorPalpite && (
                                <div className="text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                  🤔 Pode ser duplicata de: <strong>{a.melhorPalpite.codigo}</strong> {a.melhorPalpite.nome || a.melhorPalpite.apelido}
                                  {a.melhorPalpite.apelido && a.melhorPalpite.nome && a.melhorPalpite.apelido !== a.melhorPalpite.nome && ` (${a.melhorPalpite.apelido})`}
                                  <span className="ml-1 text-amber-600 font-bold">{Math.round(a.melhorPalpite.similaridade * 100)}%</span>
                                </div>
                              )}
                              {a.tributacaoSugerida && (
                                <div className="text-slate-700 mt-0.5">Tributação: <strong>{TRIBUTACAO_LABELS[a.tributacaoSugerida]}</strong></div>
                              )}
                            </div>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  );
                })()}

                {/* Empresas com código novo no sistema */}
                {desligadasNovas.length > 0 && (
                  <div className="rounded-xl border border-orange-300 bg-orange-50 p-3">
                    <div className="flex items-center gap-2 font-bold text-xs text-orange-900 mb-2">
                      <Archive size={16} className="text-orange-700" />
                      {desligadasNovas.length} empresa(s) novas — serão criadas como {criarComoAtivas ? 'ATIVAS' : 'DESLIGADAS HISTÓRICAS'}
                    </div>
                    <p className="text-[11px] text-orange-900 mb-3">
                      Esses códigos não existem no sistema e nenhum cadastro com nome similar foi encontrado. Cada uma será cadastrada como <strong>{criarComoAtivas ? 'empresa ATIVA' : 'desligada histórica'}</strong> com o código original. Bancos e marcações também são importados.
                      {!criarComoAtivas && ' Aparecem em "Empresas Desligadas".'}
                    </p>
                    <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                      {desligadasNovas.map((a) => (
                        <li
                          key={a.tempKey}
                          className={`rounded-lg border p-2.5 transition ${
                            a.selecionada ? 'bg-white border-orange-300' : 'bg-orange-100 border-orange-200 opacity-60'
                          }`}
                        >
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={a.selecionada}
                              onChange={() => toggleArquivada(a.tempKey)}
                              className="mt-1 h-4 w-4 accent-orange-600 cursor-pointer shrink-0"
                            />
                            <div className="flex-1 min-w-0 text-[11px]">
                              <div className="font-bold text-orange-900">
                                {a.razaoSocial}
                                <span className="ml-2 font-mono text-[10px] text-orange-700 font-normal">
                                  código: <strong>{a.codigoOriginal}</strong>
                                </span>
                              </div>
                              {a.melhorPalpite && (
                                <div className="text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-[11px]">
                                  🤔 Pode ser duplicata de: <strong>{a.melhorPalpite.codigo}</strong> {a.melhorPalpite.nome || a.melhorPalpite.apelido}
                                  {a.melhorPalpite.apelido && a.melhorPalpite.nome && a.melhorPalpite.apelido !== a.melhorPalpite.nome && ` (${a.melhorPalpite.apelido})`}
                                  <span className="ml-1 text-amber-600 font-bold">{Math.round(a.melhorPalpite.similaridade * 100)}%</span>
                                </div>
                              )}
                              {a.tributacaoSugerida && (
                                <div className="text-orange-800 mt-0.5">Tributação sugerida: <strong>{TRIBUTACAO_LABELS[a.tributacaoSugerida]}</strong></div>
                              )}
                            </div>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-orange-700 mt-2">Desmarque as que não quiser importar.</p>
                  </div>
                )}
              </>
            );
          })()}

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

          {/* Lista nominal das arquivadas/desligadas criadas — pra você
              revisar se algum match veio errado e arrumar manualmente. */}
          {resultado.arquivadasCriadas.criadas.length > 0 && (() => {
            const recicladas = resultado.arquivadasCriadas.criadas
              .filter((c) => c.motivo === 'codigo_reciclado')
              .sort((a, b) => b.similaridade - a.similaridade);
            const desligadas = resultado.arquivadasCriadas.criadas
              .filter((c) => c.motivo === 'nao_encontrada');
            return (
              <details className="rounded-xl bg-amber-50 border border-amber-200 p-3" open>
                <summary className="cursor-pointer text-xs font-bold text-amber-900 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-700" />
                  Empresas novas criadas como ATIVAS — revisar ({resultado.arquivadasCriadas.criadas.length})
                </summary>
                <p className="text-[11px] text-amber-800 mt-2">
                  Todas foram criadas como <strong>ATIVAS</strong> (sem tag arquivada/desligada). Se alguma já estiver desligada de fato, abra o cadastro e marque manualmente. Se for duplicata de empresa que já existe (similaridade alta), pode apagar a duplicata.
                </p>

                {recicladas.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-bold text-slate-800 mb-1">
                      Código já em uso — criadas com código sintético ({recicladas.length})
                    </div>
                    <ul className="space-y-1 max-h-72 overflow-y-auto rounded-lg border border-amber-200 bg-white p-2">
                      {recicladas.map((c, i) => (
                        <li key={`r${i}`} className="text-[11px] font-mono">
                          <span className="font-bold text-slate-900">{c.codigoOriginal}</span>
                          <span className="text-slate-400"> → </span>
                          <span className="text-cyan-700 font-bold">{c.codigoSintetico}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="text-slate-900">{c.nome}</span>
                          <span className="text-slate-500"> (vs sistema: <em>{c.nomeEmpresaAtualNoSistema || '—'}</em>)</span>
                          <span className={`ml-1 font-bold ${c.similaridade >= 0.3 ? 'text-red-700' : 'text-slate-500'}`}>
                            {Math.round(c.similaridade * 100)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {desligadas.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-bold text-orange-900 mb-1">
                      Código inédito — criadas como ATIVAS com código original ({desligadas.length})
                    </div>
                    <ul className="space-y-1 max-h-72 overflow-y-auto rounded-lg border border-orange-200 bg-white p-2">
                      {desligadas.map((c, i) => (
                        <li key={`d${i}`} className="text-[11px] font-mono">
                          <span className="font-bold text-slate-900">{c.codigoOriginal}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="text-slate-900">{c.nome}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[10px] text-amber-700 mt-2">
                  💡 Tem o mesmo log no console do navegador (F12 → Console) com tabelas filtráveis.
                </p>
              </details>
            );
          })()}
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

function BlocoStat({ label, valor, cor }: { label: string; valor: number; cor: 'emerald' | 'cyan' | 'blue' | 'amber' | 'slate' | 'orange' }) {
  const corClasses = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    cyan: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    slate: 'bg-slate-100 border-slate-300 text-slate-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
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
