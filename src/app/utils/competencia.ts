// Janela de competência pra ENVIO de guias.
//
// Regra (decidida com a Yasmin, 2026-06-11): só se envia guia da competência do
// MÊS ANTERIOR ao corrente. Fecha-se o mês anterior no mês atual — em junho,
// manda-se maio.
//
// TRIMESTRAIS (IRPJ/CSLL, refinado com a Yasmin em 2026-06-12): a guia mostra o
// mês do FIM do trimestre, mas pertence à LEVA do mês anterior — "olhou e tá 06
// (2º tri), significa que envia em 05". Use competenciaEfetiva() pra converter o
// mês lido do PDF na competência da leva antes de comparar com a janela.
//
// Fora da janela: AUTO vai pra pendência (+ alerta); MANUAL bloqueia, mas
// admin/gerente pode forçar com motivo (atrasada legítima).

/** Competência esperada hoje (YYYY-MM) = mês anterior ao corrente.
 *  Usa horário de BRASÍLIA (UTC-3, sem horário de verão no Brasil desde 2019),
 *  pra cliente (browser local) e servidor (Vercel = UTC) computarem o MESMO mês —
 *  senão, na madrugada do dia 1º, o UTC ainda estaria no mês anterior e o servidor
 *  bloquearia guias que o cliente libera. getTime() é epoch (independe de fuso);
 *  subtrair 3h e ler em UTC dá o relógio de parede de Brasília. */
export function competenciaEsperada(referencia: Date = new Date()): string {
  const brt = new Date(referencia.getTime() - 3 * 60 * 60 * 1000);
  const y = brt.getUTCFullYear();
  const m = brt.getUTCMonth(); // 0-based (jan=0), já no fuso de Brasília
  const ano = m === 0 ? y - 1 : y;
  const mesAnterior1Based = m === 0 ? 12 : m; // m (atual 0-based) == mês anterior 1-based
  return `${ano}-${String(mesAnterior1Based).padStart(2, '0')}`;
}

/** Obrigações de apuração TRIMESTRAL cuja guia mostra o mês do fim do trimestre. */
const OBRIGACOES_TRIMESTRAIS = new Set(['IRPJ', 'CSLL']);

/**
 * Converte a competência LIDA do PDF na competência EFETIVA da leva de envio.
 *
 * IRPJ/CSLL (Lucro Presumido, trimestral): o DARF traz o período de apuração
 * terminando no fim do trimestre (03, 06, 09, 12), mas o escritório envia essa
 * guia junto com a leva do mês ANTERIOR — guia mostrando 2026-06 (2º tri) é da
 * leva de 2026-05 (regra da Yasmin, 2026-06-12). Só recua quando o mês lido é
 * fim de trimestre: IRPJ/CSLL mensal por estimativa (se aparecer) não mexe.
 * Demais obrigações passam direto.
 */
export function competenciaEfetiva(obrigacao: string | null | undefined, competencia: string | null): string | null {
  if (!competencia) return competencia;
  const nome = (obrigacao ?? '').normalize('NFC').trim().toUpperCase();
  if (!OBRIGACOES_TRIMESTRAIS.has(nome)) return competencia;
  const m = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!m) return competencia;
  const mes = Number(m[2]);
  if (mes !== 3 && mes !== 6 && mes !== 9 && mes !== 12) return competencia;
  // Recua 1 mês (fim de trimestre nunca é janeiro — não cruza ano).
  return `${m[1]}-${String(mes - 1).padStart(2, '0')}`;
}

export type JanelaCompetencia = 'ok' | 'antiga' | 'adiantada';

/**
 * Avalia uma competência (YYYY-MM) contra a janela permitida:
 *   'ok'        → é o mês anterior (pode enviar)
 *   'antiga'    → mais velha que o mês anterior (atrasada → pendência aprovável)
 *   'adiantada' → mês atual ou futuro (ainda não fechou → correção)
 * Comparação lexicográfica de 'YYYY-MM' funciona (formato fixo).
 */
export function avaliarJanelaCompetencia(
  competencia: string,
  referencia: Date = new Date(),
): JanelaCompetencia {
  const esperada = competenciaEsperada(referencia);
  if (competencia === esperada) return 'ok';
  return competencia < esperada ? 'antiga' : 'adiantada';
}
