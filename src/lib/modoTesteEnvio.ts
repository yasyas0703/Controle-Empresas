// CÓPIA INTERNA PRA YASMIN (pedido dela, 2026-07-01) — substituiu o "modo teste".
//
// Histórico: até 2026-07-01 os e-mails reais dos clientes estavam inativos e
// TODO envio (fiscal/cadastro, manual/automático) era FORÇADO só pra caixa da
// Yasmin — a lista real era ignorada/substituída. Isso era o "modo teste".
//
// Agora (go-live): os clientes reais recebem de verdade. A Yasmin só quer
// continuar recebendo uma CÓPIA de tudo. Então, em vez de SUBSTITUIR os
// destinatários reais, a gente ADICIONA o e-mail dela à lista (append + dedup):
//   - Empresa COM e-mail cadastrado → cliente recebe + Yasmin recebe cópia.
//   - Empresa SEM e-mail            → cai só na Yasmin (nunca some em silêncio).
//
// O filtro fiscal↔cadastro é feito ANTES, em cada caminho de envio (guia fiscal
// só seleciona tipo='fiscal'); esta função não mexe nisso — só acrescenta a cópia.
//
// Pra DESLIGAR a cópia interna (cliente recebe sozinho), ponha `null` aqui.
export const EMAIL_COPIA_INTERNA: string | null = 'yasmin@triarcontabilidade.com.br';

/**
 * Acrescenta a cópia interna da Yasmin à lista de destinatários reais, sem
 * duplicar (case-insensitive). Ordem: reais primeiro, cópia por último.
 *
 * O nome `aplicarOverrideEmailTeste` foi mantido de propósito: TODOS os caminhos
 * de envio já chamam esta função, então trocar só o corpo garante que a regra
 * nova (cópia pra Yasmin) valha em todos eles sem risco de esquecer um call site.
 */
export function aplicarOverrideEmailTeste(emailsReais: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  const add = (e: string) => {
    const limpo = e.trim();
    if (!limpo) return;
    const chave = limpo.toLowerCase();
    if (vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(limpo);
  };
  for (const e of emailsReais) add(e);
  if (EMAIL_COPIA_INTERNA) add(EMAIL_COPIA_INTERNA);
  return saida;
}
