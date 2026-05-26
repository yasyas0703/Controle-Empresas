import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isUuid } from '@/lib/uuid';

export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

interface Payload {
  ativo: boolean;
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
    if (!isUuid(clienteId)) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body || typeof body.ativo !== 'boolean') {
      return NextResponse.json({ error: 'Campo `ativo` (boolean) obrigatório.' }, { status: 400 });
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
      return NextResponse.json({ error: 'Apenas gerente/admin.' }, { status: 403 });
    }

    const { error: updErr } = await admin
      .from('clientes_portal')
      .update({ ativo: body.ativo })
      .eq('id', clienteId);
    if (updErr) {
      // Se reativação bater no unique partial index (empresa já tem outro ativo)
      const msg = updErr.message || 'Falha ao atualizar.';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ativo: body.ativo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
