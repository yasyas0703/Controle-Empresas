// Simula o que o daemon vai fazer: pega um PDF do T:, calcula SHA-256,
// faz POST multipart pro endpoint /api/checklist-fiscal/auto-enviar.
//
// Uso:
//   node scripts/testar-auto-enviar.mjs "T:\Fiscal\EMPRESA\NOMEEMPRESA\FECHAMENTO\2026\04\2026-04 ICMS NORMAL.pdf"
//   node scripts/testar-auto-enviar.mjs "T:\Fiscal\..." --url https://controle-triar.vercel.app
//
// Por padrão usa http://localhost:3000 (precisa npm run dev rodando).
// Pra mirar produção, passa --url <url>.
//
// Lê AUTO_ENVIO_TOKEN do .env.local automaticamente.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const caminhoArg = args.find((a) => !a.startsWith('--'));
const urlArg = (() => {
  const i = args.indexOf('--url');
  return i >= 0 ? args[i + 1] : null;
})();

if (!caminhoArg) {
  console.error('❌ Faltou o caminho do PDF.');
  console.error('Uso: node scripts/testar-auto-enviar.mjs "T:\\Fiscal\\EMPRESA\\NOMEEMPRESA\\FECHAMENTO\\2026\\04\\2026-04 ICMS NORMAL.pdf"');
  process.exit(1);
}

if (!existsSync(caminhoArg)) {
  console.error(`❌ Arquivo não existe: ${caminhoArg}`);
  process.exit(1);
}

if (!statSync(caminhoArg).isFile()) {
  console.error(`❌ Não é arquivo: ${caminhoArg}`);
  process.exit(1);
}

// ─── Carrega env do .env.local ─────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) {
    console.error(`❌ Não achei .env.local em ${envPath}`);
    process.exit(1);
  }
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

const env = loadEnv();
const token = env.AUTO_ENVIO_TOKEN;
if (!token) {
  console.error('❌ AUTO_ENVIO_TOKEN não encontrado em .env.local.');
  console.error('   Adicione: AUTO_ENVIO_TOKEN=<seu_token>');
  process.exit(1);
}

const baseUrl = urlArg || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const apiUrl = `${baseUrl.replace(/\/+$/, '')}/api/checklist-fiscal/auto-enviar`;

// ─── Lê arquivo e calcula hash ─────────────────────────────────────────────
const fileBuffer = readFileSync(caminhoArg);
const hash = createHash('sha256').update(fileBuffer).digest('hex');
const nomeArquivo = basename(caminhoArg);

console.log('\n=== TESTE AUTO-ENVIAR ===\n');
console.log(`Caminho:    ${caminhoArg}`);
console.log(`Arquivo:    ${nomeArquivo}`);
console.log(`Tamanho:    ${(fileBuffer.length / 1024).toFixed(1)} KB`);
console.log(`SHA-256:    ${hash}`);
console.log(`Endpoint:   ${apiUrl}`);
console.log(`Token:      ${token.slice(0, 8)}...${token.slice(-4)}`);
console.log('');

// ─── Monta multipart e envia ───────────────────────────────────────────────
const form = new FormData();
const blob = new Blob([fileBuffer], { type: 'application/pdf' });
form.append('arquivo', blob, nomeArquivo);
form.append('meta', JSON.stringify({
  caminhoServidor: caminhoArg,
  hash,
}));

console.log('⏳ Enviando...\n');
const start = Date.now();

try {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'X-Machine-Token': token },
    body: form,
  });
  const elapsed = Date.now() - start;
  const json = await res.json().catch(() => null);

  console.log(`Status HTTP: ${res.status} (${elapsed}ms)\n`);

  if (!json) {
    console.error('❌ Resposta não é JSON. Texto bruto:');
    console.error(await res.text());
    process.exit(1);
  }

  // Cor por status
  const cores = {
    enviado: '\x1b[32m✅',
    ja_processado: '\x1b[36mℹ️ ',
    pendente_correcao: '\x1b[33m⚠️ ',
    pendente_aprovacao_primeira_vez: '\x1b[33m🔒',
    duplicado_periodo: '\x1b[36m🔁',
    interno_marcado_feito: '\x1b[32m✅',
    erro: '\x1b[31m❌',
  };
  const cor = cores[json.status] || '\x1b[37m';

  console.log(`${cor} STATUS: ${json.status?.toUpperCase()}\x1b[0m\n`);
  console.log('Detalhes:');
  console.log(JSON.stringify(json.detalhes ?? {}, null, 2));
  console.log('');

  // Mostra dica de próximo passo
  if (json.status === 'enviado') {
    console.log('🎉 Email enviado! Confere a inbox dos destinatários.');
    console.log('💡 Ver no Supabase: SELECT * FROM guias_auto_processadas ORDER BY processado_em DESC LIMIT 1;');
  } else if (json.status === 'pendente_correcao' || json.status === 'pendente_aprovacao_primeira_vez') {
    console.log('💡 Vai ficar registrado em guias_auto_problemas (vai aparecer no widget do dashboard quando criarmos).');
    console.log('   SELECT * FROM guias_auto_problemas WHERE resolvido_em IS NULL ORDER BY detectado_em DESC LIMIT 1;');
  } else if (json.status === 'ja_processado') {
    console.log('ℹ️  Mesmo arquivo (path+hash) já tinha sido processado antes — idempotência funcionou.');
  } else if (json.status === 'duplicado_periodo') {
    console.log('ℹ️  Essa empresa+mes+obrigação já foi enviada antes — guard duplicado funcionou.');
  } else if (json.status === 'erro') {
    console.log('❌ Erro técnico — veja os detalhes acima. Pode ser problema no servidor.');
    process.exit(1);
  }

  process.exit(0);
} catch (err) {
  console.error(`❌ Falha ao chamar endpoint:`, err.message);
  if (err.cause) console.error('Causa:', err.cause);
  console.error('\nDicas:');
  console.error(`  - npm run dev está rodando? (${baseUrl})`);
  console.error('  - URL correta? Use --url se for outra que não localhost.');
  process.exit(1);
}
