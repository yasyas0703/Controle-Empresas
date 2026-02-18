import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
// Aumentar timeout para bulk operations
export const maxDuration = 120; // 2 minutos

type UserPayload = {
  nome: string;
  email: string;
  senha: string;
  role: 'gerente' | 'usuario';
  departamentoId: string | null;
  ativo: boolean;
};

type BatchResult = {
  nome: string;
  email: string;
  id: string | null;
  error: string | null;
  status: 'created' | 'existing' | 'failed';
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function assertManager(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, status: 500, message: 'Supabase env não configurado no servidor' };
  }

  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: 'Missing Authorization Bearer token' };

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, message: 'Token inválido' };

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('id, role, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false as const, status: 500, message: profileError.message };
  if (!profile || !profile.ativo || profile.role !== 'gerente') {
    return { ok: false as const, status: 403, message: 'Apenas gerentes podem executar esta ação' };
  }

  return { ok: true as const, userId: data.user.id };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/admin/users/batch
 * Body: { users: UserPayload[] }
 * 
 * Cria múltiplos usuários em uma única request server-side.
 * UMA ÚNICA verificação de permissão. Delays internos entre criações.
 */
export async function POST(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  let body: { users: UserPayload[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!Array.isArray(body?.users) || body.users.length === 0) {
    return NextResponse.json({ error: 'users[] é obrigatório e não pode ser vazio' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const results: BatchResult[] = [];

  for (let i = 0; i < body.users.length; i++) {
    const u = body.users[i];
    if (!u?.nome?.trim() || !u?.email?.trim() || !u?.senha?.trim()) {
      results.push({ nome: u?.nome || '', email: u?.email || '', id: null, error: 'nome, email e senha são obrigatórios', status: 'failed' });
      continue;
    }

    // Delay entre criações para evitar rate-limit do Supabase Auth
    if (i > 0) await sleep(300);

    let userId: string | null = null;
    let status: BatchResult['status'] = 'created';
    let error: string | null = null;

    // Tentar criar no Auth (com retry)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(500 * attempt);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: u.email.trim(),
        password: u.senha,
        email_confirm: true,
      });

      if (!createError && created.user) {
        userId = created.user.id;
        break;
      }

      // Se email já existe, reutilizar
      const msg = String(createError?.message || '').toLowerCase();
      const isDuplicate = msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists');

      if (isDuplicate) {
        // Buscar o ID existente no Auth
        const existingId = await findAuthUserByEmail(admin, u.email.trim());
        if (existingId) {
          userId = existingId;
          status = 'existing';
          break;
        } else {
          error = 'Email já existe no Auth, mas não foi possível localizar o usuário';
          break;
        }
      }

      // Rate-limit ou erro temporário — tentar novamente
      const isRetryable = msg.includes('rate') || msg.includes('429') || msg.includes('timeout') || msg.includes('503');
      if (!isRetryable && attempt >= 1) {
        error = createError?.message || 'Falha desconhecida';
        break;
      }
    }

    // Se conseguiu um userId (criado ou existente), garantir perfil na tabela usuarios
    if (userId) {
      const { data: profile, error: profileError } = await admin
        .from('usuarios')
        .upsert(
          {
            id: userId,
            nome: u.nome.trim(),
            email: u.email.trim(),
            role: u.role ?? 'usuario',
            departamento_id: u.departamentoId,
            ativo: u.ativo ?? true,
          },
          { onConflict: 'id' }
        )
        .select('id')
        .single();

      if (profileError) {
        error = `Auth OK, mas perfil falhou: ${profileError.message}`;
        status = 'failed';
        userId = null;
      }
    } else if (!error) {
      error = 'Falha ao criar usuário após 3 tentativas';
      status = 'failed';
    }

    results.push({
      nome: u.nome.trim(),
      email: u.email.trim(),
      id: userId,
      error,
      status: error && !userId ? 'failed' : status,
    });
  }

  const created = results.filter((r) => r.status === 'created').length;
  const existing = results.filter((r) => r.status === 'existing').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({ results, summary: { total: results.length, created, existing, failed } });
}

async function findAuthUserByEmail(admin: ReturnType<typeof getSupabaseAdmin>, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((u) => String(u.email || '').trim().toLowerCase() === target);
    if (match?.id) return match.id;
    if (users.length < perPage) break;
  }
  return null;
}
