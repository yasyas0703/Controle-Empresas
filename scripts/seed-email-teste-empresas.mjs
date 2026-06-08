// Semeia um email de TESTE como destinatário em todas as empresas, pra testar
// os envios do Checklist Fiscal sem precisar cadastrar cliente real.
//
// Os envios leem destinatários de `empresa_emails_cliente` (rows com ativo=true).
// Este script insere 1 row por empresa com rotulo='TESTE' — fácil de localizar e
// desfazer depois (é provisório).
//
// Uso:
//   node scripts/seed-email-teste-empresas.mjs              # DRY-RUN (só mostra o que faria)
//   node scripts/seed-email-teste-empresas.mjs --apply      # insere de verdade (só cadastradas)
//   node scripts/seed-email-teste-empresas.mjs --apply --todas   # inclui empresas não-cadastradas
//   node scripts/seed-email-teste-empresas.mjs --revert     # apaga TODAS as rows de teste (rollback)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EMAIL_TESTE = 'yasminteodoro0703@gmail.com';
const ROTULO = 'TESTE'; // marca pra localizar/reverter sem tocar em email de cliente real

// Lê .env.local manualmente (sem dotenv) — mesmo padrão dos outros scripts
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
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
}

const argv = process.argv.slice(2);
const REVERT = argv.includes('--revert');
const APPLY = argv.includes('--apply');
const TODAS = argv.includes('--todas');
const DRY = !APPLY && !REVERT;

async function main() {
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

  // ─── ROLLBACK ────────────────────────────────────────────────────────────
  if (REVERT) {
    const { data, error } = await admin
      .from('empresa_emails_cliente')
      .delete()
      .eq('email', EMAIL_TESTE)
      .eq('rotulo', ROTULO)
      .select('id');
    if (error) { console.error('Erro no revert:', error.message); process.exit(1); }
    console.log(`Rollback: ${data?.length ?? 0} rows de teste apagadas.`);
    return;
  }

  // ─── Empresas ────────────────────────────────────────────────────────────
  const { data: empresas, error: empErr } = await admin
    .from('empresas')
    .select('id, codigo, apelido, razao_social, cadastrada');
  if (empErr) { console.error('Erro ao ler empresas:', empErr.message); process.exit(1); }

  const cadastradas = empresas.filter((e) => e.cadastrada);
  const alvo = TODAS ? empresas : cadastradas;

  // Não duplicar: pula empresas que já têm o email de teste
  const { data: existentes, error: exErr } = await admin
    .from('empresa_emails_cliente')
    .select('empresa_id')
    .eq('email', EMAIL_TESTE);
  if (exErr) { console.error('Erro ao ler emails existentes:', exErr.message); process.exit(1); }
  const jaTem = new Set((existentes ?? []).map((r) => r.empresa_id));

  const aInserir = alvo.filter((e) => !jaTem.has(e.id));

  console.log('─────────────────────────────────────────────');
  console.log(`Email de teste:        ${EMAIL_TESTE}`);
  console.log(`Empresas no banco:     ${empresas.length}`);
  console.log(`  cadastradas:         ${cadastradas.length}`);
  console.log(`Alvo (${TODAS ? 'TODAS' : 'só cadastradas'}):   ${alvo.length}`);
  console.log(`Já tinham o email:     ${alvo.length - aInserir.length}`);
  console.log(`A inserir agora:       ${aInserir.length}`);
  console.log('─────────────────────────────────────────────');

  if (DRY) {
    console.log('DRY-RUN — nada foi gravado.');
    console.log('  Rode com --apply pra inserir (--apply --todas inclui não-cadastradas).');
    console.log('  Depois, --revert apaga tudo que tiver rotulo "TESTE".');
    return;
  }

  if (aInserir.length === 0) {
    console.log('Nada a inserir. Todas as empresas-alvo já têm o email de teste.');
    return;
  }

  // Espelha o insert do app: só empresa_id, email, rotulo, principal, ativo.
  // id / criado_em / atualizado_em ficam com os defaults do banco.
  const rows = aInserir.map((e) => ({
    empresa_id: e.id,
    email: EMAIL_TESTE,
    rotulo: ROTULO,
    principal: true,
    ativo: true,
  }));

  let inseridos = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error: insErr } = await admin.from('empresa_emails_cliente').insert(chunk);
    if (insErr) {
      console.error(`Erro inserindo chunk ${i}-${i + chunk.length}:`, insErr.message);
      console.error(`Parcial: ${inseridos} inseridos antes do erro. Rode --revert pra limpar.`);
      process.exit(1);
    }
    inseridos += chunk.length;
  }

  console.log(`OK — ${inseridos} rows inseridas (rotulo "TESTE").`);
  console.log('Pra desfazer depois: node scripts/seed-email-teste-empresas.mjs --revert');
}

main().catch((err) => {
  console.error('Falha inesperada:', err);
  process.exit(1);
});
