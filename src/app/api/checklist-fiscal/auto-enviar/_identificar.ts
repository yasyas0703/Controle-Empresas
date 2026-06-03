// Identificação de guia pelo CONTEÚDO do PDF (OCR/extração de texto), não mais
// pela pasta nem pelo nome do arquivo.
//
// Fluxo novo (pasta única T:\Fiscal\EMPRESA\1-GUIAS A ENVIAR): o pessoal joga
// qualquer guia de qualquer empresa numa pasta só, e o sistema descobre:
//   - QUAL EMPRESA  → CNPJ ou Inscrição Estadual no PDF (sinal forte). Só razão
//     social (fraco) NÃO basta pra auto-enviar — risco de mandar pro cliente errado.
//   - QUAL OBRIGAÇÃO → roda validarGuia() de cada perfil conhecido e pega o que
//     passa (denominação + código de receita). Reaproveita as 40+ regras existentes.
//   - QUAL COMPETÊNCIA → mês/ano de referência dentro do PDF.
//
// Tudo aqui é puro (sem IO) — recebe o texto já extraído e a base de empresas.

import { encontrarEmpresas, extrairDados } from '@/app/utils/reconhecerGuia';
import { validarGuia, obrigacoesComValidacao } from '@/app/utils/validarGuia';
import type { Empresa } from '@/app/types';

function apenasDigitos(s: string): string {
  return (s || '').replace(/\D+/g, '');
}

// ─── Empresa ─────────────────────────────────────────────────────────────────

export type TipoMatchEmpresa = 'cnpj' | 'ie' | 'nome';

export interface ResultadoIdentEmpresa {
  /** Empresa escolhida (raw row do banco). null quando nada bate ou está ambíguo. */
  empresa: Empresa | null;
  /** 'cnpj'/'ie' = forte (pode auto-enviar). 'nome' = fraco (vai pra pendência). */
  tipoMatch: TipoMatchEmpresa | null;
  forte: boolean;
  /** true quando 2+ empresas batem por identificador forte — humano decide. */
  ambiguo: boolean;
  /** Resumo dos candidatos pro painel de problemas (sem dados sensíveis demais). */
  candidatos: Array<{ id: string; nome: string; tipo: TipoMatchEmpresa; motivos: string[] }>;
}

/** Verifica se o CNPJ ou a IE da empresa aparecem nos dígitos do PDF. */
function tipoMatchForte(emp: Empresa, digitosPdf: string): TipoMatchEmpresa | null {
  const cnpj = apenasDigitos(emp.cnpj ?? '');
  if (cnpj.length === 14 && digitosPdf.includes(cnpj)) return 'cnpj';
  // CNPJ-base (8 dígitos) — algumas guias estaduais (DARE-SP) só trazem ele.
  if (cnpj.length === 14 && digitosPdf.includes(cnpj.slice(0, 8))) return 'cnpj';
  // IE so vale como "forte" com 8+ digitos: 6 digitos aparecem por acaso em
  // guias cheias de numeros (valores, codigos), gerando falso-positivo.
  const ie = apenasDigitos(emp.inscricao_estadual ?? '');
  if (ie.length >= 8 && (digitosPdf.includes(ie) || digitosPdf.includes(ie.replace(/^0+/, '')))) return 'ie';
  return null;
}

function nomeEmpresa(emp: Empresa): string {
  return emp.razao_social || emp.apelido || emp.codigo || emp.id;
}

/**
 * Identifica a empresa dona da guia pelo conteúdo do PDF.
 *
 * Regra de segurança: só é "forte" (pode auto-enviar) quando o PDF traz o CNPJ
 * ou a Inscrição Estadual da empresa. Match só por razão social é "fraco" e vira
 * pendência manual — nunca envia sozinho.
 */
export function identificarEmpresa(texto: string, empresas: Empresa[]): ResultadoIdentEmpresa {
  const vazio: ResultadoIdentEmpresa = { empresa: null, tipoMatch: null, forte: false, ambiguo: false, candidatos: [] };
  if (!texto) return vazio;

  const ranqueados = encontrarEmpresas(texto, empresas);
  if (ranqueados.length === 0) return vazio;

  const digitosPdf = apenasDigitos(texto);

  const candidatos = ranqueados.slice(0, 5).map((c) => ({
    id: c.empresa.id,
    nome: nomeEmpresa(c.empresa),
    tipo: (tipoMatchForte(c.empresa, digitosPdf) ?? 'nome') as TipoMatchEmpresa,
    motivos: c.motivos,
  }));

  const cnpjDigitos = (emp: Empresa) => apenasDigitos(emp.cnpj ?? '');
  const temCnpjFull = (emp: Empresa) => { const c = cnpjDigitos(emp); return c.length === 14 && digitosPdf.includes(c); };
  // Raiz (8 digitos) é compartilhada por matriz/filiais do mesmo grupo — só usar
  // como desempate quando NINGUEM bateu o CNPJ inteiro.
  const temCnpjBase = (emp: Empresa) => { const c = cnpjDigitos(emp); return c.length === 14 && digitosPdf.includes(c.slice(0, 8)); };
  const temIe = (emp: Empresa) => {
    const ie = apenasDigitos(emp.inscricao_estadual ?? '');
    return ie.length >= 8 && (digitosPdf.includes(ie) || digitosPdf.includes(ie.replace(/^0+/, '')));
  };

  const decidir = (lista: typeof ranqueados, tipo: TipoMatchEmpresa): ResultadoIdentEmpresa | null => {
    if (lista.length === 1) return { empresa: lista[0].empresa, tipoMatch: tipo, forte: true, ambiguo: false, candidatos };
    if (lista.length > 1) return { empresa: null, tipoMatch: null, forte: false, ambiguo: true, candidatos };
    return null;
  };

  // Ordem de confiança: CNPJ completo > raiz do CNPJ > Inscricao Estadual.
  return (
    decidir(ranqueados.filter((c) => temCnpjFull(c.empresa)), 'cnpj')
    ?? decidir(ranqueados.filter((c) => temCnpjBase(c.empresa)), 'cnpj')
    ?? decidir(ranqueados.filter((c) => temIe(c.empresa)), 'ie')
    // Nenhum identificador forte — melhor candidato é só por nome (fraco).
    ?? { empresa: ranqueados[0].empresa, tipoMatch: 'nome', forte: false, ambiguo: false, candidatos }
  );
}

// ─── Obrigação ───────────────────────────────────────────────────────────────

export interface ConfigObrigacao {
  ativa: boolean;
  codigos: string[];
  naoEnviaCliente: boolean;
  motivo: string | null;
}

export interface ResultadoIdentObrigacao {
  obrigacao: string | null;
  /** true quando 2+ perfis passam e o código de receita não desempata. */
  ambiguo: boolean;
  /** Lista de obrigações que passaram (pra log/painel quando ambíguo). */
  candidatos: string[];
}

/**
 * Descobre QUAL obrigação é a guia rodando validarGuia() de cada perfil conhecido
 * e ficando com os que passam (sem bloqueio). Usa os códigos de receita cadastrados
 * da empresa (quando houver) pra desempatar.
 *
 * Identifica independente da config existir/estar ativa — o route faz essas
 * checagens depois, pra dar o diagnóstico certo ('não configurada'/'inativa').
 */
export function identificarObrigacao(
  texto: string,
  empresa: Empresa,
  configs: Map<string, ConfigObrigacao>,
): ResultadoIdentObrigacao {
  if (!texto) return { obrigacao: null, ambiguo: false, candidatos: [] };

  const aprovados: Array<{ obrigacao: string; temCodigo: boolean }> = [];
  for (const obrigacao of obrigacoesComValidacao()) {
    const codigos = configs.get(obrigacao)?.codigos ?? [];
    const r = validarGuia(texto, empresa, obrigacao, codigos);
    if (r.valido && r.perfilUsado) {
      aprovados.push({ obrigacao, temCodigo: r.detectado.codigoReceitaEncontrado != null });
    }
  }

  if (aprovados.length === 0) return { obrigacao: null, ambiguo: false, candidatos: [] };
  if (aprovados.length === 1) return { obrigacao: aprovados[0].obrigacao, ambiguo: false, candidatos: [aprovados[0].obrigacao] };

  // Mais de um passou — desempata por código de receita (sinal mais forte).
  const comCodigo = aprovados.filter((a) => a.temCodigo);
  if (comCodigo.length === 1) {
    return { obrigacao: comCodigo[0].obrigacao, ambiguo: false, candidatos: aprovados.map((a) => a.obrigacao) };
  }

  // Ambíguo de verdade — humano decide no painel.
  return { obrigacao: null, ambiguo: true, candidatos: aprovados.map((a) => a.obrigacao) };
}

// ─── Competência ─────────────────────────────────────────────────────────────

/** Lê a competência (YYYY-MM) de dentro do PDF. Reusa os fallbacks de extrairDados. */
export function competenciaDoPdf(texto: string): string | null {
  return extrairDados(texto).competencia;
}
