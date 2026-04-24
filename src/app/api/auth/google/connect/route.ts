import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOAuthClient, signState, GMAIL_SCOPES } from '@/lib/googleOAuth';

export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

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

    const oauth2 = getOAuthClient();
    const state = signState(data.user.id);
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
