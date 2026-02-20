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

async function findAuthUserIdByEmail(admin: ReturnType<typeof getSupabaseAdmin>, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  // Supabase Admin API doesn't provide getUserByEmail; we page through listUsers.
  // Workspace sizes are small, so this is acceptable and avoids breaking imports.
  const perPage = 1000;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((u) => String(u.email || '').trim().toLowerCase() === target);
    if (match?.id) return match.id;
    if (users.length < perPage) break;
  }
  return null;
}

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

  return { ok: true as const, userId: data.user.id };
}

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('usuarios').select('*').order('criado_em', { ascending: false });
  if (error) return NextResponse.json({ error: 'Erro ao buscar usuários.' }, { status: 400 });

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

  if (body.senha.trim().length < 8) {
    return NextResponse.json({ error: 'A senha deve ter no mínimo 8 caracteres.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email.trim(),
    password: body.senha,
    email_confirm: true,
  });

  // If auth user already exists, reuse it and ensure the profile exists.
  if (createError || !created.user) {
    const msg = String(createError?.message || '').toLowerCase();
    const isDuplicateEmail = msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists');
    if (!isDuplicateEmail) {
      return NextResponse.json({ error: 'Não foi possível criar o usuário.' }, { status: 400 });
    }

    const existingId = await findAuthUserIdByEmail(admin, body.email);
    if (!existingId) {
      return NextResponse.json({ error: 'Email já existe no Auth, mas não foi possível localizar o usuário.' }, { status: 409 });
    }

    const { data: profile, error: profileError } = await admin
      .from('usuarios')
      .upsert(
        {
          id: existingId,
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
      return NextResponse.json({ error: 'Erro ao criar perfil do usuário.' }, { status: 400 });
    }

    // Audit log
    await admin.from('logs').insert({
      user_id: authz.userId,
      action: 'create',
      entity: 'usuario',
      entity_id: profile.id,
      message: `Criou usuário: ${profile.nome} (${profile.email})`,
    }).then(() => {}, () => {});

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
    return NextResponse.json({ error: 'Erro ao criar perfil do usuário.' }, { status: 400 });
  }

  // Audit log
  await admin.from('logs').insert({
    user_id: authz.userId,
    action: 'create',
    entity: 'usuario',
    entity_id: profile.id,
    message: `Criou usuário: ${profile.nome} (${profile.email})`,
  }).then(() => {}, () => {});

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
