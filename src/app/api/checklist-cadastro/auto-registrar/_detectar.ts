// Detecção de certidão a partir do nome do arquivo + texto do PDF.
// Puro (sem I/O) pra ser testável. Usado pela rota auto-registrar.

import type { CadastroCertidao, CadastroResultado } from '@/app/types';

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface DeteccaoCertidao {
  certidao: CadastroCertidao;
  uf: string | null;
  autoridade: string;
}

/**
 * Identifica a certidão pelo token de autoridade no nome do arquivo:
 *   cnd-<empresa>-<scope>-<authority>-<DDMMYYYYHHMMSS>-<n>.pdf
 * Authorities reais: federal-federal, federal-fgts, federal-trabalhista,
 * state-sefazmg|sefazgo|sefazrj|sefazsc (Estadual da UF), state-sefazsp (SP Adm),
 * state-debitsp (SP Dívida Ativa).
 *
 * `subpasta` é a dica de pasta do watcher (FGTS|TRABALHISTA|cndmg|root) — usada
 * quando o nome não traz token (ex.: a pasta cndmg, nomeada por empresa, que é a
 * Estadual-MG).
 */
export function certidaoDoArquivo(nomeArquivo: string, subpasta?: string): DeteccaoCertidao | null {
  const n = norm(nomeArquivo);
  // O token de autoridade vem logo antes do timestamp (…-<auth>-DDMMYYYYHHMMSS-N).
  // Ancorar nos dígitos evita casar um "federal"/"state" que esteja no nome da
  // empresa. Fallback pra forma solta quando não há timestamp no nome.
  const m = n.match(/(?:state|federal)-([a-z]+)-\d{8,}/) ?? n.match(/(?:state|federal)-([a-z]+)/);
  const token = m?.[1] ?? null;

  if (token) {
    if (token === 'federal') return { certidao: 'FEDERAL', uf: null, autoridade: 'federal' };
    if (token === 'fgts') return { certidao: 'FGTS', uf: null, autoridade: 'fgts' };
    if (token === 'trabalhista') return { certidao: 'TRABALHISTA', uf: null, autoridade: 'trabalhista' };
    if (token === 'sefazsp') return { certidao: 'ESTADUAL_ADM', uf: 'SP', autoridade: 'sefazsp' };
    if (token === 'debitsp') return { certidao: 'ESTADUAL_DA', uf: 'SP', autoridade: 'debitsp' };
    const mUf = token.match(/^sefaz([a-z]{2})$/);
    if (mUf) return { certidao: 'ESTADUAL', uf: mUf[1].toUpperCase(), autoridade: token };
    if (token.startsWith('sefaz') || token.startsWith('debit')) {
      return { certidao: 'ESTADUAL', uf: null, autoridade: token };
    }
  }

  // Sem token — usa a dica da subpasta.
  const sp = norm(subpasta ?? '');
  if (sp.includes('fgts')) return { certidao: 'FGTS', uf: null, autoridade: 'fgts' };
  if (sp.includes('trabalhista')) return { certidao: 'TRABALHISTA', uf: null, autoridade: 'trabalhista' };
  if (sp.includes('cndmg')) return { certidao: 'ESTADUAL', uf: 'MG', autoridade: 'sefazmg' };
  return null;
}

/**
 * Identifica a certidão pelo TEXTO do PDF (assinatura do emissor). Usado quando
 * o nome do arquivo não traz token — caso da pasta renomeada (ex.: "Certidão
 * Negativa - CNPJ X.pdf", "HEDRONS P.E.N.pdf"). É a fonte mais confiável de TIPO.
 */
export function tipoDoTexto(texto: string): DeteccaoCertidao | null {
  const t = norm(texto);
  if (!t.trim()) return null;

  // FGTS (Caixa / Fundo de Garantia)
  if (/fundo de garantia|certificado de regularidade do fgts|regularidade do fgts/.test(t)) {
    return { certidao: 'FGTS', uf: null, autoridade: 'fgts' };
  }
  // Trabalhista (Justiça do Trabalho / CNDT)
  if (/justica do trabalho|debitos trabalhistas|devedores trabalhistas|tribunal superior do trabalho/.test(t)) {
    return { certidao: 'TRABALHISTA', uf: null, autoridade: 'trabalhista' };
  }
  // Federal (Receita Federal / PGFN / Dívida Ativa da União)
  if (/secretaria da receita federal|tributos federais|procuradoria-geral da fazenda nacional|divida ativa da uniao|\bpgfn\b|\brfb\b/.test(t)) {
    return { certidao: 'FEDERAL', uf: null, autoridade: 'federal' };
  }
  // SP — Administrativa (Secretaria da Fazenda e Planejamento, débitos NÃO inscritos)
  if (/fazenda e planejamento do estado\s+de\s+sao paulo|nao inscritos na divida ativa do estado de sao paulo/.test(t)) {
    return { certidao: 'ESTADUAL_ADM', uf: 'SP', autoridade: 'sefazsp' };
  }
  // SP — Dívida Ativa (Procuradoria, débitos inscritos)
  if (/procuradoria.{0,60}divida ativa|debitos inscritos[^]{0,60}divida ativa do estado de sao paulo|divida ativa do estado de sao paulo/.test(t)) {
    return { certidao: 'ESTADUAL_DA', uf: 'SP', autoridade: 'debitsp' };
  }
  // Estadual MG
  if (/secretaria de estado de fazenda de minas gerais|cdt\.fazenda\.mg|fazenda publica estadual e\/ou advocacia geral do estado/.test(t)) {
    return { certidao: 'ESTADUAL', uf: 'MG', autoridade: 'sefazmg' };
  }
  // Estadual genérico (outros estados)
  if (/secretaria de estado.{0,30}fazenda|fazenda publica estadual|secretaria.{0,20}fazenda.{0,20}estado|\bsefaz/.test(t)) {
    return { certidao: 'ESTADUAL', uf: null, autoridade: 'estadual' };
  }
  // Municipal (Prefeitura / Município)
  if (/prefeitura|municipio de|fazenda municipal|secretaria municipal/.test(t)) {
    return { certidao: 'MUNICIPAL', uf: null, autoridade: 'municipal' };
  }
  return null;
}

/**
 * Resultado lido do NOME do arquivo (reforço, quando o texto não classifica).
 * Ex.: "Certidão Positiva com Efeitos de Negativa - CNPJ X" → PEN;
 *      "UNICA NEGATIVA" → Negativa; "HEDRONS P.E.N" → PEN.
 */
export function resultadoDoNome(nomeArquivo: string): CadastroResultado | null {
  const t = norm(nomeArquivo);
  if (/efeito[s]?\s+de\s+negativa|positiva\s+com\s+efeito|\bp\.?e\.?n\b/.test(t)) return 'PEN';
  if (/\bpositiva\b/.test(t)) return 'Positiva';
  if (/\bnegativa\b/.test(t)) return 'Negativa';
  return null;
}

/**
 * Classifica o resultado pelo texto do PDF. Ordem importa: PEN antes de
 * Positiva; Negativa antes de Positiva (textos negativos dizem "NÃO constam").
 */
export function resultadoDoTexto(texto: string): CadastroResultado | null {
  const t = norm(texto);
  if (!t.trim()) return null;

  // PEN — "positiva com efeito(s) de negativa"
  if (/efeito[s]?\s+de\s+negativa/.test(t) || /positiva\s+com\s+efeito/.test(t)) return 'PEN';

  // Negativa — "não constam", "não consta", "certidão negativa", "situação regular" (FGTS), "nada consta"
  if (/\bnao\s+constam\b/.test(t)
    || /\bnao\s+consta\b/.test(t)
    || /certidao\s+negativa/.test(t)
    || /situacao\s+regular/.test(t)
    || /\bnada\s+consta\b/.test(t)) {
    return 'Negativa';
  }

  // Positiva — "certidão positiva", "constam débitos", "consta como inadimplente", "situação irregular"
  if (/certidao\s+positiva/.test(t)
    || /\bconstam\s+debitos\b/.test(t)
    || /consta\s+como\s+inadimplente/.test(t)
    || /situacao\s+irregular/.test(t)) {
    return 'Positiva';
  }

  return null;
}

/**
 * CNPJ base (raiz, 8 dígitos) do texto. Usado pra certidões que trazem só a raiz
 * — ex.: SP Dívida Ativa: "CNPJ Base: 29.168.985". Retorna 8 dígitos ou null.
 */
export function cnpjBaseDoTexto(texto: string): string | null {
  const t = norm(texto);
  const m = t.match(/cnpj\s*base[: ]*([\d.\-/]{8,16})/);
  if (m) { const d = m[1].replace(/\D/g, ''); if (d.length >= 8) return d.slice(0, 8); }
  return null;
}

/**
 * Extrai a data de emissão do PDF (metadado). Best-effort: procura rótulos de
 * emissão/expedição e cai na 1ª data DD/MM/AAAA do texto. Retorna 'YYYY-MM-DD'.
 */
export function emissaoDoTexto(texto: string): string | null {
  const t = norm(texto);
  const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
  const labels = [
    /data\s+de\s+emissao[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{4})/,
    /data\s+e\s+hora\s+da\s+emissao[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{4})/,
    /emitida[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{4})/,
    /expedicao[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{4})/,
    /informacao\s+obtida\s+em[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{4})/,
  ];
  for (const re of labels) {
    const m = t.match(re);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const any = t.match(DATA);
  if (any) return `${any[3]}-${any[2]}-${any[1]}`;
  return null;
}
