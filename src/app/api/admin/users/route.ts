import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';

type CreateUserBody = {
  nome: string;
  email: string;
  senha: string;
  role: 'gerente' | 'usuario';
  departamentoId: string | null;
  departamentosExtrasIds?: string[];
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



export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('usuarios').select('*').order('criado_em', { ascending: false });
  if (error) return NextResponse.json({ error: 'Erro ao buscar usuários.' }, { status: 400 });

  const hiddenUserIds = new Set([process.env.GHOST_USER_ID, process.env.DEVELOPER_USER_ID].filter(Boolean) as string[]);
  return NextResponse.json(
    (data ?? [])
      .filter((u) => !hiddenUserIds.has(u.id))
      .map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        role: u.role,
        departamentoId: u.departamento_id,
        departamentosExtrasIds: Array.isArray(u.departamentos_extras_ids) ? u.departamentos_extras_ids : [],
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
          departamentos_extras_ids: Array.isArray(body.departamentosExtrasIds) ? body.departamentosExtrasIds : [],
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
      user_id: authz.callerId,
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
    user_id: authz.callerId,
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
    departamentosExtrasIds: Array.isArray(profile.departamentos_extras_ids) ? profile.departamentos_extras_ids : [],
    ativo: profile.ativo,
    criadoEm: profile.criado_em,
    atualizadoEm: profile.atualizado_em,
  });
}
