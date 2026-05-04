import type { Empresa, VencimentoFiscalNome, VencimentoFiscalSnNome } from '@/app/types';

/**
 * Tabela de regras (UF/Cidade × imposto → dia do mês).
 * Use `default` quando o dia for o mesmo independente da localização.
 *
 * Para impostos municipais (ISS), as regras vêm em `cidades` (chave =
 * nome da cidade normalizado: minúsculo, sem acento, sem espaço extra).
 *
 * Origem: lista da gerente do Fiscal — Yasmin / 2026.
 */
type RegraDia = {
  default?: number;
  cidades?: Record<string, number>;
} & Partial<Record<UF, number>>;

type UF =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN'
  | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

const REGRAS: Partial<Record<VencimentoFiscalNome, RegraDia>> = {
  ICMS: { MG: 8, SP: 20, BA: 10, SC: 10, default: 20 },
  'SPED ICMS/IPI': { MG: 15, SP: 20, BA: 10, SC: 20 },
  'SPED CONTRIBUIÇÕES': { default: 10 },
  REINF: { default: 13 },
  'DIFERENCIAL DE ALIQUOTA': { MG: 8, SP: 20, default: 10 },
  'GIA-ST/DIFAL': { default: 10 },
  'ICMS-ST/DIFAL': { MG: 9, SP: 9, default: 10 },
  IPI: { default: 25 },
  'PIS/COFINS': { default: 25 },
  'CSLL/IRPJ': { default: 30 },
  DAPI: { MG: 8 },
  DIME: { SC: 10 },
  'ISS - PRESTAÇÃO DE SERVIÇOS': {
    cidades: {
      'ouro fino': 10,
      'sapucai mirim': 10,
      'lavras': 15,
      'pouso alegre': 15,
      'pereira barreto': 25,
    },
  },
  'ISS - SERVIÇOS TOMADOS': {
    cidades: {
      'sao bernardo do campo': 15,
      'sao paulo': 10,
      'inconfidentes': 10,
    },
  },
  // Sem regra (preenche manual): DARF-SERVIÇOS TOMADOS.
};

/**
 * Regras dos vencimentos do regime Simples Nacional.
 *
 * Dia 0 = "último dia do mês" (caso da Declaração DAS).
 * Origem: lista da gerente do Fiscal — Yasmin / 2026.
 */
const REGRAS_SN: Partial<Record<VencimentoFiscalSnNome, RegraDia>> = {
  'EMISSÃO GUIA DAS': { default: 20 },
  'RECIBO DAS': { default: 20 },
  'DECLARAÇÃO DAS': { default: 0 }, // 0 → último dia do mês
  SINTEGRA: { default: 20 },
  DESTDA: { default: 20 },
  'DIFERENCIAL DE ALIQUOTA': { default: 4 },
  'ICMS ANTECIPADO': { default: 20 },
  'ST ANTECIPADO': { default: 29 },
};

function normalizarUf(estado?: string | null): UF | null {
  if (!estado) return null;
  const u = estado.trim().toUpperCase();
  if (u.length !== 2) return null;
  return u as UF;
}

/** Normaliza nome de cidade: minúsculo, sem acento, espaços colapsados. */
function normalizarCidade(cidade?: string | null): string | null {
  if (!cidade) return null;
  const sem = cidade
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return sem || null;
}

/**
 * Devolve o dia do mês configurado para (imposto, UF, cidade).
 * Ordem de prioridade: cidade > UF específica > default.
 * Devolve null se não há nenhuma regra aplicável.
 */
export function getDiaVencimento(
  nomeImposto: VencimentoFiscalNome | string,
  estado?: string | null,
  cidade?: string | null,
): number | null {
  const regra = REGRAS[nomeImposto as VencimentoFiscalNome];
  if (!regra) return null;
  const cid = normalizarCidade(cidade);
  if (cid && regra.cidades && regra.cidades[cid] != null) {
    return regra.cidades[cid];
  }
  const uf = normalizarUf(estado);
  if (uf && regra[uf] != null) return regra[uf]!;
  return regra.default ?? null;
}

/**
 * Calcula a data ISO (YYYY-MM-DD) do vencimento daquele imposto no mês de
 * referência (formato YYYY-MM). Devolve null se não há regra.
 *
 * Atenção: não ajusta para dia útil — devolve o dia "calendário" cru. Caso o
 * dia caia em fim de semana/feriado, o controle real é responsabilidade do
 * usuário (postergar manualmente). Pode ser refinado depois.
 */
export function vencimentoDoMes(
  nomeImposto: VencimentoFiscalNome | string,
  estado: string | null | undefined,
  anoMes: string, // 'YYYY-MM'
  cidade?: string | null,
): string | null {
  const dia = getDiaVencimento(nomeImposto, estado, cidade);
  if (dia == null) return null;
  const m = anoMes.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  // Limita o dia ao último dia do mês (ex.: dia 30 em fevereiro vira 28/29)
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Devolve a data do próximo vencimento (a partir de `referencia`, default hoje).
 * Se hoje é dia 25/04 e o vencimento é dia 8, devolve 08/05. Se hoje é dia 5/04
 * e o vencimento é dia 8, devolve 08/04.
 */
export function proximoVencimento(
  nomeImposto: VencimentoFiscalNome | string,
  estado: string | null | undefined,
  referencia: Date = new Date(),
  cidade?: string | null,
): string | null {
  const dia = getDiaVencimento(nomeImposto, estado, cidade);
  if (dia == null) return null;
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth() + 1; // 1..12
  const diaHoje = referencia.getDate();
  const ultimoDiaMesAtual = new Date(ano, mes, 0).getDate();
  const diaNoMesAtual = Math.min(dia, ultimoDiaMesAtual);

  if (diaHoje <= diaNoMesAtual) {
    return `${ano}-${String(mes).padStart(2, '0')}-${String(diaNoMesAtual).padStart(2, '0')}`;
  }
  // Já passou: vai pro mês seguinte
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  const ultimoDiaProx = new Date(proxAno, proxMes, 0).getDate();
  const diaProx = Math.min(dia, ultimoDiaProx);
  return `${proxAno}-${String(proxMes).padStart(2, '0')}-${String(diaProx).padStart(2, '0')}`;
}

/**
 * Helper conveniente quando você já tem a empresa.
 */
export function proximoVencimentoEmpresa(
  empresa: Pick<Empresa, 'estado' | 'cidade'>,
  nomeImposto: VencimentoFiscalNome | string,
  referencia?: Date,
): string | null {
  return proximoVencimento(nomeImposto, empresa.estado, referencia, empresa.cidade);
}

/**
 * Lista todos os impostos que têm regra configurada (útil pra UI mostrar quais
 * são preenchidos automaticamente vs preenchidos na mão).
 */
export function impostosComRegra(): string[] {
  return Object.keys(REGRAS);
}

/**
 * `true` se o imposto tem regra automática para a UF/cidade informada (ou default).
 */
export function temRegraAutomatica(
  nomeImposto: VencimentoFiscalNome | string,
  estado?: string | null,
  cidade?: string | null,
): boolean {
  return getDiaVencimento(nomeImposto, estado, cidade) != null;
}

/**
 * Decide se uma obrigação fiscal é aplicável para a empresa informada.
 *
 * Lógica:
 *  - Obrigação sem regra cadastrada → preenche manual, aplica a todos (true).
 *  - Obrigação com regra → aplica só se a regra casar com UF/cidade da empresa.
 *
 * Usado pelo checklist mensal e similares para esconder cells onde o imposto
 * não faz sentido (ex.: DAPI numa empresa de SP, DIME fora de SC, ISS fora
 * das cidades cadastradas).
 */
export function obrigacaoAplicaParaEmpresa(
  nomeImposto: VencimentoFiscalNome | string,
  estado?: string | null,
  cidade?: string | null,
): boolean {
  const regra = REGRAS[nomeImposto as VencimentoFiscalNome];
  if (!regra) return true;
  return getDiaVencimento(nomeImposto, estado, cidade) != null;
}

// ─── Simples Nacional ─────────────────────────────────────────────────────

/**
 * Devolve o dia configurado para uma obrigação SN.
 * Convenção: 0 = último dia do mês.
 */
export function getDiaVencimentoSn(
  nomeImposto: VencimentoFiscalSnNome | string,
  estado?: string | null,
  cidade?: string | null,
): number | null {
  const regra = REGRAS_SN[nomeImposto as VencimentoFiscalSnNome];
  if (!regra) return null;
  const cid = normalizarCidade(cidade);
  if (cid && regra.cidades && regra.cidades[cid] != null) {
    return regra.cidades[cid];
  }
  const uf = normalizarUf(estado);
  if (uf && regra[uf] != null) return regra[uf]!;
  return regra.default ?? null;
}

/**
 * Calcula a data ISO (YYYY-MM-DD) do vencimento SN no mês de referência.
 * Quando o dia configurado é 0, retorna o último dia do mês (caso da
 * Declaração DAS — convenção combinada com a gerente do Fiscal).
 */
export function vencimentoDoMesSn(
  nomeImposto: VencimentoFiscalSnNome | string,
  estado: string | null | undefined,
  anoMes: string,
  cidade?: string | null,
): string | null {
  const dia = getDiaVencimentoSn(nomeImposto, estado, cidade);
  if (dia == null) return null;
  const m = anoMes.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  // Dia 0 = último dia do mês
  const diaFinal = dia === 0 ? ultimoDia : Math.min(dia, ultimoDia);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Indica se uma obrigação SN se aplica à empresa (UF/cidade).
 * Hoje todas as obrigações SN cadastradas têm `default`, ou seja, valem para
 * qualquer estado/cidade — se algum dia surgir uma regra estadual, isso fica
 * coberto pela mesma lógica.
 */
export function obrigacaoSnAplicaParaEmpresa(
  nomeImposto: VencimentoFiscalSnNome | string,
  estado?: string | null,
  cidade?: string | null,
): boolean {
  const regra = REGRAS_SN[nomeImposto as VencimentoFiscalSnNome];
  if (!regra) return true;
  return getDiaVencimentoSn(nomeImposto, estado, cidade) != null;
}
