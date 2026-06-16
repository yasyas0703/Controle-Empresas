import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBearerToken } from '@/lib/apiAuth';

export const runtime = 'nodejs';



export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
    if (!body?.endpoint) {
      return NextResponse.json({ error: 'Endpoint obrigatório.' }, { status: 400 });
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
    // BUG anterior: filtrava cliente_id = userId (auth_user_id), mas cliente_id
    // é o clientes_portal.id — nunca casava, então o unsubscribe deletava 0
    // linhas (o cliente continuava recebendo push). Resolve as linhas de cliente
    // do user (pode ter várias em multi-empresa) e deleta por elas + endpoint.
    const { data: clienteRows } = await admin
      .from('clientes_portal')
      .select('id')
      .eq('auth_user_id', userId);
    const clienteIds = (clienteRows ?? []).map((r) => r.id);
    if (clienteIds.length > 0) {
      await admin
        .from('portal_push_subscriptions')
        .delete()
        .in('cliente_id', clienteIds)
        .eq('endpoint', body.endpoint);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/unsubscribe] erro:', err);
    return NextResponse.json({ error: 'Não foi possível desativar as notificações agora.' }, { status: 500 });
  }
}
