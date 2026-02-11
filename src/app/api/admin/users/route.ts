import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type CreateUserBody = {
  nome: string;
  email: string;
  senha: string;
  role: 'gerente' | 'usuario';
  departamentoId: string | null;
  ativo: boolean;
};

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

  return { ok: true as const, userId: data.user.id };
}

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('usuarios').select('*').order('criado_em', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(
    (data ?? []).map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.role,
      departamentoId: u.departamento_id,
      ativo: u.ativo,
      criadoEm: u.criado_em,
      atualizadoEm: u.atualizado_em,
    }))
  );
}

export async function POST(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  let body: CreateUserBody;
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body?.nome?.trim() || !body?.email?.trim() || !body?.senha?.trim()) {
    return NextResponse.json({ error: 'nome, email e senha são obrigatórios' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email.trim(),
    password: body.senha,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Falha ao criar usuário' }, { status: 400 });
  }

  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .upsert(
      {
        id: created.user.id,
        nome: body.nome.trim(),
        email: body.email.trim(),
        role: body.role ?? 'usuario',
        departamento_id: body.departamentoId,
        ativo: body.ativo ?? true,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (profileError) {
    // rollback auth user
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({
    id: profile.id,
    nome: profile.nome,
    email: profile.email,
    role: profile.role,
    departamentoId: profile.departamento_id,
    ativo: profile.ativo,
    criadoEm: profile.criado_em,
    atualizadoEm: profile.atualizado_em,
  });
}
