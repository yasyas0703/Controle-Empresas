import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmailViaUserGmail } from '@/lib/gmailSend';
import {
  buildOnboardingEmail,
  buildEmpresaAdicionalEmail,
  gerarSenhaTemporaria,
  resolvePortalUrl,
} from '@/lib/portalOnboardingEmail';
import { getBearerToken } from '@/lib/apiAuth';

export const runtime = 'nodejs';



interface Payload {
  empresa_id: string;
  email: string;
  nome_contato?: string;
  telefone?: string;
}

// Procura um auth.users já existente pelo email. Retorna o id se achar.
async function findAuthUserIdByEmail(
  admin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
): Promise<string | null> {
  // O Admin SDK não tem getByEmail direto. Listamos com filtro.
  // 1ª página com 200 já cobre. Se precisar paginar no futuro, ajustar.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  const found = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
  return found?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body?.empresa_id || !body?.email) {
      return NextResponse.json({ error: 'empresa_id e email são obrigatórios.' }, { status: 400 });
    }
    const emailNormalizado = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
      return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
    }

    // Valida sessão da menina + role
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
      return NextResponse.json({ error: 'Apenas gerente/admin pode criar acessos.' }, { status: 403 });
    }

    // Empresa existe?
    const { data: empresaRow } = await admin
      .from('empresas')
      .select('id, razao_social, apelido, codigo')
      .eq('id', body.empresa_id)
      .maybeSingle();
    if (!empresaRow) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    }
    const empresaNome = empresaRow.razao_social || empresaRow.apelido || empresaRow.codigo || 'Sua empresa';

    // Procura se já existe auth.users com esse email (pode ser outro cliente do portal,
    // OU usuária interna do escritório usando o mesmo email pra teste).
    const existingAuthUserId = await findAuthUserIdByEmail(admin, emailNormalizado);

    if (existingAuthUserId) {
      // Já existe user no Auth. Vamos vincular sem criar/resetar senha.

      // Já tem acesso ATIVO nesta empresa pra esse user? Bloqueia.
      const { data: jaTemAtivo } = await admin
        .from('clientes_portal')
        .select('id')
        .eq('auth_user_id', existingAuthUserId)
        .eq('empresa_id', body.empresa_id)
        .eq('ativo', true)
        .maybeSingle();
      if (jaTemAtivo) {
        return NextResponse.json(
          { error: 'Este email já tem acesso ativo nesta empresa.' },
          { status: 409 },
        );
      }

      // Tem linha desativada na mesma empresa? Reativa em vez de duplicar.
      const { data: linhaInativa } = await admin
        .from('clientes_portal')
        .select('id')
        .eq('auth_user_id', existingAuthUserId)
        .eq('empresa_id', body.empresa_id)
        .eq('ativo', false)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      let novoClienteId: string;
      if (linhaInativa) {
        const { error: updErr } = await admin
          .from('clientes_portal')
          .update({
            ativo: true,
            nome_contato: body.nome_contato ?? null,
            telefone: body.telefone ?? null,
            email: emailNormalizado,
          })
          .eq('id', linhaInativa.id);
        if (updErr) {
          return NextResponse.json({ error: 'Falha ao reativar acesso: ' + updErr.message }, { status: 500 });
        }
        novoClienteId = linhaInativa.id;
      } else {
        const { data: inserted, error: insErr } = await admin
          .from('clientes_portal')
          .insert({
            auth_user_id: existingAuthUserId,
            empresa_id: body.empresa_id,
            email: emailNormalizado,
            nome_contato: body.nome_contato ?? null,
            telefone: body.telefone ?? null,
            ativo: true,
          })
          .select('id')
          .single();
        if (insErr || !inserted) {
          return NextResponse.json(
            { error: 'Falha ao vincular acesso: ' + (insErr?.message || 'erro desconhecido') },
            { status: 500 },
          );
        }
        novoClienteId = inserted.id;
      }

      // Aviso por email — senha NÃO muda (user já tem uma)
      const portalUrl = resolvePortalUrl(req);
      const { subject, bodyText, bodyHtml } = buildEmpresaAdicionalEmail({
        empresaNome,
        email: emailNormalizado,
        portalUrl,
        contatoNome: body.nome_contato ?? undefined,
      });
      const sendResult = await sendEmailViaUserGmail(usuarioId, {
        to: [emailNormalizado],
        subject,
        bodyText,
        bodyHtml,
      });

      return NextResponse.json({
        ok: true,
        cliente: { id: novoClienteId, email: emailNormalizado, empresa_id: body.empresa_id },
        vinculou_existente: true,
        email_enviado: sendResult.ok,
        email_erro: sendResult.ok ? null : sendResult.error,
      });
    }

    // Email novo — cria user no Auth (trigger insere em clientes_portal)
    const senha = gerarSenhaTemporaria(12);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNormalizado,
      password: senha,
      email_confirm: true,
      user_metadata: {
        tipo: 'cliente_portal',
        empresa_id: body.empresa_id,
        nome_contato: body.nome_contato ?? null,
      },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? 'Falha ao criar usuário.';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // O trigger criou a linha em clientes_portal (com auth_user_id = created.user.id).
    // Buscamos pra pegar o id novo e atualizamos telefone se houver.
    const { data: clienteCriado } = await admin
      .from('clientes_portal')
      .select('id')
      .eq('auth_user_id', created.user.id)
      .eq('empresa_id', body.empresa_id)
      .eq('ativo', true)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (body.telefone && clienteCriado?.id) {
      await admin
        .from('clientes_portal')
        .update({ telefone: body.telefone })
        .eq('id', clienteCriado.id);
    }

    // Envia email com a senha
    const portalUrl = resolvePortalUrl(req);
    const { subject, bodyText, bodyHtml } = buildOnboardingEmail({
      empresaNome,
      email: emailNormalizado,
      senhaTemporaria: senha,
      portalUrl,
      contatoNome: body.nome_contato,
      reenvio: false,
    });

    const sendResult = await sendEmailViaUserGmail(usuarioId, {
      to: [emailNormalizado],
      subject,
      bodyText,
      bodyHtml,
    });

    // Senha provisória NUNCA volta na response (era vazamento via HTTP).
    // Se email falhar, admin deve usar "Reenviar senha" pra gerar nova + tentar de novo.
    if (!sendResult.ok) {
      console.warn('[clientes-portal/criar] email não enviou — usar reenviar-senha pra retry', {
        cliente_id: clienteCriado?.id ?? created.user.id,
        empresa_id: body.empresa_id,
        motivo: sendResult.error,
      });
    }

    return NextResponse.json({
      ok: true,
      cliente: {
        id: clienteCriado?.id ?? created.user.id,
        email: emailNormalizado,
        empresa_id: body.empresa_id,
      },
      vinculou_existente: false,
      email_enviado: sendResult.ok,
      email_erro: sendResult.ok ? null : sendResult.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
