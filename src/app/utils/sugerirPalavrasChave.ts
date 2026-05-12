/**
 * Sugere palavras-chave candidatas a partir do texto extraído de um PDF.
 * Foca em identificar frases/termos que provavelmente caracterizam o TIPO da guia,
 * filtrando dados variáveis (datas, CNPJs, números, valores monetários).
 */

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'sob', 'sobre', 'que', 'qual', 'quais',
  'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'ao', 'aos', 'ate',
  'pelo', 'pela', 'pelos', 'pelas', 'se', 'ser', 'sao', 'seu', 'sua',
  'este', 'esta', 'esse', 'essa', 'isto', 'isso', 'aquele', 'aquela',
  'ou', 'nem', 'mas', 'pois', 'porque', 'quando', 'onde', 'como',
  'r$', 'rs', 'cpf', 'cnpj', 'fone', 'tel', 'cep', 'pag', 'pagina',
]);

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function ehVariavel(token: string): boolean {
  if (!token) return true;
  // Tudo dígito (CNPJ, valor, data sem separadores)
  if (/^\d+$/.test(token)) return true;
  // Data DD/MM/YYYY, MM/YYYY etc
  if (/^\d{1,4}[\/\-.]\d{1,4}([\/\-.]\d{1,4})?$/.test(token)) return true;
  // CNPJ/CPF formatados
  if (/^\d{2,3}\.\d{3}\.\d{3}/.test(token)) return true;
  // Valor monetário (1.234,56 ou 1234,56)
  if (/^[\d.]+,\d{2}$/.test(token)) return true;
  // Hora
  if (/^\d{1,2}:\d{2}/.test(token)) return true;
  return false;
}

function tokenizar(texto: string): string[] {
  return texto
    .split(/[\s,;:()\[\]\/\\|"'`]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

interface Candidato {
  termo: string;        // forma "bonita" pra mostrar (preserva maiúsculas comuns)
  termoNorm: string;    // forma normalizada (lower, sem acento) — chave de dedupe
  score: number;
  fonte: 'frase' | 'sigla' | 'palavra-rara';
}

/**
 * Extrai siglas (sequências de letras maiúsculas, 2-8 chars).
 * Siglas costumam ser ótimas marcadoras: ICMS, DARF, SPED, REINF, GIA-ST, EFD, PIS, COFINS etc.
 */
function extrairSiglas(texto: string): string[] {
  const re = /\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,8}(?:[-/][A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,8})?\b/g;
  const set = new Set<string>();
  for (const m of texto.matchAll(re)) {
    const sigla = m[0];
    if (sigla.length < 2) continue;
    // Filtra siglas comuns que não identificam
    if (['UF', 'CEP', 'REC', 'OK', 'PDF', 'CPF', 'CNPJ', 'IE', 'IM'].includes(sigla.toUpperCase())) continue;
    set.add(sigla);
  }
  return [...set];
}

/**
 * Extrai frases curtas em maiúsculas (títulos como "GUIA DE INFORMAÇÃO E APURAÇÃO").
 */
function extrairFrasesTitulo(texto: string): string[] {
  // 2-6 palavras maiúsculas consecutivas (com acento e espaço, hífen permitidos)
  const re = /(?:\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\-]{1,}\s+){1,5}[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\-]{2,}/g;
  const out = new Set<string>();
  for (const m of texto.matchAll(re)) {
    const frase = m[0].trim().replace(/\s+/g, ' ');
    if (frase.length >= 6 && frase.length <= 80) {
      out.add(frase);
    }
  }
  return [...out];
}

export interface SugestaoPalavraChave {
  termo: string;
  fonte: 'sigla' | 'titulo' | 'palavra';
  ocorrencias: number;
}

/**
 * Recebe o texto extraído de um PDF exemplo e devolve até `limite` sugestões
 * de palavras-chave que provavelmente identificam o tipo da guia.
 */
export function sugerirPalavrasChave(texto: string, limite = 8): SugestaoPalavraChave[] {
  if (!texto || texto.trim().length < 20) return [];

  const sugestoes: SugestaoPalavraChave[] = [];
  const textoNorm = normalizar(texto);
  const vistos = new Set<string>();

  // 1. Siglas (maior prioridade — costumam ser as melhores marcadoras)
  const siglas = extrairSiglas(texto);
  for (const sigla of siglas) {
    const norm = normalizar(sigla);
    if (vistos.has(norm)) continue;
    // Conta ocorrências
    const ocorrencias = (textoNorm.match(new RegExp(`\\b${norm.replace(/[-/]/g, '[-/]')}\\b`, 'g')) || []).length;
    if (ocorrencias === 0) continue;
    sugestoes.push({ termo: sigla, fonte: 'sigla', ocorrencias });
    vistos.add(norm);
  }

  // 2. Frases em maiúsculas (títulos)
  const frases = extrairFrasesTitulo(texto);
  for (const frase of frases) {
    const norm = normalizar(frase);
    if (vistos.has(norm)) continue;
    sugestoes.push({ termo: frase, fonte: 'titulo', ocorrencias: 1 });
    vistos.add(norm);
  }

  // 3. Palavras-chave longas (>= 5 chars, não-stopword, não variável) — fallback
  if (sugestoes.length < limite) {
    const contagem = new Map<string, { termo: string; count: number }>();
    for (const token of tokenizar(texto)) {
      if (token.length < 5) continue;
      if (ehVariavel(token)) continue;
      const norm = normalizar(token);
      if (STOPWORDS.has(norm)) continue;
      if (vistos.has(norm)) continue;
      const atual = contagem.get(norm);
      if (atual) atual.count += 1;
      else contagem.set(norm, { termo: token, count: 1 });
    }
    const palavrasOrdenadas = [...contagem.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(0, limite - sugestoes.length));
    for (const p of palavrasOrdenadas) {
      sugestoes.push({ termo: p.termo, fonte: 'palavra', ocorrencias: p.count });
    }
  }

  // Ordena: siglas primeiro, depois títulos, depois palavras; dentro de cada grupo por ocorrências
  const ordemFonte: Record<SugestaoPalavraChave['fonte'], number> = { sigla: 0, titulo: 1, palavra: 2 };
  sugestoes.sort((a, b) => {
    if (ordemFonte[a.fonte] !== ordemFonte[b.fonte]) return ordemFonte[a.fonte] - ordemFonte[b.fonte];
    return b.ocorrencias - a.ocorrencias;
  });

  return sugestoes.slice(0, limite);
}
