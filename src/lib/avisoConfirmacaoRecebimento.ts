// TEMPORÁRIO (pedido da Yasmin, julho/2026): acrescenta um pedido de confirmação
// de recebimento no RODAPÉ de toda guia enviada ao cliente. É só por este mês —
// pra DESLIGAR depois, troque ATIVO para `false` (ou remova este arquivo e os
// usos de `linhaConfirmacaoRecebimento()` nos envios de guia).

const ATIVO = true;

const TEXTO = 'Por favor, confirmar o recebimento deste e-mail.';

/**
 * Devolve a linha a ser concatenada NO FIM do corpo (texto) do e-mail da guia.
 * Vazio quando desligado — aí nada muda no e-mail. O HTML dos envios deriva do
 * texto (escapeHtml), então basta concatenar no bodyText.
 */
export function linhaConfirmacaoRecebimento(): string {
  return ATIVO ? `\n\n${TEXTO}` : '';
}
