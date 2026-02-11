import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function assertManager(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, status: 500, message: 'Supabase env não configurado no servidor' };
  }

  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: 'Missing Authorization Bearer token' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, message: 'Token inválido' };

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('id, role, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false as const, status: 500, message: profileError.message };
  if (!profile || !profile.ativo || profile.role !== 'gerente') {
    return { ok: false as const, status: 403, message: 'Apenas gerentes podem executar esta ação' };
  }

  return { ok: true as const };
}

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: { senha: string };
  try {
    body = (await req.json()) as { senha: string };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body?.senha?.trim()) return NextResponse.json({ error: 'senha é obrigatória' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password: body.senha });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
