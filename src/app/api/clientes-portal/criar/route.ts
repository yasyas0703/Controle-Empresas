import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmailViaUserGmail } from '@/lib/gmailSend';
import { buildOnboardingEmail, gerarSenhaTemporaria, resolvePortalUrl } from '@/lib/portalOnboardingEmail';

export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

interface Payload {
  empresa_id: string;
  email: string;
  nome_contato?: string;
  telefone?: string;
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

    // Já existe cliente ativo nesta empresa?
    const { data: existenteAtivo } = await admin
      .from('clientes_portal')
      .select('id, email')
      .eq('empresa_id', body.empresa_id)
      .eq('ativo', true)
      .maybeSingle();
    if (existenteAtivo) {
      return NextResponse.json(
        { error: `Esta empresa já tem acesso ativo (${existenteAtivo.email}). Use "Reenviar senha" ou desative o atual primeiro.` },
        { status: 409 },
      );
    }

    // Gera senha + cria user no Auth
    const senha = gerarSenhaTemporaria(12);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNormalizado,
      password: senha,
      email_confirm: true, // não exige confirmação, já loga
      user_metadata: {
        tipo: 'cliente_portal',
        empresa_id: body.empresa_id,
        nome_contato: body.nome_contato ?? null,
      },
    });
    if (createErr || !created.user) {
      // Email já existe?
      const msg = createErr?.message ?? '';
      if (msg.toLowerCase().includes('already')) {
        return NextResponse.json(
          { error: 'Esse email já está cadastrado no sistema. Use outro email ou desvincule o anterior.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: msg || 'Falha ao criar usuário.' }, { status: 500 });
    }

    // Trigger handle_new_auth_user já criou a linha em clientes_portal.
    // Atualiza dados opcionais (telefone) que o trigger não preenche.
    if (body.telefone) {
      await admin
        .from('clientes_portal')
        .update({ telefone: body.telefone })
        .eq('id', created.user.id);
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

    return NextResponse.json({
      ok: true,
      cliente: { id: created.user.id, email: emailNormalizado, empresa_id: body.empresa_id },
      email_enviado: sendResult.ok,
      email_erro: sendResult.ok ? null : sendResult.error,
      senha_provisoria: sendResult.ok ? null : senha, // se email falhou, devolve pra menina copiar
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
