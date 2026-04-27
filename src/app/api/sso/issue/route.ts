import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function getAuthenticatedUserEmail(req: Request): Promise<
  { ok: true; email: string } | { ok: false; status: number; message: string }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, message: 'Supabase env nao configurado no servidor' };
  }

  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, message: 'Token de autenticacao ausente' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: 'Sessao expirada. Faca login novamente.' };

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('email, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false, status: 500, message: 'Erro interno ao validar usuario' };
  if (!profile) return { ok: false, status: 403, message: 'Perfil de usuario nao encontrado' };
  if (!profile.ativo) return { ok: false, status: 403, message: 'Usuario inativo' };

  const email = String(profile.email || data.user.email || '').trim().toLowerCase();
  if (!email) return { ok: false, status: 400, message: 'Email do usuario nao disponivel' };

  return { ok: true, email };
}

export async function POST(req: Request) {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) {
    console.error('[SSO] SSO_SHARED_SECRET nao configurado');
    return NextResponse.json({ error: 'SSO nao configurado neste servidor' }, { status: 500 });
  }

  const auth = await getAuthenticatedUserEmail(req);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: auth.email,
    iat: now,
    exp: now + 60,
    nonce: crypto.randomBytes(16).toString('hex'),
    source: 'controle-empresas',
  };

  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = b64urlEncode(sig);
  const ssoToken = `${payloadB64}.${sigB64}`;

  const tarefasUrl = process.env.NEXT_PUBLIC_TAREFAS_URL || 'https://controle-tarefas.vercel.app';
  const ssoUrl = `${tarefasUrl.replace(/\/$/, '')}/sso?token=${encodeURIComponent(ssoToken)}`;

  return NextResponse.json({ token: ssoToken, ssoUrl });
}
