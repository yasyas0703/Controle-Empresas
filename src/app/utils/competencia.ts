// Janela de competência pra ENVIO de guias.
//
// Regra (decidida com a Yasmin, 2026-06-11): só se envia guia da competência do
// MÊS ANTERIOR ao corrente. Fecha-se o mês anterior no mês atual — em junho,
// manda-se maio.
//
// TRIMESTRAIS (IRPJ/CSLL): a guia usa o mês do FIM do trimestre DIRETO, igual a
// qualquer outra guia (o PIS, por exemplo). O DARF do 2º tri mostra apuração
// 30/06 e vence 31/07 → competência 06, enviada em julho, quando a janela já
// espera junho: cai na janela normal e envia sozinha. (Antes, até 2026-07-01,
// havia um recuo de 1 mês — 06 virava 05 — que jogava TODA guia trimestral pra
// `competencia_antiga` e travava no painel. Removido a pedido da Yasmin,
// 2026-07-01: apuração 30/06 tem que cair em junho, que nem o PIS.)
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
