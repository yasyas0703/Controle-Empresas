// Auditoria: cruza o que foi detectado no T:/Fiscal/EMPRESA (CSV gerado por
// descobrir-codigos-fiscal.mjs) com o que está cadastrado no banco
// (empresa_obrigacoes_config).
//
// Uso: node scripts/auditar-codigos-fiscal.mjs
//
// Gera: scripts/output-auditoria.csv com colunas:
//   codigo;razao;obrigacao;status;banco_codigos;servidor_codigos;detalhe
//
// Status possíveis:
//   OK            — códigos do banco batem com o servidor
//   DIVERGE       — banco e servidor têm códigos, mas diferentes
//   SO_NO_BANCO   — banco tem ativa mas servidor não detectou
//   SO_NO_SERVIDOR— servidor detectou mas banco não tem registro
//   SEM_CODIGO    — banco ativo, mas sem código (ex: REINF/LIVROS)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function parseCsv(text) {
  const linhas = text.split(/\r?\n/).filter(Boolean);
  const header = linhas[0].split(';');
  return linhas.slice(1).map((linha) => {
    // CSV pode ter campos com aspas duplas — parse simples
    const cols = [];
    let atual = '';
    let dentroAspas = false;
    for (const ch of linha) {
      if (ch === '"') dentroAspas = !dentroAspas;
      else if (ch === ';' && !dentroAspas) { cols.push(atual); atual = ''; }
      else atual += ch;
    }
    cols.push(atual);
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

const ALIASES = {
  'DARF': 'DARF-SERVIÇOS TOMADOS',
  'GIA': 'GIA-ST/DIFAL',
  'DIFAL': 'ICMS-ST/DIFAL',
};
function canonicalizar(o) { return ALIASES[o] || o; }

function normCodigo(c) {
  return String(c || '').replace(/^0+/, '').replace(/[^a-z0-9-]/gi, '');
}

function compararCodigos(banco, servidor) {
  const bSet = new Set(banco.map(normCodigo).filter(Boolean));
  const sSet = new Set(servidor.map(normCodigo).filter(Boolean));
  if (bSet.size === 0 && sSet.size === 0) return 'sem-codigo-ambos';
  // Banco tem algum que servidor também tem?
  for (const c of bSet) if (sSet.has(c)) return 'ok';
  // Nenhum bate
  return 'diverge';
}

async function todos(sb, tab, sel) {
  const out = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from(tab).select(sel).range(offset, offset + 999);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function main() {
  console.log('📊 Auditoria banco × servidor T:\n');

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1) Carrega o CSV gerado por descobrir-codigos-fiscal.mjs
  const csvPath = resolve(__dirname, 'output-codigos-fiscal.csv');
  const csv = parseCsv(readFileSync(csvPath, 'utf8'));
  console.log(`📋 CSV: ${csv.length} linhas`);

  // Index por (codigo_empresa, obrigacao) — pega a primeira linha pra cada par
  const servidorPorChave = new Map();
  for (const linha of csv) {
    if (!linha.codigo_empresa || !linha.obrigacao) continue;
    const obrig = canonicalizar(linha.obrigacao);
    const key = `${linha.codigo_empresa}|${obrig}`;
    if (!servidorPorChave.has(key)) {
      servidorPorChave.set(key, {
        codigos: linha.codigos.split('|').filter(Boolean),
        razao: linha.razao_social,
        pasta: linha.pasta_servidor,
      });
    }
  }
  console.log(`📂 Servidor: ${servidorPorChave.size} (empresa+obrigação) detectadas`);

  // 2) Carrega configs do banco
  const empresas = await todos(sb, 'empresas', 'id, codigo, razao_social, desligada_em, cnpj');
  const configs = await todos(sb, 'empresa_obrigacoes_config', 'empresa_id, obrigacao, ativa, codigos');
  const empPorId = new Map(empresas.map((e) => [e.id, e]));

  // Configs ativas por (codigo_empresa, obrigacao)
  const bancoPorChave = new Map();
  for (const c of configs) {
    if (!c.ativa) continue;
    const e = empPorId.get(c.empresa_id);
    if (!e || e.desligada_em) continue;
    const key = `${e.codigo}|${c.obrigacao}`;
    if (!bancoPorChave.has(key)) {
      bancoPorChave.set(key, {
        codigos: Array.isArray(c.codigos) ? c.codigos : [],
        razao: e.razao_social,
      });
    }
  }
  console.log(`💾 Banco: ${bancoPorChave.size} obrigações ativas\n`);

  // 3) Cruza
  const todasChaves = new Set([...servidorPorChave.keys(), ...bancoPorChave.keys()]);
  const linhas = ['codigo;razao;obrigacao;status;banco_codigos;servidor_codigos;pasta_servidor'];
  const stats = { ok: 0, diverge: 0, soBanco: 0, soServidor: 0, semCodigo: 0 };

  for (const key of todasChaves) {
    const [codigoEmpresa, obrigacao] = key.split('|');
    const banco = bancoPorChave.get(key);
    const servidor = servidorPorChave.get(key);

    let status = '';
    let detalhe = '';

    if (banco && servidor) {
      const result = compararCodigos(banco.codigos, servidor.codigos);
      if (result === 'ok') { status = 'OK'; stats.ok++; }
      else if (result === 'sem-codigo-ambos') { status = 'SEM_CODIGO'; stats.semCodigo++; }
      else { status = 'DIVERGE'; stats.diverge++; }
    } else if (banco) {
      status = 'SO_NO_BANCO';
      stats.soBanco++;
    } else {
      status = 'SO_NO_SERVIDOR';
      stats.soServidor++;
    }

    const razao = (banco?.razao || servidor?.razao || '').replace(/;/g, ',');
    const bCods = (banco?.codigos || []).join('|');
    const sCods = (servidor?.codigos || []).join('|');
    const pasta = (servidor?.pasta || '').replace(/;/g, ',');
    linhas.push(`${codigoEmpresa};${razao};${obrigacao};${status};${bCods};${sCods};${pasta}`);
  }

  const outPath = resolve(__dirname, 'output-auditoria.csv');
  writeFileSync(outPath, linhas.join('\n'), 'utf8');

  console.log('=== RESULTADO ===');
  console.log(`  ✅ OK (banco e servidor batem):   ${stats.ok}`);
  console.log(`  ⚪ Sem código (REINF/Livros etc): ${stats.semCodigo}`);
  console.log(`  ⚠️  DIVERGE (códigos diferentes):  ${stats.diverge}`);
  console.log(`  📂 Só no banco (sem no T:):       ${stats.soBanco}`);
  console.log(`  📋 Só no servidor (sem no banco): ${stats.soServidor}`);
  console.log(`\n💾 Relatório completo: ${outPath}`);
  console.log(`   Abre no Excel (separador ";") pra revisar caso a caso.`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
