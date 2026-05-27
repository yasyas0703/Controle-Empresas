// Helpers compartilhados das rotas /api/*. Antes desse arquivo, getBearerToken
// estava declarado idêntico em 22 rotas e assertManager em 4 — qualquer
// mudança no formato do header ou na regra de quem é gerente exigia editar
// múltiplos arquivos com risco de divergência.

import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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

export type ManagerAuth =
  | {
      ok: true;
      callerId: string;
      callerRole: string;
      /** True se o user é o DEVELOPER_USER_ID ou GHOST_USER_ID. */
      isPrivileged: boolean;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

/**
 * Valida o Bearer token + checa que o usuário é gerente, admin ou
 * `isPrivileged` (DEVELOPER_USER_ID/GHOST_USER_ID), retornando dados
 * mínimos do caller pras checagens subsequentes de cada rota.
 *
 * @param allowPrivileged se `false`, ghost/dev SEM role gerente/admin
 *   são rejeitados. Default `true` — quase todas as rotas aceitam dev/ghost.
 *   Único caller atual com `false` é `/api/admin/users/batch`.
 */
export async function assertManager(
  req: Request,
  { allowPrivileged = true }: { allowPrivileged?: boolean } = {},
): Promise<ManagerAuth> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, message: 'Supabase env não configurado no servidor' };
  }

  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, message: 'Missing Authorization Bearer token' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, message: 'Sessão expirada. Faça login novamente.' };
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('id, role, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false, status: 500, message: 'Erro interno.' };

  const ghostId = process.env.GHOST_USER_ID;
  const devId = process.env.DEVELOPER_USER_ID;
  const isPrivileged = Boolean(
    (ghostId && data.user.id === ghostId) || (devId && data.user.id === devId),
  );

  const hasManagerRole = !!profile?.ativo && (profile.role === 'gerente' || profile.role === 'admin');
  const passesPrivilegedFallback = allowPrivileged && isPrivileged;

  if (!hasManagerRole && !passesPrivilegedFallback) {
    return { ok: false, status: 403, message: 'Apenas gerentes podem executar esta ação' };
  }

  return {
    ok: true,
    callerId: data.user.id,
    callerRole: (profile?.role ?? '') as string,
    isPrivileged,
  };
}
