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

  // CNPJ(s) do PRÓPRIO ESCRITÓRIO (contador) — aparecem como transmissor nas
  // guias dos CLIENTES (ex: DESTDA/PGDAS transmitido pela TRIAR traz o CNPJ da
  // TRIAR). Quando a empresa real TAMBÉM casa, o escritório não deve competir
  // (senão dá empresa_ambigua). Se o escritório for o ÚNICO match, aí sim é guia
  // dele. Override por env ESCRITORIO_CNPJ_RAIZES (raízes de 8 dígitos, vírgula).
  const escritorioRaizes = (process.env.ESCRITORIO_CNPJ_RAIZES ?? '17308128')
    .split(',').map((s) => s.replace(/\D/g, '')).filter((s) => s.length === 8);
  const ehEscritorio = (emp: Empresa) => {
    const raiz = cnpjDigitos(emp).slice(0, 8);
    return raiz.length === 8 && escritorioRaizes.includes(raiz);
  };

  // Tira o ESCRITÓRIO (contador) da disputa quando há outra empresa concorrendo —
  // ele aparece como transmissor/contabilista nas guias dos clientes. Se SÓ o
  // escritório casa, aí sim é guia dele.
  const semEscritorio = (lista: typeof ranqueados): typeof ranqueados => {
    const ne = lista.filter((c) => !ehEscritorio(c.empresa));
    return ne.length > 0 ? ne : lista;
  };

  // Decisão por CNPJ. Se sobrar 1 → envia. Se sobrar 2+ (FILIAIS do mesmo grupo:
  // o DESTDA/declaração traz o CNPJ da matriz + o do estabelecimento, então mais
  // de uma filial casa pela raiz/CNPJ), desempata pela INSCRIÇÃO ESTADUAL, que é
  // ÚNICA por estabelecimento: se exatamente UMA candidata tem a SUA IE no
  // documento, é a declarante. Cadastros realmente idênticos (mesma IE) continuam
  // ambíguos → pendência (não chuta entre iguais).
  const decidirCnpj = (lista: typeof ranqueados): ResultadoIdentEmpresa | null => {
    if (lista.length === 0) return null;
    const l = semEscritorio(lista);
    if (l.length === 1) return { empresa: l[0].empresa, tipoMatch: 'cnpj', forte: true, ambiguo: false, candidatos };
    const comIe = l.filter((c) => temIe(c.empresa));
    if (comIe.length === 1) return { empresa: comIe[0].empresa, tipoMatch: 'cnpj', forte: true, ambiguo: false, candidatos };
    // Sem IE pra desempatar, mas TODAS as candidatas são da MESMA empresa (mesma
    // raiz de 8 dígitos = filiais do mesmo grupo): caso da declaração FEDERAL do
    // Simples (PGDAS/DECLARAÇÃO/RECIBO), que é da empresa toda e não traz IE.
    // Roteia pra MATRIZ (ordem /0001). É o mesmo cliente — nunca empresa errada.
    const raizes = new Set(l.map((c) => cnpjDigitos(c.empresa).slice(0, 8)));
    const matrizes = l.filter((c) => cnpjDigitos(c.empresa).slice(8, 12) === '0001');
    // Só roteia pra matriz se houver UMA raiz (mesma empresa) e UMA matriz. Dois
    // cadastros com o MESMO CNPJ /0001 (duplicado real) continuam ambíguos — não
    // chuta entre idênticos.
    if (raizes.size === 1 && matrizes.length === 1) {
      return { empresa: matrizes[0].empresa, tipoMatch: 'cnpj', forte: true, ambiguo: false, candidatos };
    }
    return { empresa: null, tipoMatch: null, forte: false, ambiguo: true, candidatos };
  };

  // Decisão por IE: também exclui o escritório (antes só o caminho por CNPJ
  // excluía — o contador podia vencer por IE quando era o único match de IE).
  const decidirIe = (lista: typeof ranqueados): ResultadoIdentEmpresa | null => {
    if (lista.length === 0) return null;
    const l = semEscritorio(lista);
    if (l.length === 1) return { empresa: l[0].empresa, tipoMatch: 'ie', forte: true, ambiguo: false, candidatos };
    return { empresa: null, tipoMatch: null, forte: false, ambiguo: true, candidatos };
  };

  // Ordem de confiança: CNPJ completo > raiz do CNPJ > Inscricao Estadual.
  return (
    decidirCnpj(ranqueados.filter((c) => temCnpjFull(c.empresa)))
    ?? decidirCnpj(ranqueados.filter((c) => temCnpjBase(c.empresa)))
    ?? decidirIe(ranqueados.filter((c) => temIe(c.empresa)))
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
  /**
   * Perfis que SÓ falharam porque o código de receita do PDF não bate com o
   * cadastrado na config da empresa. Permite o painel dar o diagnóstico exato
   * ("guia parece ICMS-ST, PDF traz 0220-4 mas o cadastro espera 0218-8") em
   * vez do genérico "tipo de guia não reconhecido" — pedido da Yasmin
   * 2026-06-12, depois do caso ELEMAR.
   */
  codigoDivergente?: Array<{ obrigacao: string; codigosEsperados: string[]; codigoNaGuia: string | null }>;
}

// Texto EXATO do bloqueio de código em validarGuia.ts — usado pra detectar o
// caso "só falhou pelo código". Se mudar lá, mude aqui.
const MOTIVO_BLOQUEIO_CODIGO = 'Código de receita não confere com o cadastro da empresa';

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
  // Quem falhou EXCLUSIVAMENTE pelo bloqueio de código de receita.
  const falhouSoPorCodigo: Array<{ obrigacao: string; codigosEsperados: string[] }> = [];
  for (const obrigacao of obrigacoesComValidacao()) {
    const codigos = configs.get(obrigacao)?.codigos ?? [];
    const r = validarGuia(texto, empresa, obrigacao, codigos);
    if (r.valido && r.perfilUsado) {
      aprovados.push({ obrigacao, temCodigo: r.detectado.codigoReceitaEncontrado != null });
      continue;
    }
    const bloqueios = r.problemas.filter((p) => p.severidade === 'bloqueio');
    if (bloqueios.length > 0 && bloqueios.every((b) => b.motivo === MOTIVO_BLOQUEIO_CODIGO)) {
      falhouSoPorCodigo.push({ obrigacao, codigosEsperados: codigos });
    }
  }

  if (aprovados.length === 0) {
    if (falhouSoPorCodigo.length === 0) return { obrigacao: null, ambiguo: false, candidatos: [] };
    // O perfil bateu, SÓ o código divergiu — devolve o diagnóstico exato.
    // Revalida sem códigos só pra descobrir qual código a guia traz (preview
    // pela lista global do perfil).
    const codigoDivergente = falhouSoPorCodigo.map((f) => {
      const semCodigo = validarGuia(texto, empresa, f.obrigacao, []);
      return {
        obrigacao: f.obrigacao,
        codigosEsperados: f.codigosEsperados,
        codigoNaGuia: semCodigo.detectado.codigoReceitaEncontrado ?? null,
      };
    });
    return { obrigacao: null, ambiguo: false, candidatos: [], codigoDivergente };
  }
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
// A OCR das guias bagunça a tabela (rótulo numa coluna, valor noutra), então o
// rótulo "Mês Ano de Referência / Período de Apuração" raramente fica grudado no
// valor. Estratégia em camadas (verificada em 140 guias reais: 97% de acerto):
//   1) intervalo de apuração "DD a DD/MM/AAAA" (comum em guias estaduais) -> mês final;
//   2) rótulo grudado no valor (quando a OCR mantém a adjacência);
//   3) vencimento (data mais futura plausível) menos 1 mês — guia vence sempre no
//      mês seguinte à competência. Descarta datas-lixo (futuro absurdo da OCR).

function compValida(y: number, m: number): boolean {
  return m >= 1 && m <= 12 && y >= 2020 && y <= new Date().getUTCFullYear() + 1;
}
function compYm(y: number, m: number): string { return `${y}-${String(m).padStart(2, '0')}`; }

function compPorIntervalo(texto: string): string | null {
  const m = texto.match(/\d{1,2}\s*a\s*\d{1,2}[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  return m && compValida(Number(m[2]), Number(m[1])) ? compYm(Number(m[2]), Number(m[1])) : null;
}
function compPorRotulo(texto: string): string | null {
  const pats = [
    // Rótulo ANTES do valor (formato comum).
    /per[ií]odo\s*de\s*apura[çc][aã]o[^\d]{0,20}(\d{1,2})[\/\-.](\d{4})/i,
    /compet[eê]ncia[^\d]{0,20}(\d{1,2})[\/\-.](\d{4})/i,
    /m[eê]s\s*(?:ano\s*)?(?:de\s*)?refer[eê]ncia[^\d]{0,20}(\d{1,2})\s*[\/\-.]\s*(\d{4})/i,
    // Valor ANTES do rótulo — comum no texto extraído de DAE-MG ("05 / 2026 Mês
    // Ano de Referência") e DARE-SP ("04/2026 07 - Referência"). O lookbehind
    // (?<![\d\/.\-]) evita capturar MM/AAAA de DENTRO de uma data completa
    // DD/MM/AAAA (ex: o vencimento "08/06/2026" não vira competência 06/2026).
    /(?<![\d\/.\-])(\d{1,2})\s*[\/\-.]\s*(\d{4})\s*(?:\d{1,2}\s*[-–]\s*)?(?:m[eê]s\s*(?:ano\s*)?(?:de\s*)?)?refer[eê]ncia/i,
  ];
  for (const re of pats) {
    const m = texto.match(re);
    if (m && compValida(Number(m[2]), Number(m[1]))) return compYm(Number(m[2]), Number(m[1]));
  }
  return null;
}
function compPorChaveDfe(texto: string): string | null {
  // Chave de acesso de NFe/CTe/NFCe (44 dígitos): cUF(2) + AAMM(4) + CNPJ(14) +
  // modelo(2) + ... O AAMM é o ano/mês de EMISSÃO da nota — boa proxy de
  // competência quando a guia não traz período de referência (ex: GNRE de
  // ICMS-ST por operação, que cita a Chave da DFe nas info. complementares).
  // O modelo (pos. 20-21) confirma que é chave fiscal de verdade, não o código
  // de barras da própria guia.
  for (const m of texto.matchAll(/\d{44}/g)) {
    const chave = m[0];
    if (!['55', '57', '65'].includes(chave.slice(20, 22))) continue; // NFe / CTe / NFCe
    const y = 2000 + Number(chave.slice(2, 4));
    const mes = Number(chave.slice(4, 6));
    if (compValida(y, mes)) return compYm(y, mes);
  }
  return null;
}
function compPorVencimento(texto: string): string | null {
  const limite = Date.now() + 200 * 86400000; // descarta vencimento absurdamente no futuro
  let best: { y: number; m: number; ts: number } | null = null;
  for (const mm of texto.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)) {
    const d = Number(mm[1]); const mes = Number(mm[2]); let y = Number(mm[3]);
    if (mm[3].length === 2) y += 2000;
    if (mm[3].length === 3) continue;
    if (!compValida(y, mes) || d < 1 || d > 31) continue;
    const ts = Date.UTC(y, mes - 1, d);
    if (ts > limite) continue;
    if (!best || ts > best.ts) best = { y, m: mes, ts };
  }
  if (!best) return null;
  let m = best.m - 1; let y = best.y;
  if (m < 1) { m = 12; y -= 1; }
  return compYm(y, m);
}

/** Lê a competência (YYYY-MM) de dentro do PDF (estratégia em camadas, ver acima). */
export function competenciaDoPdf(texto: string): string | null {
  return compPorIntervalo(texto) ?? compPorRotulo(texto) ?? compPorChaveDfe(texto) ?? compPorVencimento(texto) ?? extrairDados(texto).competencia;
}

// ─── Competência de LIVROS FISCAIS (caso especial) ─────────────────────────────
// Livro fiscal NÃO é guia: as datas nele SÃO o próprio mês de apuração, não um
// vencimento. Por isso a cascata de guia erra feio aqui — o `compPorVencimento`
// pega a maior data (ex.: 31/05/2026, fim do período) e SUBTRAI 1 mês, jogando o
// livro de maio pra abril. Quando isso acontece com só alguns livros do conjunto,
// o lote racha em duas competências e nunca fecha (precisa dos 5 tipos juntos).
//
// Todo livro traz o período como "PERÍODO: 01/MM/AAAA a 31/MM/AAAA" ou
// "MÊS OU PERÍODO/ANO: ... 01/MM/AAAA". A competência é esse mês DIRETO (sem
// subtrair). Camadas, da mais confiável pra menos — todas usam o mês COMO ESTÁ:
//   1) intervalo "DD a DD/MM/AAAA" (período de apuração grudado);
//   2) data logo após o rótulo de período/mês de referência;
//   3) início do período "01/MM/AAAA" (livro sempre começa no dia 1º);
//   4) data mais futura plausível — mês COMO ESTÁ (nunca menos 1).
// Se nada casar, devolve null → a rota registra pendência (melhor que chutar mês
// errado e rachar o lote).

function ymSeData(dia: number, mes: number, ano: number): string | null {
  if (dia < 1 || dia > 31 || !compValida(ano, mes)) return null;
  return compYm(ano, mes);
}

function compLivroPorRotulo(texto: string): string | null {
  // Rótulo de período seguido (em até 30 não-dígitos) de uma data DD/MM/AAAA.
  const re = /(?:per[ií]odo|m[eê]s\s*ou\s*per[ií]odo\s*\/?\s*ano|m[eê]s\s*(?:de\s*)?refer[eê]ncia)[^\d]{0,30}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i;
  const m = texto.match(re);
  return m ? ymSeData(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function compLivroPorInicioPeriodo(texto: string): string | null {
  // Início do período: livro fiscal sempre cobre o mês inteiro, começa no dia 1º.
  // "01/MM/AAAA" é assinatura forte do mês de apuração.
  const m = texto.match(/\b0?1[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  return m ? ymSeData(1, Number(m[1]), Number(m[2])) : null;
}

function compLivroPorDataMaisFutura(texto: string): string | null {
  // Igual ao compPorVencimento, mas SEM subtrair 1 mês: a maior data do livro é
  // o fim do período (31/MM) — o próprio mês de apuração.
  const limite = Date.now() + 200 * 86400000;
  let best: { y: number; m: number; ts: number } | null = null;
  for (const mm of texto.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)) {
    const d = Number(mm[1]); const mes = Number(mm[2]); let y = Number(mm[3]);
    if (mm[3].length === 2) y += 2000;
    if (mm[3].length === 3) continue;
    if (!compValida(y, mes) || d < 1 || d > 31) continue;
    const ts = Date.UTC(y, mes - 1, d);
    if (ts > limite) continue;
    if (!best || ts > best.ts) best = { y, m: mes, ts };
  }
  return best ? compYm(best.y, best.m) : null;
}

/**
 * Competência de um PDF JÁ reconhecido como LIVROS FISCAIS. Diferente da de guia:
 * usa o mês de apuração DIRETO, nunca subtrai. Ver bloco de comentário acima.
 */
export function competenciaDeLivro(texto: string): string | null {
  return compPorIntervalo(texto)
    ?? compLivroPorRotulo(texto)
    ?? compLivroPorInicioPeriodo(texto)
    ?? compLivroPorDataMaisFutura(texto);
}
