// Reset "do zero" dos dados de TESTE do auto-envio de guias (usuário ghost
// "Testes" = admin@triarcontabilidade.com.br). Pra a usuária re-soltar os mesmos
// PDFs e ver o fluxo do começo.
//
// ⚠️ DESTRUTIVO e IRREVERSÍVEL no banco/storage. Por isso:
//   - DRY-RUN é o DEFAULT: sem --apply ele só CONTA e mostra o que FARIA.
//   - Nada é apagado sem --apply.
//
// Uso:
//   node scripts/reset-auto-envio-testes.mjs                 # DRY-RUN (não muda nada)
//   node scripts/reset-auto-envio-testes.mjs --apply         # executa banco + storage
//   node scripts/reset-auto-envio-testes.mjs --apply --limpar-estado-local
//                                                            # + zera scripts/.watcher-state.json (faz .bak)
//   node scripts/reset-auto-envio-testes.mjs --apply --incluir-storage-interno
//                                                            # + apaga os PDFs anexados na célula (documentos/empresas/<id>/auto/)
//   node scripts/reset-auto-envio-testes.mjs --apply --resetar-watcher-status
//                                                            # + zera heartbeat do watcher (cosmético)
//   node scripts/reset-auto-envio-testes.mjs --apply --incluir-linhas-humanas
//                                                            # PERIGO: também mexe em linhas concluídas por HUMANO (default NÃO)
//
// Ordem segura (espelha o plano verificado):
//   1) guias_auto_problemas  → DELETE tudo (tabela 100% do auto-envio)
//   2) storage documentos/pendentes-auto/  → remove o prefixo inteiro
//   3) guias_auto_processadas → DELETE tudo (idempotência por hash)
//   4) storage portal-documentos (objetos do ghost) → remove
//   5) portal_documentos (linhas do ghost) → DELETE
//   6) checklist_fiscal → tira SÓ os eventos auto do envios_historico; se a linha
//      ficar sem sucesso e foi concluída pelo ghost, volta pra NÃO concluída
//      (status=NULL). NUNCA toca linha concluída por humano (sem a flag).
//   7) (opcional) storage documentos/empresas/<id>/auto/ das linhas resetadas
//   8) notificacoes de "Guia não enviada automaticamente" → DELETE (só essas)
//   9) (opcional) scripts/.watcher-state.json → zera (com .bak)
//  10) (opcional) watcher_status singleton → zera heartbeat
//
// Antes de --apply: PARE o watcher e esvazie a pasta T:\...\1-GUIAS A ENVIAR\
// (e _PENDENTES) na mão — senão o daemon re-posta tudo.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── flags ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMPAR_ESTADO_LOCAL = argv.includes('--limpar-estado-local');
const INCLUIR_STORAGE_INTERNO = argv.includes('--incluir-storage-interno');
const RESETAR_WATCHER_STATUS = argv.includes('--resetar-watcher-status');
const INCLUIR_LINHAS_HUMANAS = argv.includes('--incluir-linhas-humanas');

const tag = APPLY ? '\x1b[31m[APPLY]\x1b[0m' : '\x1b[36m[DRY-RUN]\x1b[0m';
function log(...a) { console.log(tag, ...a); }
function head(t) { console.log(`\n\x1b[1m=== ${t} ===\x1b[0m`); }

// ─── env ────────────────────────────────────────────────────────────────────
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
const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}
const GHOST = env.GHOST_USER_ID || '0dd329df-3ce7-403b-9bee-2768c33686a3';
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// nomes considerados "do sistema/auto" (não-humano) pra um 2º guard no checklist
const GHOST_NOMES = new Set(['Testes', 'Sistema (automático)', 'Sistema', 'Sistema (automatico)']);

// ─── helpers ──────────────────────────────────────────────────────────────
async function count(tabela, build) {
  let q = admin.from(tabela).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count: c, error } = await q;
  if (error) { console.error(`  ! erro contando ${tabela}:`, error.message); return null; }
  return c ?? 0;
}

function isEventoAuto(ev) {
  return !!ev && (ev.fonte === 'auto-enviado' || ev.fonte === 'auto-interna' || ev.automatico === true);
}

async function confirmarGhost() {
  const { data } = await admin.from('usuarios').select('id, nome, email, role').eq('id', GHOST).maybeSingle();
  if (!data) { console.error(`! GHOST ${GHOST} não encontrado em usuarios. Abortando.`); process.exit(1); }
  log(`Ghost confirmado: ${data.nome} <${data.email}> role=${data.role} id=${data.id}`);
  return data;
}

// ─── 1. guias_auto_problemas ─────────────────────────────────────────────
async function passoProblemas() {
  head('1) guias_auto_problemas (painel Auto-problemas)');
  const total = await count('guias_auto_problemas');
  const abertas = await count('guias_auto_problemas', (q) => q.is('resolvido_em', null));
  log(`linhas: ${total} (abertas=${abertas}, resolvidas=${(total ?? 0) - (abertas ?? 0)}) → DELETE todas`);
  if (APPLY) {
    const { error } = await admin.from('guias_auto_problemas').delete().not('id', 'is', null);
    if (error) console.error('  ! erro:', error.message); else log('  apagadas.');
  }
}

// ─── 2. storage documentos/pendentes-auto/ ───────────────────────────────
async function passoStoragePendentes() {
  head('2) storage documentos/pendentes-auto/');
  const { data, error } = await admin.storage.from('documentos').list('pendentes-auto', { limit: 1000 });
  if (error) { console.error('  ! erro listando:', error.message); return; }
  const paths = (data ?? []).filter((o) => o.name && !o.name.endsWith('/')).map((o) => `pendentes-auto/${o.name}`);
  log(`objetos: ${paths.length} → remover o prefixo inteiro`);
  for (const p of paths.slice(0, 10)) console.log('     -', p);
  if (paths.length > 10) console.log(`     … +${paths.length - 10}`);
  if (APPLY && paths.length) {
    const { error: rmErr } = await admin.storage.from('documentos').remove(paths);
    if (rmErr) console.error('  ! erro removendo:', rmErr.message); else log('  removidos.');
  }
}

// ─── 3. guias_auto_processadas ────────────────────────────────────────────
async function passoProcessadas() {
  head('3) guias_auto_processadas (idempotência por hash)');
  const total = await count('guias_auto_processadas');
  const statuses = ['enviado', 'interno_marcado_feito', 'pendente_correcao', 'pendente_aprovacao_competencia_antiga', 'duplicado_periodo', 'erro'];
  const partes = [];
  for (const s of statuses) partes.push(`${s}=${await count('guias_auto_processadas', (q) => q.eq('status', s))}`);
  log(`linhas: ${total} (${partes.join(', ')}) → DELETE todas`);
  if (APPLY) {
    const { error } = await admin.from('guias_auto_processadas').delete().not('id', 'is', null);
    if (error) console.error('  ! erro:', error.message); else log('  apagadas.');
  }
}

// ─── 4+5. portal_documentos (storage + linhas) ───────────────────────────
async function passoPortal() {
  head('4+5) portal_documentos (ghost) + storage portal-documentos');
  const { data: rows, error } = await admin
    .from('portal_documentos')
    .select('id, arquivo_storage_path, criado_por_usuario_id, competencia, obrigacao_nome, removido_em');
  if (error) { console.error('  ! erro lendo:', error.message); return; }
  const doGhost = (rows ?? []).filter((r) => r.criado_por_usuario_id === GHOST);
  const naoGhost = (rows ?? []).filter((r) => r.criado_por_usuario_id !== GHOST);
  log(`total=${rows?.length ?? 0} | do ghost=${doGhost.length} | de OUTROS=${naoGhost.length}`);
  if (naoGhost.length > 0) {
    console.error(`  ! ATENÇÃO: ${naoGhost.length} linha(s) de portal_documentos NÃO são do ghost. NÃO serão tocadas. (ids: ${naoGhost.slice(0, 5).map((r) => r.id).join(', ')}…)`);
  }
  const storagePaths = doGhost.map((r) => r.arquivo_storage_path).filter(Boolean);
  log(`storage portal-documentos a remover: ${storagePaths.length}`);
  log(`linhas portal_documentos a DELETAR: ${doGhost.length}`);
  if (APPLY) {
    if (storagePaths.length) {
      // remove em lotes de 100
      for (let i = 0; i < storagePaths.length; i += 100) {
        const { error: rmErr } = await admin.storage.from('portal-documentos').remove(storagePaths.slice(i, i + 100));
        if (rmErr) console.error('  ! erro removendo storage:', rmErr.message);
      }
    }
    const ids = doGhost.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error: delErr } = await admin.from('portal_documentos').delete().in('id', ids.slice(i, i + 100));
      if (delErr) console.error('  ! erro deletando linhas:', delErr.message);
    }
    log('  portal limpo.');
  }
}

// ─── 6. checklist_fiscal ─────────────────────────────────────────────────
async function passoChecklist() {
  head('6) checklist_fiscal — tira eventos auto / reseta linha se ficar vazia');
  // universo = linhas com algum evento auto no envios_historico
  const filtros = ['[{"fonte":"auto-enviado"}]', '[{"fonte":"auto-interna"}]', '[{"automatico":true}]'];
  const byId = new Map();
  for (const f of filtros) {
    const { data, error } = await admin
      .from('checklist_fiscal')
      .select('id, empresa_id, mes, obrigacao, concluido, status, concluido_por_id, concluido_por_nome, concluido_em, arquivo_url, arquivo_nome, envios_historico')
      .filter('envios_historico', 'cs', f);
    if (error) { console.error('  ! erro universo:', error.message); return { arquivosInternos: [] }; }
    for (const r of data ?? []) byId.set(r.id, r);
  }
  const universo = [...byId.values()];
  log(`linhas no universo (com evento auto): ${universo.length}`);

  let soFiltradas = 0, resetadas = 0, puladasHumanas = 0;
  const arquivosInternos = [];
  const amostraReset = [];
  const amostraHumana = [];

  for (const row of universo) {
    const hist = Array.isArray(row.envios_historico) ? row.envios_historico : [];
    const pareceHumano = row.concluido_por_id !== GHOST
      || (row.concluido_por_nome && !GHOST_NOMES.has(row.concluido_por_nome));

    if (pareceHumano && !INCLUIR_LINHAS_HUMANAS) {
      puladasHumanas++;
      if (amostraHumana.length < 10) amostraHumana.push(`${row.mes} ${row.obrigacao} (concluída por ${row.concluido_por_nome || '—'})`);
      continue; // não toca: nem filtra o array
    }

    const restantes = hist.filter((ev) => !isEventoAuto(ev));
    if (restantes.length === hist.length) continue; // nada auto removível
    const temSucesso = restantes.some((ev) => ev && ev.sucesso === true);

    const update = { envios_historico: restantes };
    let resetou = false;
    if (!temSucesso && row.concluido_por_id === GHOST) {
      update.concluido = false;
      update.status = null;
      update.concluido_em = null;
      update.concluido_por_id = null;
      update.concluido_por_nome = null;
      if (row.arquivo_url && /^empresas\/.+\/auto\//.test(row.arquivo_url)) {
        arquivosInternos.push(row.arquivo_url);
        update.arquivo_url = null;
        update.arquivo_nome = null;
      }
      resetou = true;
    }

    if (resetou) { resetadas++; if (amostraReset.length < 12) amostraReset.push(`${row.mes} ${row.obrigacao}`); }
    else soFiltradas++;

    if (APPLY) {
      const { error } = await admin.from('checklist_fiscal').update(update).eq('id', row.id);
      if (error) console.error(`  ! erro update ${row.id}:`, error.message);
    }
  }

  log(`→ resetadas p/ NÃO concluída: ${resetadas}`);
  if (amostraReset.length) console.log('     reset:', amostraReset.join(' | '));
  log(`→ só filtrado o array (mantém conclusão, sobrou envio humano): ${soFiltradas}`);
  log(`→ PULADAS por serem de humano (protegidas): ${puladasHumanas}${INCLUIR_LINHAS_HUMANAS ? ' (flag --incluir-linhas-humanas IGNORA essa proteção!)' : ''}`);
  if (amostraHumana.length) console.log('     humanas intocadas:', amostraHumana.join(' | '));
  return { arquivosInternos };
}

// ─── 7. storage interno (opcional) ────────────────────────────────────────
async function passoStorageInterno(arquivosInternos) {
  head('7) storage documentos/empresas/<id>/auto/ (anexos das células resetadas)');
  const paths = [...new Set(arquivosInternos)].filter((p) => /^empresas\/.+\/auto\//.test(p));
  log(`objetos referenciados pelas linhas resetadas: ${paths.length}`);
  if (!INCLUIR_STORAGE_INTERNO) { log('  (pulado — use --incluir-storage-interno pra remover)'); return; }
  for (const p of paths.slice(0, 10)) console.log('     -', p);
  if (APPLY && paths.length) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from('documentos').remove(paths.slice(i, i + 100));
      if (error) console.error('  ! erro:', error.message);
    }
    log('  removidos.');
  }
}

// ─── 8. notificacoes ──────────────────────────────────────────────────────
async function passoNotificacoes() {
  head('8) notificacoes — alertas de "Guia não enviada automaticamente"');
  const c = await count('notificacoes', (q) => q.is('autor_id', null).ilike('titulo', 'Guia não enviada automaticamente%'));
  log(`linhas que casam (autor_id NULL + título do auto-envio): ${c}`);
  if ((c ?? 0) > 15) {
    console.error('  ! GUARD: count alto demais — possível filtro errado pegando alertas legítimos. NÃO vou apagar. Revise.');
    return;
  }
  if (APPLY && (c ?? 0) > 0) {
    const { error } = await admin.from('notificacoes').delete().is('autor_id', null).ilike('titulo', 'Guia não enviada automaticamente%');
    if (error) console.error('  ! erro:', error.message); else log('  apagadas.');
  }
}

// ─── 9. estado local do watcher ───────────────────────────────────────────
function passoEstadoLocal() {
  head('9) scripts/.watcher-state.json (idempotência LOCAL do watcher)');
  const f = resolve(__dirname, '.watcher-state.json');
  if (!existsSync(f)) { log('  arquivo não existe — nada a fazer.'); return; }
  let n = 0;
  try { n = Object.keys(JSON.parse(readFileSync(f, 'utf8')).processados ?? {}).length; } catch {}
  log(`entradas em processados: ${n}`);
  if (!LIMPAR_ESTADO_LOCAL) { log('  (pulado — use --limpar-estado-local pra zerar)'); return; }
  if (APPLY) {
    copyFileSync(f, f + '.bak');
    writeFileSync(f, JSON.stringify({ processados: {}, ultimaSalvada: null }, null, 2), 'utf8');
    log('  zerado (backup em .watcher-state.json.bak).');
  }
}

// ─── 10. watcher_status (opcional) ────────────────────────────────────────
async function passoWatcherStatus() {
  head('10) watcher_status (heartbeat do dead-man switch) — cosmético');
  if (!RESETAR_WATCHER_STATUS) { log('  (pulado — use --resetar-watcher-status)'); return; }
  if (APPLY) {
    const { error } = await admin.from('watcher_status')
      .update({ ultimo_heartbeat: null, heartbeat_meta: null, heartbeat_alertado_em: null })
      .eq('id', 'singleton');
    if (error) console.error('  ! erro:', error.message); else log('  zerado.');
  }
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  log('Reset de dados de TESTE do auto-envio.');
  if (!APPLY) log('MODO DRY-RUN — nada será alterado. Rode com --apply pra valer.');
  else {
    console.log('\x1b[31m  ⚠ MODO APPLY — vai apagar/alterar dados de produção.\x1b[0m');
    console.log('  Confirme que: (1) o watcher está PARADO; (2) a pasta T:\\…\\1-GUIAS A ENVIAR e _PENDENTES estão vazias.');
  }
  await confirmarGhost();

  await passoProblemas();
  await passoStoragePendentes();
  await passoProcessadas();
  await passoPortal();
  const { arquivosInternos } = await passoChecklist();
  await passoStorageInterno(arquivosInternos);
  await passoNotificacoes();
  passoEstadoLocal();
  await passoWatcherStatus();

  head('Fim');
  if (!APPLY) log('DRY-RUN concluído. Revise os números acima e rode com --apply (+ flags) quando aprovar.');
  else log('APPLY concluído.');
}

main().catch((e) => { console.error('FALHA:', e); process.exit(1); });
