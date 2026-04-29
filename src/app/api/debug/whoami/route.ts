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

interface JwtPayload {
  sub?: string;
  role?: string;
  aud?: string;
  exp?: number;
  email?: string;
  [k: string]: unknown;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(padded, 'base64');
    return JSON.parse(buf.toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase env missing' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'sem bearer token — adicione ?token=... ou faça com fetch incluindo Authorization' }, { status: 401 });
  }

  const jwt = decodeJwt(token);

  // Cliente "como o usuário" — usa anon key + token; passa por RLS
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authUser, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authUser.user) {
    return NextResponse.json({ error: 'token inválido', detail: authErr?.message }, { status: 401 });
  }

  const userId = authUser.user.id;

  // 1. Linha do user na tabela usuarios (lendo COMO O USER, passa por RLS de SELECT)
  const usuarioComoUser = await userClient
    .from('usuarios')
    .select('id, email, role, ativo')
    .eq('id', userId)
    .maybeSingle();

  // 2. Linha do user lida com service-role (bypassa RLS — verdade absoluta)
  const admin = getSupabaseAdmin();
  const usuarioReal = await admin
    .from('usuarios')
    .select('id, email, role, ativo')
    .eq('id', userId)
    .maybeSingle();

  // 3. Tentar um UPDATE no-op em obrigacoes pra ver se RLS deixa
  //    Pega a primeira obrigação que existir, atualiza só `atualizado_em`
  const obr = await admin.from('obrigacoes').select('id').limit(1).maybeSingle();
  let updateTeste: { ok: boolean; rows: number; erro: string | null } = { ok: false, rows: 0, erro: null };
  if (obr.data?.id) {
    const upd = await userClient
      .from('obrigacoes')
      .update({ atualizado_em: new Date().toISOString() })
      .eq('id', obr.data.id)
      .select('id');
    updateTeste = {
      ok: !upd.error && (upd.data?.length ?? 0) > 0,
      rows: upd.data?.length ?? 0,
      erro: upd.error ? `${upd.error.code ?? ''} ${upd.error.message ?? ''} ${upd.error.details ?? ''}`.trim() : null,
    };
  }

  // 4. Tentar chamar whoami_debug se existir
  let rpc: unknown = null;
  try {
    const r = await userClient.rpc('whoami_debug');
    rpc = r.error ? { erro: r.error.message } : r.data;
  } catch (e) {
    rpc = { erro: e instanceof Error ? e.message : 'rpc falhou' };
  }

  return NextResponse.json({
    auth_user: {
      id: authUser.user.id,
      email: authUser.user.email,
    },
    jwt_decoded: {
      sub: jwt?.sub,
      role: jwt?.role,
      aud: jwt?.aud,
      email: jwt?.email,
      exp: jwt?.exp ? new Date(jwt.exp * 1000).toISOString() : null,
      expirado: jwt?.exp ? Date.now() / 1000 > jwt.exp : null,
    },
    usuarios_lido_como_user: usuarioComoUser.data ?? { erro: usuarioComoUser.error?.message ?? 'sem linha visível' },
    usuarios_lido_real: usuarioReal.data ?? { erro: usuarioReal.error?.message ?? 'sem linha real' },
    update_obrigacoes_teste: updateTeste,
    whoami_rpc: rpc,
  });
}
