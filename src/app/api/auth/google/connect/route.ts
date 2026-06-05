import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOAuthClient, signState, GMAIL_SCOPES } from '@/lib/googleOAuth';
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
    if (!token) {
      return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }

    // Aceita opcionalmente um `returnTo` (path relativo) que será respeitado
    // pelo callback após a autorização. Sem isso, o callback cai em /obrigacoes.
    const body = await req.json().catch(() => null) as { returnTo?: string } | null;
    const returnTo = typeof body?.returnTo === 'string' && /^\/[A-Za-z0-9_\-/]*$/.test(body.returnTo)
      ? body.returnTo
      : undefined;

    const oauth2 = getOAuthClient();
    const state = signState(data.user.id, 600, returnTo);
    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state,
      include_granted_scopes: true,
    });

    return NextResponse.json({ authUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[oauth/connect] falha ao gerar authUrl');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
