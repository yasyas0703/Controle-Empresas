// Helpers compartilhados das rotas /api/*. Antes desse arquivo, a função
// abaixo estava declarada idêntica em 23 rotas — qualquer mudança no
// formato do header (ex: passar a aceitar X-Auth-Token) exigia editar
// 23 arquivos.

/**
 * Extrai o token Bearer do header `Authorization` (ou `authorization`).
 * Retorna `null` se o header está ausente ou não segue o formato
 * `Bearer <token>`.
 *
 * Validação do token em si (assinatura, expiração) é feita à parte —
 * normalmente via `supabase.auth.getUser(token)` ou helpers em
 * `src/app/api/checklist-fiscal/_shared.ts` (`autenticarRequest`).
 */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
