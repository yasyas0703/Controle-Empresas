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

interface Payload {
  // 'marcar' = registrar como pago, 'desmarcar' = desfazer.
  acao: 'marcar' | 'desmarcar';
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
    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body || (body.acao !== 'marcar' && body.acao !== 'desmarcar')) {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const userId = authData.user.id;

    const admin = getSupabaseAdmin();

    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id, empresa_id, ativo')
      .eq('id', userId)
      .maybeSingle();
    if (!clienteRow || !clienteRow.ativo) {
      return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    const { data: doc } = await admin
      .from('portal_documentos')
      .select('id, empresa_id, marcado_pago_em, removido_em')
      .eq('id', documentoId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Guia não encontrada' }, { status: 404 });
    if (doc.empresa_id !== clienteRow.empresa_id) {
      return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }
    if (doc.removido_em) {
      return NextResponse.json({ error: 'Guia removida.' }, { status: 410 });
    }

    const novoValor = body.acao === 'marcar' ? new Date().toISOString() : null;

    const { error: updErr } = await admin
      .from('portal_documentos')
      .update({ marcado_pago_em: novoValor })
      .eq('id', documentoId);
    if (updErr) {
      return NextResponse.json({ error: 'Falha ao atualizar status.' }, { status: 500 });
    }

    // Log
    await admin.from('portal_acessos').insert({
      cliente_id: userId,
      documento_id: documentoId,
      acao: body.acao === 'marcar' ? 'marcou_pago' : 'desmarcou_pago',
      ip: getClientIp(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    });

    return NextResponse.json({ ok: true, marcado_pago_em: novoValor });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
