import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const obr of ['LIVROS FISCAIS', 'DEMONSTR. APURAÇÃO']) {
  const { data } = await admin.from('empresa_obrigacoes_config').select('ativa, nao_envia_cliente').eq('obrigacao', obr);
  const total = (data || []).length;
  const ativas = (data || []).filter((r) => r.ativa).length;
  const internas = (data || []).filter((r) => r.ativa && r.nao_envia_cliente).length;
  const enviam = (data || []).filter((r) => r.ativa && !r.nao_envia_cliente).length;
  console.log(`\n${obr}:`);
  console.log(`  configs no total: ${total} | ativas: ${ativas}`);
  console.log(`  ativas marcadas INTERNAS (nao envia): ${internas}`);
  console.log(`  ativas que JA enviam pro cliente:    ${enviam}`);
}
