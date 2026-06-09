/**
 * Validação rigorosa de guias fiscais antes de enviar para o cliente.
 *
 * Cada tipo de obrigação tem um "perfil de validação" que define:
 * - Âncoras: frases que precisam aparecer no PDF para confirmar o tipo
 * - Denominação: regex no campo de denominação (DARFs federais)
 * - Códigos de receita: lista informativa de códigos conhecidos
 * - Palavras proibidas: termos que indicam que a guia é de outra obrigação
 * - Verifica município: para ISS, exige que a cidade da empresa apareça no texto
 * - Estado esperado: para DAEs estaduais (MG, SP)
 *
 * Por que denominação manda e código é só confirmatório?
 * Códigos de receita variam pelo regime/tipo da empresa — IRPJ tem 2089, 0220,
 * 2362, 2456, 5993... travar numa lista fixa rejeitaria guias legítimas. A
 * denominação no DARF (ex: "IRPJ - LUCRO PRESUMIDO") sempre começa com o nome
 * do tributo, então essa é a regra de ouro.
 */
import type { Empresa } from '@/app/types';

export type SeveridadeValidacao = 'bloqueio' | 'aviso' | 'info';

export interface ProblemaValidacao {
  severidade: SeveridadeValidacao;
  motivo: string;
  detalhe: string;
}

export interface DadosDetectados {
  cnpjEncontrado: string | null;
  denominacaoEncontrada: string | null;
  codigoReceitaEncontrado: string | null;
  cidadeEncontrada: string | null;
  competencia: string | null;
  vencimento: string | null;
  valor: number | null;
}

export interface ResultadoValidacao {
  valido: boolean;
  problemas: ProblemaValidacao[];
  detectado: DadosDetectados;
  perfilUsado: string | null;
}

interface PerfilValidacao {
  /** Nome humano do perfil — usado no log e nas mensagens de erro. */
  nome: string;
  /** Frases que TODAS precisam aparecer no texto normalizado (ANDA). */
  anchorsObrigatorios: string[];
  /** Regex (case-insensitive) que precisa bater no texto. Geralmente identifica a denominação. */
  denominacaoRegex?: RegExp;
  /** Lista de códigos de receita conhecidos. Não bloqueia se não bater — apenas usado pra extrair pro log. */
  codigosReceitaConhecidos?: string[];
  /** Frases que NÃO podem aparecer — anti-confusão entre guias parecidas. */
  palavrasProibidas?: string[];
  /** Se true, verifica que `empresa.cidade` aparece no texto (crítico pra ISS). */
  verificaMunicipioDaEmpresa?: boolean;
  /** Se preenchido, espera que essa sigla apareça (ex: 'MG' pra DAE-MG). Apenas aviso, não bloqueio. */
  estadoEsperado?: string;
  /**
   * Alguns documentos (livros fiscais gerados por sistemas antigos) extraem com o
   * texto espaçado letra-a-letra ("r e g i s t r o d e a p u r a c a o"), o que
   * impede o match por palavra. Com esta flag, a denominação é testada também numa
   * versão SEM espaços — como as regex usam \s* (zero ou mais), continuam casando.
   * NÃO ligar em perfis que dependem de \b (ISS, DIME): sem espaços a fronteira de
   * palavra deixa de existir e o anti-confusão quebra.
   */
  matchSemEspacos?: boolean;
}

const COMBINING = /[̀-ͯ]/g;

function normalizar(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function apenasDigitos(s: string): string {
  return (s || '').replace(/\D+/g, '');
}

function encontrarCnpj(texto: string, cnpjEmpresa: string): string | null {
  const cnpjDigitos = apenasDigitos(cnpjEmpresa);
  if (cnpjDigitos.length !== 14) return null;
  const todosDigitos = apenasDigitos(texto);
  if (todosDigitos.includes(cnpjDigitos)) return cnpjDigitos;
  // Algumas guias (DARE-SP) trazem só o CNPJ-base (8 primeiros dígitos)
  // como identificador principal. Aceita se os 8 batem.
  const cnpjBase = cnpjDigitos.slice(0, 8);
  if (cnpjBase.length === 8 && todosDigitos.includes(cnpjBase)) return cnpjDigitos;
  return null;
}

/**
 * Procura a Inscrição Estadual da empresa no texto do PDF. Guias estaduais
 * (DAE-MG, GNRE, DAPI) frequentemente trazem só a IE, sem CNPJ. Comparação
 * por dígitos pra ignorar formatação (pontos, traços, zeros à esquerda).
 */
function encontrarInscricaoEstadual(texto: string, ieEmpresa: string): string | null {
  const ieDigitos = apenasDigitos(ieEmpresa);
  if (ieDigitos.length < 6) return null;
  const todosDigitos = apenasDigitos(texto);
  if (todosDigitos.includes(ieDigitos)) return ieEmpresa;
  // Tenta também sem zeros à esquerda (alguns sistemas omitem)
  const ieSemZeros = ieDigitos.replace(/^0+/, '');
  if (ieSemZeros.length >= 6 && todosDigitos.includes(ieSemZeros)) return ieEmpresa;
  return null;
}

/**
 * Detecta a competência no texto. Procura padrões "MM/YYYY", "PA: MM/YYYY",
 * "Período de Apuração", "Mês Ano de Referência" etc. Retorna 'YYYY-MM' ou null.
 */
function extrairCompetencia(texto: string): string | null {
  const padroes: RegExp[] = [
    /per[ií]odo\s*de\s*apura[çc][aã]o[^\d]{0,40}(\d{1,2})[\/\-.](\d{4})/i,
    /compet[eê]ncia[^\d]{0,40}(\d{1,2})[\/\-.](\d{4})/i,
    /\bpa\b[^\d]{0,15}(\d{1,2})[\/\-.](\d{4})/i,
    /m[eê]s\s*ano\s*de\s*refer[eê]ncia[^\d]{0,40}(\d{1,2})\s*[\/\-]\s*(\d{4})/i,
    /per[ií]odo\s*de\s*refer[eê]ncia[^\d]{0,40}(\d{1,2})[\/\-.](\d{4})/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const mes = Number(m[1]);
      const ano = Number(m[2]);
      if (mes >= 1 && mes <= 12 && ano >= 2000 && ano <= 2100) {
        return `${ano}-${String(mes).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function extrairVencimento(texto: string): string | null {
  const padroes: RegExp[] = [
    /data\s*de\s*vencimento[^\d]{0,40}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
    /pagar\s*este\s*documento\s*at[eé][^\d]{0,15}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
    /vencimento[^\d]{0,40}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
    /pag[aá]vel\s*at[eé][^\d]{0,15}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      let ano = Number(m[3]);
      if (m[3].length === 2) ano += 2000;
      if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ano >= 2000 && ano <= 2100) {
        return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function extrairValor(texto: string): number | null {
  const padroes: RegExp[] = [
    /valor\s*total\s*do\s*documento[^\d]{0,15}r?\$?\s*([\d.]{1,15},\d{2})/i,
    /total\s*a\s*recolher[^\d]{0,15}r?\$?\s*([\d.]{1,15},\d{2})/i,
    /total[^\d]{0,15}r?\$?\s*([\d.]{1,15},\d{2})/i,
    /r\$\s*([\d.]{1,15},\d{2})/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const bruto = m[1].replace(/\./g, '').replace(',', '.');
      const n = Number.parseFloat(bruto);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Procura um código de receita conhecido no texto. Aceita o código com ou sem
 * zeros à esquerda (a planilha às vezes traz "121-4" no lugar de "0121-4").
 */
function encontrarCodigoReceita(texto: string, codigos: string[]): string | null {
  const textoNoSpaces = texto.replace(/\s+/g, ' ');
  for (const cod of codigos) {
    const codTrim = cod.trim();
    if (!codTrim) continue;
    const variantes = new Set<string>();
    variantes.add(codTrim);
    // Sem zero à esquerda: "0120-6" -> "120-6"
    variantes.add(codTrim.replace(/^0+/, ''));
    // Com zero à esquerda em códigos 3-X / X-X: "121-4" -> "0121-4", "46-2" -> "046-2"
    if (/^\d{2,3}-\d$/.test(codTrim) && codTrim.length < 5) {
      variantes.add(`0${codTrim}`);
    }
    for (const v of variantes) {
      if (!v) continue;
      const escaped = v.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`);
      if (re.test(textoNoSpaces)) return cod;
    }
  }
  return null;
}

// Marcas de documentos que NÃO são guia de PAGAMENTO (recibos de SPED/EFD,
// declaração DAPI, livros de apuração). Esses documentos citam "ICMS ST /
// antecipado / DIFAL" como LINHA da apuração e casavam por engano nos perfis de
// guia ICMS abaixo, gerando obrigacao_ambigua em massa (verificação maio/2026:
// ~57 ambíguas eram SPED/DAPI/livro). Uma guia de pagamento (DAE/GNRE) nunca
// contém essas marcas, então proibi-las é seguro e faz cada documento classificar
// no seu tipo (LIVROS FISCAIS, DAPI, SPED) em vez de empatar com a guia.
const MARCAS_NAO_GUIA_ICMS = [
  'sistema\\s*publico\\s*de\\s*escrituracao\\s*digital',
  'escrituracao\\s*fiscal\\s*digital',
  '\\bdapi\\b',
  'declaracao\\s*de\\s*apuracao',
  'registro\\s*de\\s*apuracao',
  'livro\\s*registro',
];

/**
 * Tabela de perfis por nome de obrigação. Os nomes vêm de
 * VENCIMENTOS_FISCAIS_NOMES e VENCIMENTOS_FISCAIS_SN_NOMES em types.ts.
 */
const PERFIS: Record<string, PerfilValidacao> = {
  // ─── Federais (DARF) ────────────────────────────────────────────────────
  PIS: {
    nome: 'PIS (DARF Federal)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /pis\s*-\s*/i,
    codigosReceitaConhecidos: ['8109', '3703', '8301', '6912'],
    palavrasProibidas: ['simples nacional', 'documento de arrecadacao do simples', 'cofins\\s*-\\s*contrib', 'cofins\\s*-\\s*faturamento'],
  },
  COFINS: {
    nome: 'COFINS (DARF Federal)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /cofins\s*-\s*/i,
    codigosReceitaConhecidos: ['2172', '1239', '8645', '5856'],
    palavrasProibidas: ['simples nacional', 'documento de arrecadacao do simples', 'pis\\s*-\\s*faturamento', 'pis\\s*-\\s*pasep'],
  },
  IRPJ: {
    nome: 'IRPJ (DARF Federal)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /irpj\s*-\s*/i,
    codigosReceitaConhecidos: ['2089', '0220', '2362', '2456', '5993', '3373'],
    palavrasProibidas: ['simples nacional', 'csll\\s*-\\s*', 'pis\\s*-\\s*', 'cofins\\s*-\\s*'],
  },
  CSLL: {
    nome: 'CSLL (DARF Federal)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /csll\s*-\s*/i,
    codigosReceitaConhecidos: ['2372', '2484', '6773', '2030'],
    palavrasProibidas: ['simples nacional', 'irpj\\s*-\\s*', 'pis\\s*-\\s*', 'cofins\\s*-\\s*'],
  },
  'DARF-SERVIÇOS TOMADOS': {
    nome: 'DARF Serviços Tomados (IRRF)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /(irrf|ret\s*de\s*contribuicoes\s*pagt\s*pj\s*a\s*pj)/i,
    codigosReceitaConhecidos: ['1708', '5952', '5979', '0588'],
    palavrasProibidas: ['simples nacional', 'pis\\s*-\\s*faturamento'],
  },
  'IPI': {
    nome: 'IPI (DARF Federal)',
    anchorsObrigatorios: ['documento de arrecadacao'],
    denominacaoRegex: /ipi\s*-\s*/i,
    codigosReceitaConhecidos: ['5123', '1097', '0668'],
    palavrasProibidas: ['simples nacional', 'pis\\s*-\\s*faturamento', 'cofins\\s*-\\s*contrib', 'irpj\\s*-\\s*'],
  },
  'REINF': {
    nome: 'EFD-Reinf',
    anchorsObrigatorios: ['efd-reinf', 'escrituracao fiscal digital'],
    denominacaoRegex: /(r-2020|r-4020|r-1000|retencao\s*contribuicao\s*previdenciaria)/i,
  },

  // ─── SPEDs ──────────────────────────────────────────────────────────────
  'SPED ICMS/IPI': {
    nome: 'SPED Fiscal (ICMS/IPI)',
    anchorsObrigatorios: ['sistema publico de escrituracao digital', 'recibo de entrega'],
    denominacaoRegex: /apuracao\s*do\s*icms/i,
    palavrasProibidas: ['efd-contribuicoes'],
  },
  'SPED CONTRIBUIÇÕES': {
    nome: 'SPED Contribuições',
    anchorsObrigatorios: ['sistema publico de escrituracao digital'],
    denominacaoRegex: /(efd-contribuicoes|apuracao\s*das\s*contribuicoes\s*socias|pis\/pasep)/i,
  },

  // ─── Estaduais (genéricos por nome — sistema escolhe o perfil correto pelo
  //     conteúdo, mas o nome da obrigação é o ponto de entrada) ────────────
  'ICMS NORMAL': {
    nome: 'ICMS Normal (DAE-MG ou DARE-SP)',
    anchorsObrigatorios: [],
    // Cobre as variantes SETORIAIS do DAE-MG: comércio-outros (0120), combustível/
    // lubrificantes (0105, postos), transportes (0115), serviço/comunicação. Sem
    // isso, posto/transportadora de MG caía em obrigacao_nao_identificada.
    denominacaoRegex: /(icms\s*comercio\s*-\s*outros|icms\s*comb(?:ust)?|icms\s*transporte|icms\s*servico|icms\s*[–-]\s*regime\s*periodico\s*de\s*apuracao|operacoes\s*proprias-\s*rpa)/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*comercio\\s*td', 'icms\\s*st\\s*entradas', 'icms\\s*st\\s*industria', 'icms\\s*[-–]?\\s*substituicao\\s*tributaria', 'icms\\s*diferenca\\s*de\\s*aliquota', 'icms\\s*rec\\s*\\.\\s*antecipado', ...MARCAS_NAO_GUIA_ICMS],
  },
  'ICMS TDD': {
    nome: 'ICMS TDD (DAE-MG)',
    anchorsObrigatorios: [],
    denominacaoRegex: /icms\s*comercio\s*td/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*comercio\\s*-\\s*outros', 'icms\\s*st\\s*entradas', 'icms\\s*diferenca\\s*de\\s*aliquota', 'icms\\s*rec\\s*\\.\\s*antecipado'],
  },
  'ICMS-ST': {
    nome: 'ICMS-ST',
    anchorsObrigatorios: [],
    // SÓ Substituição Tributária (ST). DIFAL é obrigação SEPARADA (DIFERENCIAL
    // DE ALIQUOTA) — por isso "diferencial/difal" aqui é PALAVRA PROIBIDA: guia
    // de DIFAL não cai em ST. Pega ICMS-ST geral (indústria/saída/outros, ex.
    // DAE-MG "icms st industria-outros") + GNRE/guia nacional SEM marca de DIFAL.
    // "st entradas" fica de fora (é do ST ANTECIPADO).
    denominacaoRegex: /(icms\s*[-–]?\s*substituicao\s*tributaria|substituicao\s*tributaria\s*-\s*rpa|\bicms\s*st\b|gnre|guia\s*nacional\s*de\s*recolhimento)/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*st\\s*entradas', 'diferencial\\s*de\\s*aliquota', 'icms\\s*diferenca\\s*de\\s*aliquota', 'difal', ...MARCAS_NAO_GUIA_ICMS],
  },
  'GIA-ST': {
    nome: 'GIA-ST',
    anchorsObrigatorios: [],
    // GIA-ST é uma DECLARAÇÃO (Guia de Informação e Apuração do ICMS-ST),
    // transmitida eletronicamente. Não deve reivindicar "guia nacional de
    // recolhimento" (isso é GNRE, guia de PAGAMENTO) nem "icms diferenca de
    // aliquota" (tipo de tributo) — essas frases colidiam com ICMS-ST/DIFAL e
    // DIFERENCIAL DE ALIQUOTA e geravam obrigacao_ambigua.
    denominacaoRegex: /(gia-?st|comprovante\s*de\s*transmissao|guia\s*informativa)/i,
  },
  'DIFERENCIAL DE ALIQUOTA': {
    nome: 'Diferencial de Alíquota',
    anchorsObrigatorios: [],
    denominacaoRegex: /(icms\s*diferenca\s*de\s*aliquota|diferencial\s*de\s*aliquota|difal)/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*st\\s*entradas', 'icms\\s*rec\\s*\\.\\s*antecipado', ...MARCAS_NAO_GUIA_ICMS],
  },
  'DAPI': {
    nome: 'DAPI (Minas Gerais)',
    anchorsObrigatorios: ['fazenda de minas gerais'],
    denominacaoRegex: /(dapi|declaracao\s*de\s*apuracao|recibo\s*de\s*transmissao)/i,
    estadoEsperado: 'MG',
  },
  'DIME': {
    nome: 'DIME (Santa Catarina)',
    anchorsObrigatorios: [],
    // \bdime\b com fronteira: /dime/ casava com "aTENDIMEnto" (substring),
    // virando candidato fantasma em guias municipais. "santa catarina" removido
    // (genérico demais — aparece em endereços). estadoEsperado SC ainda orienta.
    denominacaoRegex: /\bdime\b|declaracao\s*do\s*ic\s*ms\s*mensal/i,
    estadoEsperado: 'SC',
  },

  // ─── ISS Municipais ─────────────────────────────────────────────────────
  'ISS - PRESTAÇÃO DE SERVIÇOS': {
    nome: 'ISS Prestação de Serviços',
    anchorsObrigatorios: [],
    // FRONTEIRA DE PALAVRA é crítica: /(iss|issqn)/ casava com "emISSao",
    // "comISSao", "transmISSao" — que aparecem em QUASE TODA guia (DARE, DAE,
    // DARF...). Isso fazia o ISS colidir com a obrigação real e gerar
    // obrigacao_ambigua em massa. \b(iss|issqn)\b só pega ISS/ISSQN como palavra.
    // "imposto sobre servic(o)" cobre municípios que escrevem por extenso.
    denominacaoRegex: /\b(iss|issqn)\b|imposto\s+sobre\s+servic/i,
    // "simples nacional" proibido: o DAS/PGDAS lista o ISS como um dos tributos
    // do Simples + o município, e o ISS casava por engano (133 guias do Simples
    // viravam ambíguas [ISS, DAS]). Guia avulsa de ISS municipal nunca diz isso.
    palavrasProibidas: ['tomados', 'retido\\s*na\\s*fonte', 'issqn\\s*tomador', 'simples\\s*nacional'],
    verificaMunicipioDaEmpresa: true,
  },
  'ISS - SERVIÇOS TOMADOS': {
    nome: 'ISS Serviços Tomados',
    anchorsObrigatorios: [],
    // Exige marca POSITIVA de "tomado/retido" — espelha as palavrasProibidas do
    // perfil de Prestação. Sem isto, /(iss|issqn)/ casava com QUALQUER guia de
    // ISS (inclusive Prestado), colidindo com o perfil de Prestação e marcando
    // tudo como obrigacao_ambigua. Agora guia de Prestado reprova aqui.
    denominacaoRegex: /(tomad|retido\s*na\s*fonte|issqn\s*tomador)/i,
    // Mesmo motivo do Prestação: não casar com documento do Simples Nacional.
    palavrasProibidas: ['simples\\s*nacional'],
    verificaMunicipioDaEmpresa: true,
  },

  // ─── Simples Nacional ───────────────────────────────────────────────────
  'EMISSÃO GUIA DAS': {
    nome: 'DAS (Documento de Arrecadação do Simples Nacional)',
    anchorsObrigatorios: ['documento de arrecadacao', 'simples nacional'],
    denominacaoRegex: /simples\s*nacional/i,
    codigosReceitaConhecidos: ['1001', '1002', '1004', '1005', '1006', '1007', '1008'],
    // É a GUIA de PAGAMENTO. Proíbe marcas da DECLARAÇÃO e do RECIBO (que também
    // citam "documento de arrecadacao do simples nacional") pra não pegar eles.
    palavrasProibidas: ['receitas federais', 'darf', 'declaratorio', 'discriminativo\\s*de\\s*receitas', 'recibo\\s*de\\s*entrega'],
  },
  'RECIBO DAS': {
    nome: 'Recibo PGDAS-D',
    anchorsObrigatorios: ['pgdas-d'],
    // O recibo é o comprovante de ENTREGA da declaração. A âncora 'pgdas-d'
    // garante que só casa com documento do PGDAS-D (não vaza pra SPED etc.).
    denominacaoRegex: /recibo\s*de\s*entrega/i,
  },
  'DECLARAÇÃO DAS': {
    nome: 'Declaração DAS (PGDAS-D)',
    anchorsObrigatorios: [],
    // A DECLARAÇÃO (extrato do PGDAS-D) tem marcas ÚNICAS: "declaratório",
    // "discriminativo de receitas", "programa gerador do documento...". Antes a
    // âncora era 'pgdas-d', mas a declaração real escreve "programa gerador..."
    // por extenso (não tem "pgdas-d" literal) → não casava nada. Proíbe "recibo
    // de entrega" pra não pegar o RECIBO. (Marcadores confirmados em guias reais.)
    denominacaoRegex: /(declaratorio|discriminativo\s*de\s*receitas|programa\s*gerador\s*do\s*documento)/i,
    palavrasProibidas: ['recibo\\s*de\\s*entrega'],
  },
  'SINTEGRA': {
    nome: 'SINTEGRA',
    anchorsObrigatorios: ['sintegra'],
    denominacaoRegex: /(sistema\s*integrado\s*de\s*informacoes|convenio\s*icms|operacoes\s*interestaduais)/i,
  },
  'DESTDA': {
    nome: 'DeSTDA',
    anchorsObrigatorios: ['destda'],
    denominacaoRegex: /(declaracao\s*de\s*substituicao\s*tributaria|conteudo:\s*destda|recibo\s*de\s*entrega\s*de\s*documentos\s*digitais)/i,
  },
  'ICMS ANTECIPADO': {
    nome: 'ICMS Antecipado',
    anchorsObrigatorios: [],
    // Inclui a forma da DARE-SP/GNRE ("icms - recolhimento antecipado (outra uf)"),
    // que escreve por extenso e não casava /icms antecipado/.
    denominacaoRegex: /(icms\s*rec\s*\.?\s*antecipado|icms\s*antecipado|icms\s*[-–]?\s*recolhimento\s*antecipado|recolhimento\s*antecipado\s*\(outra\s*uf\))/i,
    palavrasProibidas: ['icms\\s*st\\s*entradas', 'icms\\s*diferenca\\s*de\\s*aliquota', 'demonstrativo\\s*do\\s*icms\\s*antecipado', ...MARCAS_NAO_GUIA_ICMS],
  },
  'ST ANTECIPADO': {
    nome: 'ST Antecipado',
    anchorsObrigatorios: [],
    // Adjacência (sem ".*" largo): nos livros de apuração "substituição tributária"
    // e "entradas" aparecem como SEÇÕES distantes e o ".*" casava por engano,
    // gerando [ST ANTECIPADO, LIVROS FISCAIS]. Guia real diz "ICMS ST ENTRADAS"
    // ou "substituição tributária - entradas" grudado.
    denominacaoRegex: /(icms\s*st\s*entradas|substituicao\s*tributaria\s*[-–]?\s*entrada)/i,
    palavrasProibidas: ['icms\\s*rec\\s*\\.\\s*antecipado', ...MARCAS_NAO_GUIA_ICMS],
  },

  // ─── Internas do escritório ─────────────────────────────────────────────
  'LIVROS FISCAIS': {
    nome: 'Livros Fiscais',
    anchorsObrigatorios: [],
    // Cobre os livros reais: apuração ICMS/IPI ("registro de apuracao"), entradas e
    // saídas ("livro registro de entradas/saidas") e o genérico "livro fiscal".
    // matchSemEspacos: os livros saem com texto espaçado letra-a-letra.
    denominacaoRegex: /(registro\s*de\s*apuracao|registro\s*de\s*(entradas?|saidas?|notas\s*fiscais)|livro\s*registro|livro\s*fiscal)/i,
    matchSemEspacos: true,
  },
  'DEMONSTR. APURAÇÃO': {
    nome: 'Demonstrativo de Apuração',
    anchorsObrigatorios: [],
    denominacaoRegex: /(demonstrativo\s*do\s*credito\s*presumido|apuracao\s*geral|demonstrativo\s*de\s*apuracao)/i,
    matchSemEspacos: true,
  },
};

/**
 * Aliases de nome — mesma obrigação pode aparecer com variações.
 */
const ALIASES: Record<string, string> = {
  // Retrocompat com nomes antigos (antes de separar)
  'PIS/COFINS': 'PIS',
  'CSLL/IRPJ': 'CSLL',
  'ICMS': 'ICMS NORMAL',
  // Atalhos comuns
  'DARF': 'DARF-SERVIÇOS TOMADOS',
  'DARF SERVICOS TOMADOS': 'DARF-SERVIÇOS TOMADOS',
  'DARF SERVIÇOS TOMADOS': 'DARF-SERVIÇOS TOMADOS',
  'DAS': 'EMISSÃO GUIA DAS',
  'ICMS ST': 'ICMS-ST',
  'GIA': 'GIA-ST',
  // Retrocompat: nomes antigos (antes de separar ST do DIFAL) -> novos.
  'ICMS-ST/DIFAL': 'ICMS-ST',
  'GIA-ST/DIFAL': 'GIA-ST',
  'DIFAL': 'DIFERENCIAL DE ALIQUOTA',
  'DIFERENCIAL DE ALÍQUOTA': 'DIFERENCIAL DE ALIQUOTA',
  'ISS PRESTADOR': 'ISS - PRESTAÇÃO DE SERVIÇOS',
  'ISS TOMADOR': 'ISS - SERVIÇOS TOMADOS',
  'LIVRO FISCAL ICMS': 'LIVROS FISCAIS',
  'LIVRO FISCAL IPI': 'LIVROS FISCAIS',
  'DEMONSTRATIVO APURAÇÃO': 'DEMONSTR. APURAÇÃO',
};

function resolverPerfil(obrigacaoNome: string): { chave: string; perfil: PerfilValidacao } | null {
  const direto = PERFIS[obrigacaoNome];
  if (direto) return { chave: obrigacaoNome, perfil: direto };

  const normalizadoEntrada = normalizar(obrigacaoNome).toUpperCase();
  for (const [alias, alvo] of Object.entries(ALIASES)) {
    if (normalizar(alias).toUpperCase() === normalizadoEntrada) {
      const perfil = PERFIS[alvo];
      if (perfil) return { chave: alvo, perfil };
    }
  }

  // Tenta match parcial nos nomes dos perfis (último recurso)
  for (const [chave, perfil] of Object.entries(PERFIS)) {
    if (normalizar(chave).toUpperCase() === normalizadoEntrada) {
      return { chave, perfil };
    }
  }

  return null;
}

export function validarGuia(
  texto: string,
  empresa: Empresa,
  obrigacaoNome: string,
  /** Códigos de receita esperados desta empresa pra esta obrigação. Se preenchido, exige bater (bloqueio). Se vazio, segue só pela denominação. Vem da tabela empresa_obrigacoes_config. */
  codigosEsperados?: string[],
): ResultadoValidacao {
  const problemas: ProblemaValidacao[] = [];
  const textoNorm = normalizar(texto);

  const detectado: DadosDetectados = {
    cnpjEncontrado: null,
    denominacaoEncontrada: null,
    codigoReceitaEncontrado: null,
    cidadeEncontrada: null,
    competencia: extrairCompetencia(texto),
    vencimento: extrairVencimento(texto),
    valor: extrairValor(texto),
  };

  // ─── Bloqueio 1: identifica a empresa via CNPJ OU Inscrição Estadual ────
  // Guias estaduais (DAE-MG, GNRE, DAPI) frequentemente não trazem o CNPJ
  // visível, só a Inscrição Estadual. Aceita qualquer um dos dois como
  // prova de que a guia é desta empresa.
  const cnpjEmpresa = empresa.cnpj ?? '';
  const ieEmpresa = empresa.inscricao_estadual ?? '';
  const cnpjEncontrado = cnpjEmpresa ? encontrarCnpj(texto, cnpjEmpresa) : null;
  detectado.cnpjEncontrado = cnpjEncontrado;

  if (cnpjEncontrado) {
    // ok — identificou por CNPJ
  } else if (ieEmpresa && encontrarInscricaoEstadual(texto, ieEmpresa)) {
    // Identificou pela IE — comum em guias estaduais
    problemas.push({
      severidade: 'info',
      motivo: 'Identificação por Inscrição Estadual',
      detalhe: `CNPJ não visível no PDF, mas a Inscrição Estadual ${ieEmpresa} confere. Comum em DAE-MG e GNRE.`,
    });
  } else if (!cnpjEmpresa && !ieEmpresa) {
    problemas.push({
      severidade: 'aviso',
      motivo: 'Empresa sem CNPJ ou IE cadastrados',
      detalhe: 'Não foi possível verificar se a guia é desta empresa porque o cadastro está sem CNPJ e sem Inscrição Estadual.',
    });
  } else {
    const tentados: string[] = [];
    if (cnpjEmpresa) tentados.push(`CNPJ ${cnpjEmpresa}`);
    if (ieEmpresa) tentados.push(`Inscrição Estadual ${ieEmpresa}`);
    problemas.push({
      severidade: 'bloqueio',
      motivo: 'Empresa não identificada no PDF',
      detalhe: `Nenhum identificador da empresa "${empresa.razao_social || empresa.codigo}" foi encontrado no PDF (tentei: ${tentados.join(' e ')}). A guia pode ser de outra empresa.`,
    });
  }

  // ─── Resolve o perfil de validação pela obrigação esperada ─────────────
  const resolvido = resolverPerfil(obrigacaoNome);
  if (!resolvido) {
    problemas.push({
      severidade: 'aviso',
      motivo: 'Sem regra de validação',
      detalhe: `Não há perfil de validação configurado para "${obrigacaoNome}". O upload será aceito sem verificação do tipo de guia.`,
    });
    return {
      valido: problemas.every((p) => p.severidade !== 'bloqueio'),
      problemas,
      detectado,
      perfilUsado: null,
    };
  }

  const { perfil, chave } = resolvido;

  // ─── Bloqueio 2: Âncoras obrigatórias ───────────────────────────────────
  if (perfil.anchorsObrigatorios.length > 0) {
    const faltando = perfil.anchorsObrigatorios.filter((a) => !textoNorm.includes(normalizar(a)));
    if (faltando.length > 0) {
      problemas.push({
        severidade: 'bloqueio',
        motivo: 'Tipo de guia não confere',
        detalhe: `Esperado "${perfil.nome}", mas não encontrei estas frases obrigatórias no PDF: ${faltando.map((f) => `"${f}"`).join(', ')}.`,
      });
    }
  }

  // ─── Bloqueio 3: Denominação ────────────────────────────────────────────
  // Roda no texto NORMALIZADO (lowercase, sem acentos) — todas as regex de
  // denominação foram escritas assumindo essa forma. Aplicar no texto cru
  // faria "Operações Próprias" não bater em /operacoes proprias/.
  if (perfil.denominacaoRegex) {
    let m = textoNorm.match(perfil.denominacaoRegex);
    // Fallback p/ texto espaçado letra-a-letra (ver matchSemEspacos no tipo).
    if (!m && perfil.matchSemEspacos) {
      m = textoNorm.replace(/\s+/g, '').match(perfil.denominacaoRegex);
    }
    if (m) {
      detectado.denominacaoEncontrada = m[0];
    } else {
      problemas.push({
        severidade: 'bloqueio',
        motivo: 'Denominação não confere',
        detalhe: `Esperado "${perfil.nome}", mas a denominação característica não foi encontrada no PDF.`,
      });
    }
  }

  // ─── Bloqueio 4: Palavras proibidas (anti-confusão) ─────────────────────
  if (perfil.palavrasProibidas && perfil.palavrasProibidas.length > 0) {
    for (const proibida of perfil.palavrasProibidas) {
      const re = new RegExp(proibida, 'i');
      if (re.test(textoNorm)) {
        problemas.push({
          severidade: 'bloqueio',
          motivo: 'Guia parece ser de outro tributo',
          detalhe: `Esperado "${perfil.nome}", mas o PDF contém "${proibida.replace(/\\s\*/g, ' ').replace(/\\/g, '')}", o que indica outra obrigação.`,
        });
      }
    }
  }

  // ─── Bloqueio 5: Município (ISS) ────────────────────────────────────────
  if (perfil.verificaMunicipioDaEmpresa) {
    const cidade = empresa.cidade?.trim();
    if (!cidade) {
      problemas.push({
        severidade: 'aviso',
        motivo: 'Empresa sem cidade cadastrada',
        detalhe: 'Não foi possível verificar se a guia é do município correto porque o cadastro está sem cidade.',
      });
    } else {
      const cidadeNorm = normalizar(cidade);
      // Aceita match com a cidade limpa (sem "MG", "SP", acentos)
      if (textoNorm.includes(cidadeNorm)) {
        detectado.cidadeEncontrada = cidade;
      } else {
        problemas.push({
          severidade: 'bloqueio',
          motivo: 'Município não confere',
          detalhe: `A cidade "${cidade}" da empresa não foi encontrada no PDF. Cada município emite seu próprio ISS — esta guia pode ser de outra cidade.`,
        });
      }
    }
  }

  // ─── Aviso: estado esperado ─────────────────────────────────────────────
  if (perfil.estadoEsperado) {
    const ufNorm = perfil.estadoEsperado.toLowerCase();
    if (!textoNorm.includes(` ${ufNorm} `) && !textoNorm.includes(`uf:${ufNorm}`) && !textoNorm.includes(`uf: ${ufNorm}`)) {
      problemas.push({
        severidade: 'aviso',
        motivo: 'Estado da guia parece diferente',
        detalhe: `Esperado uma guia de ${perfil.estadoEsperado}, mas não encontrei a sigla no PDF.`,
      });
    }
  }

  // ─── Bloqueio 6: código de receita cadastrado pra esta empresa ─────────
  // Se a empresa tem códigos cadastrados (empresa_obrigacoes_config.codigos),
  // o PDF tem que trazer um deles. Caso contrário, bloqueia — admin/gerente
  // pode forçar pela UI se a planilha estiver errada.
  const codigosLimpos = (codigosEsperados ?? []).map((c) => c.trim()).filter(Boolean);
  if (codigosLimpos.length > 0) {
    const codigoEncontrado = encontrarCodigoReceita(texto, codigosLimpos);
    if (codigoEncontrado) {
      detectado.codigoReceitaEncontrado = codigoEncontrado;
    } else {
      // Tenta detectar QUAL código aparece no PDF (pra ajudar o usuário a entender)
      let codigoVistoNoPdf: string | null = null;
      if (perfil.codigosReceitaConhecidos) {
        codigoVistoNoPdf = encontrarCodigoReceita(texto, perfil.codigosReceitaConhecidos);
      }
      problemas.push({
        severidade: 'bloqueio',
        motivo: 'Código de receita não confere com o cadastro da empresa',
        detalhe: `Para "${empresa.razao_social || empresa.codigo}" esta obrigação usa código(s): ${codigosLimpos.join(', ')}. ${codigoVistoNoPdf ? `O PDF traz código ${codigoVistoNoPdf} — diferente do esperado.` : 'Nenhum dos códigos esperados foi encontrado no PDF.'}`,
      });
    }
  } else if (perfil.codigosReceitaConhecidos && perfil.codigosReceitaConhecidos.length > 0) {
    // Empresa sem códigos cadastrados — usa lista global do perfil só pra preview
    const cod = encontrarCodigoReceita(texto, perfil.codigosReceitaConhecidos);
    if (cod) detectado.codigoReceitaEncontrado = cod;
  }

  const valido = !problemas.some((p) => p.severidade === 'bloqueio');
  return { valido, problemas, detectado, perfilUsado: chave };
}

/** Lista de obrigações que têm perfil de validação configurado. */
export function obrigacoesComValidacao(): string[] {
  return Object.keys(PERFIS);
}
