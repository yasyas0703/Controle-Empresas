import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function assertGhostOrDev(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, status: 500, message: 'Supabase env não configurado' };
  }
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: 'Missing Authorization Bearer token' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, message: 'Sessão expirada.' };

  const ghostId = process.env.GHOST_USER_ID;
  const devId = process.env.DEVELOPER_USER_ID;
  if ((!ghostId || data.user.id !== ghostId) && (!devId || data.user.id !== devId)) {
    return { ok: false as const, status: 403, message: 'Acesso negado.' };
  }
  return { ok: true as const, callerId: data.user.id };
}

// DELETE — força logout de um usuário específico
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await assertGhostOrDev(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Não pode resetar a própria sessão nem a da desenvolvedora
  const devId = process.env.DEVELOPER_USER_ID;
  if (devId && id === devId && authz.callerId !== devId) {
    return NextResponse.json({ error: 'Não é possível resetar esta sessão.' }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc('invalidar_sessoes_usuario', { p_user_id: id });
  if (error) return NextResponse.json({ error: 'Erro ao invalidar sessões.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
