// Remove os RELATÓRIOS que o seed-relatorios.mjs carregou — limpa relatorio_url/
// relatorio_nome do checklist_cadastro e apaga os PDFs do Storage.
//   - célula que tem OUTROS dados (certidão / resultado / status / observação /
//     envio): só limpa o relatório (mantém a célula);
//   - célula que SÓ tinha o relatório: apaga a linha inteira.
//
// Uso:
//   node scripts/remove-relatorios.mjs                 # DRY-RUN
//   node scripts/remove-relatorios.mjs --apply
//   node scripts/remove-relatorios.mjs --mes 2026-06 --certidao FEDERAL

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const APPLY = args.includes('--apply');
const MES = (() => { const m = argVal('--mes'); return m && /^\d{4}-\d{2}$/.test(m) ? m : '2026-06'; })();
const CERTIDAO = argVal('--certidao') || 'FEDERAL';

function loadEnv() {
  const env = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (process.env[k]) env[k] = process.env[k];
  return env;
}
const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('ERRO: env do Supabase faltando'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const temEnvio = (e) => Array.isArray(e) && e.length > 0;
const temOutrosDados = (c) => !!c.arquivo_url || !!c.resultado || !!c.status || !!(c.observacao && String(c.observacao).trim()) || temEnvio(c.envios_historico);

// carrega as células com relatório
const cels = [];
let off = 0;
for (;;) {
  const { data, error } = await sb.from('checklist_cadastro')
    .select('id,empresa_id,arquivo_url,relatorio_url,relatorio_nome,resultado,status,observacao,envios_historico')
    .eq('mes', MES).eq('certidao', CERTIDAO).not('relatorio_nome', 'is', null).range(off, off + 999);
  if (error) { console.error('Erro ao ler:', error.message); process.exit(1); }
  cels.push(...data); if (data.length < 1000) break; off += 1000;
}

const aLimpar = cels.filter(temOutrosDados);   // mantém a célula, só tira o relatório
const aApagar = cels.filter((c) => !temOutrosDados(c)); // apaga a linha (só tinha relatório)
const paths = cels.map((c) => c.relatorio_url).filter(Boolean);

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Remover RELATÓRIOS — mês ${MES} · coluna ${CERTIDAO}`);
console.log(`  Modo: ${APPLY ? 'APLICAR' : 'DRY-RUN'}`);
console.log('═══════════════════════════════════════════════════════');
console.log(`  Células com relatório:        ${cels.length}`);
console.log(`  → manter célula, tirar relat: ${aLimpar.length}`);
console.log(`  → apagar linha (só relat):    ${aApagar.length}`);
console.log(`  PDFs no Storage a apagar:     ${paths.length}`);

if (!APPLY) { console.log('\n  DRY-RUN. Rode com --apply pra remover.'); process.exit(0); }

// 1. apaga os PDFs do Storage (em lotes)
let removidosStorage = 0;
for (let i = 0; i < paths.length; i += 100) {
  const lote = paths.slice(i, i + 100);
  const { error } = await sb.storage.from('documentos').remove(lote);
  if (error) console.error('  ! falha ao apagar lote do storage:', error.message);
  else removidosStorage += lote.length;
}

// 2. limpa o relatório das células que têm outros dados
let limpas = 0;
for (let i = 0; i < aLimpar.length; i += 200) {
  const ids = aLimpar.slice(i, i + 200).map((c) => c.id);
  const { error } = await sb.from('checklist_cadastro')
    .update({ relatorio_url: null, relatorio_nome: null, atualizado_em: new Date().toISOString() })
    .in('id', ids);
  if (error) console.error('  ! falha ao limpar:', error.message); else limpas += ids.length;
}

// 3. apaga as linhas que só tinham relatório
let apagadas = 0;
for (let i = 0; i < aApagar.length; i += 200) {
  const ids = aApagar.slice(i, i + 200).map((c) => c.id);
  const { error } = await sb.from('checklist_cadastro').delete().in('id', ids);
  if (error) console.error('  ! falha ao apagar:', error.message); else apagadas += ids.length;
}

console.log('');
console.log(`  ✓ Storage: ${removidosStorage} PDF(s) apagados.`);
console.log(`  ✓ Células limpas (mantidas): ${limpas}.`);
console.log(`  ✓ Linhas apagadas (só relat): ${apagadas}.`);
