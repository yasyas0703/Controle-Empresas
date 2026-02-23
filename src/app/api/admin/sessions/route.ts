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

async function assertGhostOrDev(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, status: 500, message: 'Supabase env não configurado' };
  }
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: 'Missing Authorization Bearer token' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, message: 'Sessão expirada.' };

  const ghostId = process.env.GHOST_USER_ID;
  const devId = process.env.DEVELOPER_USER_ID;
  if ((!ghostId || data.user.id !== ghostId) && (!devId || data.user.id !== devId)) {
    return { ok: false as const, status: 403, message: 'Acesso negado.' };
  }
  return { ok: true as const, callerId: data.user.id };
}

export async function GET(req: Request) {
  const authz = await assertGhostOrDev(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const admin = getSupabaseAdmin();

  const { data: sessoes, error } = await admin.rpc('listar_sessoes_ativas');
  if (error) return NextResponse.json({ error: 'Erro ao listar sessões.' }, { status: 500 });

  // Buscar nomes dos usuários
  const { data: usuarios } = await admin.from('usuarios').select('id, nome, email');
  const userMap = new Map((usuarios ?? []).map((u: any) => [u.id, u]));

  const ghostId = process.env.GHOST_USER_ID;

  // Deduplicar por userId — manter apenas a sessão mais recente por usuário
  const seenUsers = new Set<string>();
  const resultado: any[] = [];
  for (const s of sessoes ?? []) {
    if (ghostId && s.user_id === ghostId) continue;
    if (seenUsers.has(s.user_id)) continue;
    seenUsers.add(s.user_id);
    const u = userMap.get(s.user_id) as any;
    resultado.push({
      userId: s.user_id,
      nome: u?.nome ?? 'Desconhecido',
      email: u?.email ?? '',
      criadoEm: s.criado_em,
      atualizadoEm: s.atualizado_em,
      userAgent: s.user_agent ?? '',
      ip: s.ip ?? '',
    });
  }

  return NextResponse.json(resultado);
}
