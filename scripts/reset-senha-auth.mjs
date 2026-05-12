// Reseta a senha de um user no auth.users via Supabase Admin API.
// Uso: node scripts/reset-senha-auth.mjs <email> <nova-senha>
// Exemplo: node scripts/reset-senha-auth.mjs yasminteodoro0703@gmail.com teste12345

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lê .env.local manualmente (sem dotenv)
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  try {
    const text = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
    return env;
  } catch (err) {
    console.error('Não consegui ler .env.local:', err.message);
    process.exit(1);
  }
}

async function main() {
  const [, , email, novaSenha] = process.argv;
  if (!email || !novaSenha) {
    console.error('Uso: node scripts/reset-senha-auth.mjs <email> <nova-senha>');
    process.exit(1);
  }

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Procura o user pelo email
  const { data: lista, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.error('Falha ao listar users:', listErr.message);
    process.exit(1);
  }
  const user = lista.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`Usuário ${email} não existe em auth.users.`);
    process.exit(1);
  }

  console.log(`User encontrado: ${user.id}  email=${user.email}`);

  // 2) Atualiza senha + garante email confirmado
  const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
    password: novaSenha,
    email_confirm: true,
  });
  if (updErr) {
    console.error('Falha ao resetar senha:', updErr.message);
    process.exit(1);
  }

  console.log(`✓ Senha resetada pra "${novaSenha}".`);

  // 3) Testa logando com a senha nova
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signin, error: signErr } = await anon.auth.signInWithPassword({
      email,
      password: novaSenha,
    });
    if (signErr) {
      console.error('✗ Login de teste FALHOU:', signErr.message);
      process.exit(1);
    }
    console.log(`✓ Login de teste OK — user.id = ${signin.user?.id}`);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
