// Nome de exibição ("display name") do remetente nos e-mails que o sistema manda
// (guias, certidões, onboarding do portal, alertas). Sem isso o cabeçalho From
// sai só com o endereço (ex.: envio@triarcontabilidade.com.br) e a caixa do
// cliente mostra só "envio". Com o nome, aparece "TRIAR CONTABILIDADE".
// Pedido da Yasmin (2026-07-01). Pra trocar o nome, muda só a constante abaixo.
export const NOME_REMETENTE = 'TRIAR CONTABILIDADE';

/**
 * Monta o valor do header `From` com nome de exibição:
 *   "TRIAR CONTABILIDADE" <envio@triarcontabilidade.com.br>
 *
 * - Sanitiza CRLF do nome e do e-mail (defesa contra header injection).
 * - Nome ASCII vira quoted-string; nome com acento/UTF-8 vira encoded-word
 *   RFC 2047 (=?UTF-8?B?...?=), que é o correto pra caractere fora de ASCII.
 * - Constante vazia → devolve só o e-mail (sem nome).
 */
export function formatarRemetente(email: string): string {
  const addr = String(email).replace(/[\r\n]/g, ' ').trim();
  const nome = NOME_REMETENTE.replace(/[\r\n]/g, ' ').trim();
  if (!nome) return addr;
  const asciiSafe = /^[\x20-\x7E]*$/.test(nome);
  const nomeHeader = asciiSafe
    ? `"${nome.replace(/(["\\])/g, '\\$1')}"`
    : `=?UTF-8?B?${Buffer.from(nome, 'utf8').toString('base64')}?=`;
  return `${nomeHeader} <${addr}>`;
}
