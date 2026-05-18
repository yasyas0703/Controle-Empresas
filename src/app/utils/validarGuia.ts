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
 * Procura um código de receita conhecido no texto. Retorna o primeiro que
 * achar, junto com o contexto (texto ao redor) pra log.
 */
function encontrarCodigoReceita(texto: string, codigos: string[]): string | null {
  for (const cod of codigos) {
    const escaped = cod.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`);
    if (re.test(texto)) return cod;
  }
  return null;
}

/**
 * Tabela de perfis por nome de obrigação. Os nomes vêm de
 * VENCIMENTOS_FISCAIS_NOMES e VENCIMENTOS_FISCAIS_SN_NOMES em types.ts.
 */
const PERFIS: Record<string, PerfilValidacao> = {
  // ─── Federais (DARF) ────────────────────────────────────────────────────
  'PIS/COFINS': {
    nome: 'PIS/COFINS (DARF Federal)',
    anchorsObrigatorios: ['receita federal', 'documento de arrecadacao'],
    denominacaoRegex: /(pis\s*-\s*|cofins\s*-\s*contrib|cofins\s*-\s*faturamento)/i,
    codigosReceitaConhecidos: ['8109', '2172', '1239', '3703', '8645', '5856'],
    palavrasProibidas: ['simples nacional', 'documento de arrecadacao do simples'],
  },
  'CSLL/IRPJ': {
    nome: 'CSLL/IRPJ (DARF Federal)',
    anchorsObrigatorios: ['receita federal', 'documento de arrecadacao'],
    denominacaoRegex: /(irpj\s*-\s*|csll\s*-\s*)/i,
    codigosReceitaConhecidos: ['2089', '0220', '2362', '2456', '5993', '2372', '2484', '6773', '2030'],
    palavrasProibidas: ['simples nacional', 'pis\\s*-\\s*faturamento', 'cofins\\s*-\\s*contrib'],
  },
  'DARF-SERVIÇOS TOMADOS': {
    nome: 'DARF Serviços Tomados (IRRF)',
    anchorsObrigatorios: ['receita federal', 'documento de arrecadacao'],
    denominacaoRegex: /(irrf|ret\s*de\s*contribuicoes\s*pagt\s*pj\s*a\s*pj)/i,
    codigosReceitaConhecidos: ['1708', '5952', '5979', '0588'],
    palavrasProibidas: ['simples nacional', 'pis\\s*-\\s*faturamento'],
  },
  'IPI': {
    nome: 'IPI (DARF Federal)',
    anchorsObrigatorios: ['receita federal', 'documento de arrecadacao'],
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
  'ICMS': {
    nome: 'ICMS Normal',
    // Pelo menos um dos anchors precisa aparecer — não usa anchorsObrigatorios,
    // usa o regex de denominação que cobre os 2 layouts (DAE-MG e DARE-SP).
    anchorsObrigatorios: [],
    denominacaoRegex: /(icms\s*comercio\s*-\s*outros|icms\s*–\s*regime\s*periodico\s*de\s*apuracao|icms\s*-\s*regime\s*periodico\s*de\s*apuracao|operacoes\s*proprias-\s*rpa)/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*st\\s*entradas', 'icms\\s*diferenca\\s*de\\s*aliquota', 'icms\\s*rec\\s*\\.\\s*antecipado'],
  },
  'ICMS-ST/DIFAL': {
    nome: 'ICMS-ST / DIFAL',
    anchorsObrigatorios: [],
    denominacaoRegex: /(icms\s*-\s*substituicao\s*tributaria|icms\s*–\s*substituicao\s*tributaria|icms\s*st\s*entradas|icms\s*diferenca\s*de\s*aliquota|substituicao\s*tributaria\s*-\s*rpa|gnre|guia\s*nacional\s*de\s*recolhimento)/i,
    palavrasProibidas: ['simples nacional'],
  },
  'GIA-ST/DIFAL': {
    nome: 'GIA-ST / DIFAL',
    anchorsObrigatorios: [],
    denominacaoRegex: /(gia-?st|comprovante\s*de\s*transmissao|guia\s*informativa|guia\s*nacional\s*de\s*recolhimento|icms\s*diferenca\s*de\s*aliquota)/i,
  },
  'DIFERENCIAL DE ALIQUOTA': {
    nome: 'Diferencial de Alíquota',
    anchorsObrigatorios: [],
    denominacaoRegex: /(icms\s*diferenca\s*de\s*aliquota|diferencial\s*de\s*aliquota|difal)/i,
    palavrasProibidas: ['simples nacional', 'icms\\s*st\\s*entradas', 'icms\\s*rec\\s*\\.\\s*antecipado'],
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
    denominacaoRegex: /(dime|declaracao\s*do\s*ic\s*ms\s*mensal|santa\s*catarina)/i,
    estadoEsperado: 'SC',
  },

  // ─── ISS Municipais ─────────────────────────────────────────────────────
  'ISS - PRESTAÇÃO DE SERVIÇOS': {
    nome: 'ISS Prestação de Serviços',
    anchorsObrigatorios: [],
    denominacaoRegex: /(iss|issqn)/i,
    palavrasProibidas: ['tomados', 'retido\\s*na\\s*fonte', 'issqn\\s*tomador'],
    verificaMunicipioDaEmpresa: true,
  },
  'ISS - SERVIÇOS TOMADOS': {
    nome: 'ISS Serviços Tomados',
    anchorsObrigatorios: [],
    denominacaoRegex: /(iss|issqn)/i,
    palavrasProibidas: [],
    verificaMunicipioDaEmpresa: true,
  },

  // ─── Simples Nacional ───────────────────────────────────────────────────
  'EMISSÃO GUIA DAS': {
    nome: 'DAS (Documento de Arrecadação do Simples Nacional)',
    anchorsObrigatorios: ['documento de arrecadacao', 'simples nacional'],
    denominacaoRegex: /simples\s*nacional/i,
    codigosReceitaConhecidos: ['1001', '1002', '1004', '1005', '1006', '1007', '1008'],
    palavrasProibidas: ['receitas federais', 'darf'],
  },
  'RECIBO DAS': {
    nome: 'Recibo PGDAS-D',
    anchorsObrigatorios: ['pgdas-d'],
    denominacaoRegex: /(recibo\s*de\s*entrega\s*da\s*apuracao|simples\s*nacional)/i,
  },
  'DECLARAÇÃO DAS': {
    nome: 'Declaração DAS (PGDAS-D)',
    anchorsObrigatorios: ['pgdas-d'],
    denominacaoRegex: /(recibo\s*de\s*entrega\s*da\s*apuracao|simples\s*nacional)/i,
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
    denominacaoRegex: /(icms\s*rec\s*\.?\s*antecipado|icms\s*antecipado)/i,
    palavrasProibidas: ['icms\\s*st\\s*entradas', 'icms\\s*diferenca\\s*de\\s*aliquota'],
  },
  'ST ANTECIPADO': {
    nome: 'ST Antecipado',
    anchorsObrigatorios: [],
    denominacaoRegex: /(icms\s*st\s*entradas|substituicao\s*tributaria.*entrada)/i,
    palavrasProibidas: ['icms\\s*rec\\s*\\.\\s*antecipado'],
  },

  // ─── Internas do escritório ─────────────────────────────────────────────
  'LIVROS FISCAIS': {
    nome: 'Livros Fiscais',
    anchorsObrigatorios: [],
    denominacaoRegex: /(registro\s*de\s*apuracao\s*do\s*icms|registro\s*de\s*apuracao\s*do\s*ipi|livro\s*fiscal)/i,
  },
  'DEMONSTR. APURAÇÃO': {
    nome: 'Demonstrativo de Apuração',
    anchorsObrigatorios: [],
    denominacaoRegex: /(demonstrativo\s*do\s*credito\s*presumido|apuracao\s*geral|demonstrativo\s*de\s*apuracao)/i,
  },
};

/**
 * Aliases de nome — mesma obrigação pode aparecer com variações.
 */
const ALIASES: Record<string, string> = {
  'PIS': 'PIS/COFINS',
  'COFINS': 'PIS/COFINS',
  'CSLL': 'CSLL/IRPJ',
  'IRPJ': 'CSLL/IRPJ',
  'DARF': 'DARF-SERVIÇOS TOMADOS',
  'DARF SERVICOS TOMADOS': 'DARF-SERVIÇOS TOMADOS',
  'DARF SERVIÇOS TOMADOS': 'DARF-SERVIÇOS TOMADOS',
  'DAS': 'EMISSÃO GUIA DAS',
  'ICMS NORMAL': 'ICMS',
  'ICMS ST': 'ICMS-ST/DIFAL',
  'GIA': 'GIA-ST/DIFAL',
  'GIA-ST': 'GIA-ST/DIFAL',
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

  // ─── Bloqueio 1: CNPJ da empresa precisa aparecer no PDF ───────────────
  const cnpjEmpresa = empresa.cnpj ?? '';
  if (cnpjEmpresa) {
    const encontrado = encontrarCnpj(texto, cnpjEmpresa);
    detectado.cnpjEncontrado = encontrado;
    if (!encontrado) {
      problemas.push({
        severidade: 'bloqueio',
        motivo: 'CNPJ não encontrado',
        detalhe: `O CNPJ ${cnpjEmpresa} da empresa "${empresa.razao_social || empresa.codigo}" não aparece no PDF. A guia pode ser de outra empresa.`,
      });
    }
  } else {
    problemas.push({
      severidade: 'aviso',
      motivo: 'Empresa sem CNPJ cadastrado',
      detalhe: 'Não foi possível verificar se a guia é desta empresa porque o cadastro está sem CNPJ.',
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
  if (perfil.denominacaoRegex) {
    const m = texto.match(perfil.denominacaoRegex);
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

  // ─── Info: código de receita (não bloqueante) ───────────────────────────
  if (perfil.codigosReceitaConhecidos && perfil.codigosReceitaConhecidos.length > 0) {
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
