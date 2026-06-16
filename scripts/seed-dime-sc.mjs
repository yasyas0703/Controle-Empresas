// Ativa a obrigação DIME (Santa Catarina) nas empresas de SC em empresa_obrigacoes_config.
//
// Contexto: o reconhecimento da DIME (recibo do SAT/SEF-SC) foi corrigido em
// validarGuia.ts, mas o auto-envio só processa a obrigação se ela estiver
// CADASTRADA e ATIVA pra empresa (senão cai em obrigacao_nao_configurada).
// Este script cria/ativa a config DIME pras empresas de SC.
//
// Regras:
//   - Só empresas de SC (estado 'SC' ou 'Santa Catarina'), não desligadas.
//   - Só REGIME NORMAL (lucro_real / lucro_presumido). Simples Nacional NÃO tem
//     DIME (declara via PGDAS/DeSTDA) — essas são PULADAS e listadas.
//   - Tributação indefinida (null): PULADA por segurança (você decide depois).
//   - DIME vai pro cliente (decisão da Yasmin) -> nao_envia_cliente = false.
//   - Se já existe linha DIME, só liga ativa=true e PRESERVA codigos /
//     nao_envia_cliente / motivo (não clobbera config feita à mão).
//
// Uso:
//   node scripts/seed-dime-sc.mjs            # DRY-RUN (não grava) — só relatório
//   node scripts/seed-dime-sc.mjs --apply    # grava de verdade
//   node scripts/seed-dime-sc.mjs --incluir-indefinidas   # inclui tributação null

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const INCLUIR_INDEFINIDAS = process.argv.includes('--incluir-indefinidas');

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

// UF da empresa — 'SC' direto, ou "Santa Catarina" por extenso. (ufDaEmpresa do
// app faz slice(0,2) que viraria 'SA' pra "Santa Catarina", então trato aqui.)
function ehSC(estado) {
  const up = (estado ?? '').trim().toUpperCase();
  if (up === 'SC') return true;
  const norm = up.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return norm.includes('SANTA CATARINA');
}

const REGIME_NORMAL = new Set(['lucro_real', 'lucro_presumido']);
const TRIB_LABEL = { lucro_real: 'Lucro Real', lucro_presumido: 'Lucro Presumido', simples_nacional: 'Simples Nacional' };

function nomeEmp(e) { return e.apelido || e.razao_social || e.codigo || e.id; }

async function main() {
  console.log(`${APPLY ? '[GRAVANDO]' : '[DRY-RUN] (use --apply pra gravar)'} — DIME em empresas de SC\n`);

  const env = loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY faltando no .env.local');
    process.exit(1);
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Empresas ativas (não desligadas).
  const { data: empresasDb, error: errEmp } = await sb
    .from('empresas')
    .select('id, codigo, razao_social, apelido, estado, tributacao, inscricao_estadual')
    .is('desligada_em', null);
  if (errEmp) { console.error('Erro ao buscar empresas:', errEmp.message); process.exit(1); }

  // 2. Filtra SC.
  const sc = (empresasDb ?? []).filter((e) => ehSC(e.estado));
  console.log(`Empresas de SC (ativas): ${sc.length}`);

  // 3. Separa por regime.
  const alvo = [];       // regime normal -> ativa DIME
  const puladasSimples = [];
  const puladasIndefinidas = [];
  for (const e of sc) {
    if (REGIME_NORMAL.has(e.tributacao)) alvo.push(e);
    else if (e.tributacao === 'simples_nacional') puladasSimples.push(e);
    else if (INCLUIR_INDEFINIDAS) alvo.push(e);
    else puladasIndefinidas.push(e);
  }

  // 4. Configs DIME já existentes pra essas empresas (pra preservar à mão).
  const ids = alvo.map((e) => e.id);
  const configAtual = new Map();
  if (ids.length) {
    const { data: cfgs, error: errCfg } = await sb
      .from('empresa_obrigacoes_config')
      .select('empresa_id, ativa, codigos, nao_envia_cliente, motivo')
      .eq('obrigacao', 'DIME')
      .in('empresa_id', ids);
    if (errCfg) { console.error('Erro ao buscar configs:', errCfg.message); process.exit(1); }
    for (const c of cfgs ?? []) configAtual.set(c.empresa_id, c);
  }

  // 5. Decide ação por empresa.
  const aInserir = [];  // sem linha -> cria
  const aAtivar = [];   // linha inativa -> liga (preserva resto)
  const jaAtivas = [];  // já ativa -> no-op
  for (const e of alvo) {
    const cfg = configAtual.get(e.id);
    if (!cfg) aInserir.push(e);
    else if (cfg.ativa) jaAtivas.push(e);
    else aAtivar.push({ e, cfg });
  }

  // -- Relatório --------------------------------------------------------------
  console.log(`   Regime normal (alvo):      ${alvo.length}`);
  console.log(`   Simples Nacional (pula):   ${puladasSimples.length}`);
  console.log(`   Tributação indefinida:     ${puladasIndefinidas.length}${INCLUIR_INDEFINIDAS ? ' (incluídas por flag)' : ' (puladas — use --incluir-indefinidas)'}`);
  console.log('');
  console.log('Ação na DIME:');
  console.log(`   criar config nova:        ${aInserir.length}`);
  console.log(`   ligar (estava inativa):   ${aAtivar.length}`);
  console.log(`   já ativa (no-op):         ${jaAtivas.length}`);
  console.log('');

  const linhaEmp = (e) => `   [${e.codigo ?? '-'}] ${nomeEmp(e)} · ${TRIB_LABEL[e.tributacao] ?? 'tributação ?'}${e.inscricao_estadual ? ` · IE ${e.inscricao_estadual}` : ''}`;

  if (aInserir.length) { console.log('GANHAM config DIME ativa (vai pro cliente):'); aInserir.forEach((e) => console.log(linhaEmp(e))); console.log(''); }
  if (aAtivar.length) { console.log('REATIVADAS (preservando codigos/envio/motivo):'); aAtivar.forEach(({ e }) => console.log(linhaEmp(e))); console.log(''); }
  if (jaAtivas.length) { console.log('Já estavam ativas (nada a fazer):'); jaAtivas.forEach((e) => console.log(linhaEmp(e))); console.log(''); }
  if (puladasSimples.length) { console.log('Puladas — Simples Nacional (não têm DIME):'); puladasSimples.forEach((e) => console.log(linhaEmp(e))); console.log(''); }
  if (puladasIndefinidas.length) { console.log('Puladas — tributação indefinida (confira o cadastro):'); puladasIndefinidas.forEach((e) => console.log(linhaEmp(e))); console.log(''); }

  if (!APPLY) {
    console.log('DRY-RUN: nada foi gravado. Rode com --apply pra aplicar.');
    return;
  }

  // -- Grava ------------------------------------------------------------------
  const now = new Date().toISOString();
  const rows = [
    // Novas: default DIME vai pro cliente.
    ...aInserir.map((e) => ({
      empresa_id: e.id, obrigacao: 'DIME', ativa: true, codigos: [],
      nao_envia_cliente: false, motivo: null,
      alterada_em: now, alterada_por_nome: 'seed-dime-sc',
    })),
    // Reativadas: preserva o que estava lá, só liga ativa.
    ...aAtivar.map(({ e, cfg }) => ({
      empresa_id: e.id, obrigacao: 'DIME', ativa: true,
      codigos: Array.isArray(cfg.codigos) ? cfg.codigos : [],
      nao_envia_cliente: cfg.nao_envia_cliente ?? false, motivo: cfg.motivo ?? null,
      alterada_em: now, alterada_por_nome: 'seed-dime-sc',
    })),
  ];

  if (!rows.length) { console.log('Nada a gravar (todas já ativas).'); return; }

  let ok = 0, erros = 0;
  // Lotes de 100 pra não estourar payload.
  for (let i = 0; i < rows.length; i += 100) {
    const fatia = rows.slice(i, i + 100);
    const { error } = await sb.from('empresa_obrigacoes_config').upsert(fatia, { onConflict: 'empresa_id,obrigacao' });
    if (error) { console.error(`Erro no lote ${i}:`, error.message); erros += fatia.length; }
    else ok += fatia.length;
  }
  console.log(`Pronto. ${ok} configs DIME gravadas (${erros} erros).`);
  console.log(`Pra reverter: DELETE FROM empresa_obrigacoes_config WHERE obrigacao='DIME' AND alterada_por_nome='seed-dime-sc';`);
}

main().catch((err) => { console.error('Erro fatal:', err); process.exit(1); });
