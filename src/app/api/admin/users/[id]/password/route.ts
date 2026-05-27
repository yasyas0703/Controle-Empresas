import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { isUuid } from '@/lib/uuid';
import { assertManager } from '@/lib/apiAuth';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  // Rate limit: admin/dev/ghost sem limite; gerente: 50/h por IP (proteção contra account takeover).
  const devId = process.env.DEVELOPER_USER_ID;
  const ghostId = process.env.GHOST_USER_ID;
  const isPrivileged =
    authz.callerRole === 'admin' ||
    (devId && authz.callerId === devId) ||
    (ghostId && authz.callerId === ghostId);
  if (!isPrivileged) {
    const ip = getClientIp(req);
    const rl = rateLimit(`password:${ip}`, 50, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    }
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });

  // Conta protegida: somente a própria desenvolvedora pode alterar sua senha
  if (devId && id === devId && authz.callerId !== devId) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  // Conta ghost: somente o ghost e a desenvolvedora podem alterar a senha do ghost
  if (ghostId && id === ghostId && authz.callerId !== ghostId && (!devId || authz.callerId !== devId)) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  // Admins não podem alterar senha de outro admin — exceto a desenvolvedora e o ghost
  const { data: targetProfile } = await admin.from('usuarios').select('role, email').eq('id', id).maybeSingle();
  if (targetProfile?.role === 'admin' && authz.callerId !== id && (!devId || authz.callerId !== devId) && (!ghostId || authz.callerId !== ghostId)) {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 403 });
  }

  // Gerentes só podem resetar senha de usuários comuns. Sem isso, um gerente
  // comprometido podia tomar a conta de outro gerente do mesmo nível ou
  // tentar contra admin (que já está bloqueado acima). Self-reset sempre
  // permitido. Dev/ghost passam porque o assertManager devolveu callerRole
  // possivelmente vazio mas isPrivileged=true — confere as duas coisas.
  const isPrivileged = (devId && authz.callerId === devId) || (ghostId && authz.callerId === ghostId);
  if (
    authz.callerRole === 'gerente'
    && !isPrivileged
    && authz.callerId !== id
    && (targetProfile?.role === 'gerente' || targetProfile?.role === 'admin')
  ) {
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

  // Detecta conta órfã: existe em `usuarios` mas não em `auth.users`.
  // Acontece quando o user foi deletado direto pelo painel do Supabase.
  // Recriamos no Auth com o mesmo UID para preservar todos os vínculos.
  const { data: existingAuth } = await admin.auth.admin.getUserById(id);
  let recreated = false;
  if (!existingAuth?.user) {
    if (!targetProfile?.email) {
      return NextResponse.json({ error: 'Usuário sem email cadastrado — não é possível recriar acesso.' }, { status: 400 });
    }
    const { error: createError } = await admin.auth.admin.createUser({
      id,
      email: targetProfile.email,
      password: senha,
      email_confirm: true,
    });
    if (createError) {
      return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 400 });
    }
    recreated = true;
  } else {
    const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
    if (error) return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 400 });
  }

  // Audit log
  await admin.from('logs').insert({
    user_id: authz.callerId,
    action: 'update',
    entity: 'usuario',
    entity_id: id,
    message: recreated ? 'Recriou conta de acesso (Auth) e definiu senha do usuário' : 'Alterou a senha do usuário',
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, recreated });
}
