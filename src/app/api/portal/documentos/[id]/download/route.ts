import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET = 'portal-documentos';
const SIGNED_URL_EXPIRES = 60; // segundos — link de download tem validade curta

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function getClientIp(req: Request): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const { id: documentoId } = await params;

    // 1. Valida token e identifica o cliente
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const userId = authData.user.id;

    const admin = getSupabaseAdmin();

    // 2. Carrega o documento (precisamos do empresa_id pra validar acesso)
    const { data: doc } = await admin
      .from('portal_documentos')
      .select('id, empresa_id, arquivo_storage_path, arquivo_nome_original, baixado_em, removido_em')
      .eq('id', documentoId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Guia não encontrada' }, { status: 404 });
    if (doc.removido_em) {
      return NextResponse.json({ error: 'Esta guia foi removida pelo escritório.' }, { status: 410 });
    }

    // 3. Valida que o user tem acesso ativo à empresa deste documento
    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id')
      .eq('auth_user_id', userId)
      .eq('empresa_id', doc.empresa_id)
      .eq('ativo', true)
      .maybeSingle();
    if (!clienteRow) {
      return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    // 4. Gera signed URL com download forçado (Content-Disposition: attachment)
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.arquivo_storage_path, SIGNED_URL_EXPIRES, {
        download: doc.arquivo_nome_original,
      });
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Falha ao gerar link de download.' }, { status: 500 });
    }

    // 5. Registra acesso (await pra garantir que persiste em dev mode)
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;
    const nowIso = new Date().toISOString();

    // Carrega visualizado_em pra decidir se devemos setar também
    const { data: docMeta } = await admin
      .from('portal_documentos')
      .select('visualizado_em')
      .eq('id', documentoId)
      .maybeSingle();

    // Log do acesso
    await admin.from('portal_acessos').insert({
      cliente_id: clienteRow.id,
      documento_id: documentoId,
      acao: 'baixou',
      ip,
      user_agent: userAgent,
    });

    // Marca baixado_em (primeira vez) + visualizado_em (se ainda null —
    // baixar implica visualizar).
    const updates: Record<string, string> = {};
    if (!doc.baixado_em) updates.baixado_em = nowIso;
    if (!docMeta?.visualizado_em) updates.visualizado_em = nowIso;
    if (Object.keys(updates).length > 0) {
      await admin.from('portal_documentos').update(updates).eq('id', documentoId);
    }

    return NextResponse.json({
      url: signed.signedUrl,
      filename: doc.arquivo_nome_original,
      expiresIn: SIGNED_URL_EXPIRES,
      baixado_em: doc.baixado_em ?? updates.baixado_em ?? null,
      visualizado_em: docMeta?.visualizado_em ?? updates.visualizado_em ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
