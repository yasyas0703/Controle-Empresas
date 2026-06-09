// Daemon local que observa a pasta ÚNICA T:/Fiscal/EMPRESA/1-GUIAS A ENVIAR/
// e dispara POST pra /api/checklist-fiscal/auto-enviar quando detecta PDFs novos.
//
// O servidor identifica empresa/obrigação/competência pelo CONTEÚDO do PDF (OCR)
// — não precisa mais de padrão de nome de arquivo nem de pasta por empresa.
//
// Como rodar:
//   node scripts/watcher-guias.mjs                # roda em foreground (envia de verdade)
//   node scripts/watcher-guias.mjs --dry-run      # só loga o que faria, NÃO chama API
//   node scripts/watcher-guias.mjs --limit 5      # processa só os 5 primeiros (teste)
//   node scripts/watcher-guias.mjs --once         # processa o que tem e sai
//   node scripts/watcher-guias.mjs --url https://controle-empresas.vercel.app
//
// Como rodar em background no Windows (sobrevive reboot):
//   1. Crie um .bat com: node scripts/watcher-guias.mjs > C:\watcher.log 2>&1
//   2. Task Scheduler → criar tarefa básica → ao logar → executar o .bat
//
// O que faz:
//   - chokidar olha a pasta de entrada com awaitWriteFinish (espera o arquivo
//     terminar de copiar). Qualquer PDF na raiz da pasta vale.
//   - Pra cada PDF novo: calcula SHA-256, faz POST multipart pra API
//   - APÓS a resposta, MOVE o arquivo:
//       enviado/interno_marcado_feito → T:/Fiscal/EMPRESA/<EMPRESA>/<REGIME>/<ANO>/
//       qualquer outro status        → T:/Fiscal/EMPRESA/1-GUIAS A ENVIAR/_PENDENTES/
//   - State local em scripts/.watcher-state.json evita re-POST; o servidor também
//     faz idempotência por hash (defesa em profundidade).
//   - Retry com backoff exponencial (1s, 4s, 16s) em falha de rede
//   - Logs estruturados em scripts/.watcher.log
//
// O que NÃO faz (intencional):
//   - Não desce em subpastas que começam com "_" (ex: _PENDENTES).
//   - Em falha de rede, NÃO move o arquivo (fica na entrada pra re-tentar).

import chokidar from 'chokidar';
import { Agent } from 'undici';
import {
  readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, renameSync, mkdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════
// Configuração
// ═══════════════════════════════════════════════════════════════════════════

// Raiz onde ficam as pastas das empresas (destino dos arquivos arquivados).
// Configurável por env FISCAL_ROOT — ESSENCIAL pra rodar no servidor: um
// Serviço/Tarefa do Windows "sem login" NÃO enxerga drive mapeado (T: é por
// sessão de usuário). No servidor, aponte pro caminho UNC:
//   FISCAL_ROOT=\\NOME-DO-SERVIDOR\Compartilhamento\Fiscal\EMPRESA
// No PC da usuária (com T: mapeado) o default abaixo continua valendo.
const T_ROOT = process.env.FISCAL_ROOT || 'T:\\Fiscal\\EMPRESA';
// Nome da pasta única de entrada (também é o que ignoramos ao resolver empresa).
const NOME_PASTA_ENTRADA = '1-GUIAS A ENVIAR';
const PASTA_ENTRADA = resolve(T_ROOT, NOME_PASTA_ENTRADA);
const PASTA_PENDENTES = resolve(PASTA_ENTRADA, '_PENDENTES');

// Interessa: PDF na pasta de entrada que NÃO esteja numa subpasta "_" (ex: _PENDENTES).
function pathInteressa(caminho) {
  if (!/\.pdf$/i.test(caminho)) return false;
  if (/[\\/]_[^\\/]*([\\/]|$)/.test(caminho)) return false;
  return true;
}

const STATE_FILE = resolve(__dirname, '.watcher-state.json');
const LOG_FILE = resolve(__dirname, '.watcher.log');

const args = process.argv.slice(2);
const urlArg = (() => {
  const i = args.indexOf('--url');
  return i >= 0 ? args[i + 1] : null;
})();
const DRY_RUN = args.includes('--dry-run');
const ONCE = args.includes('--once');
const NO_POLL = args.includes('--no-poll');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();
// --empresa não filtra mais (pasta é única e mista); mantido só pra não quebrar bats.
const EMPRESA_FILTRO = (() => {
  const i = args.indexOf('--empresa');
  return i >= 0 ? args[i + 1] : null;
})();
let processedCount = 0;

// ─── Carrega env: .env.local (dev) + process.env (servidor) ────────────────
// No PC da usuária lê do .env.local. No servidor (Tarefa do Windows / serviço)
// normalmente NÃO há .env.local — as variáveis vêm do ambiente do sistema.
// process.env tem prioridade; .env.local é fallback de desenvolvimento.
function loadEnv() {
  const env = {};
  const envPath = resolve(__dirname, '..', '.env.local');
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
  }
  // process.env vence (.env.local é só conveniência de dev).
  for (const k of ['AUTO_ENVIO_TOKEN', 'NEXT_PUBLIC_APP_URL', 'FISCAL_ROOT']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

const env = loadEnv();
const TOKEN = env.AUTO_ENVIO_TOKEN;
if (!TOKEN) {
  console.error('❌ AUTO_ENVIO_TOKEN faltando em .env.local');
  process.exit(1);
}
const BASE_URL = urlArg || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const API_URL = `${BASE_URL.replace(/\/+$/, '')}/api/checklist-fiscal/auto-enviar`;
const HEARTBEAT_URL = `${API_URL}/heartbeat`;

// ═══════════════════════════════════════════════════════════════════════════
// State local (idempotência rápida — não substitui a do servidor)
// ═══════════════════════════════════════════════════════════════════════════

let state = { processados: {}, ultimaSalvada: null };

function carregarState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    state = JSON.parse(raw);
    if (!state.processados) state.processados = {};
  } catch (err) {
    console.error('⚠️  Não consegui ler state, começando do zero:', err.message);
    state = { processados: {}, ultimaSalvada: null };
  }
}

let saveTimer = null;
function salvarStateDebounced() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    salvarStateSync();
  }, 500);
}

function salvarStateSync() {
  try {
    state.ultimaSalvada = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️  Falha ao salvar state:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Log
// ═══════════════════════════════════════════════════════════════════════════

function ts() {
  return new Date().toISOString();
}

// Hora pra exibir na tela — horário de Brasília (o ts() do log fica em UTC).
function horaCli() {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
}

function logFile(level, msg, extra = {}) {
  const entry = { ts: ts(), level, msg, ...extra };
  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // se falhar log no arquivo, ignora silencioso (não trava daemon)
  }
}

const CORES = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  vermelho: '\x1b[31m', verde: '\x1b[32m', amarelo: '\x1b[33m',
  azul: '\x1b[34m', ciano: '\x1b[36m', branco: '\x1b[37m',
};

function logCli(cor, prefix, msg) {
  const linha = `${CORES.dim}${horaCli()}${CORES.reset} ${cor}${prefix}${CORES.reset} ${msg}`;
  console.log(linha);
}

const log = {
  info:  (msg, extra) => { logCli(CORES.azul, 'INFO ', msg); logFile('info', msg, extra); },
  ok:    (msg, extra) => { logCli(CORES.verde, '✅ OK ', msg); logFile('ok', msg, extra); },
  warn:  (msg, extra) => { logCli(CORES.amarelo, '⚠️  WARN', msg); logFile('warn', msg, extra); },
  err:   (msg, extra) => { logCli(CORES.vermelho, '❌ ERR', msg); logFile('error', msg, extra); },
  step:  (msg, extra) => { logCli(CORES.ciano, '➜   ', msg); logFile('step', msg, extra); },
  skip:  (msg, extra) => { logCli(CORES.dim, '·   skip', msg); logFile('skip', msg, extra); },
};

// ═══════════════════════════════════════════════════════════════════════════
// Arquivamento (move o PDF da entrada pro destino correto)
// ═══════════════════════════════════════════════════════════════════════════

// Normalização forte pra casar nome de empresa (resposta da API vs pasta no T:).
// Mesma lógica do servidor: tira ltda/me/sa/eireli/epp, acentos, pontuação.
function normalizarNomeEmpresa(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bltda\b|\bme\b|\bs\.?a\.?\b|\beireli\b|\beirelli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Acha a pasta real da empresa no T: a partir dos candidatos (apelido/razão/código).
// Retorna o caminho absoluto ou null se não achar / estiver ambíguo (seguro: null).
function acharPastaEmpresa(candidatos) {
  let dirs;
  try {
    dirs = readdirSync(T_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => normalizarNomeEmpresa(n) !== normalizarNomeEmpresa(NOME_PASTA_ENTRADA));
  } catch {
    return null;
  }
  const normDirs = dirs.map((n) => ({ nome: n, norm: normalizarNomeEmpresa(n) }));

  // 1. Match exato normalizado.
  for (const cand of candidatos || []) {
    const c = normalizarNomeEmpresa(cand);
    if (!c) continue;
    const exatos = normDirs.filter((d) => d.norm === c);
    if (exatos.length === 1) return resolve(T_ROOT, exatos[0].nome);
    if (exatos.length > 1) return null; // ambíguo — não arrisca
  }
  // 2. Fallback: prefixo (um começa com o outro), com tamanho mínimo pra evitar lixo.
  for (const cand of candidatos || []) {
    const c = normalizarNomeEmpresa(cand);
    if (c.length < 6) continue;
    const pref = normDirs.filter((d) => d.norm.startsWith(c) || c.startsWith(d.norm));
    if (pref.length === 1) return resolve(T_ROOT, pref[0].nome);
  }
  return null;
}

// Evita sobrescrever: se o nome já existe, adiciona " (2)", " (3)"...
function caminhoSemColisao(dir, nome) {
  if (!existsSync(join(dir, nome))) return join(dir, nome);
  const ponto = nome.lastIndexOf('.');
  const ext = ponto > 0 ? nome.slice(ponto) : '';
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  let i = 2;
  while (existsSync(join(dir, `${base} (${i})${ext}`))) i++;
  return join(dir, `${base} (${i})${ext}`);
}

function moverParaPendentes(caminho) {
  try {
    mkdirSync(PASTA_PENDENTES, { recursive: true });
  } catch {
    // se nem a pasta de pendentes dá pra criar, deixa o arquivo onde está
  }
  const alvo = caminhoSemColisao(PASTA_PENDENTES, basename(caminho));
  try {
    renameSync(caminho, alvo);
    log.info(`Movido pra _PENDENTES: ${basename(alvo)}`);
    return true;
  } catch (err) {
    log.err(`Falha ao mover ${basename(caminho)} pra _PENDENTES: ${err.message}`);
    return false;
  }
}

// Erros do Windows quando o arquivo está ABERTO/travado (visualizador de PDF,
// antivírus, handle do chokidar ainda segurando). Não é falha de envio — o
// arquivo só não pode ser MOVIDO enquanto está aberto.
function ehErroDeLock(err) {
  return !!err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Renomeia com algumas re-tentativas curtas — resolve locks transitórios
// (antivírus passando, handle solto pelo chokidar) sem esperar a próxima
// varredura. Lock persistente (PDF aberto pela usuária) cai de volta no caller.
async function renomearComRetry(de, para, esperas = [300, 1000, 2500]) {
  for (let i = 0; ; i++) {
    try {
      renameSync(de, para);
      return { ok: true };
    } catch (err) {
      if (ehErroDeLock(err) && i < esperas.length) {
        await dormir(esperas[i]);
        continue;
      }
      return { ok: false, locked: ehErroDeLock(err), err };
    }
  }
}

// Arquiva o PDF enviado na pasta definitiva da empresa.
// Retorna true se conseguiu TIRAR o arquivo da entrada; false se ficou preso
// (PDF aberto) — nesse caso o caller guarda o destino e a varredura periódica
// re-tenta SÓ a movimentação depois, SEM reenviar.
async function arquivarNaEmpresa(caminho, destino) {
  const pasta = acharPastaEmpresa(destino?.candidatosPasta || []);
  if (!pasta) {
    log.warn(`Enviado, mas não achei a pasta da empresa no T: (${(destino?.candidatosPasta || []).join(' / ')}). Vai pra _PENDENTES pra arquivar na mão.`);
    return moverParaPendentes(caminho);
  }
  const destDir = join(pasta, destino.regime || 'FECHAMENTO', String(destino.ano || ''));
  try {
    mkdirSync(destDir, { recursive: true });
  } catch (err) {
    log.err(`Falha ao criar ${destDir}: ${err.message}. Vai pra _PENDENTES.`);
    return moverParaPendentes(caminho);
  }
  const nome = destino.nomeArquivo || basename(caminho);
  const alvo = caminhoSemColisao(destDir, nome);
  const r = await renomearComRetry(caminho, alvo);
  if (r.ok) {
    log.ok(`Arquivado: ${basename(alvo)} → ${destDir}`);
    return true;
  }
  if (r.locked) {
    // NÃO é erro de envio: o email já saiu e o checklist já foi marcado. Só não
    // dá pra mover o PDF porque ele está ABERTO. Loga calmo e deixa na entrada —
    // a varredura periódica arquiva sozinha assim que o arquivo for fechado.
    log.warn(`Enviado e marcado no checklist — só não arquivei "${basename(caminho)}" ainda porque o PDF está ABERTO (resource busy). Feche o arquivo que eu arquivo sozinho em alguns segundos.`);
    return false;
  }
  // Erro real (permissão, caminho inválido): tira da entrada pra não ficar preso.
  log.err(`Falha ao arquivar ${basename(caminho)} em ${destDir}: ${r.err?.message}. Vai pra _PENDENTES.`);
  return moverParaPendentes(caminho);
}

// Decide pra onde o arquivo vai conforme o status retornado pela API.
// Retorna true se o arquivo saiu da entrada (arquivado ou movido pra pendentes);
// false se ficou preso (re-tentar só a movimentação depois).
async function moverConformeResultado(caminho, resultado) {
  const enviou = resultado.status === 'enviado' || resultado.status === 'interno_marcado_feito';
  if (enviou && resultado.destino) {
    return await arquivarNaEmpresa(caminho, resultado.destino);
  }
  // pendente_*, erro, duplicado_periodo, ja_processado → sai da entrada
  return moverParaPendentes(caminho);
}

// Varredura periódica de "arquivamentos presos": arquivos que JÁ foram enviados
// (checklist marcado, email enviado) mas ficaram na entrada porque o PDF estava
// aberto na hora (EBUSY). O chokidar não re-emite evento pra um arquivo que
// continua parado, então precisamos olhar ativamente. Re-enfileira só esses —
// processarArquivo vê o state terminal e re-tenta SÓ a movimentação, nunca
// reenvia.
function reprocessarArquivamentosPresos() {
  let entradas;
  try {
    entradas = readdirSync(PASTA_ENTRADA, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of entradas) {
    if (!d.isFile()) continue;
    const caminho = join(PASTA_ENTRADA, d.name);
    if (!pathInteressa(caminho)) continue;
    const st = state.processados[caminho];
    if (st && st.arquivado === false && st.destino
        && (st.status === 'enviado' || st.status === 'interno_marcado_feito')) {
      enfileirar(caminho);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Processamento de arquivo
// ═══════════════════════════════════════════════════════════════════════════

// Fila simples: garante 1 processamento por vez pra não estourar API.
let processando = false;
const fila = [];

// Conta falhas de REDE consecutivas. Conexão keep-alive da Vercel às vezes
// "morre" depois de uma requisição lenta (cold start) e o undici fica reusando
// o socket podre. Se acontecer N vezes seguidas, sai do processo; o
// watcher-3-prod.bat reinicia em 10s com conexão nova.
let falhasRedeSeguidas = 0;
const MAX_FALHAS_REDE_SEGUIDAS = 5;

function enfileirar(caminho) {
  if (fila.includes(caminho)) return;
  fila.push(caminho);
  drenarFila();
}

async function drenarFila() {
  if (processando) return;
  processando = true;
  while (fila.length > 0) {
    const caminho = fila.shift();
    try {
      await processarArquivo(caminho);
    } catch (err) {
      log.err(`Falha inesperada em ${basename(caminho)}: ${err.message}`, { caminho, stack: err.stack });
    }
  }
  processando = false;
}

async function processarArquivo(caminho) {
  if (processedCount >= LIMIT) {
    log.skip(`limite ${LIMIT} atingido, pulando ${basename(caminho)}`);
    return;
  }

  // 1. Lê arquivo + hash
  let buffer;
  try {
    buffer = readFileSync(caminho);
  } catch (err) {
    log.warn(`Não consegui ler ${basename(caminho)}: ${err.code} (provavelmente moveram/apagaram)`, { caminho });
    return;
  }
  const hash = createHash('sha256').update(buffer).digest('hex');

  // 2. Já processado localmente? (idempotência rápida)
  // Só pula o que teve desfecho TERMINAL (já enviou / já estava resolvido). Guias
  // que foram pra PENDÊNCIA (não reconhecida, config inativa, etc.) DEVEM ser
  // reprocessáveis: se a usuária corrige a causa e joga o arquivo de novo na
  // entrada, tem que tentar de novo. (erro_rede também reprocessa — a requisição
  // nunca chegou no servidor.)
  const SKIP_STATUSES = new Set(['enviado', 'interno_marcado_feito', 'ja_processado', 'duplicado_periodo']);
  const stEntry = state.processados[caminho];
  if (stEntry && stEntry.hash === hash && SKIP_STATUSES.has(stEntry.status)) {
    // Já teve desfecho terminal — NUNCA reenvia. Mas se foi enviado e o
    // arquivamento ficou pendente (PDF estava aberto → EBUSY), re-tenta SÓ mover
    // o arquivo agora que ele talvez já tenha sido fechado.
    if (stEntry.arquivado === false && stEntry.destino) {
      const ok = await arquivarNaEmpresa(caminho, stEntry.destino);
      if (ok) {
        stEntry.arquivado = true;
        stEntry.destino = null;
        salvarStateDebounced();
      }
    }
    return;
  }

  log.step(`Processando ${basename(caminho)} (${(buffer.length / 1024).toFixed(1)} KB)`);
  processedCount++;

  // DRY RUN: só loga o que faria, sem chamar API nem mover.
  if (DRY_RUN) {
    log.info(`[DRY-RUN] Faria POST pra ${API_URL} com ${basename(caminho)} (hash: ${hash.slice(0, 12)}...)`);
    state.processados[caminho] = {
      hash, status: 'dry_run', ultimaTentativa: ts(), tentativas: 0,
    };
    salvarStateDebounced();
    return;
  }

  // 3. POST com retry
  const tentativas = [1000, 4000, 16000]; // backoff em ms
  let resultado = null;

  for (let i = 0; i < tentativas.length; i++) {
    try {
      resultado = await enviarParaApi(caminho, buffer, hash);
      break; // sucesso (HTTP 200, qualquer status retornado)
    } catch (err) {
      const ultima = i === tentativas.length - 1;
      if (ultima) {
        log.err(`Falha definitiva pra ${basename(caminho)} após ${tentativas.length} tentativas: ${err.message}`, { caminho, hash });
        // Marca no state pra não re-tentar em loop. Re-tenta se hash mudar.
        // NÃO move o arquivo — fica na entrada pra próxima varredura tentar de novo.
        state.processados[caminho] = {
          hash, status: 'erro_rede', ultimaTentativa: ts(), tentativas: tentativas.length, erro: err.message,
        };
        salvarStateDebounced();
        falhasRedeSeguidas++;
        if (falhasRedeSeguidas >= MAX_FALHAS_REDE_SEGUIDAS) {
          log.err(`${falhasRedeSeguidas} falhas de rede seguidas — conexão travou. Saindo pro watcher reiniciar.`);
          salvarStateSync();
          process.exit(1);
        }
        return;
      }
      log.warn(`Tentativa ${i + 1} falhou: ${err.message} — esperando ${tentativas[i + 1] / 1000}s`);
      await new Promise((r) => setTimeout(r, tentativas[i]));
    }
  }

  // 4. Loga, move o arquivo e atualiza state
  if (!resultado) return;
  falhasRedeSeguidas = 0; // chegou no servidor — zera contador de falhas de rede

  const cor = {
    enviado: CORES.verde,
    ja_processado: CORES.dim,
    pendente_correcao: CORES.amarelo,
    pendente_aprovacao_primeira_vez: CORES.amarelo,
    pendente_aprovacao_competencia_antiga: CORES.amarelo,
    duplicado_periodo: CORES.dim,
    interno_marcado_feito: CORES.verde,
    erro: CORES.vermelho,
  }[resultado.status] || CORES.branco;

  const linhaResumo = `${cor}${resultado.status}${CORES.reset} ${CORES.dim}|${CORES.reset} ${basename(caminho)}`;
  if (resultado.status === 'enviado' || resultado.status === 'interno_marcado_feito') {
    log.ok(linhaResumo, { caminho, resposta: resultado });
  } else if (resultado.status === 'erro') {
    log.err(linhaResumo, { caminho, resposta: resultado });
  } else if (String(resultado.status).startsWith('pendente')) {
    log.warn(`${linhaResumo} — ${JSON.stringify(resultado.detalhes ?? {})}`, { caminho, resposta: resultado });
  } else {
    log.info(linhaResumo, { caminho, resposta: resultado });
  }

  // Move conforme o resultado (enviado → pasta da empresa; resto → _PENDENTES).
  // Se o arquivamento falhar por lock (PDF aberto), guarda o destino pra a
  // varredura periódica re-tentar SÓ a movimentação depois — sem reenviar.
  const arquivado = await moverConformeResultado(caminho, resultado);

  state.processados[caminho] = {
    hash,
    status: resultado.status,
    ultimaTentativa: ts(),
    tentativas: 1,
    arquivado,
    destino: arquivado ? null : (resultado.destino ?? null),
  };
  salvarStateDebounced();
}

async function enviarParaApi(caminho, buffer, hash) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: 'application/pdf' });
  form.append('arquivo', blob, basename(caminho));
  form.append('meta', JSON.stringify({ caminhoServidor: caminho, hash }));

  // Pool de conexão NOVO e descartável por requisição. Era a causa do
  // "fetch failed" em cascata: depois de uma requisição lenta (cold start da
  // Vercel), o socket reaproveitado "azedava". Um Agent novo por envio equivale
  // a um processo novo. Destruído no finally.
  const dispatcher = new Agent({
    connect: { timeout: 30_000 },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    pipelining: 0,
  });

  // Timeout amplo (90s): cold start da Vercel às vezes passa de 60s.
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort('timeout'), 90_000);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'X-Machine-Token': TOKEN },
      body: form,
      signal: ac.signal,
      dispatcher,
    });

    if (!res.ok && res.status >= 500) {
      // 5xx = erro do servidor, vale tentar de novo
      throw new Error(`HTTP ${res.status}`);
    }

    // 4xx e 2xx — o servidor já decidiu, não adianta re-tentar.
    return await res.json().catch(() => ({ status: 'erro', detalhes: { motivo: 'resposta_nao_json', http: res.status } }));
  } finally {
    clearTimeout(tid);
    dispatcher.destroy().catch(() => {}); // fecha o pool dessa requisição
  }
}

// Heartbeat: avisa o servidor que o watcher está vivo (dead-man switch). Se
// parar de bater, o cron alerta "watcher parado". Best-effort — nunca derruba
// o processo. Em dry-run não toca no servidor.
async function baterPonto() {
  if (DRY_RUN) return;
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort('timeout'), 15_000);
  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'X-Machine-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: process.env.COMPUTERNAME || null,
        modo: ONCE ? 'once' : 'watch',
        pendentes: fila.length,
      }),
      signal: ac.signal,
    });
  } catch {
    // silencioso — heartbeat é best-effort
  } finally {
    clearTimeout(tid);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

function imprimirCabecalho() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Watcher de Guias Fiscais — Controle Triar                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  📥 Entrada:     ${PASTA_ENTRADA}`);
  console.log(`  📦 Arquiva em:  ${T_ROOT}\\<EMPRESA>\\<REGIME>\\<ANO>\\`);
  console.log(`  ⏳ Pendências:  ${PASTA_PENDENTES}`);
  console.log(`  🌐 API:         ${API_URL}`);
  console.log(`  🔑 Token:       ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`);
  console.log(`  💾 State:       ${STATE_FILE}`);
  console.log(`  📝 Log:         ${LOG_FILE}`);
  console.log(`  ♻️  Já no state: ${Object.keys(state.processados).length} arquivos`);
  if (DRY_RUN) console.log(`  ${CORES.amarelo}🧪 MODO DRY-RUN — NÃO vai chamar a API nem mover arquivos.${CORES.reset}`);
  if (Number.isFinite(LIMIT)) console.log(`  ${CORES.amarelo}🔢 LIMIT: processa só ${LIMIT} arquivos${CORES.reset}`);
  if (ONCE) console.log(`  ${CORES.amarelo}⏭️  ONCE: processa o que tem e sai${CORES.reset}`);
  if (EMPRESA_FILTRO) console.log(`  ${CORES.amarelo}ℹ️  --empresa "${EMPRESA_FILTRO}" ignorado (pasta única e mista).${CORES.reset}`);
  console.log('');
  console.log('  Pressione Ctrl+C pra parar (salva state antes).');
  console.log('');
}

function iniciar() {
  carregarState();
  imprimirCabecalho();

  if (!existsSync(T_ROOT)) {
    log.err(`Pasta ${T_ROOT} não existe ou não está mapeada. Verifique se o T: está acessível.`);
    process.exit(1);
  }
  if (!existsSync(PASTA_ENTRADA)) {
    log.err(`Pasta de entrada ${PASTA_ENTRADA} não existe. Crie-a no servidor antes de rodar.`);
    process.exit(1);
  }

  log.info(`Watcher iniciado. Observando ${PASTA_ENTRADA}.`);
  logFile('info', 'startup', { entrada: PASTA_ENTRADA, apiUrl: API_URL });

  // Bate ponto agora e, no modo watch contínuo, a cada 5 min.
  baterPonto();
  if (!ONCE) setInterval(baterPonto, 5 * 60_000);

  // Varre arquivamentos presos (PDF aberto na hora do envio) a cada 45s.
  if (!ONCE) setInterval(reprocessarArquivamentosPresos, 45_000);

  const watcher = chokidar.watch(PASTA_ENTRADA, {
    persistent: true,
    ignoreInitial: false, // processa o que já tá lá (state local filtra os já processados)
    awaitWriteFinish: {
      stabilityThreshold: 2000, // espera 2s sem mudança = arquivo terminou de copiar
      pollInterval: 200,
    },
    ignored: (path) => {
      // chokidar 4.x: filtro chamado pra cada path (arquivo ou diretório).
      // Retornar true = ignorar; false = processar.
      if (/(^|[\\/])\.[^.]/.test(path)) return true;          // dotfiles
      if (/~\$/.test(path)) return true;                       // temp do Office
      if (/[\\/]_[^\\/]*([\\/]|$)/.test(path)) return true;    // subpastas "_" (ex: _PENDENTES)
      if (/\.pdf$/i.test(path)) return false;                  // PDFs interessam
      if (/\.[a-z0-9]{1,5}$/i.test(path)) return true;         // outros arquivos
      return false;                                            // diretórios passam
    },
    // T: é drive de rede no Windows. fs.watch não funciona em drives de rede —
    // polling é a única forma confiável. 30s entre scans é compromisso aceitável.
    usePolling: !NO_POLL,
    interval: 30_000,
    binaryInterval: 30_000,
  });

  let totalDetectado = 0;

  watcher.on('add', (caminho) => {
    if (!pathInteressa(caminho)) return; // dupla checagem
    totalDetectado++;
    enfileirar(caminho);
  });

  watcher.on('change', (caminho) => {
    if (!pathInteressa(caminho)) return;
    log.info(`Mudou: ${basename(caminho)}`);
    delete state.processados[caminho];
    enfileirar(caminho);
  });

  watcher.on('unlink', (caminho) => {
    if (!pathInteressa(caminho)) return;
    // Sai da entrada (movido por nós ou removido na mão) — só loga.
    log.info(`Saiu da entrada: ${basename(caminho)}`);
  });

  watcher.on('error', (err) => {
    log.err(`Erro do chokidar: ${err.message}`, { stack: err.stack });
  });

  watcher.on('ready', () => {
    log.info(`Scan inicial completo. ${totalDetectado} arquivos detectados, fila: ${fila.length}.`);
    if (ONCE) {
      const espera = setInterval(() => {
        if (!processando && fila.length === 0) {
          clearInterval(espera);
          log.info(`Modo --once: processei ${processedCount} arquivos. Saindo.`);
          salvarStateSync();
          watcher.close().then(() => process.exit(0));
        }
      }, 500);
    } else {
      log.info('Modo "watch" ativo — esperando novos arquivos...');
    }
  });

  // ─── Graceful shutdown ───
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');
    log.info(`${signal} recebido. Finalizando...`);
    salvarStateSync();
    watcher.close().then(() => {
      log.info('Watcher fechado. Tchau!');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.err(`Exceção não tratada: ${err.message}`, { stack: err.stack });
  });
}

iniciar();
