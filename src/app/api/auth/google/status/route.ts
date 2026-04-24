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

export async function GET(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ connected: false });
    }
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ connected: false });

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ connected: false });

    const admin = getSupabaseAdmin();
    const { data: row } = await admin
      .from('usuario_gmail_tokens')
      .select('email, revoked, atualizado_em, last_used_at')
      .eq('usuario_id', data.user.id)
      .maybeSingle();

    if (!row || row.revoked) return NextResponse.json({ connected: false });

    return NextResponse.json({
      connected: true,
      email: row.email,
      conectado_em: row.atualizado_em,
      ultimo_uso: row.last_used_at,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    await admin.from('usuario_gmail_tokens').delete().eq('usuario_id', data.user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
