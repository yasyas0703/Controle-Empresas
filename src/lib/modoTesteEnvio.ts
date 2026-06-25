// ⚠️ MODO TESTE (PROVISÓRIO — instrução da Yasmin, 2026-06-25): enquanto ela
// não ativar os e-mails reais dos clientes, TODA guia (manual ou automática,
// Fiscal ou Cadastro) deve cair só na caixa dela — mesmo que a empresa já
// tenha e-mail de cliente cadastrado e ativo. Sem isso, qualquer e-mail real
// que alguém cadastre/ative por engano já sai pro cliente.
//
// Coloque `null` (ou array vazio) quando ela liberar o envio pros clientes reais.
export const EMAILS_TESTE_FORCAR_TODOS_ENVIOS: string[] | null = [
  'yasminteodoro0703@gmail.com',
  'yasmin@triarcontabilidade.com.br',
];

/**
 * Aplica o override de teste: enquanto `EMAILS_TESTE_FORCAR_TODOS_ENVIOS`
 * estiver setado, ignora os e-mails reais da empresa e devolve só os de
 * teste — mesmo que a empresa não tenha nenhum e-mail cadastrado (assim a
 * guia nunca trava em "sem emails cadastrados" durante o teste). Com mais
 * de um e-mail aqui, cada um vira um envio individual com pixel próprio
 * (ver enviar-anexo/_shared-envio) — útil pra testar abertura por destinatário.
 */
export function aplicarOverrideEmailTeste(emailsReais: string[]): string[] {
  if (!EMAILS_TESTE_FORCAR_TODOS_ENVIOS || EMAILS_TESTE_FORCAR_TODOS_ENVIOS.length === 0) return emailsReais;
  return EMAILS_TESTE_FORCAR_TODOS_ENVIOS;
}
