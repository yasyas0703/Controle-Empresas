import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';

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



const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/admin/users/batch
 * Body: { users: UserPayload[] }
 * 
 * Cria múltiplos usuários em uma única request server-side.
 * UMA ÚNICA verificação de permissão. Delays internos entre criações.
 */
export async function POST(req: Request) {
  // allowPrivileged: false mantém o comportamento original — bulk de
  // usuários não passa pra dev/ghost sem role gerente/admin (operação
  // estritamente administrativa, não automação).
  const authz = await assertManager(req, { allowPrivileged: false });
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
          error = 'Este email já está cadastrado, mas não foi possível localizar o usuário.';
          break;
        }
      }

      // Rate-limit ou erro temporário — tentar novamente
      const isRetryable = msg.includes('rate') || msg.includes('429') || msg.includes('timeout') || msg.includes('503');
      if (!isRetryable && attempt >= 1) {
        error = 'Não foi possível criar este usuário.';
        break;
      }
    }

    // Se conseguiu um userId (criado ou existente), garantir perfil na tabela usuarios
    if (userId) {
      const { error: profileError } = await admin
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
        error = 'Não foi possível criar o perfil do usuário.';
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
