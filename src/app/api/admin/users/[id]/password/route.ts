import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

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
  if (error || !data.user) return { ok: false as const, status: 401, message: 'Sessão expirada. Faça login novamente.' };

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('id, role, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false as const, status: 500, message: 'Erro interno.' };
  if (!profile || !profile.ativo || (profile.role !== 'gerente' && profile.role !== 'admin')) {
    return { ok: false as const, status: 403, message: 'Apenas gerentes podem executar esta ação' };
  }

  return { ok: true as const, callerId: data.user.id, callerRole: profile.role as string };
}

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Rate limit: max 5 trocas de senha por hora por IP
  const ip = getClientIp(req);
  const rl = rateLimit(`password:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Conta protegida: somente a própria desenvolvedora pode alterar sua senha
  const devId = process.env.DEVELOPER_USER_ID;
  if (devId && id === devId && authz.callerId !== devId) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  // Conta ghost: somente o ghost e a desenvolvedora podem alterar a senha do ghost
  const ghostId = process.env.GHOST_USER_ID;
  if (ghostId && id === ghostId && authz.callerId !== ghostId && (!devId || authz.callerId !== devId)) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  // Admins não podem alterar senha de outro admin — exceto a desenvolvedora e o ghost
  const { data: targetProfile } = await admin.from('usuarios').select('role').eq('id', id).maybeSingle();
  if (targetProfile?.role === 'admin' && authz.callerId !== id && (!devId || authz.callerId !== devId) && (!ghostId || authz.callerId !== ghostId)) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  let body: { senha: string };
  try {
    body = (await req.json()) as { senha: string };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body?.senha?.trim()) return NextResponse.json({ error: 'senha é obrigatória' }, { status: 400 });

  const senha = body.senha.trim();
  if (senha.length < 8) {
    return NextResponse.json({ error: 'A senha deve ter no mínimo 8 caracteres.' }, { status: 400 });
  }

  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 400 });

  // Audit log
  await admin.from('logs').insert({
    user_id: authz.callerId,
    action: 'update',
    entity: 'usuario',
    entity_id: id,
    message: `Alterou a senha do usuário`,
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true });
}
