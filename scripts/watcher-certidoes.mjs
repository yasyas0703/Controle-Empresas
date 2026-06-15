// Watcher de CERTIDÕES (Controle Cadastro). Lê as pastas do mês em
// T:\Office\PARCELAMENTOS\CERTIDOES e POSTa cada PDF pra
// /api/checklist-cadastro/auto-registrar, que identifica empresa + certidão +
// resultado e grava no checklist. NÃO envia e-mail (só cataloga).
//
// ⚠️ SOMENTE LEITURA: este watcher NUNCA move, renomeia ou apaga arquivos das
//    pastas de origem. Ele só lê. A deduplicação é feita por hash no
//    scripts/.watcher-certidoes-state.json (e no servidor, por hash).
//
// Pastas lidas (mês alvo MM.YYYY):
//   T:\Office\PARCELAMENTOS\CERTIDOES\<MM.YYYY>            (raiz: estadual/federal)
//   T:\Office\PARCELAMENTOS\CERTIDOES\<MM.YYYY>\FGTS
//   T:\Office\PARCELAMENTOS\CERTIDOES\<MM.YYYY>\TRABALHISTA
//   T:\Office\PARCELAMENTOS\CERTIDOES\cndmg               (Estadual-MG, por empresa)
//
// Como rodar:
//   node scripts/watcher-certidoes.mjs                 # mês atual, fica observando
//   node scripts/watcher-certidoes.mjs --mes 2026-06   # mês específico
//   node scripts/watcher-certidoes.mjs --once          # processa e sai
//   node scripts/watcher-certidoes.mjs --dry-run       # só loga, não chama API
//   node scripts/watcher-certidoes.mjs --limit 5       # processa só os 5 primeiros
//   node scripts/watcher-certidoes.mjs --url https://controle-empresas.vercel.app

import { Agent } from 'undici';
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const CERTIDOES_ROOT = process.env.CERTIDOES_ROOT || 'T:\\Office\\PARCELAMENTOS\\CERTIDOES';
const STATE_FILE = resolve(__dirname, '.watcher-certidoes-state.json');
const LOG_FILE = resolve(__dirname, '.watcher-certidoes.log');

const args = process.argv.slice(2);
function argVal(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }
const DRY_RUN = args.includes('--dry-run');
const ONCE = args.includes('--once');
const urlArg = argVal('--url');
const LIMIT = (() => { const n = Number(argVal('--limit')); return Number.isFinite(n) && n > 0 ? n : Infinity; })();

function mesAtualIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const MES_ISO = (() => {
  const m = argVal('--mes');
  return m && /^\d{4}-\d{2}$/.test(m) ? m : mesAtualIso();
})();
// 'YYYY-MM' → 'MM.YYYY' (nome da pasta do mês)
function pastaDoMes(mesIso) { const [y, mm] = mesIso.split('-'); return `${mm}.${y}`; }

let processedCount = 0;

// ─── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  const envPath = resolve(__dirname, '..', '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  for (const k of ['AUTO_ENVIO_TOKEN', 'NEXT_PUBLIC_APP_URL', 'CERTIDOES_ROOT']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}
const env = loadEnv();
const TOKEN = env.AUTO_ENVIO_TOKEN;
if (!TOKEN) { console.error('ERRO: AUTO_ENVIO_TOKEN faltando em .env.local'); process.exit(1); }
const BASE_URL = urlArg || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const API_URL = `${BASE_URL.replace(/\/+$/, '')}/api/checklist-cadastro/auto-registrar`;

// ─── State (idempotência local; não substitui a do servidor) ──────────────────
let state = { processados: {}, ultimaSalvada: null };
function carregarState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!state.processados) state.processados = {};
  } catch (err) {
    console.error('AVISO: state ilegível, começando do zero:', err.message);
    state = { processados: {}, ultimaSalvada: null };
  }
}
let saveTimer = null;
function salvarStateDebounced() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; salvarStateSync(); }, 500);
}
function salvarStateSync() {
  try { state.ultimaSalvada = new Date().toISOString(); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (err) { console.error('AVISO: falha ao salvar state:', err.message); }
}

// ─── Log ─────────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString(); }
function horaCli() { return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }); }
function logFile(level, msg, extra = {}) {
  try { appendFileSync(LOG_FILE, JSON.stringify({ ts: ts(), level, msg, ...extra }) + '\n', 'utf8'); } catch { /* ignore */ }
}
const C = { reset: '\x1b[0m', dim: '\x1b[2m', vermelho: '\x1b[31m', verde: '\x1b[32m', amarelo: '\x1b[33m', azul: '\x1b[34m', ciano: '\x1b[36m', branco: '\x1b[37m' };
function logCli(cor, prefix, msg) { console.log(`${C.dim}${horaCli()}${C.reset} ${cor}${prefix}${C.reset} ${msg}`); }
const log = {
  info: (m, e) => { logCli(C.azul, 'INFO', m); logFile('info', m, e); },
  ok: (m, e) => { logCli(C.verde, 'OK  ', m); logFile('ok', m, e); },
  warn: (m, e) => { logCli(C.amarelo, 'WARN', m); logFile('warn', m, e); },
  err: (m, e) => { logCli(C.vermelho, 'ERR ', m); logFile('error', m, e); },
  step: (m, e) => { logCli(C.ciano, 'STEP', m); logFile('step', m, e); },
  skip: (m, e) => { logCli(C.dim, 'SKIP', m); logFile('skip', m, e); },
};

// ─── Alvos de leitura ─────────────────────────────────────────────────────────
// Cada alvo é { dir, subpasta }. Os arquivos são lidos só desses diretórios
// (não recursivo — as subpastas FGTS/TRABALHISTA são alvos próprios).
// Pasta de ENTRADA (estilo fiscal): solta os PDFs aqui. A competência vira o
// MÊS DO RUN (mesIso). Escaneada SEMPRE — inclusive no loop contínuo (60s).
// É pequena (só os novos), então re-varrer é barato. Flat (tipo pelo texto) +
// subpastas opcionais. Pasta inexistente é ignorada.
const PASTA_ENTRADA = '1- GUIAS A ENVIAR';
function alvosEntrada() {
  const entrada = join(CERTIDOES_ROOT, PASTA_ENTRADA);
  return [
    { dir: entrada, subpasta: 'root' },
    { dir: join(entrada, 'FGTS'), subpasta: 'FGTS' },
    { dir: join(entrada, 'TRABALHISTA'), subpasta: 'TRABALHISTA' },
  ];
}
// Pastas por mês (carga histórica). Varridas só no --once — re-ler ~1000 PDFs do
// T: a cada 60s no loop contínuo seria pesado demais (cada arquivo é lido inteiro
// pra calcular o hash). Por isso o contínuo observa só a entrada.
function alvosMes(mesIso) {
  const pastaMes = join(CERTIDOES_ROOT, pastaDoMes(mesIso));
  return [
    { dir: pastaMes, subpasta: 'root' },
    { dir: join(pastaMes, 'FGTS'), subpasta: 'FGTS' },
    { dir: join(pastaMes, 'TRABALHISTA'), subpasta: 'TRABALHISTA' },
    { dir: join(CERTIDOES_ROOT, 'cndmg'), subpasta: 'cndmg' },
  ];
}

const TAMANHO_MINIMO_PDF = 100;
function validarPdfBuffer(buffer) {
  if (buffer.length < TAMANHO_MINIMO_PDF) return `arquivo muito pequeno (${buffer.length} bytes)`;
  if (buffer.toString('latin1', 0, 5) !== '%PDF-') return 'não começa com %PDF-';
  // %%EOF pode NÃO estar nos últimos 1024 bytes: certidões assinadas (ex.: SP
  // Administrativa, ~1MB) têm a assinatura digital DEPOIS do %%EOF. Procurar só
  // na cauda dava falso "cópia incompleta" e pulava o arquivo. Varre o buffer
  // inteiro (Buffer.includes é nativo/rápido) — um PDF truncado em cópia não tem
  // %%EOF em lugar nenhum, então a proteção contra cópia incompleta continua.
  if (!buffer.includes('%%EOF')) return 'sem %%EOF (cópia incompleta/PDF truncado?)';
  return null;
}

// Status terminais — não re-POSTa se o hash não mudou.
const SKIP_STATUSES = new Set(['registrado', 'ja_processado']);

// ─── Fila / processamento ─────────────────────────────────────────────────────
let processando = false;
const fila = []; // { caminho, subpasta }
let falhasRedeSeguidas = 0;
const MAX_FALHAS_REDE_SEGUIDAS = 5;

function enfileirar(caminho, subpasta) {
  if (fila.some((f) => f.caminho === caminho)) return;
  fila.push({ caminho, subpasta });
  drenarFila();
}

async function drenarFila() {
  if (processando) return;
  processando = true;
  while (fila.length > 0) {
    const item = fila.shift();
    try { await processarArquivo(item.caminho, item.subpasta); }
    catch (err) { log.err(`Falha inesperada em ${basename(item.caminho)}: ${err.message}`, { stack: err.stack }); }
  }
  processando = false;
}

async function processarArquivo(caminho, subpasta) {
  if (processedCount >= LIMIT) { log.skip(`limite ${LIMIT} atingido, pulando ${basename(caminho)}`); return; }

  let buffer;
  try { buffer = readFileSync(caminho); }
  catch (err) {
    if (err.code === 'ENOENT') return; // sumiu — nada a fazer (não mexemos nas pastas)
    log.warn(`não consegui ler ${basename(caminho)} (${err.code || err.message}) — tento na próxima varredura`);
    return;
  }
  const invalido = validarPdfBuffer(buffer);
  if (invalido) { log.warn(`${basename(caminho)}: ${invalido} — pulo por ora`); return; }

  const hash = createHash('sha256').update(buffer).digest('hex');
  const st = state.processados[caminho];
  if (st && st.hash === hash && SKIP_STATUSES.has(st.status)) return; // já registrado, conteúdo igual

  // Mostra a ORIGEM real (entrada x pasta de mês) — "root" sozinho confundia.
  const origem = caminho.includes(PASTA_ENTRADA) ? 'ENTRADA' : (subpasta === 'root' ? pastaDoMes(MES_ISO) : subpasta);
  log.step(`Processando [${origem}] ${basename(caminho)} (${(buffer.length / 1024).toFixed(1)} KB)`);
  processedCount++;

  if (DRY_RUN) {
    log.info(`[DRY-RUN] POST ${API_URL} — ${basename(caminho)} (mes ${MES_ISO}, ${subpasta}, hash ${hash.slice(0, 12)}…)`);
    state.processados[caminho] = { hash, status: 'dry_run', ultimaTentativa: ts() };
    salvarStateDebounced();
    return;
  }

  const tentativas = [1000, 4000, 16000];
  let resultado = null;
  for (let i = 0; i < tentativas.length; i++) {
    try { resultado = await enviarParaApi(caminho, buffer, hash, subpasta); break; }
    catch (err) {
      if (i === tentativas.length - 1) {
        log.err(`Falha definitiva em ${basename(caminho)} após ${tentativas.length} tentativas: ${err.message}`);
        state.processados[caminho] = { hash, status: 'erro_rede', ultimaTentativa: ts(), erro: err.message };
        salvarStateDebounced();
        falhasRedeSeguidas++;
        if (falhasRedeSeguidas >= MAX_FALHAS_REDE_SEGUIDAS) {
          log.err(`${falhasRedeSeguidas} falhas de rede seguidas — saindo pro watcher reiniciar.`);
          salvarStateSync();
          process.exit(1);
        }
        return;
      }
      log.warn(`Tentativa ${i + 1} falhou: ${err.message} — esperando ${tentativas[i + 1] / 1000}s`);
      await new Promise((r) => setTimeout(r, tentativas[i]));
    }
  }
  if (!resultado) return;
  falhasRedeSeguidas = 0;

  const cor = { registrado: C.verde, ja_processado: C.dim, pendente_correcao: C.amarelo, erro: C.vermelho }[resultado.status] || C.branco;
  const resumo = `${cor}${resultado.status}${C.reset} ${C.dim}|${C.reset} ${basename(caminho)}`;
  if (resultado.status === 'registrado') {
    const extra = `${resultado.empresa?.nome ?? '?'} · ${resultado.certidao}${resultado.resultado ? ' · ' + resultado.resultado : ' · (sem resultado)'}${resultado.matchFraco ? ' · ⚠ match fraco' : ''}`;
    log.ok(`${resumo} — ${extra}`, { resposta: resultado });
  } else if (resultado.status === 'erro') {
    log.err(`${resumo} — ${JSON.stringify(resultado.detalhes ?? {})}`, { resposta: resultado });
  } else if (String(resultado.status).startsWith('pendente')) {
    log.warn(`${resumo} — ${JSON.stringify(resultado.detalhes ?? {})}`, { resposta: resultado });
  } else {
    log.info(resumo, { resposta: resultado });
  }

  state.processados[caminho] = { hash, status: resultado.status, ultimaTentativa: ts() };
  salvarStateDebounced();
}

async function enviarParaApi(caminho, buffer, hash, subpasta) {
  const form = new FormData();
  form.append('arquivo', new Blob([buffer], { type: 'application/pdf' }), basename(caminho));
  form.append('meta', JSON.stringify({ caminhoServidor: caminho, hash, mes: MES_ISO, subpasta }));

  const dispatcher = new Agent({ connect: { timeout: 30_000 }, keepAliveTimeout: 1, keepAliveMaxTimeout: 1, pipelining: 0 });
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort('timeout'), 90_000);
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'X-Machine-Token': TOKEN }, body: form, signal: ac.signal, dispatcher });
    if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return await res.json().catch(() => ({ status: 'erro', detalhes: { motivo: 'resposta_nao_json', http: res.status } }));
  } finally {
    clearTimeout(tid);
    dispatcher.destroy().catch(() => {});
  }
}

// ─── Varredura ─────────────────────────────────────────────────────────────────
function scanAll(soEntrada = false) {
  const alvos = soEntrada ? alvosEntrada() : [...alvosEntrada(), ...alvosMes(MES_ISO)];
  for (const alvo of alvos) {
    let entradas;
    try { entradas = readdirSync(alvo.dir, { withFileTypes: true }); }
    catch { continue; } // pasta pode não existir nesse mês — tudo bem
    for (const d of entradas) {
      if (!d.isFile()) continue;
      if (!/\.pdf$/i.test(d.name)) continue;
      enfileirar(join(alvo.dir, d.name), alvo.subpasta);
    }
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
function cabecalho() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Watcher de Certidões — Controle Cadastro (somente leitura)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Mês alvo:    ${MES_ISO}  (pasta ${pastaDoMes(MES_ISO)})`);
  console.log(`  Raiz:        ${CERTIDOES_ROOT}`);
  console.log(`  API:         ${API_URL}`);
  console.log(`  Token:       ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`);
  console.log(`  State:       ${STATE_FILE}`);
  console.log(`  Já no state: ${Object.keys(state.processados).length} arquivos`);
  if (DRY_RUN) console.log(`  ${C.amarelo}MODO DRY-RUN — não chama a API.${C.reset}`);
  if (Number.isFinite(LIMIT)) console.log(`  ${C.amarelo}LIMIT: ${LIMIT} arquivos${C.reset}`);
  if (ONCE) console.log(`  ${C.amarelo}ONCE: processa o que tem e sai${C.reset}`);
  console.log(`  ${C.dim}SOMENTE LEITURA — nenhum arquivo é movido/renomeado/apagado.${C.reset}`);
  console.log('');
}

function iniciar() {
  carregarState();
  cabecalho();
  if (!existsSync(CERTIDOES_ROOT)) {
    log.err(`Raiz ${CERTIDOES_ROOT} não existe/não mapeada. Verifique o T: (ou CERTIDOES_ROOT).`);
    process.exit(1);
  }
  log.info(`Watcher de certidões iniciado (mês ${MES_ISO}).`);

  // --once varre tudo (entrada + pastas de mês). Contínuo observa SÓ a entrada
  // (as pastas de mês são carga histórica; re-lê-las a cada 60s seria pesado).
  scanAll(/* soEntrada */ !ONCE);

  if (ONCE) {
    const espera = setInterval(() => {
      if (!processando && fila.length === 0) {
        clearInterval(espera);
        log.info(`Modo --once: processei ${processedCount} arquivos. Saindo.`);
        salvarStateSync();
        process.exit(0);
      }
    }, 500);
  } else {
    // Re-varre a entrada a cada 60s (T: é drive de rede; polling é o mais confiável).
    setInterval(() => scanAll(true), 60_000);
    log.info(`Modo "watch" ativo — observando ${PASTA_ENTRADA} a cada 60s. Vai colocando que ele vai pegando.`);
  }

  const shutdown = (sig) => { console.log(''); log.info(`${sig} recebido. Salvando state…`); salvarStateSync(); process.exit(0); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => log.err(`Exceção não tratada: ${err.message}`, { stack: err.stack }));
}

iniciar();
