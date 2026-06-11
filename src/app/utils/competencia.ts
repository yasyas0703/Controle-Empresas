// Janela de competência pra ENVIO de guias.
//
// Regra (decidida com a Yasmin, 2026-06-11): só se envia guia da competência do
// MÊS ANTERIOR ao corrente. Fecha-se o mês anterior no mês atual — em junho,
// manda-se maio. Vale pra mensal E trimestral: a guia trimestral é enviada no mês
// do vencimento, que é o mês seguinte ao fim do trimestre (= a competência). Ex.:
// IRPJ 2º tri tem competência junho (fim do período) e vence 31/07 → enviada em
// julho, quando o mês anterior É junho.
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
