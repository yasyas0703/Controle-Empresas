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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
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
      return NextResponse.json({ error: 'Apenas gerente/admin pode reenviar senha.' }, { status: 403 });
    }

    // Carrega cliente + empresa
    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id, email, empresa_id, nome_contato, ativo, empresa:empresas(razao_social, apelido, codigo)')
      .eq('id', clienteId)
      .maybeSingle();
    if (!clienteRow) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    if (!clienteRow.ativo) {
      return NextResponse.json({ error: 'Cliente está desativado. Reative antes de reenviar.' }, { status: 400 });
    }

    const empresaRaw = Array.isArray((clienteRow as { empresa: unknown }).empresa)
      ? ((clienteRow as { empresa: Array<{ razao_social: string | null; apelido: string | null; codigo: string | null }> }).empresa[0] ?? null)
      : ((clienteRow as { empresa: { razao_social: string | null; apelido: string | null; codigo: string | null } | null }).empresa ?? null);
    const empresaNome = empresaRaw?.razao_social || empresaRaw?.apelido || empresaRaw?.codigo || 'Sua empresa';

    // Gera nova senha + atualiza no Auth
    const senha = gerarSenhaTemporaria(12);
    const { error: updErr } = await admin.auth.admin.updateUserById(clienteId, { password: senha });
    if (updErr) {
      return NextResponse.json({ error: 'Falha ao atualizar senha: ' + updErr.message }, { status: 500 });
    }

    // Envia email
    const portalUrl = resolvePortalUrl(req);
    const { subject, bodyText, bodyHtml } = buildOnboardingEmail({
      empresaNome,
      email: clienteRow.email,
      senhaTemporaria: senha,
      portalUrl,
      contatoNome: clienteRow.nome_contato ?? undefined,
      reenvio: true,
    });

    const sendResult = await sendEmailViaUserGmail(usuarioId, {
      to: [clienteRow.email],
      subject,
      bodyText,
      bodyHtml,
    });

    return NextResponse.json({
      ok: true,
      email_enviado: sendResult.ok,
      email_erro: sendResult.ok ? null : sendResult.error,
      senha_provisoria: sendResult.ok ? null : senha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
