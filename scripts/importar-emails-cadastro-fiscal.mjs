// ─────────────────────────────────────────────────────────────────────────────
// Importa os e-mails de cliente da planilha `emailscadastrofiscal.xlsx` para a
// tabela `empresa_emails_cliente`, separando por tipo:
//   - Departamento "Cadastro"                       → tipo = 'cadastro'
//   - "Fiscal" / "Fiscal Guias" / "Fiscal Guias ²ª" → tipo = 'fiscal'
//
// IMPORTANTE — os e-mails entram DORMINDO (ativo=false). Nenhum envio (fiscal ou
// cadastro) seleciona e-mail com ativo=false, então NADA é enviado pra esses
// clientes ainda. Enquanto isso, o e-mail de TESTE (rotulo='TESTE') continua
// ativo e recebe tudo. Quando for pra valer, rode com `--ativar --apply`.
//
// MODOS:
//   node scripts/importar-emails-cadastro-fiscal.mjs                 # DRY-RUN da importação (não grava)
//   node scripts/importar-emails-cadastro-fiscal.mjs --apply         # importa DORMINDO (ativo=false)
//   node scripts/importar-emails-cadastro-fiscal.mjs --ativar        # DRY-RUN do go-live
//   node scripts/importar-emails-cadastro-fiscal.mjs --ativar --apply# GO-LIVE: ativa os reais + desliga o TESTE
//   node scripts/importar-emails-cadastro-fiscal.mjs --revert --apply# desfaz a importação (apaga só os importados)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLANILHA = resolve(__dirname, '..', 'emailscadastrofiscal.xlsx');
const EMAIL_TESTE = 'yasminteodoro0703@gmail.com'; // mesmo do seed-email-teste-empresas.mjs

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ATIVAR = argv.includes('--ativar');
const REVERT = argv.includes('--revert');
const TESTE_CADASTRO = argv.includes('--teste-cadastro');
const CSV_NAO_CASADAS = resolve(__dirname, 'output-emails-nao-casados.csv'); // gitignored (scripts/output-*.csv)

// ── helpers ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const text = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

function lerTexto(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink ?? '').trim();
    if ('result' in v) return v.result == null ? '' : String(v.result).trim();
    if ('text' in v) return String(v.text ?? '').trim();
  }
  return String(v).trim();
}

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const normCodigo = (s) => (s || '').trim().replace(/^0+/, '') || '0'; // tira zeros à esquerda
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Departamento da planilha → tipo da tabela. Qualquer coisa com "cadastro" é
// cadastro; o resto (Fiscal, Fiscal Guias, Fiscal Guias ²ª) é fiscal.
function deptParaTipo(dept) {
  const n = (dept || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('cadastro')) return 'cadastro';
  if (n.includes('fiscal')) return 'fiscal';
  return null; // departamento desconhecido — não classifica
}

// ── lê a planilha → tuplas (codigo, cnpj, cliente, email, tipo, rotulo) ───────
async function lerPlanilha() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(PLANILHA));
  const ws = wb.worksheets[0];

  // codigo → { codigo, cnpj, cliente, tuplas: Map<`${email}|${tipo}`, {email,tipo,rotulo}> }
  const empresas = new Map();
  const problemas = { semCodigo: 0, emailInvalido: [], deptDesconhecido: new Map() };

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nome = lerTexto(row.getCell(1));
    const email = lerTexto(row.getCell(2)).toLowerCase();
    const codigo = lerTexto(row.getCell(3));
    const cliente = lerTexto(row.getCell(4));
    const cnpj = soDigitos(lerTexto(row.getCell(5)));
    const dept = lerTexto(row.getCell(6));
    if (!email && !codigo && !cliente) continue;

    if (!codigo) { problemas.semCodigo++; continue; }
    if (!email || !EMAIL_RE.test(email)) { if (email) problemas.emailInvalido.push(`L${r}: "${email}"`); continue; }
    const tipo = deptParaTipo(dept);
    if (!tipo) { problemas.deptDesconhecido.set(dept, (problemas.deptDesconhecido.get(dept) || 0) + 1); continue; }

    const k = normCodigo(codigo);
    if (!empresas.has(k)) empresas.set(k, { codigo, cnpj, cliente, tuplas: new Map() });
    const e = empresas.get(k);
    if (!e.cnpj && cnpj) e.cnpj = cnpj;
    const tk = `${email}|${tipo}`;
    if (!e.tuplas.has(tk)) e.tuplas.set(tk, { email, tipo, rotulo: nome || null });
  }
  return { empresas, problemas };
}

// ── conexão ──────────────────────────────────────────────────────────────────
function getAdmin() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local'); process.exit(1); }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function carregarEmpresasDb(admin) {
  const { data, error } = await admin.from('empresas').select('id, codigo, cnpj, razao_social, apelido, cadastrada');
  if (error) { console.error('Erro lendo empresas:', error.message); process.exit(1); }
  const porCodigo = new Map();
  const porCnpj = new Map();
  for (const e of data) {
    if (e.codigo) {
      const k = normCodigo(String(e.codigo));
      if (!porCodigo.has(k)) porCodigo.set(k, []);
      porCodigo.get(k).push(e);
    }
    const c = soDigitos(e.cnpj);
    if (c) { if (!porCnpj.has(c)) porCnpj.set(c, []); porCnpj.get(c).push(e); }
  }
  return { todas: data, porCodigo, porCnpj };
}

async function carregarEmailsExistentes(admin) {
  // Pagina pra não estourar o limite de 1000 linhas do PostgREST.
  const todos = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await admin
      .from('empresa_emails_cliente')
      .select('id, empresa_id, email, tipo, ativo, rotulo')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Erro lendo emails existentes:', error.message); process.exit(1); }
    todos.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return todos;
}

// ── resolve cada empresa da planilha → empresa do banco ──────────────────────
function resolver(empresasXlsx, db) {
  const matched = []; // { dbId, codigo, cliente, tuplas:[] }
  const unmatched = []; // { codigo, cnpj, cliente, nTuplas }
  const conflitoCnpj = []; // codigo casou mas cnpj diverge

  for (const [k, x] of empresasXlsx) {
    let alvo = null;
    let via = null;
    const porCod = db.porCodigo.get(k);
    if (porCod && porCod.length === 1) { alvo = porCod[0]; via = 'codigo'; }
    else if (porCod && porCod.length > 1) {
      // desempata por cnpj
      const m = porCod.find((e) => soDigitos(e.cnpj) && soDigitos(e.cnpj) === x.cnpj);
      alvo = m || null; via = m ? 'codigo+cnpj' : null;
    }
    if (!alvo && x.cnpj) {
      const porCnpj = db.porCnpj.get(x.cnpj);
      if (porCnpj && porCnpj.length === 1) { alvo = porCnpj[0]; via = 'cnpj'; }
    }
    if (!alvo) { unmatched.push({ codigo: x.codigo, cnpj: x.cnpj, cliente: x.cliente, nTuplas: x.tuplas.size }); continue; }

    // checagem de sanidade: cnpj diverge?
    const dbCnpj = soDigitos(alvo.cnpj);
    if (via === 'codigo' && x.cnpj && dbCnpj && x.cnpj !== dbCnpj) {
      conflitoCnpj.push({ codigo: x.codigo, cliente: x.cliente, xlsxCnpj: x.cnpj, dbCnpj, dbNome: alvo.razao_social || alvo.apelido });
    }
    matched.push({ dbId: alvo.id, codigo: x.codigo, cliente: x.cliente, via, tuplas: [...x.tuplas.values()] });
  }
  return { matched, unmatched, conflitoCnpj };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const admin = getAdmin();

  // ── SEED do e-mail de TESTE como CADASTRO ───────────────────────────────────
  // Hoje o TESTE recebe as GUIAS (tipo='fiscal'). Pra também receber as
  // CERTIDÕES durante o teste, garante uma linha tipo='cadastro' ativa pras
  // mesmas empresas onde o TESTE já existe. Idempotente. Revert: o
  // seed-email-teste-empresas.mjs --revert apaga por email+rotulo='TESTE'.
  if (TESTE_CADASTRO) {
    const existentes = await carregarEmailsExistentes(admin);
    const comTeste = new Set(existentes.filter((e) => e.email === EMAIL_TESTE).map((e) => e.empresa_id));
    const jaCadastro = new Set(
      existentes.filter((e) => e.email === EMAIL_TESTE && (e.tipo || 'fiscal') === 'cadastro').map((e) => e.empresa_id),
    );
    const alvo = [...comTeste].filter((id) => !jaCadastro.has(id));
    console.log('═══ SEED TESTE como CADASTRO (pra você receber certidões de teste) ═══');
    console.log(`  Empresas com e-mail de TESTE:      ${comTeste.size}`);
    console.log(`  Já têm TESTE tipo cadastro:        ${jaCadastro.size}`);
    console.log(`  A inserir (TESTE cadastro, ativo): ${alvo.length}`);
    if (!APPLY) { console.log('\n  DRY-RUN — nada gravado. Rode `--teste-cadastro --apply`.'); return; }
    const rows = alvo.map((id) => ({ empresa_id: id, email: EMAIL_TESTE, rotulo: 'TESTE', tipo: 'cadastro', principal: true, ativo: true }));
    let ins = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await admin.from('empresa_emails_cliente').insert(chunk);
      if (error) { console.error('Erro inserindo TESTE cadastro:', error.message); process.exit(1); }
      ins += chunk.length;
    }
    console.log(`\n  OK — ${ins} linhas TESTE tipo cadastro inseridas (certidões de teste agora caem no seu e-mail).`);
    return;
  }

  // ── GO-LIVE ────────────────────────────────────────────────────────────────
  if (ATIVAR) {
    const existentes = await carregarEmailsExistentes(admin);
    const importados = existentes.filter((e) => e.email !== EMAIL_TESTE && e.ativo === false);
    const teste = existentes.filter((e) => e.email === EMAIL_TESTE);
    console.log('═══ GO-LIVE (ativar e-mails reais, desligar TESTE) ═══');
    console.log(`  E-mails importados a ATIVAR (ativo=false→true): ${importados.length}`);
    console.log(`  E-mails de TESTE a DESLIGAR (ativo=true→false):  ${teste.filter((e) => e.ativo).length}`);
    if (!APPLY) { console.log('\n  DRY-RUN — nada alterado. Rode com `--ativar --apply` pra executar.'); return; }
    // ativa reais em lotes
    let on = 0;
    for (let i = 0; i < importados.length; i += 200) {
      const ids = importados.slice(i, i + 200).map((e) => e.id);
      const { error } = await admin.from('empresa_emails_cliente').update({ ativo: true }).in('id', ids);
      if (error) { console.error('Erro ativando:', error.message); process.exit(1); }
      on += ids.length;
    }
    // desliga TESTE
    const { error: errT } = await admin.from('empresa_emails_cliente').update({ ativo: false }).eq('email', EMAIL_TESTE);
    if (errT) { console.error('Erro desligando TESTE:', errT.message); process.exit(1); }
    console.log(`\n  OK — ${on} e-mails reais ativados; e-mails de TESTE desligados.`);
    console.log('  LEMBRE: o envio FISCAL precisa filtrar tipo=fiscal (ver checklist) antes de valer pra valer.');
    return;
  }

  const { empresas, problemas } = await lerPlanilha();
  const db = await carregarEmpresasDb(admin);
  const { matched, unmatched, conflitoCnpj } = resolver(empresas, db);
  const existentes = await carregarEmailsExistentes(admin);
  const jaExiste = new Set(existentes.map((e) => `${e.empresa_id}|${e.email}|${e.tipo || 'fiscal'}`));

  // ── REVERT ───────────────────────────────────────────────────────────────
  if (REVERT) {
    const importados = existentes.filter((e) => e.email !== EMAIL_TESTE && e.ativo === false);
    console.log('═══ REVERT (apagar e-mails importados, dormindo) ═══');
    console.log(`  Linhas a apagar (email≠TESTE e ativo=false): ${importados.length}`);
    if (!APPLY) { console.log('\n  DRY-RUN — nada apagado. Rode `--revert --apply` pra apagar.'); return; }
    let del = 0;
    for (let i = 0; i < importados.length; i += 200) {
      const ids = importados.slice(i, i + 200).map((e) => e.id);
      const { error } = await admin.from('empresa_emails_cliente').delete().in('id', ids);
      if (error) { console.error('Erro apagando:', error.message); process.exit(1); }
      del += ids.length;
    }
    console.log(`\n  OK — ${del} linhas importadas apagadas.`);
    return;
  }

  // ── monta linhas a inserir ─────────────────────────────────────────────────
  const rows = [];
  let dupExistente = 0;
  const porTipo = { fiscal: 0, cadastro: 0 };
  for (const m of matched) {
    for (const t of m.tuplas) {
      const chave = `${m.dbId}|${t.email}|${t.tipo}`;
      if (jaExiste.has(chave)) { dupExistente++; continue; }
      rows.push({ empresa_id: m.dbId, email: t.email, rotulo: t.rotulo, tipo: t.tipo, principal: false, ativo: false });
      porTipo[t.tipo]++;
    }
  }

  // ── relatório ──────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Planilha:              ${PLANILHA}`);
  console.log(`Empresas na planilha:  ${empresas.size}`);
  console.log(`  casadas no banco:    ${matched.length}`);
  console.log(`  NÃO encontradas:     ${unmatched.length}`);
  console.log(`Empresas no banco:     ${db.todas.length}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`E-mails a inserir (novos, DORMINDO ativo=false): ${rows.length}`);
  console.log(`  tipo fiscal:         ${porTipo.fiscal}`);
  console.log(`  tipo cadastro:       ${porTipo.cadastro}`);
  console.log(`Já existiam (pulados): ${dupExistente}`);
  console.log('───────────────────────────────────────────────────────────────');
  if (problemas.semCodigo) console.log(`Linhas sem código (puladas): ${problemas.semCodigo}`);
  if (problemas.emailInvalido.length) {
    console.log(`E-mails inválidos (pulados): ${problemas.emailInvalido.length}`);
    problemas.emailInvalido.slice(0, 10).forEach((x) => console.log('    ' + x));
  }
  if (problemas.deptDesconhecido.size) {
    console.log('Departamentos desconhecidos (pulados):');
    for (const [d, n] of problemas.deptDesconhecido) console.log(`    ${JSON.stringify(d)}: ${n}`);
  }
  if (conflitoCnpj.length) {
    console.log(`\n⚠ CONFLITO de CNPJ (código casou mas CNPJ diverge) — ${conflitoCnpj.length}:`);
    conflitoCnpj.slice(0, 15).forEach((c) => console.log(`    cod ${c.codigo} "${c.cliente}" planilha=${c.xlsxCnpj} banco=${c.dbCnpj} (${c.dbNome})`));
  }
  if (unmatched.length) {
    console.log(`\nEmpresas da planilha SEM correspondência no banco — ${unmatched.length}:`);
    unmatched.slice(0, 40).forEach((u) => console.log(`    cod ${u.codigo} cnpj ${u.cnpj} "${u.cliente}" (${u.nTuplas} e-mails)`));
    if (unmatched.length > 40) console.log(`    ... +${unmatched.length - 40}`);

    // CSV pra revisão manual: inclui dica de possível empresa no banco (nome parecido).
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    // Palavras genéricas que não distinguem empresa (evita dica falsa por "COMERCIO" etc.).
    const STOP = new Set(['COMERCIO', 'SERVICOS', 'SERVICO', 'INDUSTRIA', 'IMPORTACAO', 'EXPORTACAO',
      'IMPORTADORA', 'EXPORTADORA', 'LTDA', 'EIRELI', 'SOCIEDADE', 'INDIVIDUAL', 'ADVOCACIA',
      'EQUIPAMENTOS', 'PRODUTOS', 'VAREJISTA', 'ATACADISTA', 'COMERCIAL', 'TRANSPORTES',
      'CONSULTORIA', 'ENSINO', 'PROPAGANDA', 'PARTICIPACAO', 'MANUTENCAO', 'EMPRESA', 'BRASIL']);
    const linhas = ['codigo;cnpj;cliente;n_emails;possivel_match_no_banco'];
    for (const u of unmatched) {
      const token = (u.cliente || '').toUpperCase().split(/\s+/).find((t) => t.length >= 5 && !STOP.has(t));
      let hint = '';
      if (token) {
        const hits = db.todas
          .filter((e) => (e.razao_social || '').toUpperCase().includes(token.toUpperCase()))
          .slice(0, 3)
          .map((e) => `cod ${e.codigo}/${soDigitos(e.cnpj) || 's-cnpj'} ${e.razao_social}`);
        hint = hits.join(' | ');
      }
      linhas.push([u.codigo, u.cnpj, esc(u.cliente), u.nTuplas, esc(hint)].join(';'));
    }
    writeFileSync(CSV_NAO_CASADAS, '﻿' + linhas.join('\r\n'), 'utf8');
    console.log(`\n  → CSV de revisão: ${CSV_NAO_CASADAS}`);
  }
  console.log('═══════════════════════════════════════════════════════════════');

  if (!APPLY) {
    console.log('DRY-RUN — nada gravado. Rode com `--apply` pra inserir (entram DORMINDO, ativo=false).');
    return;
  }

  // ── insert ─────────────────────────────────────────────────────────────────
  let ins = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await admin.from('empresa_emails_cliente').insert(chunk);
    if (error) {
      console.error(`Erro inserindo chunk ${i}-${i + chunk.length}:`, error.message);
      console.error(`Parcial: ${ins} inseridos. Rode \`--revert --apply\` pra limpar.`);
      process.exit(1);
    }
    ins += chunk.length;
  }
  console.log(`OK — ${ins} e-mails inseridos DORMINDO (ativo=false). Nada será enviado a eles ainda.`);
  console.log('Quando for pra valer: `node scripts/importar-emails-cadastro-fiscal.mjs --ativar --apply`');
}

main().catch((e) => { console.error('Falha inesperada:', e); process.exit(1); });
