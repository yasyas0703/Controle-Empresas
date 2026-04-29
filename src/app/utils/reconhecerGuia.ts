import type { Empresa, Obrigacao, UUID } from '@/app/types';

export interface CandidatoEmpresa {
  empresa: Empresa;
  score: number;
  motivos: string[];
}

export interface CandidatoObrigacao {
  obrigacao: Obrigacao;
  score: number;
  palavrasEncontradas: string[];
  palavrasFaltando: string[];
}

export interface DadosExtraidos {
  vencimento: string | null; // ISO YYYY-MM-DD
  competencia: string | null; // 'YYYY-MM'
  valor: number | null;
}

export interface ResultadoReconhecimento {
  empresa: CandidatoEmpresa | null;
  empresasAlternativas: CandidatoEmpresa[];
  obrigacao: CandidatoObrigacao | null;
  obrigacoesAlternativas: CandidatoObrigacao[];
  dados: DadosExtraidos;
}

const COMBINING = /[̀-ͯ]/g;

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function apenasDigitos(s: string): string {
  return (s || '').replace(/\D+/g, '');
}

const MESES_PT: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

/**
 * Tenta localizar CNPJs no texto e casa com as empresas do sistema.
 */
export function encontrarEmpresas(texto: string, empresas: Empresa[]): CandidatoEmpresa[] {
  const resultados = new Map<UUID, CandidatoEmpresa>();
  if (!texto) return [];

  const textoNorm = normalizar(texto);
  const todosDigitos = apenasDigitos(texto);

  // 1. CNPJ exato (14 dígitos)
  const cnpjRegex = /\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}/g;
  const cnpjsTexto = (texto.match(cnpjRegex) ?? []).map(apenasDigitos).filter((d) => d.length === 14);

  for (const emp of empresas) {
    const cnpjEmp = apenasDigitos(emp.cnpj ?? '');
    if (cnpjEmp.length !== 14) continue;
    if (cnpjsTexto.includes(cnpjEmp) || todosDigitos.includes(cnpjEmp)) {
      const atual = resultados.get(emp.id) ?? { empresa: emp, score: 0, motivos: [] };
      atual.score += 100;
      atual.motivos.push('CNPJ exato no documento');
      resultados.set(emp.id, atual);
    }
  }

  // 2. Razão social / apelido / código — match literal
  for (const emp of empresas) {
    const candidatos = [emp.razao_social, emp.apelido, emp.codigo]
      .map((v) => (v ?? '').trim())
      .filter((v) => v.length >= 4);
    for (const nome of candidatos) {
      const nomeNorm = normalizar(nome);
      if (nomeNorm.length >= 4 && textoNorm.includes(nomeNorm)) {
        const atual = resultados.get(emp.id) ?? { empresa: emp, score: 0, motivos: [] };
        atual.score += 25 + Math.min(nomeNorm.length, 40);
        atual.motivos.push(`Nome "${nome}" localizado`);
        resultados.set(emp.id, atual);
        break;
      }
    }
  }

  // 3. Inscrição estadual / municipal (se únicas e longas)
  for (const emp of empresas) {
    const iesMuni = [emp.inscricao_estadual, emp.inscricao_municipal]
      .map((v) => apenasDigitos(v ?? ''))
      .filter((v) => v.length >= 6);
    for (const insc of iesMuni) {
      if (todosDigitos.includes(insc)) {
        const atual = resultados.get(emp.id) ?? { empresa: emp, score: 0, motivos: [] };
        atual.score += 10;
        atual.motivos.push('Inscrição estadual/municipal localizada');
        resultados.set(emp.id, atual);
        break;
      }
    }
  }

  return [...resultados.values()].sort((a, b) => b.score - a.score);
}

/**
 * Avalia cada obrigação ativa e retorna quantas palavras-chave bateram.
 * Exige >= 1 palavra-chave configurada, caso contrário ignora a obrigação.
 */
export function encontrarObrigacoes(texto: string, obrigacoes: Obrigacao[]): CandidatoObrigacao[] {
  if (!texto) return [];
  const textoNorm = normalizar(texto);
  const resultados: CandidatoObrigacao[] = [];

  for (const o of obrigacoes) {
    if (!o.ativo) continue;
    const palavras = (o.palavrasChave ?? []).map(normalizar).filter(Boolean);
    if (palavras.length === 0) continue;

    const encontradas: string[] = [];
    const faltando: string[] = [];
    for (const p of palavras) {
      if (textoNorm.includes(p)) encontradas.push(p);
      else faltando.push(p);
    }
    if (encontradas.length === 0) continue;

    // Score: proporção + peso por quantidade absoluta
    const proporcao = encontradas.length / palavras.length;
    const score = Math.round(proporcao * 100) + encontradas.length * 2;

    resultados.push({
      obrigacao: o,
      score,
      palavrasEncontradas: encontradas,
      palavrasFaltando: faltando,
    });
  }

  return resultados.sort((a, b) => b.score - a.score);
}

/**
 * Tenta extrair vencimento, competência e valor do texto.
 */
export function extrairDados(texto: string): DadosExtraidos {
  const dados: DadosExtraidos = { vencimento: null, competencia: null, valor: null };
  if (!texto) return dados;

  const textoNorm = normalizar(texto);

  // Valida e normaliza dia/mes/ano. Ano de 2 dígitos vira 20XX. Ano fora
  // do range razoável (2000–2100) é rejeitado — extração de PDF às vezes
  // junta dígitos, ex.: "07/01/2512" (na verdade 07/01/25 + "12" do campo
  // seguinte). Sem essa checagem, esse lixo vira o "vencimento".
  const parseData = (diaS: string, mesS: string, anoS: string): { iso: string; ts: number } | null => {
    const dia = Number(diaS);
    const mes = Number(mesS);
    let ano = Number(anoS);
    if (anoS.length === 2) ano += 2000;
    if (anoS.length === 3) return null;
    if (mes < 1 || mes > 12) return null;
    if (dia < 1 || dia > 31) return null;
    if (ano < 2000 || ano > 2100) return null;
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const ts = Date.UTC(ano, mes - 1, dia);
    return { iso, ts };
  };

  // --- Vencimento: tenta vários rótulos comuns em DARF, DAS, GPS, GARE etc.
  // Em PDFs o texto extraído costuma vir embolado, então a janela é generosa.
  // Procura *todas* as ocorrências de cada padrão e fica com a primeira data
  // válida (alguns labels podem aparecer antes de lixo numérico).
  const padroesVencimento: RegExp[] = [
    /data[^a-z0-9]{0,5}(?:de[^a-z0-9]{0,5})?vencimento[^\d]{0,80}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/gi,
    /data[^a-z0-9]{0,5}(?:limite[^a-z0-9]{0,5})?(?:de[^a-z0-9]{0,5})?(?:para[^a-z0-9]{0,5})?(?:de[^a-z0-9]{0,5})?pagamento[^\d]{0,80}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/gi,
    /pagar[^a-z0-9]{0,5}at[eé][^\d]{0,40}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/gi,
    /vence(?:r|m)?[^a-z0-9]{0,5}(?:em|ate|at[eé])?[^\d]{0,40}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/gi,
    /venc(?:to|imento)[^\d]{0,80}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/gi,
  ];

  let achou = false;
  for (const re of padroesVencimento) {
    for (const m of texto.matchAll(re)) {
      const parsed = parseData(m[1], m[2], m[3]);
      if (parsed) {
        dados.vencimento = parsed.iso;
        achou = true;
        break;
      }
    }
    if (achou) break;
  }

  if (!achou) {
    // Fallback: a maior (mais futura) data válida do documento. Em guia de
    // tributo o vencimento é tipicamente a data mais à frente.
    const todasDatas = [...texto.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)];
    let melhor: { iso: string; ts: number } | null = null;
    for (const m of todasDatas) {
      const parsed = parseData(m[1], m[2], m[3]);
      if (!parsed) continue;
      if (!melhor || parsed.ts > melhor.ts) melhor = parsed;
    }
    if (melhor) dados.vencimento = melhor.iso;
  }

  // --- Competência. DARF usa "Período de Apuração", DAS/GPS/GARE costumam
  // usar "Competência". Tenta vários rótulos; aceita mm/yyyy, mes/yyyy, e
  // o atalho "PA" comum em formulários compactos.
  const parseCompMes = (mesS: string, anoS: string): string | null => {
    const mes = Number(mesS);
    let ano = Number(anoS);
    if (anoS.length === 2) ano += 2000;
    if (anoS.length === 3) return null;
    if (mes < 1 || mes > 12) return null;
    if (ano < 2000 || ano > 2100) return null;
    return `${ano}-${String(mes).padStart(2, '0')}`;
  };

  const padroesCompNum: RegExp[] = [
    /per[ií]odo[^a-z0-9]{0,5}de[^a-z0-9]{0,5}apura[çc][aã]o[^\d]{0,40}(\d{1,2})[\/\-.](\d{2,4})/gi,
    /compet[eê]ncia[^\d]{0,40}(\d{1,2})[\/\-.](\d{2,4})/gi,
    /\bp\.?\s?a\.?\b[^\d]{0,15}(\d{1,2})[\/\-.](\d{2,4})/gi,
    /m[eê]s[^a-z0-9]{0,5}(?:de[^a-z0-9]{0,5})?refer[eê]ncia[^\d]{0,30}(\d{1,2})[\/\-.](\d{2,4})/gi,
  ];

  let compAchou = false;
  for (const re of padroesCompNum) {
    for (const m of texto.matchAll(re)) {
      const c = parseCompMes(m[1], m[2]);
      if (c) {
        dados.competencia = c;
        compAchou = true;
        break;
      }
    }
    if (compAchou) break;
  }

  if (!compAchou) {
    // Variantes com nome do mês: "abril/2026", "Período de Apuração: abril 2026"
    const labels = '(?:per[ií]odo[^a-z0-9]{0,5}de[^a-z0-9]{0,5}apura[çc][aã]o|compet[eê]ncia|m[eê]s[^a-z0-9]{0,5}(?:de[^a-z0-9]{0,5})?refer[eê]ncia)';
    const padraoCompNome = new RegExp(
      `${labels}[^a-z0-9]{0,15}(${Object.keys(MESES_PT).join('|')})[^\\d]{0,6}(\\d{2,4})`,
      'i',
    );
    const mCompNome = textoNorm.match(padraoCompNome);
    if (mCompNome) {
      const mesNum = MESES_PT[mCompNome[1]];
      const c = parseCompMes(String(mesNum), mCompNome[2]);
      if (c) {
        dados.competencia = c;
        compAchou = true;
      }
    }
  }

  if (!compAchou) {
    // Último recurso: pega o primeiro mm/yyyy isolado do documento que faça
    // sentido (mês 1-12, ano 2000-2100). Evita pegar o ano de vencimento.
    for (const m of texto.matchAll(/\b(\d{1,2})[\/\-.](\d{4})\b/g)) {
      const c = parseCompMes(m[1], m[2]);
      if (c) {
        dados.competencia = c;
        break;
      }
    }
  }

  // --- Valor: procura por "R$ 1.234,56" ou "valor ... 1.234,56"
  const padraoValor = /(?:r\$\s*|valor[^\d]{0,15})([\d.]{1,15},\d{2})/i;
  const mVal = texto.match(padraoValor);
  if (mVal) {
    const bruto = mVal[1].replace(/\./g, '').replace(',', '.');
    const n = Number.parseFloat(bruto);
    if (Number.isFinite(n)) dados.valor = n;
  }

  return dados;
}

/**
 * Pipeline completo: recebe texto do PDF + base de empresas/obrigações e
 * devolve o melhor candidato de cada lado + dados extraídos.
 */
export function reconhecerGuia(
  texto: string,
  empresas: Empresa[],
  obrigacoes: Obrigacao[],
): ResultadoReconhecimento {
  const emps = encontrarEmpresas(texto, empresas);
  const obrs = encontrarObrigacoes(texto, obrigacoes);
  return {
    empresa: emps[0] ?? null,
    empresasAlternativas: emps.slice(1, 5),
    obrigacao: obrs[0] ?? null,
    obrigacoesAlternativas: obrs.slice(1, 5),
    dados: extrairDados(texto),
  };
}
