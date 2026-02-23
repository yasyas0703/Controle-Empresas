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

// GET — público, sem auth (AppShell checa antes do login)
export async function GET() {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('configuracoes').select('valor').eq('chave', 'manutencao').maybeSingle();
    console.log('[manutencao GET] data:', data, 'error:', error);
    return NextResponse.json({ ativo: data?.valor === 'true' });
  } catch (e) {
    console.error('[manutencao GET] exception:', e);
    return NextResponse.json({ ativo: false });
  }
}

// POST — somente ghost ou desenvolvedora
export async function POST(req: Request) {
  console.log('[manutencao POST] iniciando...');

  const authz = await assertGhostOrDev(req);
  console.log('[manutencao POST] auth result:', authz);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  let body: { ativo: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  console.log('[manutencao POST] body:', body);

  const admin = getSupabaseAdmin();

  // Verificar se a tabela existe e tem a linha
  const { data: current, error: selectError } = await admin
    .from('configuracoes')
    .select('*')
    .eq('chave', 'manutencao')
    .maybeSingle();
  console.log('[manutencao POST] current row:', current, 'selectError:', selectError);

  const { data: upsertData, error: upsertError } = await admin
    .from('configuracoes')
    .upsert(
      { chave: 'manutencao', valor: String(!!body.ativo), atualizado_em: new Date().toISOString() },
      { onConflict: 'chave' }
    )
    .select();

  console.log('[manutencao POST] upsert result:', upsertData, 'upsertError:', upsertError);

  if (upsertError) {
    return NextResponse.json({ error: `Erro ao salvar: ${upsertError.message}`, detail: upsertError }, { status: 500 });
  }

  // Confirmar lendo de volta
  const { data: verify } = await admin.from('configuracoes').select('valor').eq('chave', 'manutencao').maybeSingle();
  console.log('[manutencao POST] verify after save:', verify);

  return NextResponse.json({ ok: true, ativo: !!body.ativo, savedValue: verify?.valor });
}
