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

type PatchBody = {
  nome?: string;
  email?: string;
  role?: 'gerente' | 'usuario';
  departamentoId?: string | null;
  ativo?: boolean;
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Update Auth email (if provided)
  if (body.email !== undefined) {
    const nextEmail = String(body.email).trim();
    if (!nextEmail) return NextResponse.json({ error: 'email inválido' }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(id, { email: nextEmail, email_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (body.nome !== undefined) {
    const nextNome = String(body.nome).trim();
    if (!nextNome) return NextResponse.json({ error: 'nome inválido' }, { status: 400 });
    row.nome = nextNome;
  }
  if (body.email !== undefined) row.email = String(body.email).trim();
  if (body.role !== undefined) row.role = body.role;
  if (body.departamentoId !== undefined) row.departamento_id = body.departamentoId;
  if (body.ativo !== undefined) row.ativo = body.ativo;

  const { data: updated, error: updateError } = await admin.from('usuarios').update(row).eq('id', id).select('*').single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

  return NextResponse.json({
    id: updated.id,
    nome: updated.nome,
    email: updated.email,
    role: updated.role,
    departamentoId: updated.departamento_id,
    ativo: updated.ativo,
    criadoEm: updated.criado_em,
    atualizadoEm: updated.atualizado_em,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Tenta deletar do Auth (ignora erro se o user só existe na tabela e não no Auth)
  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError && !authError.message.toLowerCase().includes('not found')) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Remove o perfil da tabela usuarios
  const { error: dbError } = await admin.from('usuarios').delete().eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
