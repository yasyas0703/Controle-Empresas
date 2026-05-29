// Daemon local que observa T:/Fiscal/EMPRESA/*/{FECHAMENTO,SIMPLES NACIONAL}/
// e dispara POST pra /api/checklist-fiscal/auto-enviar quando detecta PDFs novos.
//
// Como rodar:
//   node scripts/watcher-guias.mjs                # roda em foreground (envia de verdade)
//   node scripts/watcher-guias.mjs --dry-run      # só loga o que faria, NÃO chama API
//   node scripts/watcher-guias.mjs --limit 5      # processa só os 5 primeiros (teste)
//   node scripts/watcher-guias.mjs --once         # processa o que tem e sai
//   node scripts/watcher-guias.mjs --url https://controle-triar.vercel.app
//
// Como rodar em background no Windows (sobrevive reboot):
//   1. Crie um .bat com: node scripts/watcher-guias.mjs > C:\watcher.log 2>&1
//   2. Task Scheduler → criar tarefa básica → ao logar → executar o .bat
//   (Ou use node-windows pra instalar como Serviço — ver scripts/README-watcher.md)
//
// O que faz:
//   - chokidar olha as pastas com awaitWriteFinish (espera arquivo terminar de copiar)
//   - Pra cada PDF novo: calcula SHA-256, faz POST multipart pra API
//   - State local em scripts/.watcher-state.json (path → hash → status) evita re-POST
//     mesmo após restart. O servidor também faz idempotência (defesa em profundidade).
//   - Retry com backoff exponencial (1s, 4s, 16s) em falha de rede
//   - Logs estruturados em scripts/.watcher.log
//
// O que NÃO faz (intencional):
//   - Não move/renomeia/apaga arquivos no T:. Apenas LÊ.
//   - Não bate em LIVROS FISCAIS, SPED, REINF (só FECHAMENTO e SIMPLES NACIONAL).

import chokidar from 'chokidar';
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════
// Configuração
// ═══════════════════════════════════════════════════════════════════════════

const T_ROOT = 'T:\\Fiscal\\EMPRESA';

// Anos que valem a pena observar (ajustar conforme passa o tempo).
// Generoso pra trás (pegar correções de meses anteriores) e pra frente
// (pra quando virar ano sem precisar mudar o daemon).
const ANOS = [2024, 2025, 2026, 2027];
const ANOS_SET = new Set(ANOS.map(String));

// chokidar 4.x removeu suporte a glob — agora a gente observa T:/Fiscal/EMPRESA
// inteiro (recursive) e filtra paths com regex no callback. Mais robusto
// (não depende de glob no Windows) e tem o mesmo resultado.
const PATH_PATTERN = /[\\/]EMPRESA[\\/][^\\/]+[\\/](FECHAMENTO|SIMPLES NACIONAL)[\\/](\d{4})[\\/].*\.pdf$/i;

function pathInteressa(caminho) {
  const m = caminho.match(PATH_PATTERN);
  if (!m) return false;
  if (!ANOS_SET.has(m[2])) return false;
  if (EMPRESA_FILTRO) {
    // Extrai a parte do nome da empresa (entre EMPRESA\ e \FECHAMENTO|SIMPLES NACIONAL)
    const me = caminho.match(/[\\/]EMPRESA[\\/]([^\\/]+)[\\/]/i);
    const nome = me?.[1] ?? '';
    if (!nome.toUpperCase().includes(EMPRESA_FILTRO.toUpperCase())) return false;
  }
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
const EMPRESA_FILTRO = (() => {
  const i = args.indexOf('--empresa');
  return i >= 0 ? args[i + 1] : null;
})();
let processedCount = 0;

// ─── Carrega env do .env.local ─────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) {
    console.error(`❌ Não achei .env.local em ${envPath}`);
    process.exit(1);
  }
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

const env = loadEnv();
const TOKEN = env.AUTO_ENVIO_TOKEN;
if (!TOKEN) {
  console.error('❌ AUTO_ENVIO_TOKEN faltando em .env.local');
  process.exit(1);
}
const BASE_URL = urlArg || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const API_URL = `${BASE_URL.replace(/\/+$/, '')}/api/checklist-fiscal/auto-enviar`;

// ═══════════════════════════════════════════════════════════════════════════
// State local (idempotência rápida — não substitui a do servidor)
// ═══════════════════════════════════════════════════════════════════════════

// Shape:
//   { "T:/.../arquivo.pdf": { hash: "...", status: "enviado", ultimaTentativa: "ISO", tentativas: 1 } }
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
  // Debounce: não escrever a cada arquivo, agrupar em ~500ms
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
  const linha = `${CORES.dim}${ts().slice(11, 19)}${CORES.reset} ${cor}${prefix}${CORES.reset} ${msg}`;
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
// Processamento de arquivo
// ═══════════════════════════════════════════════════════════════════════════

// Fila simples: garante 1 processamento por vez pra não estourar API
// nem sobrecarregar a máquina com PDFs grandes em paralelo.
let processando = false;
const fila = [];

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
  // EXCEÇÃO: se a última tentativa foi falha de REDE ('erro_rede'), a requisição
  // nunca chegou no servidor (nada foi gravado lá), então re-tentamos na próxima
  // varredura. Sem isso, um blip de rede (deploy, queda momentânea) travava o
  // arquivo até alguém renomear na mão.
  const stEntry = state.processados[caminho];
  if (stEntry && stEntry.hash === hash && stEntry.status !== 'erro_rede') {
    // Mesma versão exata, já resolvida — pula
    return;
  }

  log.step(`Processando ${basename(caminho)} (${(buffer.length / 1024).toFixed(1)} KB)`);
  processedCount++;

  // DRY RUN: só loga o que faria, sem chamar API
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
        // Marca no state pra não ficar re-tentando em loop. Vai re-tentar
        // se hash do arquivo mudar.
        state.processados[caminho] = {
          hash, status: 'erro_rede', ultimaTentativa: ts(), tentativas: tentativas.length, erro: err.message,
        };
        salvarStateDebounced();
        return;
      }
      log.warn(`Tentativa ${i + 1} falhou: ${err.message} — esperando ${tentativas[i + 1] / 1000}s`);
      await new Promise((r) => setTimeout(r, tentativas[i]));
    }
  }

  // 4. Loga e atualiza state
  if (!resultado) return;

  const cor = {
    enviado: CORES.verde,
    ja_processado: CORES.dim,
    pendente_correcao: CORES.amarelo,
    pendente_aprovacao_primeira_vez: CORES.amarelo,
    duplicado_periodo: CORES.dim,
    interno_marcado_feito: CORES.verde,
    erro: CORES.vermelho,
  }[resultado.status] || CORES.branco;

  const linhaResumo = `${cor}${resultado.status}${CORES.reset} ${CORES.dim}|${CORES.reset} ${basename(caminho)}`;
  if (resultado.status === 'enviado') {
    log.ok(linhaResumo, { caminho, resposta: resultado });
  } else if (resultado.status === 'erro') {
    log.err(linhaResumo, { caminho, resposta: resultado });
  } else if (resultado.status === 'pendente_correcao' || resultado.status === 'pendente_aprovacao_primeira_vez') {
    log.warn(`${linhaResumo} — ${JSON.stringify(resultado.detalhes ?? {})}`, { caminho, resposta: resultado });
  } else {
    log.info(linhaResumo, { caminho, resposta: resultado });
  }

  state.processados[caminho] = {
    hash,
    status: resultado.status,
    ultimaTentativa: ts(),
    tentativas: 1,
  };
  salvarStateDebounced();
}

async function enviarParaApi(caminho, buffer, hash) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: 'application/pdf' });
  form.append('arquivo', blob, basename(caminho));
  form.append('meta', JSON.stringify({ caminhoServidor: caminho, hash }));

  // Timeout de 60s — PDFs grandes + validação pode demorar
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort('timeout'), 60_000);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'X-Machine-Token': TOKEN },
      body: form,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok && res.status >= 500) {
    // 5xx = erro do servidor, vale tentar de novo
    throw new Error(`HTTP ${res.status}`);
  }

  // 4xx e 2xx — o servidor já decidiu, não adianta re-tentar.
  // Retorna o JSON pra logar (mesmo se for erro de validação)
  return await res.json().catch(() => ({ status: 'erro', detalhes: { motivo: 'resposta_nao_json', http: res.status } }));
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
  console.log(`  📁 Observando:  ${T_ROOT}`);
  console.log(`  📅 Anos:        ${ANOS.join(', ')}`);
  console.log(`  📂 Pastas:      FECHAMENTO, SIMPLES NACIONAL`);
  console.log(`  🌐 API:         ${API_URL}`);
  console.log(`  🔑 Token:       ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`);
  console.log(`  💾 State:       ${STATE_FILE}`);
  console.log(`  📝 Log:         ${LOG_FILE}`);
  console.log(`  ♻️  Já no state: ${Object.keys(state.processados).length} arquivos`);
  if (DRY_RUN) console.log(`  ${CORES.amarelo}🧪 MODO DRY-RUN — NÃO vai chamar a API.${CORES.reset}`);
  if (Number.isFinite(LIMIT)) console.log(`  ${CORES.amarelo}🔢 LIMIT: processa só ${LIMIT} arquivos${CORES.reset}`);
  if (ONCE) console.log(`  ${CORES.amarelo}⏭️  ONCE: processa o que tem e sai${CORES.reset}`);
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

  // Se --empresa foi passado, observa só a pasta dessa empresa (scan mais rápido).
  // Senão observa T:/Fiscal/EMPRESA inteiro.
  let pastaObservada = T_ROOT;
  if (EMPRESA_FILTRO) {
    // Tenta achar a pasta exata. Match case-insensitive contendo o filtro.
    try {
      const subs = readdirSync(T_ROOT);
      const match = subs.find((d) => d.toUpperCase().includes(EMPRESA_FILTRO.toUpperCase()));
      if (match) {
        pastaObservada = resolve(T_ROOT, match);
        log.info(`Filtro --empresa: observando só ${pastaObservada}`);
      } else {
        log.err(`Nenhuma pasta em ${T_ROOT} contém "${EMPRESA_FILTRO}".`);
        process.exit(1);
      }
    } catch (err) {
      log.err(`Falha ao listar ${T_ROOT}: ${err.message}`);
      process.exit(1);
    }
  }

  log.info(`Watcher iniciado. Observando ${pastaObservada} (recursivo, filtro regex).`);
  logFile('info', 'startup', { root: pastaObservada, anos: ANOS, apiUrl: API_URL });

  const watcher = chokidar.watch(pastaObservada, {
    persistent: true,
    ignoreInitial: false, // processa o que já tá lá (state local filtra os já processados)
    awaitWriteFinish: {
      stabilityThreshold: 2000, // espera 2s sem mudança = arquivo terminou de copiar
      pollInterval: 200,
    },
    ignored: (path) => {
      // chokidar 4.x: filtro chamado pra cada path (arquivo ou diretório).
      // Retornar true = ignorar; false = processar.
      //
      // Estratégia sem statSync (evita IO síncrono em cada path):
      //   - dotfiles e temp do Office → ignora sempre
      //   - .pdf → só permite se bate com nosso pattern (FECHAMENTO/SN/ano OK)
      //   - outras extensões conhecidas (.xlsx, .doc, .zip etc) → ignora
      //   - sem extensão (provavelmente diretório) → deixa passar pra chokidar descer
      if (/(^|[\\\/])\.[^.]/.test(path)) return true;
      if (/~\$/.test(path)) return true;
      if (/\.pdf$/i.test(path)) return !pathInteressa(path);
      if (/\.[a-z0-9]{1,5}$/i.test(path)) return true;
      return false;
    },
    // T: é drive de rede no Windows. fs.watch (ReadDirectoryChangesW) NÃO
    // funciona em drives de rede — dá "UNKNOWN: unknown error, watch".
    // Polling é a única forma confiável aqui. Custa CPU, mas é o que tem.
    // 30s entre polls é compromisso aceitável (guia que cai à 14:00:00 vira
    // email no máximo 14:00:30). Se quiser local, passa --no-poll.
    usePolling: !NO_POLL,
    interval: 30_000,        // 30s entre scans completos
    binaryInterval: 30_000,  // mesmo pra binários
  });

  let totalDetectado = 0;
  let inicializado = false;

  watcher.on('add', (caminho) => {
    if (!pathInteressa(caminho)) return; // dupla checagem
    totalDetectado++;
    enfileirar(caminho);
  });

  watcher.on('change', (caminho) => {
    if (!pathInteressa(caminho)) return;
    // Arquivo modificado — invalida state e reprocessa
    log.info(`Mudou: ${basename(caminho)}`);
    delete state.processados[caminho];
    enfileirar(caminho);
  });

  watcher.on('unlink', (caminho) => {
    if (!pathInteressa(caminho)) return;
    log.info(`Removido: ${basename(caminho)} (mantendo histórico no state)`);
    // NÃO removemos do state — se voltar com mesmo conteúdo, queremos
    // saber que já foi processado. Limpeza é manual via comando.
  });

  watcher.on('error', (err) => {
    log.err(`Erro do chokidar: ${err.message}`, { stack: err.stack });
  });

  watcher.on('ready', () => {
    inicializado = true;
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
    // Failsafe — se watcher.close() pendurar, força saída em 5s
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.err(`Exceção não tratada: ${err.message}`, { stack: err.stack });
  });
}

iniciar();
