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

  // --- Vencimento: procura por "vencimento" próximo a uma data dd/mm/yyyy
  const padraoVencimento = /vencimento[^\d]{0,30}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i;
  const mVenc = texto.match(padraoVencimento);
  if (mVenc) {
    const dia = mVenc[1].padStart(2, '0');
    const mes = mVenc[2].padStart(2, '0');
    let ano = mVenc[3];
    if (ano.length === 2) ano = `20${ano}`;
    dados.vencimento = `${ano}-${mes}-${dia}`;
  } else {
    // Fallback: primeira data dd/mm/yyyy encontrada
    const qualquerData = texto.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (qualquerData) {
      const dia = qualquerData[1].padStart(2, '0');
      const mes = qualquerData[2].padStart(2, '0');
      let ano = qualquerData[3];
      if (ano.length === 2) ano = `20${ano}`;
      dados.vencimento = `${ano}-${mes}-${dia}`;
    }
  }

  // --- Competência: "competência 04/2026" ou "abril/2026" ou "MM/YYYY" isolado
  const padraoCompNum = /compet[eê]ncia[^\d]{0,15}(\d{1,2})[\/\-.](\d{2,4})/i;
  const mCompNum = texto.match(padraoCompNum);
  if (mCompNum) {
    const mes = mCompNum[1].padStart(2, '0');
    let ano = mCompNum[2];
    if (ano.length === 2) ano = `20${ano}`;
    dados.competencia = `${ano}-${mes}`;
  } else {
    const padraoCompNome = new RegExp(
      `compet[eê]ncia[^a-z0-9]{0,15}(${Object.keys(MESES_PT).join('|')})[^\\d]{0,6}(\\d{2,4})`,
      'i'
    );
    const mCompNome = textoNorm.match(padraoCompNome);
    if (mCompNome) {
      const mesNum = MESES_PT[mCompNome[1]];
      let ano = mCompNome[2];
      if (ano.length === 2) ano = `20${ano}`;
      dados.competencia = `${ano}-${String(mesNum).padStart(2, '0')}`;
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
