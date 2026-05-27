// Formatters compartilhados — adicionar coisas aqui só quando o mesmo
// helper estiver duplicado em pelo menos 2 lugares.

/**
 * Formata número de RET no padrão XX.XXXXXXXXX-XX (max 13 dígitos).
 * Usado em inputs controlados de cadastro/exibição de RET e em logs
 * de mudança histórica.
 *
 * Aceita string vazia/undefined → retorna ''.
 */
export function formatRetNumber(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 11) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 11)}-${digits.slice(11)}`;
}
