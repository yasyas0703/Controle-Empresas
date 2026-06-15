// Detecção de certidão a partir do nome do arquivo + texto do PDF.
// Puro (sem I/O) pra ser testável. Usado pela rota auto-registrar.

// Import RELATIVO (não @/) de propósito: este módulo também é usado pelo
// script de backfill via tsx (scripts/backfill-gestao-certidoes.ts), e o tsx
// não resolve os paths do tsconfig.
import type { CadastroCertidao, CadastroResultado } from '../../../types';

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

// ─── Gestão de Certidões: validade, número, órgão, autenticidade ─────────────

const DATA_RE = /(\d{2})\/(\d{2})\/(\d{4})/;

function dataParaIso(m: RegExpMatchArray | null): string | null {
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function somarMeses(iso: string, meses: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

export interface DetalhesCertidao {
  validadeEm: string | null;        // 'YYYY-MM-DD'
  numeroCertidao: string | null;
  orgaoEmissor: string | null;
  codigoAutenticidade: string | null;
  linkValidacao: string | null;
}

/**
 * Extrai os campos da Gestão de Certidões do texto do PDF. Cada órgão usa
 * rótulos diferentes (mapa levantado dos exemplos reais):
 *   FEDERAL  "Válida até DD/MM/AAAA" · "Código de controle da certidão: X"
 *   MG       "Data de emissão  Data de validade" (par de datas) · "Código de controle de autenticidade"
 *   SP Adm   "Certidão nº X" · "Validade 6 (seis) meses, contados da expedição"
 *   SP DA    "Certidão nº X" · "Validade 30 (TRINTA) dias, contados da emissão"
 *   FGTS     "Validade: INÍCIO a FIM" (usa a data FINAL) · "Certificação Número: X"
 *   CNDT     "Certidão nº: N/AAAA" · "Validade: DD/MM/AAAA - 180 dias"
 * `emissaoIso` alimenta as validades relativas ("N dias/meses contados da emissão").
 */
export function extrairDetalhesCertidao(
  texto: string,
  certidao: CadastroCertidao,
  emissaoIso: string | null,
): DetalhesCertidao {
  const t = norm(texto);
  const out: DetalhesCertidao = {
    validadeEm: null, numeroCertidao: null, orgaoEmissor: null,
    codigoAutenticidade: null, linkValidacao: null,
  };
  if (!t.trim()) return out;

  // ── Validade (ordem importa: intervalo > data explícita > relativa) ──
  // FGTS / qualquer intervalo "X a Y" → a data FINAL é o vencimento.
  const intervalo = t.match(/validade[: ]*\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  if (intervalo) out.validadeEm = dataParaIso(intervalo[2].match(DATA_RE));
  // Federal: "válida até DD/MM/AAAA"
  if (!out.validadeEm) {
    const m = t.match(/valida\s+ate\s+(\d{2}\/\d{2}\/\d{4})/);
    if (m) out.validadeEm = dataParaIso(m[1].match(DATA_RE));
  }
  // MG: rótulos "Data de emissão  Data de validade" seguidos do PAR de datas
  // (emissão primeiro, validade depois). Cobre também a ordem rótulo→data→data.
  if (!out.validadeEm) {
    const par = t.match(/data de emissao\s+data de validade\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
    if (par) out.validadeEm = dataParaIso(par[2].match(DATA_RE));
  }
  // "data de validade" com uma data próxima (máx 30 chars entre rótulo e valor)
  if (!out.validadeEm) {
    const m = t.match(/data de validade[^0-9]{0,30}(\d{2}\/\d{2}\/\d{4})/);
    if (m) out.validadeEm = dataParaIso(m[1].match(DATA_RE));
  }
  // CNDT e genéricos: "validade: DD/MM/AAAA" (o "- 180 dias" que segue é redundante)
  if (!out.validadeEm) {
    const m = t.match(/validade[: ]*\s*(\d{2}\/\d{2}\/\d{4})/);
    if (m) out.validadeEm = dataParaIso(m[1].match(DATA_RE));
  }
  // Relativa: "validade 30 (trinta) dias" / "validade 6 (seis) meses" — soma na
  // emissão. 1ª: ancorada no rótulo "validade" (layout 1 coluna, ex.: SP D.Ativa).
  // 2ª (fallback): "N (palavra) dias/meses … contados" SEM o rótulo grudado —
  // PDFs em 2 colunas (ex.: SP Administrativa) separam o rótulo do valor; o
  // "(palavra)" + "contados" deixa o padrão específico o bastante.
  if (!out.validadeEm && emissaoIso) {
    const rel = t.match(/validade\s*(?:de\s*)?(\d{1,3})\s*(?:\([a-z\s]+\)\s*)?(dias?|mes(?:es)?)/)
      ?? t.match(/(\d{1,3})\s*\([a-z\s]+\)\s*(dias?|mes(?:es)?)\b[^.]{0,40}contad/);
    if (rel) {
      const n = Number(rel[1]);
      if (n > 0 && n <= 999) {
        out.validadeEm = rel[2].startsWith('dia') ? somarDias(emissaoIso, n) : somarMeses(emissaoIso, n);
      }
    }
  }
  // Sanidade: validade tem que ser posterior à emissão (quando conhecida).
  if (out.validadeEm && emissaoIso && out.validadeEm < emissaoIso) out.validadeEm = null;

  // ── Número da certidão / certificação ──
  // FGTS: "Certificação Número: 2026051316304920454701"
  let num = t.match(/certificacao\s+numero[: ]*\s*(\d{6,})/)?.[1] ?? null;
  // CNDT: "Certidão nº: 47941031/2026" · SP: "Certidão nº 26060476766-60" / "82432689"
  if (!num) num = t.match(/certidao\s*n[o°º]?\s*[:.]?\s*([\d][\d.\-\/]{3,30}\d)/)?.[1] ?? null;
  out.numeroCertidao = num;

  // ── Código de controle / autenticidade ──
  // Federal: "Código de controle da certidão: 86BE.9F84.FB44.9D42"
  let cod = t.match(/codigo de controle da certidao[: ]*\s*([0-9a-f]{2,8}(?:[.\-][0-9a-f]{2,8}){2,})/)?.[1] ?? null;
  // MG: "Código de controle de autenticidade CB19-7F00-44D0-..."
  if (!cod) cod = t.match(/codigo de controle de autenticidade\s*[:\-]?\s*([0-9a-f]{4}(?:-[0-9a-f]{4}){3,})/)?.[1] ?? null;
  if (!cod) cod = t.match(/codigo de (?:controle|autenticidade)[^0-9a-f]{0,15}([0-9a-f]{4}(?:[.\-][0-9a-f]{2,8}){2,})/)?.[1] ?? null;
  out.codigoAutenticidade = cod ? cod.toUpperCase() : null;

  // ── Órgão emissor + link de validação (por tipo / assinatura no texto) ──
  if (certidao === 'FGTS') {
    out.orgaoEmissor = 'Caixa Econômica Federal (CRF)';
    out.linkValidacao = 'https://consulta-crf.caixa.gov.br';
  } else if (certidao === 'TRABALHISTA') {
    out.orgaoEmissor = 'Justiça do Trabalho (CNDT/TST)';
    out.linkValidacao = 'http://www.tst.jus.br';
  } else if (certidao === 'FEDERAL') {
    out.orgaoEmissor = 'Receita Federal / PGFN';
    out.linkValidacao = 'http://rfb.gov.br';
  } else if (certidao === 'ESTADUAL_ADM') {
    out.orgaoEmissor = 'SEFAZ/SP (Administrativa)';
    out.linkValidacao = 'https://www.pfe.fazenda.sp.gov.br';
  } else if (certidao === 'ESTADUAL_DA') {
    out.orgaoEmissor = 'PGE/SP (Dívida Ativa)';
    out.linkValidacao = 'https://www.dividaativa.pge.sp.gov.br';
  } else if (certidao === 'MUNICIPAL') {
    out.orgaoEmissor = 'Prefeitura Municipal';
  } else if (/secretaria de estado de fazenda de minas gerais/.test(t)) {
    out.orgaoEmissor = 'SEF/MG';
    out.linkValidacao = 'https://cdt.fazenda.mg.gov.br';
  } else if (certidao === 'ESTADUAL') {
    out.orgaoEmissor = 'SEFAZ (Estadual)';
  }
  // Link explícito no texto, se houver, vence o default do tipo.
  const link = t.match(/https?:\/\/[a-z0-9.\-\/_]+/)?.[0] ?? null;
  if (link) out.linkValidacao = link;

  return out;
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
