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

interface SubscribePayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
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

    const body = (await req.json().catch(() => null)) as SubscribePayload | null;
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return NextResponse.json({ error: 'Subscription inválida.' }, { status: 400 });
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
    // Pega a 1ª linha ativa do user (em multi-empresa, qualquer uma serve —
    // a subscription é por dispositivo, e o webPush.ts envia pra todas as
    // empresas do mesmo auth_user).
    const { data: clienteRow } = await admin
      .from('clientes_portal')
      .select('id')
      .eq('auth_user_id', userId)
      .eq('ativo', true)
      .order('criado_em', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!clienteRow) {
      return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    // Upsert por endpoint (re-registrar com mesmo endpoint atualiza chaves)
    const { error: upsertErr } = await admin
      .from('portal_push_subscriptions')
      .upsert(
        {
          cliente_id: clienteRow.id,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
          ultimo_uso_em: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );

    if (upsertErr) {
      console.error('[push/subscribe] erro:', upsertErr);
      return NextResponse.json({ error: 'Falha ao registrar inscrição.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
