// Recupera responsáveis de empresas que foram apagados (responsável = null)
// por um import. Lê os logs de auditoria, acha onde um departamento foi de
// "tinha responsável" -> "null", e restaura o responsável antigo.
//
// SEGURO: roda em SIMULAÇÃO por padrão (só mostra o que faria). Só grava com --apply.
// Só restaura quando o responsável ATUAL daquele dep está vazio (não atropela
// uma atribuição mais nova).
//
// Uso:
//   node scripts/recuperar-responsaveis.mjs                      # simula, todos os deps, últimos 3 dias
//   node scripts/recuperar-responsaveis.mjs --dep "SN"           # filtra por nome do departamento
//   node scripts/recuperar-responsaveis.mjs --desde 2026-06-01   # só logs a partir dessa data
//   node scripts/recuperar-responsaveis.mjs --dep "SN" --apply   # GRAVA de verdade

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  try {
    const text = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
    return env;
  } catch (err) {
    console.error('Não consegui ler .env.local:', err.message);
    process.exit(1);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, dep: null, desde: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--dep') out.dep = args[++i] ?? null;
    else if (args[i] === '--desde') out.desde = args[++i] ?? null;
  }
  return out;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function main() {
  const { apply, dep: depFiltro, desde } = parseArgs();
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Mapas de apoio (nomes legíveis)
  const { data: deps } = await admin.from('departamentos').select('id, nome');
  const { data: users } = await admin.from('usuarios').select('id, nome');
  const { data: emps } = await admin.from('empresas').select('id, codigo, razao_social');
  const depNome = new Map((deps || []).map((d) => [d.id, d.nome]));
  const userNome = new Map((users || []).map((u) => [u.id, u.nome]));
  const empById = new Map((emps || []).map((e) => [e.id, e]));

  // Resolve filtro de departamento (nome -> id)
  let depFiltroId = null;
  if (depFiltro) {
    const achado = (deps || []).find((d) => norm(d.nome) === norm(depFiltro) || norm(d.nome).includes(norm(depFiltro)));
    if (!achado) {
      console.error(`Departamento "${depFiltro}" não encontrado. Departamentos: ${(deps || []).map((d) => d.nome).join(', ')}`);
      process.exit(1);
    }
    depFiltroId = achado.id;
    console.log(`Filtrando pelo departamento: ${achado.nome} (${achado.id})`);
  }

  // Janela de tempo: --desde, ou últimos 3 dias por padrão
  const desdeISO = desde
    ? new Date(desde).toISOString()
    : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Lendo logs de empresa (update) a partir de ${desdeISO}...`);

  const { data: logs, error: logErr } = await admin
    .from('logs')
    .select('entity_id, message, diff, em')
    .eq('entity', 'empresa')
    .eq('action', 'update')
    .gte('em', desdeISO)
    .order('em', { ascending: true }); // ascending: pega a PRIMEIRA remoção (valor original)
  if (logErr) {
    console.error('Erro ao ler logs:', logErr.message);
    process.exit(1);
  }

  // Para cada (empresa, dep), guarda o responsável original (from) da PRIMEIRA remoção -> null
  const aRestaurar = new Map(); // key `${empresaId}|${depId}` -> { empresaId, depId, usuarioId }
  for (const log of logs || []) {
    const diff = log.diff;
    const r = diff && diff.responsaveis;
    if (!r || typeof r !== 'object' || !r.from || !r.to) continue;
    const from = r.from || {};
    const to = r.to || {};
    for (const depId of Object.keys(from)) {
      if (depFiltroId && depId !== depFiltroId) continue;
      const antes = from[depId];
      const depois = to[depId];
      // Foi de "tinha alguém" para "ninguém"
      if (antes && !depois) {
        const key = `${log.entity_id}|${depId}`;
        if (!aRestaurar.has(key)) {
          aRestaurar.set(key, { empresaId: log.entity_id, depId, usuarioId: antes });
        }
      }
    }
  }

  if (aRestaurar.size === 0) {
    console.log('\nNenhum responsável removido encontrado nesse período/filtro. Nada a recuperar.');
    return;
  }

  // Confere o estado ATUAL: só restaura se o dep estiver vazio agora
  const candidatos = [...aRestaurar.values()];
  const empresaIds = [...new Set(candidatos.map((c) => c.empresaId))];
  const { data: atuais } = await admin
    .from('responsaveis')
    .select('empresa_id, departamento_id, usuario_id')
    .in('empresa_id', empresaIds);
  const atualMap = new Map((atuais || []).map((r) => [`${r.empresa_id}|${r.departamento_id}`, r.usuario_id]));

  const paraGravar = [];
  const puladosOcupados = [];
  for (const c of candidatos) {
    const atual = atualMap.get(`${c.empresaId}|${c.depId}`);
    if (atual) puladosOcupados.push({ ...c, atual });
    else paraGravar.push(c);
  }

  console.log(`\n=== ${apply ? 'APLICANDO' : 'SIMULAÇÃO (use --apply para gravar)'} ===`);
  console.log(`Vão ser restaurados: ${paraGravar.length}`);
  for (const c of paraGravar) {
    const emp = empById.get(c.empresaId);
    console.log(`  ${emp?.codigo ?? c.empresaId}  [${depNome.get(c.depId) ?? c.depId}]  ->  ${userNome.get(c.usuarioId) ?? c.usuarioId}`);
  }
  if (puladosOcupados.length > 0) {
    console.log(`\nPulados (já têm responsável atual, não mexo): ${puladosOcupados.length}`);
    for (const c of puladosOcupados) {
      const emp = empById.get(c.empresaId);
      console.log(`  ${emp?.codigo ?? c.empresaId}  [${depNome.get(c.depId) ?? c.depId}]  atual=${userNome.get(c.atual) ?? c.atual}  (antigo=${userNome.get(c.usuarioId) ?? c.usuarioId})`);
    }
  }

  if (!apply) {
    console.log('\nSimulação. Nada foi gravado. Rode de novo com --apply para aplicar.');
    return;
  }

  // Grava em lotes via upsert
  const rows = paraGravar.map((c) => ({ empresa_id: c.empresaId, departamento_id: c.depId, usuario_id: c.usuarioId }));
  let ok = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const lote = rows.slice(i, i + 50);
    const { error } = await admin.from('responsaveis').upsert(lote, { onConflict: 'empresa_id,departamento_id' });
    if (error) {
      console.error(`Erro ao gravar lote ${i / 50 + 1}:`, error.message);
    } else {
      ok += lote.length;
    }
  }
  console.log(`\nPronto. ${ok} responsável(eis) restaurado(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
