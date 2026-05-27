/**
 * Cliente Supabase com SERVICE_ROLE — bypassa TODAS as policies RLS.
 *
 * ⚠️  NUNCA IMPORTAR EM CÓDIGO QUE RODA NO BROWSER (`'use client'` ou
 * Client Components). A service-role key é o segredo mais sensível do
 * projeto: vaza pro bundle ⇒ acesso total ao banco.
 *
 * ⚠️  TODA chamada a `getSupabaseAdmin()` em uma rota /api/* DEVE ter:
 *
 *   1. **Autenticação**: o Bearer token foi validado antes (via
 *      `getBearerToken` + `authClient.auth.getUser(token)` ou via
 *      `assertManager` de `@/lib/apiAuth`).
 *
 *   2. **Autorização**: a role/identidade do caller foi conferida
 *      antes da query bypassar RLS. Ex:
 *        - `assertManager(req)` valida que é gerente/admin (ou ghost/dev).
 *        - rotas /api/portal/* validam que o `auth_user_id` do caller
 *          tem cliente_portal vinculado à empresa do recurso pedido.
 *        - cron usa `CRON_SECRET` no header como prova de origem Vercel.
 *
 *   3. **Ownership do recurso** quando aplicável: ex.
 *      `/api/portal/documentos/[id]/download` não basta ter sessão
 *      válida — confere que o documento pertence à empresa do cliente.
 *
 * Onde NÃO precisa de getSupabaseAdmin (use o cliente anon comum):
 *   - Quando a query pode ser feita pelo próprio usuário com RLS ligada.
 *   - Quando a query é pública (ex: leitura de tabelas com policy
 *     `for select using (true)`).
 *
 * Quando precisa:
 *   - Listar/criar/editar usuários (auth.admin.* exige service role).
 *   - Operações em tabelas com RLS estrita que o caller não passaria
 *     (ex: cron alertar-vencimentos lê empresas de todas as gerentes).
 *   - Cross-tenant queries (ex: bulk update de várias empresas num
 *     único request).
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getSupabaseAdmin() {
  if (!supabaseUrl) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
