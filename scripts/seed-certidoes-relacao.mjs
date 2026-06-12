// Importa a RELAÇÃO de certidões (texto enviado pelo cadastro) pro checklist_cadastro.
// Casa cada linha por CNPJ (14 dígitos) e grava o resultado (Negativa/PEN/Positiva)
// na coluna FEDERAL ou ESTADUAL do mês. Para empresas de SP, a estadual vira
// ESTADUAL_ADM + ESTADUAL_DA (a relação dá um resultado só → replica nas duas).
//
// SEM PDF: a relação só traz o RESULTADO (status colorido). O arquivo da certidão
// vem depois pelo watcher. Por isso essas células não ficam "enviáveis" até ter o PDF.
//
// Uso:
//   node scripts/seed-certidoes-relacao.mjs                 # DRY-RUN (não grava) — só relatório
//   node scripts/seed-certidoes-relacao.mjs --apply         # grava de verdade
//   node scripts/seed-certidoes-relacao.mjs --mes 2026-06   # mês (default 2026-06)
//   node scripts/seed-certidoes-relacao.mjs --file <caminho.txt>
//
// Mapeamento de resultado:
//   NEGATIVA → Negativa · P.E.N → PEN · POSI/NEGAT → PEN (positiva c/ efeito) · POSITIVA → Positiva
// "POSI/NEGAT - ..." guarda a nota na observação (ex.: ABRIR CHAT / PROCESSO).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const APPLY = args.includes('--apply');
const MES = (() => { const m = argVal('--mes'); return m && /^\d{4}-\d{2}$/.test(m) ? m : '2026-06'; })();
const DATA_FILE = argVal('--file') || resolve(__dirname, 'data', `relacao-certidoes-${MES}.txt`);

function loadEnv() {
  const env = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (process.env[k]) env[k] = process.env[k];
  return env;
}
const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY faltando no .env.local'); process.exit(1); }

const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

function soDigitos(s) { return (s || '').replace(/\D/g, ''); }

function classificarResultado(linha) {
  const u = linha.toUpperCase();
  const cands = [
    { re: 'P.E.N', res: 'PEN' },
    { re: 'POSI/NEGAT', res: 'PEN' },
    { re: 'POSITIVA', res: 'Positiva' },
    { re: 'NEGATIVA', res: 'Negativa' },
  ];
  let melhor = null;
  for (const c of cands) {
    const idx = u.lastIndexOf(c.re);
    if (idx >= 0 && (!melhor || idx > melhor.idx)) melhor = { ...c, idx };
  }
  if (!melhor) return { resultado: null, raw: null, ambiguo: false };
  const raw = linha.slice(melhor.idx).trim();
  return { resultado: melhor.res, raw, ambiguo: melhor.re === 'POSI/NEGAT' };
}

function cnpjDaLinha(linha) {
  for (const tok of linha.split(/\t/)) {
    if (soDigitos(tok).length === 14) return soDigitos(tok);
  }
  // fallback: varre números soltos
  const m = linha.match(/(\d[\d.\-/]{12,})/g) || [];
  for (const tok of m) if (soDigitos(tok).length === 14) return soDigitos(tok);
  return null;
}

function ufDaLinha(linha) {
  const matches = [...linha.matchAll(/\/([A-Za-z]{2})(?=\b|$|\s)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const uf = matches[i][1].toUpperCase();
    if (UFS.has(uf)) return uf;
  }
  return null;
}

// ─── Parse ────────────────────────────────────────────────────────────────────
const texto = readFileSync(DATA_FILE, 'utf8');
let secao = null;
const linhas = [];
for (const raw of texto.split(/\r?\n/)) {
  const linha = raw.replace(/\s+$/, '');
  if (!linha.trim()) continue;
  if (/^###\s*FEDERAL/i.test(linha)) { secao = 'FEDERAL'; continue; }
  if (/^###\s*ESTADUAL/i.test(linha)) { secao = 'ESTADUAL'; continue; }
  if (linha.trimStart().startsWith('#')) continue;
  if (!secao) continue;
  const cnpj = cnpjDaLinha(linha);
  const { resultado, raw: resRaw, ambiguo } = classificarResultado(linha);
  const uf = secao === 'ESTADUAL' ? ufDaLinha(linha) : null;
  linhas.push({ secao, cnpj, resultado, resRaw, ambiguo, uf, linha });
}

// ─── Supabase: carrega empresas e casa por CNPJ ────────────────────────────────
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const empresasPorCnpj = new Map();
{
  const PAGE = 1000; let off = 0;
  for (;;) {
    const { data, error } = await sb.from('empresas').select('id, cnpj, razao_social, apelido, codigo').range(off, off + PAGE - 1);
    if (error) { console.error('Erro ao ler empresas:', error.message); process.exit(1); }
    for (const e of data || []) { const d = soDigitos(e.cnpj); if (d.length === 14) empresasPorCnpj.set(d, e); }
    if (!data || data.length < PAGE) break;
    off += PAGE;
  }
}

// ─── Monta as células a gravar ─────────────────────────────────────────────────
const cells = [];     // {empresa, certidao, resultado, observacao}
const semCnpj = [];
const semResultado = [];
const naoCasou = [];
for (const r of linhas) {
  if (!r.cnpj) { semCnpj.push(r); continue; }
  if (!r.resultado) { semResultado.push(r); continue; }
  const empresa = empresasPorCnpj.get(r.cnpj);
  if (!empresa) { naoCasou.push(r); continue; }
  const observacao = r.ambiguo && r.resRaw ? `[relação ${MES}] ${r.resRaw}` : null;
  let certidoes;
  if (r.secao === 'FEDERAL') certidoes = ['FEDERAL'];
  else if (r.uf === 'SP') certidoes = ['ESTADUAL_ADM', 'ESTADUAL_DA'];
  else certidoes = ['ESTADUAL'];
  for (const certidao of certidoes) {
    cells.push({ empresa, certidao, resultado: r.resultado, uf: r.uf, observacao });
  }
}

// ─── Relatório ─────────────────────────────────────────────────────────────────
const dist = cells.reduce((a, c) => ((a[c.resultado] = (a[c.resultado] || 0) + 1), a), {});
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Importação da relação de certidões — mês ${MES}`);
console.log(`  Arquivo: ${DATA_FILE}`);
console.log(`  Modo: ${APPLY ? 'APLICAR (grava no banco)' : 'DRY-RUN (não grava)'}`);
console.log('═══════════════════════════════════════════════════════');
console.log(`  Linhas lidas:        ${linhas.length}`);
console.log(`  Empresas no banco:   ${empresasPorCnpj.size}`);
console.log(`  Células a gravar:    ${cells.length}  (FEDERAL ${cells.filter(c => c.certidao === 'FEDERAL').length} · ESTADUAL ${cells.filter(c => c.certidao.startsWith('ESTADUAL')).length})`);
console.log(`  Distribuição:        ${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
console.log(`  Sem CNPJ na linha:   ${semCnpj.length}`);
console.log(`  Sem resultado:       ${semResultado.length}`);
console.log(`  CNPJ não casou:      ${naoCasou.length}`);
if (naoCasou.length) {
  console.log('  --- CNPJ não encontrado no sistema (não serão gravados): ---');
  for (const r of naoCasou) console.log(`    ${r.secao.padEnd(8)} ${r.cnpj}  ${r.linha.split(/\t/).slice(0, 3).join(' ').slice(0, 70)}`);
}
if (semResultado.length) {
  console.log('  --- Linhas sem resultado reconhecido: ---');
  for (const r of semResultado) console.log(`    ${r.secao.padEnd(8)} ${(r.cnpj || '?')}  ${r.linha.slice(0, 70)}`);
}

if (!APPLY) {
  console.log('');
  console.log('  DRY-RUN. Rode com --apply pra gravar. (Antes, rode a migration se ainda não rodou.)');
  process.exit(0);
}

// ─── Aplica ────────────────────────────────────────────────────────────────────
// Confere se a tabela existe (migration aplicada).
{
  const probe = await sb.from('checklist_cadastro').select('id').limit(1);
  if (probe.error) {
    console.error('');
    console.error('  ERRO: não consegui acessar checklist_cadastro:', probe.error.message);
    console.error('  Rode a migration supabase-migration-checklist-cadastro.sql no Supabase antes de --apply.');
    process.exit(1);
  }
}

const now = new Date().toISOString();
const payload = cells.map((c) => {
  const row = {
    empresa_id: c.empresa.id,
    certidao: c.certidao,
    mes: MES,
    resultado: c.resultado,
    fonte: 'relacao',
    atualizado_em: now,
  };
  if (c.uf) row.uf = c.uf;
  if (c.observacao) row.observacao = c.observacao;
  return row;
});

let gravadas = 0;
const LOTE = 200;
for (let i = 0; i < payload.length; i += LOTE) {
  const fatia = payload.slice(i, i + LOTE);
  const { error } = await sb.from('checklist_cadastro').upsert(fatia, { onConflict: 'empresa_id,certidao,mes' });
  if (error) { console.error(`Erro no lote ${i}-${i + fatia.length}:`, error.message); process.exit(1); }
  gravadas += fatia.length;
  console.log(`  Gravadas ${gravadas}/${payload.length}…`);
}
console.log('');
console.log(`  ✓ Pronto. ${gravadas} células gravadas em checklist_cadastro (mês ${MES}, fonte='relacao').`);
console.log(`  Pra reverter: DELETE FROM checklist_cadastro WHERE mes='${MES}' AND fonte='relacao';`);
