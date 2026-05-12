import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmailViaUserGmail } from '@/lib/gmailSend';
import { buildEmailAlteradoEmail, resolvePortalUrl } from '@/lib/portalOnboardingEmail';

export const runtime = 'nodejs';

function getBearer(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

// DELETE: remove o acesso desta empresa em definitivo. Se for o último
// acesso do auth_user e ele NÃO for usuária do escritório, deleta também
// o auth.users (libera o email pra ser usado de novo no futuro).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const { id: clienteId } = await params;

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const usuarioId = authData.user.id;

    const admin = getSupabaseAdmin();
    const { data: usuarioRow } = await admin
      .from('usuarios')
      .select('id, role, ativo')
      .eq('id', usuarioId)
      .maybeSingle();
    if (!usuarioRow || !usuarioRow.ativo || (usuarioRow.role !== 'admin' && usuarioRow.role !== 'gerente')) {
      return NextResponse.json({ error: 'Apenas gerente/admin pode excluir acessos.' }, { status: 403 });
    }

    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id, auth_user_id, email')
      .eq('id', clienteId)
      .maybeSingle();
    if (!clienteRow) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }

    // Apaga logs de acesso do cliente primeiro (FK pode estar como RESTRICT)
    await admin.from('portal_acessos').delete().eq('cliente_id', clienteId);
    // Apaga push subscriptions do cliente
    await admin.from('portal_push_subscriptions').delete().eq('cliente_id', clienteId);

    const { error: delErr } = await admin
      .from('clientes_portal')
      .delete()
      .eq('id', clienteId);
    if (delErr) {
      return NextResponse.json({ error: 'Falha ao excluir: ' + delErr.message }, { status: 500 });
    }

    // Se foi o último acesso do auth_user e ele NÃO tem nada a ver com o
    // controle interno do escritório, remove o auth.users pra liberar o email.
    //
    // PROTEÇÃO TRIPLA pra nunca deletar uma usuária do escritório:
    //   (1) Match por id  — usuarios.id == auth_user_id
    //   (2) Match por email — qualquer usuarios.email == email do cliente
    //   (3) Match em DEVELOPER_USER_ID / GHOST_USER_ID
    // Se qualquer uma bater, paramos sem tocar no auth.users.
    let authRemovido = false;
    const { data: outros } = await admin
      .from('clientes_portal')
      .select('id')
      .eq('auth_user_id', clienteRow.auth_user_id)
      .limit(1);
    const aindaTemAcesso = (outros?.length ?? 0) > 0;
    if (!aindaTemAcesso) {
      const [{ data: matchPorId }, { data: matchPorEmail }] = await Promise.all([
        admin.from('usuarios').select('id').eq('id', clienteRow.auth_user_id).maybeSingle(),
        admin.from('usuarios').select('id').ilike('email', clienteRow.email).maybeSingle(),
      ]);
      const protegido =
        !!matchPorId ||
        !!matchPorEmail ||
        clienteRow.auth_user_id === process.env.DEVELOPER_USER_ID ||
        clienteRow.auth_user_id === process.env.GHOST_USER_ID;

      if (!protegido) {
        const { error: delAuthErr } = await admin.auth.admin.deleteUser(clienteRow.auth_user_id);
        if (delAuthErr) {
          // Não bloqueia — a linha do cliente já foi removida.
          console.error('[clientes-portal/DELETE] falha ao remover auth.users:', delAuthErr);
        } else {
          authRemovido = true;
        }
      } else {
        console.log(
          '[clientes-portal/DELETE] auth.users PRESERVADO — email pertence a usuária do escritório:',
          clienteRow.email,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      auth_removido: authRemovido,
      email_liberado: authRemovido,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

interface Payload {
  email?: string;
  nome_contato?: string | null;
  telefone?: string | null;
}

// PATCH/PUT: edita email, nome, telefone.
// Email muda em clientes_portal E em auth.users (admin updateUserById).
// Se o user do Auth tem outras linhas em clientes_portal (multi-empresa),
// o email muda em TODAS — porque é o email de login dele.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const { id: clienteId } = await params;
    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body || (!body.email && body.nome_contato === undefined && body.telefone === undefined)) {
      return NextResponse.json(
        { error: 'Informe pelo menos um campo: email, nome_contato ou telefone.' },
        { status: 400 },
      );
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const usuarioId = authData.user.id;

    const admin = getSupabaseAdmin();
    const { data: usuarioRow } = await admin
      .from('usuarios')
      .select('id, role, ativo')
      .eq('id', usuarioId)
      .maybeSingle();
    if (!usuarioRow || !usuarioRow.ativo || (usuarioRow.role !== 'admin' && usuarioRow.role !== 'gerente')) {
      return NextResponse.json({ error: 'Apenas gerente/admin pode editar acessos.' }, { status: 403 });
    }

    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id, auth_user_id, email, nome_contato')
      .eq('id', clienteId)
      .maybeSingle();
    if (!clienteRow) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }

    // Atualiza email se mudou
    const updatesClientesPortal: Record<string, unknown> = {};
    let emailMudou = false;
    if (body.email !== undefined) {
      const novoEmail = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) {
        return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
      }
      if (novoEmail !== clienteRow.email) {
        // PROTEÇÃO: se esse auth_user é também usuária do escritório,
        // bloqueia. Trocar o email aqui mudaria o login interno dela.
        const { data: ehUsuariaInterna } = await admin
          .from('usuarios')
          .select('id')
          .eq('id', clienteRow.auth_user_id)
          .maybeSingle();
        if (ehUsuariaInterna) {
          return NextResponse.json(
            {
              error:
                'Esse cliente compartilha email com uma usuária do escritório. ' +
                'Não dá pra trocar o email por aqui — mudaria o login interno dela também. ' +
                'Se for o caso, exclua esse acesso de cliente e cadastre um novo com outro email.',
            },
            { status: 409 },
          );
        }

        // Pré-check: o novo email já existe em outro auth.users?
        // Se sim, abortamos com mensagem clara (Supabase só devolve
        // "Error updating user" genérico nesse caso).
        const { data: lista, error: listErr } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        if (listErr) {
          console.error('[clientes-portal/PUT] listUsers falhou:', listErr);
          return NextResponse.json(
            { error: 'Falha ao validar email: ' + listErr.message },
            { status: 500 },
          );
        }
        const colisao = lista.users.find(
          (u) => (u.email ?? '').toLowerCase() === novoEmail && u.id !== clienteRow.auth_user_id,
        );
        if (colisao) {
          return NextResponse.json(
            {
              error:
                'Esse email já está em outra conta do sistema (pode ser uma usuária do escritório ou outro cliente). ' +
                'Pra esse cliente usar esse email, primeiro remove/altera a outra conta.',
            },
            { status: 409 },
          );
        }

        // Atualiza no Auth
        const { error: updAuthErr } = await admin.auth.admin.updateUserById(
          clienteRow.auth_user_id,
          { email: novoEmail, email_confirm: true },
        );
        if (updAuthErr) {
          console.error('[clientes-portal/PUT] updateUserById falhou:', {
            auth_user_id: clienteRow.auth_user_id,
            novo_email: novoEmail,
            message: updAuthErr.message,
            status: updAuthErr.status,
            code: (updAuthErr as { code?: string }).code,
          });
          const msg = updAuthErr.message?.toLowerCase() ?? '';
          if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
            return NextResponse.json(
              { error: 'Este email já está em uso por outra conta no sistema.' },
              { status: 409 },
            );
          }
          return NextResponse.json(
            {
              error: `Falha ao atualizar email no Auth (${updAuthErr.status ?? '?'}): ${updAuthErr.message}`,
            },
            { status: 500 },
          );
        }
        // Atualiza email em TODAS as linhas do mesmo auth_user (não só desta).
        await admin
          .from('clientes_portal')
          .update({ email: novoEmail })
          .eq('auth_user_id', clienteRow.auth_user_id);
        emailMudou = true;
      }
    }

    if (body.nome_contato !== undefined) {
      updatesClientesPortal.nome_contato = body.nome_contato;
    }
    if (body.telefone !== undefined) {
      updatesClientesPortal.telefone = body.telefone;
    }

    if (Object.keys(updatesClientesPortal).length > 0) {
      const { error: updErr } = await admin
        .from('clientes_portal')
        .update(updatesClientesPortal)
        .eq('id', clienteId);
      if (updErr) {
        return NextResponse.json({ error: 'Falha ao salvar: ' + updErr.message }, { status: 500 });
      }
    }

    // Se o email mudou, notifica o cliente no NOVO email
    let emailNotificacaoEnviada = false;
    let emailNotificacaoErro: string | null = null;
    if (emailMudou && body.email) {
      const novoEmail = body.email.trim().toLowerCase();
      const portalUrl = resolvePortalUrl(req);
      const nomeContato =
        body.nome_contato !== undefined ? body.nome_contato : clienteRow.nome_contato;
      const { subject, bodyText, bodyHtml } = buildEmailAlteradoEmail({
        email: novoEmail,
        emailAntigo: clienteRow.email,
        portalUrl,
        contatoNome: nomeContato ?? undefined,
      });
      const sendResult = await sendEmailViaUserGmail(usuarioId, {
        to: [novoEmail],
        subject,
        bodyText,
        bodyHtml,
      });
      emailNotificacaoEnviada = sendResult.ok;
      emailNotificacaoErro = sendResult.ok ? null : sendResult.error;
    }

    return NextResponse.json({
      ok: true,
      email_mudou: emailMudou,
      email_notificacao_enviada: emailNotificacaoEnviada,
      email_notificacao_erro: emailNotificacaoErro,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
