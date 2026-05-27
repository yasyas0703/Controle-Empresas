/**
 * Parser do nome de arquivo de guia fiscal no padrão `YYYY-MM OBRIGACAO.pdf`.
 *
 * Padrão obrigatório:
 *   2026-04 ICMS NORMAL.pdf
 *   2025-04 PIS.pdf
 *
 * Tolerâncias (normaliza e aceita):
 *   - separador entre data e obrigação: espaço, hífen, underscore, ponto
 *   - separador entre ano e mês: hífen, underscore, ponto
 *   - acentos na obrigação (DEMONSTR. APURAÇÃO == DEMONSTR APURACAO)
 *   - case (icms normal == ICMS NORMAL)
 *   - aliases comuns (sped fiscal == SPED ICMS/IPI, iss prestador == ISS - PRESTAÇÃO DE SERVIÇOS)
 *
 * O resultado dá:
 *   - competencia (YYYY-MM) ou null se não conseguir
 *   - obrigação canônica (de VENCIMENTOS_FISCAIS_NOMES ou _SN_NOMES) ou null
 *   - erros listados pra usar no widget de avisos
 *   - nomeSugerido (forma canônica) pra mostrar pra usuária renomear
 *
 * Esse parser é usado em 2 lugares:
 *   - daemon local antes de chamar a API (avisa cedo)
 *   - endpoint /api/checklist-fiscal/auto-enviar (defesa em profundidade)
 */

import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES } from '@/app/types';

export type TipoErroParse =
  | 'sem_separador_data_obrigacao'
  | 'data_invalida'
  | 'ano_fora_do_intervalo'
  | 'mes_invalido'
  | 'obrigacao_vazia'
  | 'obrigacao_desconhecida'
  | 'extensao_invalida';

export interface ResultadoParseNome {
  valido: boolean;
  competencia: string | null;       // "2026-04"
  obrigacao: string | null;         // "ICMS NORMAL" (canônica) ou null
  obrigacaoOriginal: string | null; // o que foi escrito pelo usuário, pra mostrar no aviso
  erros: TipoErroParse[];
  /** Sugestão de nome correto (pra mostrar pra usuária renomear). */
  nomeSugerido: string | null;
}

const ANO_MIN = 2020;
const ANO_MAX = 2030;

/**
 * Normaliza string pra comparação: minúsculas, sem acentos, sem caracteres
 * especiais de pontuação, espaços simples.
 */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[._\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapa de aliases → nome canônico.
 *
 * Chaves estão JÁ normalizadas (lowercase, sem acento, separador simples).
 * Se vier mais de um match (ex: "iss" bate em prestador e tomador), o parser
 * usa o mais específico primeiro (chave mais longa).
 */
const ALIASES: Record<string, string> = {
  // ─── Regime Normal ───
  'icms normal': 'ICMS NORMAL',
  'icms tdd': 'ICMS TDD',
  'sped icms ipi': 'SPED ICMS/IPI',
  'sped icms': 'SPED ICMS/IPI',
  'sped fiscal': 'SPED ICMS/IPI',
  'efd fiscal': 'SPED ICMS/IPI',
  'efd icms ipi': 'SPED ICMS/IPI',
  'ipi': 'IPI',
  'gia st difal': 'GIA-ST/DIFAL',
  'gia st': 'GIA-ST/DIFAL',
  'gia': 'GIA-ST/DIFAL',
  'icms st difal': 'ICMS-ST/DIFAL',
  'icms st': 'ICMS-ST/DIFAL',
  'st difal': 'ICMS-ST/DIFAL',
  'iss prestacao de servicos': 'ISS - PRESTAÇÃO DE SERVIÇOS',
  'iss prestacao': 'ISS - PRESTAÇÃO DE SERVIÇOS',
  'iss prestador': 'ISS - PRESTAÇÃO DE SERVIÇOS',
  'iss prestados': 'ISS - PRESTAÇÃO DE SERVIÇOS',
  'iss servicos tomados': 'ISS - SERVIÇOS TOMADOS',
  'iss tomados': 'ISS - SERVIÇOS TOMADOS',
  'iss tomador': 'ISS - SERVIÇOS TOMADOS',
  'reinf': 'REINF',
  'efd reinf': 'REINF',
  'sped reinf': 'REINF',
  'darf servicos tomados': 'DARF-SERVIÇOS TOMADOS',
  'darf serv tomados': 'DARF-SERVIÇOS TOMADOS',
  'darf st': 'DARF-SERVIÇOS TOMADOS',
  'pis': 'PIS',
  'cofins': 'COFINS',
  'sped contribuicoes': 'SPED CONTRIBUIÇÕES',
  'sped contrib': 'SPED CONTRIBUIÇÕES',
  'efd contribuicoes': 'SPED CONTRIBUIÇÕES',
  'efd contrib': 'SPED CONTRIBUIÇÕES',
  'csll': 'CSLL',
  'irpj': 'IRPJ',
  'diferencial de aliquota': 'DIFERENCIAL DE ALIQUOTA',
  'diferencial aliquota': 'DIFERENCIAL DE ALIQUOTA',
  'dif aliquota': 'DIFERENCIAL DE ALIQUOTA',
  'dif aliq': 'DIFERENCIAL DE ALIQUOTA',
  'difal': 'DIFERENCIAL DE ALIQUOTA',
  'dapi': 'DAPI',
  'dime': 'DIME',
  'livros fiscais': 'LIVROS FISCAIS',
  'livros': 'LIVROS FISCAIS',
  'demonstr apuracao': 'DEMONSTR. APURAÇÃO',
  'demonstrativo apuracao': 'DEMONSTR. APURAÇÃO',
  'demonstrativo de apuracao': 'DEMONSTR. APURAÇÃO',
  'demonstrativo': 'DEMONSTR. APURAÇÃO',

  // ─── Simples Nacional ───
  'emissao guia das': 'EMISSÃO GUIA DAS',
  'emissao das': 'EMISSÃO GUIA DAS',
  'guia das': 'EMISSÃO GUIA DAS',
  'das': 'EMISSÃO GUIA DAS',
  'recibo das': 'RECIBO DAS',
  'recibo pgdas': 'RECIBO DAS',
  'recibo pgdas d': 'RECIBO DAS',
  'pgdas': 'RECIBO DAS',
  'declaracao das': 'DECLARAÇÃO DAS',
  'declaracao pgdas': 'DECLARAÇÃO DAS',
  'sintegra': 'SINTEGRA',
  'destda': 'DESTDA',
  'icms antecipado': 'ICMS ANTECIPADO',
  'icms ant': 'ICMS ANTECIPADO',
  'st antecipado': 'ST ANTECIPADO',
  'st ant': 'ST ANTECIPADO',
};

// Lista ordenada por tamanho desc — pra match "mais específico primeiro"
const ALIASES_ORDENADOS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

const TODAS_OBRIGACOES_CANONICAS = new Set<string>([
  ...VENCIMENTOS_FISCAIS_NOMES,
  ...VENCIMENTOS_FISCAIS_SN_NOMES,
]);

/**
 * Tenta mapear texto livre pra obrigação canônica.
 *   - Normaliza
 *   - Bate com aliases mais longos primeiro
 *   - Fallback: bate exato com nome canônico já normalizado
 */
export function resolverObrigacao(texto: string): string | null {
  const norm = normalizar(texto);
  if (!norm) return null;

  // Match exato em alias (rápido)
  if (ALIASES[norm]) return ALIASES[norm];

  // Match exato com nome canônico normalizado
  for (const canonico of TODAS_OBRIGACOES_CANONICAS) {
    if (normalizar(canonico) === norm) return canonico;
  }

  // Match parcial: pega o alias mais longo que aparece como palavra-chave
  // (usa space-padding pra evitar match em substring — "pis" não casa em "pisa")
  const padded = ` ${norm} `;
  for (const alias of ALIASES_ORDENADOS) {
    if (padded.includes(` ${alias} `)) return ALIASES[alias];
  }

  return null;
}

/**
 * Parser principal.
 *
 * @param nomeArquivo Nome do arquivo (com ou sem .pdf — extensão é validada)
 * @returns Resultado estruturado, sempre retorna (nunca lança)
 */
export function parseNomeGuia(nomeArquivo: string): ResultadoParseNome {
  const erros: TipoErroParse[] = [];
  let competencia: string | null = null;
  let obrigacao: string | null = null;
  let obrigacaoOriginal: string | null = null;

  // 1. Tira extensão e valida
  const baseSemExt = nomeArquivo.replace(/\.[^.]+$/, '').trim();
  const ext = (nomeArquivo.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  if (ext !== 'pdf') {
    erros.push('extensao_invalida');
  }

  // 2. Tenta extrair data no início: YYYY[separador]MM[separador]resto
  //    Usa lookahead negativo (?![\d]) ao invés de \b — \b não funciona quando
  //    o separador é underscore (que é word-char em regex JS), e cairíamos no
  //    caso "2026-04_ICMS_NORMAL.pdf" sendo rejeitado.
  const matchData = baseSemExt.match(/^\s*(\d{4})[\s\-_.]+(\d{1,2})(?!\d)(.*)$/);

  if (!matchData) {
    erros.push('data_invalida');
    // Sem data parseada, ainda tenta a obrigação se houver texto.
    const tentativaObr = baseSemExt.trim();
    if (tentativaObr) {
      obrigacaoOriginal = tentativaObr;
      obrigacao = resolverObrigacao(tentativaObr);
      if (!obrigacao) erros.push('obrigacao_desconhecida');
    } else {
      erros.push('obrigacao_vazia');
    }
    return montarResultado(competencia, obrigacao, obrigacaoOriginal, erros);
  }

  const ano = Number(matchData[1]);
  const mes = Number(matchData[2]);
  const resto = matchData[3] ?? '';

  if (ano < ANO_MIN || ano > ANO_MAX) {
    erros.push('ano_fora_do_intervalo');
  }
  if (mes < 1 || mes > 12) {
    erros.push('mes_invalido');
  }

  if (ano >= ANO_MIN && ano <= ANO_MAX && mes >= 1 && mes <= 12) {
    competencia = `${ano}-${String(mes).padStart(2, '0')}`;
  }

  // 3. Obrigação = tudo depois da data
  //    Aceita separador opcional logo após a data (espaço, hífen, underscore, ponto)
  const obrigacaoBruta = resto.replace(/^[\s\-_.]+/, '').trim();

  if (!obrigacaoBruta) {
    erros.push('obrigacao_vazia');
    return montarResultado(competencia, obrigacao, obrigacaoOriginal, erros);
  }

  obrigacaoOriginal = obrigacaoBruta;
  obrigacao = resolverObrigacao(obrigacaoBruta);

  if (!obrigacao) {
    erros.push('obrigacao_desconhecida');
  }

  return montarResultado(competencia, obrigacao, obrigacaoOriginal, erros);
}

function montarResultado(
  competencia: string | null,
  obrigacao: string | null,
  obrigacaoOriginal: string | null,
  erros: TipoErroParse[],
): ResultadoParseNome {
  const valido = erros.length === 0;
  let nomeSugerido: string | null = null;
  if (competencia && obrigacao) {
    nomeSugerido = `${competencia} ${obrigacao}.pdf`;
  }
  return { valido, competencia, obrigacao, obrigacaoOriginal, erros, nomeSugerido };
}

/**
 * Helper pra mensagens human-readable dos erros — usado no widget.
 */
export function descreverErroParse(erro: TipoErroParse): string {
  switch (erro) {
    case 'sem_separador_data_obrigacao': return 'Falta espaço entre a data e o nome da obrigação';
    case 'data_invalida':                return 'Data inválida. Use o formato AAAA-MM no início (ex: 2026-04)';
    case 'ano_fora_do_intervalo':        return `Ano fora do intervalo aceito (${ANO_MIN}-${ANO_MAX})`;
    case 'mes_invalido':                 return 'Mês inválido. Use 01 a 12';
    case 'obrigacao_vazia':              return 'Faltou o nome da obrigação após a data';
    case 'obrigacao_desconhecida':       return 'Nome da obrigação não reconhecido. Confira a lista oficial';
    case 'extensao_invalida':            return 'Arquivo precisa ser .pdf';
  }
}

/**
 * Extrai o nome bruto da pasta da empresa do caminho completo do servidor.
 *
 * Padrão esperado: T:\Fiscal\EMPRESA\<NOMEEMPRESA>\<FECHAMENTO|SIMPLES NACIONAL>\...
 * Retorna o segmento <NOMEEMPRESA> ou null se o caminho não bater.
 *
 * Aceita separadores Windows (\) e Unix (/). Case-insensitive nas pastas-âncora.
 */
export function extrairNomeEmpresaDoCaminho(caminhoCompleto: string): string | null {
  // Normaliza separadores
  const partes = caminhoCompleto.split(/[\\\/]+/).filter(Boolean);

  // Procura pelo segmento "EMPRESA" (case insensitive) — o próximo é o nome
  for (let i = 0; i < partes.length - 1; i++) {
    if (partes[i].toUpperCase() === 'EMPRESA') {
      return partes[i + 1] ?? null;
    }
  }
  return null;
}

/**
 * Detecta se o caminho indica regime SN (pasta "SIMPLES NACIONAL") ou Normal
 * (pasta "FECHAMENTO"). Útil pro endpoint decidir qual lista de obrigações
 * usar pra checar a obrigação parseada.
 */
export function detectarRegimeDoCaminho(caminhoCompleto: string): 'simples_nacional' | 'normal' | null {
  const upper = caminhoCompleto.toUpperCase();
  if (upper.includes('\\SIMPLES NACIONAL\\') || upper.includes('/SIMPLES NACIONAL/')) {
    return 'simples_nacional';
  }
  if (upper.includes('\\FECHAMENTO\\') || upper.includes('/FECHAMENTO/')) {
    return 'normal';
  }
  return null;
}
