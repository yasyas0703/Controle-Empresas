// Importa os RELATÓRIOS de situação fiscal FEDERAL (Receita Federal/PGFN —
// "Informações de apoio para emissão de certidão") pro campo `relatorio` da
// coluna FEDERAL do checklist_cadastro. Quando a certidão é positiva/com débitos,
// o que vai pro cliente é esse relatório (não a certidão).
//
// Pasta: T:\Office\PARCELAMENTOS\RELATORIOS\<MM.YYYY>
// Casa por CNPJ: do NOME do arquivo (situacaofiscal-...-<CNPJ14>-<timestamp>-n.pdf)
// ou, nos informais (ELEMAR.pdf), do TEXTO do PDF (via pdftotext).
// Sobe o PDF no Storage (bucket documentos) e grava relatorio_url/relatorio_nome.
//
// Uso:
//   node scripts/seed-relatorios.mjs                 # DRY-RUN (não sobe nem grava)
//   node scripts/seed-relatorios.mjs --apply         # sobe os PDFs e grava
//   node scripts/seed-relatorios.mjs --mes 2026-06
//   node scripts/seed-relatorios.mjs --certidao FEDERAL   # coluna alvo (default FEDERAL)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const APPLY = args.includes('--apply');
const MES = (() => { const m = argVal('--mes'); return m && /^\d{4}-\d{2}$/.test(m) ? m : '2026-06'; })();
const CERTIDAO = argVal('--certidao') || 'FEDERAL';
const RELATORIOS_ROOT = process.env.RELATORIOS_ROOT || 'T:\\Office\\PARCELAMENTOS\\RELATORIOS';
const DIR = argVal('--dir') || join(RELATORIOS_ROOT, `${MES.slice(5)}.${MES.slice(0, 4)}`);

function loadEnv() {
  const env = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RELATORIOS_ROOT']) if (process.env[k]) env[k] = process.env[k];
  return env;
}
const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY faltando'); process.exit(1); }
if (!existsSync(DIR)) { console.error('ERRO: pasta não encontrada:', DIR); process.exit(1); }

const soDig = (s) => (s || '').replace(/\D/g, '');

function cnpjDoNome(nome) {
  // primeiro grupo de 14 dígitos (o CNPJ vem antes do timestamp no padrão situacaofiscal-)
  const m = nome.match(/\d{14}/);
  return m ? m[0] : null;
}
function cnpjsDoTexto(caminho) {
  // fallback p/ informais: extrai CNPJs completos do texto via pdftotext
  try {
    const txt = execFileSync('pdftotext', ['-layout', caminho, '-'], { encoding: 'latin1', maxBuffer: 20 * 1024 * 1024 });
    const ms = txt.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) || [];
    return [...new Set(ms.map(soDig))];
  } catch { return []; }
}

// ─── empresas (cnpj → empresa) ────────────────────────────────────────────────
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const empresasPorCnpj = new Map();
{
  let off = 0;
  for (;;) {
    const { data, error } = await sb.from('empresas').select('id,cnpj,razao_social,apelido').range(off, off + 999);
    if (error) { console.error('Erro empresas:', error.message); process.exit(1); }
    for (const e of data || []) { const d = soDig(e.cnpj); if (d.length === 14) empresasPorCnpj.set(d, e); }
    if (!data || data.length < 1000) break; off += 1000;
  }
}

// ─── varre a pasta e casa ──────────────────────────────────────────────────────
const arquivos = readdirSync(DIR).filter((n) => /\.pdf$/i.test(n));
const casados = [];   // {nome, caminho, empresa, via}
const naoCasou = [];
let viaNome = 0, viaTexto = 0;
for (const nome of arquivos) {
  const caminho = join(DIR, nome);
  let empresa = null, via = null;
  const cn = cnpjDoNome(nome);
  if (cn && empresasPorCnpj.has(cn)) { empresa = empresasPorCnpj.get(cn); via = 'nome'; viaNome++; }
  if (!empresa) {
    for (const c of cnpjsDoTexto(caminho)) { if (empresasPorCnpj.has(c)) { empresa = empresasPorCnpj.get(c); via = 'texto'; viaTexto++; break; } }
  }
  if (empresa) casados.push({ nome, caminho, empresa, via });
  else naoCasou.push({ nome });
}

// ─── relatório ─────────────────────────────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Importação de RELATÓRIOS (situação fiscal) — mês ${MES} → coluna ${CERTIDAO}`);
console.log(`  Pasta: ${DIR}`);
console.log(`  Modo: ${APPLY ? 'APLICAR (sobe PDFs + grava)' : 'DRY-RUN'}`);
console.log('═══════════════════════════════════════════════════════');
console.log(`  PDFs na pasta:    ${arquivos.length}`);
console.log(`  Casados:          ${casados.length}  (por nome ${viaNome} · por texto ${viaTexto})`);
console.log(`  Não casaram:      ${naoCasou.length}`);
for (const r of naoCasou) console.log(`    ✗ ${r.nome}`);

if (!APPLY) { console.log('\n  DRY-RUN. Rode com --apply pra subir os PDFs e gravar.'); process.exit(0); }

// ─── aplica: upload + upsert ────────────────────────────────────────────────────
{
  const probe = await sb.from('checklist_cadastro').select('id').limit(1);
  if (probe.error) { console.error('  ERRO: checklist_cadastro inacessível — rode a migration.', probe.error.message); process.exit(1); }
}
let ok = 0, falhas = 0;
for (const r of casados) {
  try {
    const buf = readFileSync(r.caminho);
    const hash = createHash('sha256').update(buf).digest('hex');
    const path = `empresas/${r.empresa.id}/cadastro/${MES}/relatorio-${CERTIDAO.toLowerCase()}-${hash.slice(0, 16)}.pdf`;
    const up = await sb.storage.from('documentos').upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (up.error) { console.error(`  ✗ upload ${r.nome}: ${up.error.message}`); falhas++; continue; }
    const { error } = await sb.from('checklist_cadastro').upsert({
      empresa_id: r.empresa.id, certidao: CERTIDAO, mes: MES,
      relatorio_url: path, relatorio_nome: r.nome, atualizado_em: new Date().toISOString(),
    }, { onConflict: 'empresa_id,certidao,mes' });
    if (error) { console.error(`  ✗ upsert ${r.nome}: ${error.message}`); falhas++; continue; }
    ok++;
    if (ok % 25 === 0) console.log(`  … ${ok}/${casados.length}`);
  } catch (e) { console.error(`  ✗ ${r.nome}: ${e.message}`); falhas++; }
}
console.log('');
console.log(`  ✓ ${ok} relatório(s) anexado(s) na coluna ${CERTIDAO} (mês ${MES}).${falhas ? ` Falhas: ${falhas}.` : ''}`);
console.log(`  Reverter: limpa relatorio_url/nome — UPDATE checklist_cadastro SET relatorio_url=NULL, relatorio_nome=NULL WHERE mes='${MES}' AND certidao='${CERTIDAO}' AND relatorio_nome IS NOT NULL;`);
