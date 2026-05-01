import ExcelJS from 'exceljs';
import type {
  ContaBancaria,
  ControleContabilStatus,
  Empresa,
  Tributacao,
  UUID,
  Usuario,
} from '@/app/types';
import {
  BANCO_IGNORAR,
  SIMILARIDADE_MIN_MATCH,
  TOKEN_SEM_MOVIMENTO,
  TOKEN_VAZIO,
  bancoIgnorar,
  ehEmpresaFilial,
  extrairInicial,
  findContaExistente,
  findEmpresaPorCodigo,
  findEmpresaPorNome,
  findUsuarioPorNome,
  gerarCodigoSinteticoArquivada,
  getIniciaisMapPorAno,
  nomeBancoLimpo,
  normalizarString,
  similaridadeNomes,
} from './parser';
import type {
  ParsedImportacao,
  PreviewAviso,
  PreviewBancoNovo,
  PreviewEmpresaArquivada,
  PreviewStatus,
  PreviewTributacao,
} from './parser';

// ─── Detecção de cor da célula ─────────────────────────────

export type CorClasse = 'verde' | 'laranja' | 'branco' | 'cinza' | 'outro';

/**
 * Classifica uma cor ARGB hex (sem alpha ou com) em verde / laranja / branco / cinza.
 * Tons usados na planilha original (Excel/LibreOffice padrão):
 *   verde: ~92D050, ~C6EFCE, ~70AD47, ~A9D08E
 *   laranja: ~FFC000, ~F4B084, ~FCE4D6, ~ED7D31
 */
export function classificarCor(rawHex: string | undefined | null): CorClasse {
  if (!rawHex) return 'outro';
  const hex = rawHex.replace(/^#/, '').toUpperCase();
  if (hex.length !== 6 && hex.length !== 8) return 'outro';
  // Se tiver alpha, descarta
  const rgb = hex.length === 8 ? hex.substring(2) : hex;
  const r = parseInt(rgb.substring(0, 2), 16);
  const g = parseInt(rgb.substring(2, 4), 16);
  const b = parseInt(rgb.substring(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 'outro';

  // Branco "puro" ou bem claro
  if (r > 245 && g > 245 && b > 245) return 'branco';

  // Cinza puro: R, G, B muito próximos (sem matiz dominante)
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 12 && max < 250) return 'cinza';

  // Verde: G > R e G > B com folga
  if (g > r && g > b && g - Math.min(r, b) >= 18) return 'verde';

  // Laranja/âmbar: R alto e dominante sobre B
  if (r >= 200 && r - b >= 40 && g >= 60 && g <= r) return 'laranja';

  return 'outro';
}

interface CelulaXlsx {
  texto: string;
  corHex: string | null;
}

/**
 * Lê a cor de fundo da célula e classifica diretamente em verde/laranja/branco/cinza.
 * Suporta:
 *   - ARGB hex (`fgColor.argb`)
 *   - Theme color (`fgColor.theme`) — Office Theme padrão:
 *       theme 5 = Accent 2 = laranja (ED7D31)
 *       theme 9 = Accent 6 = verde   (70AD47)
 *     Tint não muda a classe (clareia/escurece, mas continua sendo a mesma família).
 */
function classificarFill(cell: ExcelJS.Cell): CorClasse {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern') return 'outro';
  const pattern = fill as ExcelJS.FillPattern;
  const fg = pattern.fgColor;
  if (!fg) return 'outro';

  // 1) Theme color (caso da planilha do user — Office Theme padrão)
  const fgWithTheme = fg as { theme?: number; tint?: number; argb?: string };
  if (typeof fgWithTheme.theme === 'number') {
    const t = fgWithTheme.theme;
    // Office Theme padrão: 5 = Accent 2 (laranja), 9 = Accent 6 (verde)
    if (t === 5) return 'laranja';
    if (t === 9) return 'verde';
    // Outros temas: 0/1 = bg/fg (branco/preto), 2/3 = bg2/fg2, 4/6/7/8 = outros accents
    if (t === 0 || t === 2) return 'branco';
    return 'outro';
  }

  // 2) ARGB hex
  if (typeof fgWithTheme.argb === 'string') {
    return classificarCor(fgWithTheme.argb);
  }

  return 'outro';
}

function lerTextoCelula(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  // Rich text / formula
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray((v as ExcelJS.CellRichTextValue).richText)) {
      return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim();
    }
    if ('result' in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      return r == null ? '' : String(r).trim();
    }
    if ('text' in v) {
      return String((v as { text: string }).text ?? '').trim();
    }
  }
  return String(v).trim();
}

// ─── Detecção de seção (Lucro Real / Presumido / Simples) ──

function detectarSecaoTexto(texto: string): Tributacao | null {
  const norm = normalizarString(texto);
  if (!norm) return null;
  if (norm === 'lucro real') return 'lucro_real';
  if (norm === 'lucro presumido') return 'lucro_presumido';
  if (norm === 'simples nacional') return 'simples_nacional';
  return null;
}

// ─── Parser XLSX ────────────────────────────────────────────

export interface ParserXlsxInput {
  arquivo: File | ArrayBuffer;
  ano: number;
  empresas: Empresa[];
  usuarios: Usuario[];
  contasExistentes: ContaBancaria[];
}

function getCellAt(row: ExcelJS.Row, col: number): ExcelJS.Cell {
  return row.getCell(col);
}

// Mapeia nomes em português pra número do mês (aceita versões com/sem acento).
const NOMES_MES_PT: Record<string, number> = {
  jan: 1, janeiro: 1,
  fev: 2, fevereiro: 2,
  mar: 3, marco: 3, 'março': 3,
  abr: 4, abril: 4,
  mai: 5, maio: 5,
  jun: 6, junho: 6,
  jul: 7, julho: 7,
  ago: 8, agosto: 8,
  set: 9, setembro: 9,
  out: 10, outubro: 10,
  nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
};

function detectarMesNaCelula(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  // Número puro 1..12
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  // Nome do mês em PT (case-insensitive, tolera acento/sufixo do tipo "Jan/2025")
  const norm = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  // Pega o primeiro "token" alfabético (ex.: "jan/2025" → "jan")
  const m = norm.match(/^([a-z]+)/);
  if (m && NOMES_MES_PT[m[1]]) return NOMES_MES_PT[m[1]];
  return null;
}

/**
 * Detecta as colunas onde estão os 12 meses no cabeçalho.
 *  - Aceita números (1..12) E nomes em português (jan, fev, ..., dezembro).
 *  - Procura nas primeiras 10 linhas.
 *  - Se achou pelo menos 2 meses consecutivos (ex.: 1 na col X, 2 na col X+1),
 *    infere o resto assumindo colunas consecutivas — útil quando só algumas
 *    colunas têm header preenchido na planilha histórica.
 */
function detectarColunasMeses(ws: ExcelJS.Worksheet, ate = 40): number[] {
  let melhor: { score: number; mapa: Record<number, number> } = { score: 0, mapa: {} };

  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const row = ws.getRow(r);
    const mapa: Record<number, number> = {};
    for (let c = 1; c <= ate; c++) {
      const t = lerTextoCelula(row.getCell(c));
      const n = detectarMesNaCelula(t);
      if (n != null && !mapa[n]) mapa[n] = c;
    }
    const found = Object.keys(mapa).length;
    if (found === 12) {
      return Array.from({ length: 12 }, (_, i) => mapa[i + 1]);
    }
    if (found > melhor.score) melhor = { score: found, mapa };
  }

  // Se achou pelo menos 2 meses consecutivos, infere os outros como colunas
  // consecutivas a partir do mês 1.
  if (melhor.score >= 2) {
    const m = melhor.mapa;
    // Tenta achar a coluna do mês 1. Se não tiver, calcula a partir do menor mês
    // detectado (ex.: se mês 3 está na col 7, então mês 1 = col 5).
    let colMes1: number | null = m[1] ?? null;
    if (colMes1 == null) {
      const mesesDetectados = Object.keys(m).map(Number).sort((a, b) => a - b);
      const primeiro = mesesDetectados[0];
      colMes1 = m[primeiro] - (primeiro - 1);
    }
    if (colMes1 != null && colMes1 >= 1) {
      const coerente = Object.entries(m).every(([mes, col]) => col === colMes1! + Number(mes) - 1);
      if (coerente) {
        return Array.from({ length: 12 }, (_, i) => colMes1! + i);
      }
    }
  }

  return []; // não detectou — usa fallback do chamador
}

export async function parseXlsxImportacao(input: ParserXlsxInput): Promise<ParsedImportacao> {
  const { arquivo, ano, empresas, usuarios, contasExistentes } = input;
  const iniciaisMap = getIniciaisMapPorAno(ano);

  const wb = new ExcelJS.Workbook();
  if (arquivo instanceof File) {
    const buf = await arquivo.arrayBuffer();
    await wb.xlsx.load(buf);
  } else {
    await wb.xlsx.load(arquivo);
  }
  const ws = wb.worksheets[0];
  if (!ws) {
    return {
      ano,
      tributacoes: [],
      bancosNovos: [],
      statuses: [],
      avisos: [{ tipo: 'linha_sem_codigo', mensagem: 'Planilha vazia ou sem worksheet.' }],
      empresasNaoEncontradas: [],
      empresasArquivadas: [],
      totalLinhasCsv: 0,
    };
  }

  const colMeses = detectarColunasMeses(ws);
  const COL_CODIGO = 1;
  const COL_NOME = 2;
  const COL_BANCO = 3;
  // Se não detectou, assume colunas E..P (5..16) como meses 1..12
  const meses = colMeses.length === 12 ? colMeses : [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const detectouColMeses = colMeses.length === 12;

  const tributacoes: PreviewTributacao[] = [];
  const bancosNovos: PreviewBancoNovo[] = [];
  const statuses: PreviewStatus[] = [];
  const avisos: PreviewAviso[] = [];
  const empresasNaoEncontradas: Array<{ codigo: string; nome: string }> = [];
  const empresasArquivadas: PreviewEmpresaArquivada[] = [];
  const tributacoesAplicadas = new Set<UUID>();
  const bancosNovosKey = new Set<string>();

  if (!detectouColMeses) {
    avisos.push({
      tipo: 'linha_sem_codigo',
      mensagem: `Cabeçalho dos meses não foi totalmente detectado. Usando colunas padrão E..P (5..16) como Jan..Dez. Se as marcações vieram em meses errados, confira em qual coluna está o cabeçalho do mês na sua planilha.`,
    });
  }

  let secao: Tributacao | null = null;
  let empresaAtual: Empresa | null = null;
  let empresaArquivadaAtualTempKey: string | null = null;
  let bancoAtualExistenteId: UUID | null = null;
  let bancoAtualTempKey: string | null = null;
  let bancoAtualNome: string | null = null;
  let tributacaoPendente: Tributacao | null = null;
  let empresaAtualTemBancoReal = false;
  // Planilha do user repete código+nome em cada linha de banco (não usa
  // merge). Sem dedupe, cada linha é tratada como "nova empresa", o que
  // duplica empresas arquivadas/desligadas (uma cópia por banco). Guardamos
  // a última (codigo, nome) processada pra detectar continuação.
  let ultimoCodigoRaw: string | null = null;
  let ultimoNomeRaw: string | null = null;

  const commitTributacaoPendente = () => {
    if (empresaAtual && tributacaoPendente && empresaAtualTemBancoReal && !tributacoesAplicadas.has(empresaAtual.id)) {
      tributacoesAplicadas.add(empresaAtual.id);
      if (empresaAtual.tributacao !== tributacaoPendente) {
        tributacoes.push({
          empresaId: empresaAtual.id,
          codigo: empresaAtual.codigo,
          nomeEmpresa: empresaAtual.razao_social ?? empresaAtual.apelido ?? '',
          tributacaoAntes: empresaAtual.tributacao ?? null,
          tributacaoDepois: tributacaoPendente,
        });
      }
    }
  };

  const totalRows = ws.rowCount;
  for (let r = 1; r <= totalRows; r++) {
    const row = ws.getRow(r);

    const codigoRaw = lerTextoCelula(getCellAt(row, COL_CODIGO));
    const nomeEmpresaRaw = lerTextoCelula(getCellAt(row, COL_NOME));
    const bancoRaw = lerTextoCelula(getCellAt(row, COL_BANCO));

    // Detectar seção de tributação (linha que tem só "Lucro Real" / "Lucro Presumido" / "SIMPLES NACIONAL")
    if (codigoRaw && !nomeEmpresaRaw && !bancoRaw) {
      const novaSecao = detectarSecaoTexto(codigoRaw);
      if (novaSecao) {
        secao = novaSecao;
        continue;
      }
    } else if (!codigoRaw && nomeEmpresaRaw) {
      const novaSecao = detectarSecaoTexto(nomeEmpresaRaw);
      if (novaSecao) {
        secao = novaSecao;
        continue;
      }
    }

    // Pula header literal
    const lower = codigoRaw.toLowerCase();
    if (lower === 'onge' || lower === 'codigo' || lower === 'código') continue;

    // Linha vazia
    if (!codigoRaw && !nomeEmpresaRaw && !bancoRaw) continue;

    // Nova empresa (tem código + nome) — mas só se for diferente da última
    // linha. A planilha repete (codigo, nome) em cada linha de banco, então
    // sem essa checagem o parser duplica a empresa N vezes.
    const ehMesmaEmpresaDaLinhaAnterior =
      codigoRaw && nomeEmpresaRaw &&
      codigoRaw === ultimoCodigoRaw &&
      nomeEmpresaRaw === ultimoNomeRaw;
    if (codigoRaw && nomeEmpresaRaw && !ehMesmaEmpresaDaLinhaAnterior) {
      commitTributacaoPendente();
      ultimoCodigoRaw = codigoRaw;
      ultimoNomeRaw = nomeEmpresaRaw;

      // 0) FILIAL — escritório não faz controle de filiais, pula tudo
      //    (banco, status). Continuação na mesma empresa também é pulada
      //    pois empresaAtual fica null e ctx vira null.
      if (ehEmpresaFilial(nomeEmpresaRaw)) {
        avisos.push({
          tipo: 'duplicata_secao',
          mensagem: `Linha ${r}: empresa ${codigoRaw} "${nomeEmpresaRaw}" ignorada (filial — não controlada).`,
        });
        empresaAtual = null;
        empresaArquivadaAtualTempKey = null;
        bancoAtualExistenteId = null;
        bancoAtualTempKey = null;
        bancoAtualNome = null;
        tributacaoPendente = null;
        empresaAtualTemBancoReal = false;
        continue;
      }

      // 1) Tenta achar pelo CÓDIGO
      let e = findEmpresaPorCodigo(empresas, codigoRaw);
      let empresaDoMesmoCodigo: Empresa | null = e;
      let nomeSistemaDoCodigo = '';
      let simComCodigo = 0;

      if (e) {
        nomeSistemaDoCodigo = e.razao_social ?? e.apelido ?? '';
        simComCodigo = similaridadeNomes(nomeEmpresaRaw, nomeSistemaDoCodigo);
        if (simComCodigo < SIMILARIDADE_MIN_MATCH) {
          // Código bate mas nome muito diferente: pode ser código reciclado.
          // Antes de assumir, vamos tentar achar pelo NOME entre as ativas.
          e = null;
        }
      }

      // 2) Fallback por NOME entre empresas ATIVAS (não arquivadas/desligadas).
      //    Resolve o caso "empresa tá no sistema, mas com outro código".
      if (!e) {
        const ignorar = new Set<UUID>();
        if (empresaDoMesmoCodigo) ignorar.add(empresaDoMesmoCodigo.id);
        const matchNome = findEmpresaPorNome(empresas, nomeEmpresaRaw, {
          ignorarIds: ignorar,
          minSimilaridade: 0.6,
        });
        if (matchNome) {
          e = matchNome.empresa;
          avisos.push({
            tipo: 'duplicata_secao',
            mensagem: `Linha ${r}: empresa "${nomeEmpresaRaw}" (código planilha ${codigoRaw}) casada por NOME com cadastro ativo "${matchNome.empresa.razao_social ?? matchNome.empresa.apelido}" (código sistema ${matchNome.empresa.codigo}, similaridade ${Math.round(matchNome.similaridade * 100)}%).`,
          });
        }
      }

      // 3) Não achou nem por código nem por nome → cria como nova empresa.
      //    Antes, computa o "melhor palpite" — empresa existente com sim
      //    entre 0.2 e 0.59 (faixa duvidosa, abaixo do threshold). O user
      //    revisa na preview se é mesmo duplicata.
      if (!e) {
        // Palpite só aparece se sim > 0.5 — abaixo disso é quase sempre
        // falso positivo (palavra genérica em comum tipo "comercio",
        // "transporte", "exportação"), polui a UI sem ajudar.
        const ignorarPalpite = new Set<UUID>();
        if (empresaDoMesmoCodigo) ignorarPalpite.add(empresaDoMesmoCodigo.id);
        const palpite = findEmpresaPorNome(empresas, nomeEmpresaRaw, {
          ignorarIds: ignorarPalpite,
          minSimilaridade: 0.51,
        });
        const melhorPalpite = palpite && palpite.similaridade < 0.6
          ? {
              codigo: palpite.empresa.codigo ?? '',
              nome: palpite.empresa.razao_social ?? '',
              apelido: palpite.empresa.apelido ?? '',
              similaridade: palpite.similaridade,
            }
          : null;

        if (empresaDoMesmoCodigo) {
          const codigoSintetico = gerarCodigoSinteticoArquivada(codigoRaw, empresas, empresasArquivadas);
          const tempKey = `arq_${empresasArquivadas.length}`;
          empresasArquivadas.push({
            tempKey,
            motivo: 'codigo_reciclado',
            codigoOriginal: codigoRaw,
            codigoSintetico,
            razaoSocial: nomeEmpresaRaw,
            tributacaoSugerida: secao,
            similaridade: simComCodigo,
            nomeEmpresaAtualNoSistema: nomeSistemaDoCodigo,
            selecionada: true,
            desligadaEm: null,
            melhorPalpite,
          });
          empresaAtual = null;
          empresaArquivadaAtualTempKey = tempKey;
        } else {
          const tempKey = `arq_${empresasArquivadas.length}`;
          empresasNaoEncontradas.push({ codigo: codigoRaw, nome: nomeEmpresaRaw });
          empresasArquivadas.push({
            tempKey,
            motivo: 'nao_encontrada',
            codigoOriginal: codigoRaw,
            codigoSintetico: codigoRaw,
            razaoSocial: nomeEmpresaRaw,
            tributacaoSugerida: secao,
            similaridade: 0,
            nomeEmpresaAtualNoSistema: '',
            selecionada: true,
            desligadaEm: null,
            melhorPalpite,
          });
          empresaAtual = null;
          empresaArquivadaAtualTempKey = tempKey;
        }
        bancoAtualExistenteId = null;
        bancoAtualTempKey = null;
        bancoAtualNome = null;
        tributacaoPendente = null;
        empresaAtualTemBancoReal = false;
        continue;
      }

      // 4) Caminho feliz — empresa real (achada por código ou por nome)
      empresaAtual = e;
      empresaArquivadaAtualTempKey = null;
      bancoAtualExistenteId = null;
      bancoAtualTempKey = null;
      bancoAtualNome = null;
      empresaAtualTemBancoReal = false;
      tributacaoPendente = secao;

      if (secao && tributacoesAplicadas.has(e.id)) {
        avisos.push({
          tipo: 'duplicata_secao',
          mensagem: `Empresa ${e.codigo} ${e.razao_social ?? ''} aparece em mais de uma seção de tributação. Mantida a primeira.`,
        });
      }
    }

    const ctx = empresaAtual
      ? {
          empresaId: empresaAtual.id as UUID | undefined,
          arquivadaTempKey: undefined as string | undefined,
          codigo: empresaAtual.codigo,
          nome: empresaAtual.razao_social ?? empresaAtual.apelido ?? '',
          dedupKeyOwner: empresaAtual.id,
        }
      : empresaArquivadaAtualTempKey
        ? (() => {
            const arq = empresasArquivadas.find((a) => a.tempKey === empresaArquivadaAtualTempKey)!;
            return {
              empresaId: undefined as UUID | undefined,
              arquivadaTempKey: arq.tempKey as string | undefined,
              codigo: arq.codigoOriginal,
              nome: arq.razaoSocial,
              dedupKeyOwner: arq.tempKey,
            };
          })()
        : null;

    // Banco
    if (bancoRaw && !bancoIgnorar(bancoRaw)) {
      if (!ctx) {
        avisos.push({
          tipo: 'linha_sem_codigo',
          mensagem: `Linha ${r}: banco "${bancoRaw}" sem empresa associada.`,
        });
        continue;
      }
      const bancoNome = nomeBancoLimpo(bancoRaw);
      empresaAtualTemBancoReal = true;
      const existente = ctx.empresaId
        ? findContaExistente(contasExistentes, ctx.empresaId, bancoNome)
        : null;
      const dedupKey = `${ctx.dedupKeyOwner}|${normalizarString(bancoNome)}`;

      if (existente) {
        bancoAtualExistenteId = existente.id;
        bancoAtualTempKey = null;
        bancoAtualNome = bancoNome;
      } else if (bancosNovosKey.has(dedupKey)) {
        const novo = bancosNovos.find((b) => `${b.empresaId ?? b.empresaArquivadaTempKey}|${normalizarString(b.nome)}` === dedupKey);
        bancoAtualExistenteId = null;
        bancoAtualTempKey = novo?.tempKey ?? null;
        bancoAtualNome = bancoNome;
      } else {
        const tempKey = `tmp_${ctx.dedupKeyOwner}_${bancosNovos.length}`;
        bancosNovos.push({
          tempKey,
          empresaId: ctx.empresaId,
          empresaArquivadaTempKey: ctx.arquivadaTempKey,
          codigoEmpresa: ctx.codigo,
          nomeEmpresa: ctx.nome,
          nome: bancoNome,
        });
        bancosNovosKey.add(dedupKey);
        bancoAtualExistenteId = null;
        bancoAtualTempKey = tempKey;
        bancoAtualNome = bancoNome;
      }
    }

    if (!ctx || (!bancoAtualExistenteId && !bancoAtualTempKey) || !bancoAtualNome) continue;

    // Status mensais com cor!
    for (let i = 0; i < 12; i++) {
      const colMes = meses[i];
      const cell = getCellAt(row, colMes);
      const texto = lerTextoCelula(cell);
      const corClasse = classificarFill(cell);

      const textoUpper = texto.toUpperCase();
      const semTexto = !texto || TOKEN_VAZIO.has(textoUpper);
      const ehSemMovimento = TOKEN_SEM_MOVIMENTO.has(textoUpper);

      // Decide status: cor manda quando há cor verde/laranja; texto S/M sempre vence
      let status: ControleContabilStatus | null = null;
      let observacao: string | null = null;
      let marcadoPorId: UUID | null = null;
      let marcadoPorNome: string | null = null;

      // "OK" literal sempre vira feito sem usuário (independente de cor)
      const ehTextoOk = textoUpper === 'OK';
      // Tenta extrair a inicial (aceita "D", "Diana", "Diane" → "D"; descarta se não bater no map do ano)
      const inicialReconhecida = ehTextoOk ? null : extrairInicial(texto, iniciaisMap);

      if (ehSemMovimento) {
        status = 'sem_movimento';
        observacao = 'Importado: sem movimento';
      } else if (corClasse === 'laranja') {
        status = 'recebido_pendente';
        observacao = 'Importado: recebido (pendente)';
      } else if (corClasse === 'verde') {
        status = 'feito';
      } else if (ehTextoOk) {
        // Texto "OK" sem cor detectada — ainda assim trata como feito
        status = 'feito';
      } else if (semTexto) {
        // sem cor + sem texto = pula (deixa branco)
        continue;
      } else {
        // Tem texto mas cor não detectada → assume "feito" se a inicial bate no map do ano
        if (inicialReconhecida) {
          status = 'feito';
          avisos.push({
            tipo: 'linha_sem_codigo',
            mensagem: `Linha ${r} ${ctx.codigo} ${bancoAtualNome} mês ${i + 1}: cor da célula não detectada — assumido como "feito" (texto "${texto}").`,
          });
        } else {
          avisos.push({
            tipo: 'inicial_desconhecida',
            mensagem: `${ctx.codigo} ${ctx.nome}, banco "${bancoAtualNome}", mês ${i + 1}: valor "${texto}" não reconhecido para o ano ${ano}.`,
          });
          continue;
        }
      }

      // Mapear pra usuário se a inicial existir no map do ano. Usuários que
      // não estão mais no sistema ficam com marcadoPorId=null (sem criar).
      if (inicialReconhecida) {
        const nome = iniciaisMap[inicialReconhecida];
        const usuario = findUsuarioPorNome(usuarios, nome);
        marcadoPorNome = nome;
        marcadoPorId = usuario?.id ?? null;
      }
      // Sem inicial reconhecida (incluindo "OK", células verdes vazias e
      // letras de pessoas que saíram): fica só verde, sem nome nem user_id.

      statuses.push({
        empresaId: ctx.empresaId,
        empresaArquivadaTempKey: ctx.arquivadaTempKey,
        codigoEmpresa: ctx.codigo,
        nomeEmpresa: ctx.nome,
        bancoExistenteId: bancoAtualExistenteId ?? undefined,
        bancoTempKey: bancoAtualTempKey ?? undefined,
        bancoNome: bancoAtualNome,
        mes: `${ano}-${String(i + 1).padStart(2, '0')}`,
        status,
        marcadoPorId,
        marcadoPorNome,
        observacao,
        origemValorCsv: `${texto || '∅'} (${corClasse})`,
      });
    }
  }

  commitTributacaoPendente();

  return {
    ano,
    tributacoes,
    bancosNovos,
    statuses,
    avisos,
    empresasNaoEncontradas,
    empresasArquivadas,
    totalLinhasCsv: totalRows,
  };
}

// Suprime warning de import não-usado (BANCO_IGNORAR é usado por outras consultas)
void BANCO_IGNORAR;
