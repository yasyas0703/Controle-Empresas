import type { Empresa, VencimentoFiscalNome } from '@/app/types';

/**
 * Tabela de regras (UF × imposto → dia do mês).
 * Use `default` quando o dia for o mesmo independente da UF.
 *
 * Origem das regras: lista passada pelo usuário em abril/2026.
 * Fontes a estender quando aparecer regra nova: SPED, REINF, ISS, DARF-Serviços
 * Tomados e GIA-ST. Por enquanto ficam sem regra → empresa preenche na mão.
 */
type RegraDia = { default?: number } & Partial<Record<UF, number>>;

type UF =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN'
  | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

const REGRAS: Partial<Record<VencimentoFiscalNome, RegraDia>> = {
  ICMS: { MG: 8, SP: 20, BA: 10, SC: 10, default: 20 },
  'DIFERENCIAL DE ALIQUOTA': { MG: 8, SP: 20, default: 10 },
  // GIA-ST/DIFAL costuma seguir a mesma data de DIFAL.
  'GIA-ST/DIFAL': { MG: 8, SP: 20, default: 10 },
  'ICMS-ST/DIFAL': { MG: 9, SP: 9, default: 10 },
  IPI: { default: 25 },
  'PIS/COFINS': { default: 25 },
  'CSLL/IRPJ': { default: 30 },
  // Sem regra (preenche manual): SPED ICMS/IPI, ISS - PRESTAÇÃO DE SERVIÇOS,
  // REINF, DARF-SERVIÇOS TOMADOS, SPED CONTRIBUIÇÕES.
};

function normalizarUf(estado?: string | null): UF | null {
  if (!estado) return null;
  const u = estado.trim().toUpperCase();
  if (u.length !== 2) return null;
  return u as UF;
}

/**
 * Devolve o dia do mês configurado para (imposto, UF). Se a UF não tem regra
 * específica, usa o `default`. Se o imposto não tem nenhuma regra, devolve null
 * (o usuário preenche na mão).
 */
export function getDiaVencimento(
  nomeImposto: VencimentoFiscalNome | string,
  estado?: string | null,
): number | null {
  const regra = REGRAS[nomeImposto as VencimentoFiscalNome];
  if (!regra) return null;
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
): string | null {
  const dia = getDiaVencimento(nomeImposto, estado);
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
): string | null {
  const dia = getDiaVencimento(nomeImposto, estado);
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
  empresa: Pick<Empresa, 'estado'>,
  nomeImposto: VencimentoFiscalNome | string,
  referencia?: Date,
): string | null {
  return proximoVencimento(nomeImposto, empresa.estado, referencia);
}

/**
 * Lista todos os impostos que têm regra configurada (útil pra UI mostrar quais
 * são preenchidos automaticamente vs preenchidos na mão).
 */
export function impostosComRegra(): string[] {
  return Object.keys(REGRAS);
}

/**
 * `true` se o imposto tem regra automática para a UF informada (ou default).
 */
export function temRegraAutomatica(
  nomeImposto: VencimentoFiscalNome | string,
  estado?: string | null,
): boolean {
  return getDiaVencimento(nomeImposto, estado) != null;
}
