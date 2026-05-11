import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente Supabase para o **portal do cliente** (rotas /portal/*).
// Usa storageKey separado para que a sessão do cliente NÃO conflite
// com a sessão interna das usuárias do escritório.
//
// As duas chaves podem coexistir em paralelo no mesmo localStorage:
//   - 'controle-triar-auth'         → sessão das meninas (sistema interno)
//   - 'controle-triar-portal-auth'  → sessão do cliente final (portal)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let _client: SupabaseClient | null = null;

type AuthStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMemoryStorage(): AuthStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function getAuthStorage(): AuthStorage {
  if (typeof window === 'undefined') return createMemoryStorage();
  try {
    const probeKey = '__controle-triar-portal-auth-probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

export function getSupabasePortal(): SupabaseClient {
  if (!_client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase nao configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local');
    }
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: getAuthStorage(),
        persistSession: true,
        storageKey: 'controle-triar-portal-auth',
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}

export const supabasePortal = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return Reflect.get(getSupabasePortal() as object, prop);
  },
});
