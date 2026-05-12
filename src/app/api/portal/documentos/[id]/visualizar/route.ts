import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const { id: documentoId } = await params;

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const userId = authData.user.id;

    const admin = getSupabaseAdmin();

    const { data: doc } = await admin
      .from('portal_documentos')
      .select('id, empresa_id, visualizado_em, removido_em')
      .eq('id', documentoId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Guia não encontrada' }, { status: 404 });
    if (doc.removido_em) {
      return NextResponse.json({ error: 'Guia removida.' }, { status: 410 });
    }

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

    const nowIso = new Date().toISOString();

    // Insere log de visualização (await pra garantir persistência)
    await admin.from('portal_acessos').insert({
      cliente_id: clienteRow.id,
      documento_id: documentoId,
      acao: 'visualizou',
      ip: getClientIp(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    });

    // Marca visualizado_em só na primeira vez (não sobrescreve)
    if (!doc.visualizado_em) {
      await admin
        .from('portal_documentos')
        .update({ visualizado_em: nowIso })
        .eq('id', documentoId);
    }

    return NextResponse.json({ ok: true, visualizado_em: doc.visualizado_em ?? nowIso });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
