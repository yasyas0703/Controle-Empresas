// Descobre quais obrigações fiscais e códigos de receita cada empresa
// emite, lendo as pastas do servidor T:\Fiscal\EMPRESA\*.
//
// ATENÇÃO: este script SÓ LÊ. Jamais grava, move ou apaga em T:.
//
// Como detecta:
//   - FECHAMENTO/2026/         → guias do regime normal (ICMS, IPI, PIS, COFINS, etc)
//   - SIMPLES NACIONAL/2026/   → guias do SN (DAS, SINTEGRA, DESTDA, etc)
//   - LIVROS FISCAIS/2026/     → 5 livros do Onvio + Créd.Pres. (Demonstrativo)
//   - SPED/EFD-FISCAL/2026/    → SPED ICMS/IPI
//   - SPED/EFD-CONTRIBUIÇÕES/  → SPED Contribuições (pasta vazia = não emite)
//   - SPED/EFD-REINF/          → REINF (pasta vazia = não emite)
//
// Uso:
//   node scripts/descobrir-codigos-fiscal.mjs --sample          # 10 empresas
//   node scripts/descobrir-codigos-fiscal.mjs --empresa "NOME"  # 1 empresa
//   node scripts/descobrir-codigos-fiscal.mjs                   # todas com fiscal
//
// Saída: scripts/output-codigos-fiscal.csv

import { createClient } from '@supabase/supabase-js';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { createRequire } from 'node:module';
const requireCJS = createRequire(import.meta.url);
const pdfjsLib = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = 'T:\\Fiscal\\EMPRESA';
const ANO_ALVO = String(new Date().getFullYear());

// ─── env ──────────────────────────────────────────────────────────────────
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

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bltda\b|\bme\b|\bs\.a\.?\b|\bsa\b|\beireli\b|\beirelli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── PDF text extraction ─────────────────────────────────────────────────
async function extrairTextoPdf(filePath, maxPaginas = 2) {
  try {
    const buffer = readFileSync(filePath);
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({
      data, useWorker: false, disableWorker: true, verbosity: 0,
    }).promise;
    const limite = Math.min(doc.numPages, maxPaginas);
    const partes = [];
    for (let p = 1; p <= limite; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i) => i.str).join(' '));
    }
    return partes.join('\n');
  } catch {
    return '';
  }
}

/** Extrai o CNPJ encontrado no texto do PDF (primeiro válido). */
function extrairCnpjDoTexto(texto) {
  if (!texto) return null;
  const re = /\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})\b/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const digitos = m[1].replace(/\D/g, '');
    if (digitos.length === 14) return digitos;
  }
  return null;
}

function extrairCodigoDoTexto(texto, obrigacao) {
  if (!texto) return null;
  // Códigos com hífen (DAE-MG, DARE-SP): "Receita: 0120-6", "046-2 ICMS"
  const hifenado = texto.match(/Receita:\s*(\d{2,4}-\d)|Código de Receita\s*[–-]\s*Descrição\s*(\d{2,3}-\d)|\b(\d{2,3}-\d)\s+ICMS/i);
  if (hifenado) return (hifenado[1] || hifenado[2] || hifenado[3]).trim();
  // DARFs federais
  const padroesPorObrigacao = {
    'PIS':    /\b(\d{4})\s+PIS\b/,
    'COFINS': /\b(\d{4})\s+COFINS\b/,
    'IRPJ':   /\b(\d{4})\s+IRPJ\b/,
    'CSLL':   /\b(\d{4})\s+CSLL\b/,
    'IPI':    /\b(\d{4})\s+IPI\b/,
    'DARF':   /\b(\d{4})\s+(IRRF|RET\s+DE\s+CONTRIB|RETENCAO)/i,
  };
  const re = padroesPorObrigacao[obrigacao];
  if (re) {
    const m = texto.match(re);
    if (m) return m[1];
  }
  const generico = texto.match(/\b(\d{4})\s+(PIS|COFINS|IRPJ|CSLL|IPI|IRRF|INSS|ICMS)/);
  if (generico) return generico[1];
  return null;
}

/** Extrai TODOS os códigos DARF do texto (1 PDF pode ter múltiplos tributos). */
function extrairTodosCodigosDarf(texto) {
  if (!texto) return [];
  const codigos = new Set();
  // Códigos de receita: 4 dígitos antes do nome do tributo
  const re = /\b(\d{4})\s+(PIS|COFINS|IRPJ|CSLL|IPI|IRRF|RET\s+DE\s+CONTRIB)/gi;
  let m;
  while ((m = re.exec(texto)) !== null) codigos.add(m[1]);
  return [...codigos];
}

// ─── mapeamento de nome de arquivo → obrigação ────────────────────────────
// Ordem importa (mais específico antes). Arquivos vêm com data tipo "2026-01"
// ou "012026" no início, separados por espaço, hífen ou underscore.
const SEP = '[\\s_.-]+'; // separador entre data e nome do tributo
const REGRAS_NOME = [
  { obrigacao: 'ICMS TDD', padroes: [/icms[\s_.-]*(a[\s_.-]*recolher[\s_.-]*-?[\s_.-]*)?t[td]d\b/i, /icms[\s_.-]+tdd/i, /icms[\s_.-]+ttd/i] },
  { obrigacao: 'ICMS-ST/DIFAL', padroes: [/icms[\s_.-]+st(?!\s*entrad)/i, /icms-st/i, /substituicao[\s_.-]+tributaria/i] },
  { obrigacao: 'ICMS ANTECIPADO', padroes: [/icms[\s_.-]+ant(ecip)?/i] },
  { obrigacao: 'ST ANTECIPADO', padroes: [/icms[\s_.-]+st[\s_.-]+entrada/i, /\bst[\s_.-]+antecip/i] },
  { obrigacao: 'ICMS NORMAL', padroes: [
    /icms[\s_.-]+normal/i,
    /icms[\s_.-]+a[\s_.-]+recolher(?!.*tdd)(?!.*ttd)(?!.*st)/i,
    // Aceita "2026-01 ICMS", "2026-01-ICMS", "2026_01_ICMS", e "ICMS - Recalculo"
    new RegExp(`(?:^|[\\s_.-])icms\\b(?!.*tdd)(?!.*ttd)(?!.*\\bst\\b)(?!.*ant)(?!.*difal)(?!.*\\(m\\))(?!.*comercio${SEP}td)`, 'i'),
  ] },
  // Federais
  { obrigacao: 'IPI', padroes: [new RegExp(`(?:^|[\\s_.-])ipi(?!\\s*fiscal)(?!\\s*-?2)(?!.*\\(m\\))`, 'i')] },
  { obrigacao: 'PIS', padroes: [/\bpis\b/i] },
  { obrigacao: 'COFINS', padroes: [/\bcofins\b/i] },
  { obrigacao: 'IRPJ', padroes: [/\birpj\b/i] },
  { obrigacao: 'CSLL', padroes: [/\bcsll\b/i] },
  // REINF detectado por arquivo XML/PDF da pasta SPED ou nome
  { obrigacao: 'REINF', padroes: [/\breinf\b/i, /r-?2099/i, /r2055/i] },
  { obrigacao: 'DARF', padroes: [/darf.*serv.*tomad/i, /\birrf\b/i, /darf(?!.*pis)(?!.*cofins)(?!.*irpj)(?!.*csll)(?!.*ipi)/i] },
  // Estaduais
  { obrigacao: 'DIFERENCIAL DE ALIQUOTA', padroes: [/dif[\s_-]*aliq/i, /diferencial[\s_-]*(de[\s_-]*)?aliqu?ota/i] },
  { obrigacao: 'DIFAL', padroes: [/\bdifal\b/i] },
  { obrigacao: 'DAPI', padroes: [/\bdapi\b/i] },
  { obrigacao: 'GIA', padroes: [/\bgia[\s_-]*st\b/i, /^gia\b/i, /\bgia\.pdf$/i] },
  { obrigacao: 'DIME', padroes: [/\bdime\b/i] },
  // SPED (pelo nome também, caso esteja fora da pasta SPED)
  { obrigacao: 'SPED ICMS/IPI', padroes: [/sped.*(icms|ipi)/i, /efd[\s_-]*fiscal/i] },
  { obrigacao: 'SPED CONTRIBUIÇÕES', padroes: [/sped.*contribuic/i, /efd.*contribuic/i] },
  // Municipais — ISS pelo nome do município no validador; aqui só identifica tipo
  { obrigacao: 'ISS - PRESTAÇÃO DE SERVIÇOS', padroes: [/iss.*prestad/i, /issqn.*prest/i] },
  { obrigacao: 'ISS - SERVIÇOS TOMADOS', padroes: [/iss.*tomad/i, /issqn.*tomad/i, /iss.*retid/i] },
  // Simples Nacional
  { obrigacao: 'SINTEGRA', padroes: [/\bsintegra\b/i] },
  { obrigacao: 'DESTDA', padroes: [/\bdestda\b/i, /\bdesfis\b/i] },
  // DECLARAÇÃO/RECIBO = mesmo conceito (recibo do PGDAS-D), mapeio tudo pra RECIBO DAS
  { obrigacao: 'RECIBO DAS', padroes: [/recibo.*das\b/i, /pgdas/i, /declarac[aã]o(?!.*difal)(?!.*aliq)/i] },
  { obrigacao: 'EMISSÃO GUIA DAS', padroes: [/\bdas\b(?!.*recibo)/i] },
];

// Regras extras quando o arquivo está na pasta SIMPLES NACIONAL/{ano}/.
// "2026-01 RECIBO.pdf" sozinho dentro de SN = RECIBO DAS (não confundir com
// "RECIBO" de outras coisas em FECHAMENTO).
function detectarObrigacaoEmSN(filename) {
  const obrig = detectarObrigacao(filename);
  if (obrig) return obrig;
  const norm = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\brecibo\b/i.test(norm)) return 'RECIBO DAS';
  if (/relat[oó]rio.*difal|relat[oó]rio.*aliq|^rel\s+difal/i.test(norm)) return 'DIFERENCIAL DE ALIQUOTA';
  if (/rel\s+icms\s+ant/i.test(norm)) return 'ICMS ANTECIPADO';
  return null;
}

function detectarObrigacao(filename) {
  // Normaliza acentos pra regex bater em "ALÍQUOTA" igual "ALIQUOTA"
  const norm = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const regra of REGRAS_NOME) {
    for (const re of regra.padroes) {
      if (re.test(norm)) return regra.obrigacao;
    }
  }
  return null;
}

// ─── helpers de filesystem ────────────────────────────────────────────────
function tentarListar(dirPath) {
  try { return readdirSync(dirPath); } catch { return null; }
}

function ehDiretorio(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Acha primeira subpasta cujo nome (case-insensitive, normalizado) bate com algum dos candidatos. */
function acharSubpasta(basePath, candidatos) {
  const itens = tentarListar(basePath);
  if (!itens) return null;
  const candsNorm = candidatos.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const item of itens) {
    if (!ehDiretorio(join(basePath, item))) continue;
    const norm = item.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candsNorm.includes(norm)) return item;
  }
  return null;
}

/** Lista recursivamente todos os arquivos (até `profMax` níveis), retorna [{nome, full, ext}]. */
function listarArquivosRec(dirPath, profMax = 3, profAtual = 0, out = []) {
  if (profAtual > profMax) return out;
  const itens = tentarListar(dirPath);
  if (!itens) return out;
  for (const item of itens) {
    const full = join(dirPath, item);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      listarArquivosRec(full, profMax, profAtual + 1, out);
    } else {
      const ext = item.split('.').pop().toLowerCase();
      out.push({ nome: item, full, ext });
    }
  }
  return out;
}

function pastaTemConteudo(dirPath, extPermitidas = null) {
  if (!existsSync(dirPath)) return false;
  const arquivos = listarArquivosRec(dirPath, 3);
  if (extPermitidas) {
    return arquivos.some((a) => extPermitidas.includes(a.ext));
  }
  return arquivos.length > 0;
}

// ─── busca de pasta da empresa ────────────────────────────────────────────
let pastasEmpresaCache = null;
function listarPastasEmpresa() {
  if (pastasEmpresaCache) return pastasEmpresaCache;
  try {
    pastasEmpresaCache = readdirSync(T_ROOT).filter((n) => ehDiretorio(join(T_ROOT, n)));
  } catch (err) {
    console.error(`Falha ao listar ${T_ROOT}:`, err.message);
    process.exit(1);
  }
  return pastasEmpresaCache;
}

function acharPastaEmpresa(razaoSocial, apelido) {
  const pastas = listarPastasEmpresa();
  const cands = [razaoSocial, apelido].filter(Boolean).map(normalizar);
  // 1. Match exato
  for (const cand of cands) {
    const p = pastas.find((pa) => normalizar(pa) === cand);
    if (p) return p;
  }
  // 2. Pasta começa com nome (ignora sufixos tipo "(CLIA POUSO ALEGRE)")
  for (const cand of cands) {
    const p = pastas.find((pa) => normalizar(pa).startsWith(cand));
    if (p) return p;
  }
  // 3. Cand começa com nome da pasta (caso a razão tenha sufixos extras)
  for (const cand of cands) {
    const p = pastas.find((pa) => cand.startsWith(normalizar(pa)) && normalizar(pa).length >= 8);
    if (p) return p;
  }
  // 4. Contém
  for (const cand of cands) {
    if (cand.length < 6) continue;
    const p = pastas.find((pa) => normalizar(pa).includes(cand) || cand.includes(normalizar(pa)));
    if (p) return p;
  }
  return null;
}

// ─── escaneamento de 1 ESTABELECIMENTO (matriz ou filial) ────────────────
// Recebe o caminho base (pode ser a raiz da empresa ou uma sub-pasta de filial).
async function escanearEstabelecimento(base) {
  const obrigacoes = {}; // { 'IPI': { count, exemplos: [], exemplosPath: [], codigos: Set } }
  let tipoRegimeSet = new Set();

  function addObrigacao(obrig, nomeArquivo, fullPath) {
    if (!obrigacoes[obrig]) obrigacoes[obrig] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
    obrigacoes[obrig].count++;
    if (obrigacoes[obrig].exemplos.length < 3) {
      obrigacoes[obrig].exemplos.push(nomeArquivo);
      obrigacoes[obrig].exemplosPath.push(fullPath);
    }
  }

  // ── 1) FECHAMENTO / SIMPLES NACIONAL — guias por nome ─────────────────
  // tipoRegime só é marcado se o ano corrente tem PDFs de verdade (não basta
  // a pasta existir — empresa pode ter migrado de regime e deixado a antiga
  // vazia).
  const fech = acharSubpasta(base, ['FECHAMENTO']);
  if (fech) {
    const anoPath = join(base, fech, ANO_ALVO);
    if (existsSync(anoPath)) {
      const arqs = listarArquivosRec(anoPath, 3).filter((a) => a.ext === 'pdf');
      if (arqs.length > 0) tipoRegimeSet.add('normal');
      for (const a of arqs) {
        const obrig = detectarObrigacao(a.nome);
        if (obrig) addObrigacao(obrig, a.nome, a.full);
      }
    }
  }

  const sn = acharSubpasta(base, ['SIMPLES NACIONAL']);
  if (sn) {
    const anoPath = join(base, sn, ANO_ALVO);
    if (existsSync(anoPath)) {
      const arqs = listarArquivosRec(anoPath, 3).filter((a) => a.ext === 'pdf');
      if (arqs.length > 0) tipoRegimeSet.add('sn');
      for (const a of arqs) {
        const obrig = detectarObrigacaoEmSN(a.nome);
        if (obrig) addObrigacao(obrig, a.nome, a.full);
      }
    }
  }

  // ── 1b) Pastas auxiliares SN (SINTEGRA, DESTDA, ICMS ANTECIPADO etc) ──
  // Algumas empresas SN guardam essas obrigações em pastas separadas na raiz,
  // não dentro de SIMPLES NACIONAL/{ano}/.
  const PASTAS_AUX_SN = [
    { nomes: ['SINTEGRA'], obrigacao: 'SINTEGRA', exts: ['pdf', 'zip', 'txt'] },
    { nomes: ['DESTDA', 'DESFIS'], obrigacao: 'DESTDA', exts: ['pdf', 'txt', 'zip'] },
    { nomes: ['ICMS ANTECIPADO', 'ICMS ANTEC', 'ICMS ANT'], obrigacao: 'ICMS ANTECIPADO', exts: ['pdf'] },
    { nomes: ['DIFAL', 'DIFERENCIAL DE ALIQUOTA', 'DIFERENCIAL ALIQUOTA'], obrigacao: 'DIFERENCIAL DE ALIQUOTA', exts: ['pdf'] },
  ];
  for (const aux of PASTAS_AUX_SN) {
    const folder = acharSubpasta(base, aux.nomes);
    if (!folder) continue;
    const anoPath = join(base, folder, ANO_ALVO);
    const fallback = join(base, folder);
    const alvo = existsSync(anoPath) ? anoPath : fallback;
    const arqs = listarArquivosRec(alvo, 2).filter((a) => aux.exts.includes(a.ext));
    if (arqs.length === 0) continue;
    if (!obrigacoes[aux.obrigacao]) obrigacoes[aux.obrigacao] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
    obrigacoes[aux.obrigacao].count = arqs.length;
    const exPdf = arqs.find((a) => a.ext === 'pdf') || arqs[0];
    if (obrigacoes[aux.obrigacao].exemplos.length === 0 && exPdf) {
      obrigacoes[aux.obrigacao].exemplos.push(exPdf.nome);
      if (exPdf.ext === 'pdf') obrigacoes[aux.obrigacao].exemplosPath.push(exPdf.full);
    }
  }

  // ── 2) LIVROS FISCAIS — conjunto de 5 + Créd.Pres. ────────────────────
  const livros = acharSubpasta(base, ['LIVROS FISCAIS', 'LIVRO FISCAL', 'LIVROS']);
  if (livros) {
    const anoPath = join(base, livros, ANO_ALVO);
    if (existsSync(anoPath)) {
      const arqs = listarArquivosRec(anoPath, 2).filter((a) => a.ext === 'pdf');
      const contadores = { icmsM: [], ipiM: [], issM: [], entrada: [], saida: [], credPres: [] };
      for (const a of arqs) {
        if (/ICMS\s+NORMAL\s*\(M\)/i.test(a.nome)) contadores.icmsM.push(a);
        else if (/IPI[\s_-]*-?2\b/i.test(a.nome) || /\(IPI\)\s*\(M\)/i.test(a.nome)) contadores.ipiM.push(a);
        else if (/ISS\s*\(M\)/i.test(a.nome)) contadores.issM.push(a);
        else if (/LIVRO\s+DE\s+ENTRADA/i.test(a.nome)) contadores.entrada.push(a);
        else if (/LIVRO\s+DE\s+SA[IÍ]DA/i.test(a.nome)) contadores.saida.push(a);
        else if (/Cr[eé]d\.?\s*Pres/i.test(a.nome)) contadores.credPres.push(a);
      }
      // LIVROS FISCAIS = 3+ tipos presentes
      const tiposPresentes = ['icmsM', 'ipiM', 'issM', 'entrada', 'saida'].filter((k) => contadores[k].length > 0);
      if (tiposPresentes.length >= 3) {
        const exemplo = contadores.entrada[0] || contadores.saida[0] || contadores.icmsM[0];
        if (!obrigacoes['LIVROS FISCAIS']) obrigacoes['LIVROS FISCAIS'] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
        obrigacoes['LIVROS FISCAIS'].count = Math.max(
          contadores.entrada.length, contadores.saida.length, contadores.icmsM.length
        );
        if (exemplo) {
          obrigacoes['LIVROS FISCAIS'].exemplos.push(exemplo.nome);
          obrigacoes['LIVROS FISCAIS'].exemplosPath.push(exemplo.full);
        }
      }
      // DEMONSTR. APURAÇÃO = Créd. Pres.
      if (contadores.credPres.length > 0) {
        const ex = contadores.credPres[0];
        if (!obrigacoes['DEMONSTR. APURAÇÃO']) obrigacoes['DEMONSTR. APURAÇÃO'] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
        obrigacoes['DEMONSTR. APURAÇÃO'].count = contadores.credPres.length;
        obrigacoes['DEMONSTR. APURAÇÃO'].exemplos.push(ex.nome);
        obrigacoes['DEMONSTR. APURAÇÃO'].exemplosPath.push(ex.full);
      }
    }
  }

  // ── 3) SPED/EFD-FISCAL, EFD-CONTRIBUIÇÕES, EFD-REINF ──────────────────
  const sped = acharSubpasta(base, ['SPED']);
  if (sped) {
    const spedBase = join(base, sped);
    const fiscal = acharSubpasta(spedBase, ['EFD-FISCAL', 'EFD FISCAL', 'EFDFISCAL']);
    if (fiscal) {
      const anoP = join(spedBase, fiscal, ANO_ALVO);
      const fallback = join(spedBase, fiscal);
      const alvo = existsSync(anoP) ? anoP : fallback;
      if (pastaTemConteudo(alvo, ['pdf', 'txt', 'zip'])) {
        const arqs = listarArquivosRec(alvo, 3).filter((a) => ['pdf', 'txt', 'zip'].includes(a.ext));
        const ex = arqs.find((a) => a.ext === 'pdf') || arqs[0];
        if (!obrigacoes['SPED ICMS/IPI']) obrigacoes['SPED ICMS/IPI'] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
        obrigacoes['SPED ICMS/IPI'].count = arqs.length;
        if (ex) {
          obrigacoes['SPED ICMS/IPI'].exemplos.push(ex.nome);
          if (ex.ext === 'pdf') obrigacoes['SPED ICMS/IPI'].exemplosPath.push(ex.full);
        }
      }
    }
    const contrib = acharSubpasta(spedBase, ['EFD-CONTRIBUIÇÕES', 'EFD CONTRIBUICOES', 'EFD-CONTRIBUICOES', 'EFDCONTRIBUICOES']);
    if (contrib) {
      const anoP = join(spedBase, contrib, ANO_ALVO);
      const fallback = join(spedBase, contrib);
      const alvo = existsSync(anoP) ? anoP : fallback;
      if (pastaTemConteudo(alvo, ['pdf', 'txt', 'zip'])) {
        const arqs = listarArquivosRec(alvo, 3).filter((a) => ['pdf', 'txt', 'zip'].includes(a.ext));
        const ex = arqs.find((a) => a.ext === 'pdf') || arqs[0];
        if (!obrigacoes['SPED CONTRIBUIÇÕES']) obrigacoes['SPED CONTRIBUIÇÕES'] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
        obrigacoes['SPED CONTRIBUIÇÕES'].count = arqs.length;
        if (ex) {
          obrigacoes['SPED CONTRIBUIÇÕES'].exemplos.push(ex.nome);
          if (ex.ext === 'pdf') obrigacoes['SPED CONTRIBUIÇÕES'].exemplosPath.push(ex.full);
        }
      }
    }
    const reinf = acharSubpasta(spedBase, ['EFD-REINF', 'EFD REINF', 'EFDREINF']);
    if (reinf) {
      const reinfPath = join(spedBase, reinf);
      if (pastaTemConteudo(reinfPath, ['xml', 'pdf', 'zip'])) {
        const arqs = listarArquivosRec(reinfPath, 3).filter((a) => ['xml', 'pdf', 'zip'].includes(a.ext));
        if (!obrigacoes['REINF']) obrigacoes['REINF'] = { count: 0, exemplos: [], exemplosPath: [], codigos: new Set() };
        obrigacoes['REINF'].count = arqs.length;
        if (arqs[0]) obrigacoes['REINF'].exemplos.push(arqs[0].nome);
      }
    }
  }

  // ── 4) Extrai códigos abrindo PDFs (+ CNPJ pra identificar matriz/filial) ─
  let cnpjDetectado = null;
  for (const [obrig, info] of Object.entries(obrigacoes)) {
    if (obrig === 'DARF') {
      let primeiroTexto = null;
      for (const p of info.exemplosPath.slice(0, 3)) {
        const texto = await extrairTextoPdf(p);
        if (!primeiroTexto) primeiroTexto = texto;
        for (const c of extrairTodosCodigosDarf(texto)) info.codigos.add(c);
        if (!cnpjDetectado) cnpjDetectado = extrairCnpjDoTexto(texto);
      }
      // Trecho do primeiro PDF pra preview
      info.exemploTrecho = primeiroTexto ? primeiroTexto.slice(0, 500).replace(/\s+/g, ' ').trim() : null;
    } else if (info.exemplosPath.length > 0) {
      const texto = await extrairTextoPdf(info.exemplosPath[0]);
      const c = extrairCodigoDoTexto(texto, obrig);
      if (c) info.codigos.add(c);
      if (!cnpjDetectado) cnpjDetectado = extrairCnpjDoTexto(texto);
      info.exemploTrecho = texto ? texto.slice(0, 500).replace(/\s+/g, ' ').trim() : null;
    }
  }

  for (const info of Object.values(obrigacoes)) {
    info.codigosArr = [...info.codigos];
    delete info.codigos;
  }

  const tipoRegime = [...tipoRegimeSet].join('+') || null;
  return { tipoRegime, obrigacoes, cnpjDetectado };
}

// ─── escaneamento orquestrado: matriz + filiais ──────────────────────────
async function escanearEmpresa(pastaEmpresa) {
  const base = join(T_ROOT, pastaEmpresa);
  // 1) Matriz = raiz da empresa
  const matriz = await escanearEstabelecimento(base);
  matriz._origem = pastaEmpresa;
  matriz._tipo = 'matriz';
  const estabelecimentos = [matriz];

  // 2) Filiais — busca TODAS as pastas que começam com "FILIAL" ou "FILIAIS"
  //    diretamente na raiz da empresa.
  const itensRaiz = tentarListar(base) ?? [];
  const filhasCandidatas = itensRaiz.filter((nome) => {
    if (!ehDiretorio(join(base, nome))) return false;
    return /^filia[il]s?\b/i.test(nome);
  });

  for (const filhaNome of filhasCandidatas) {
    const filhaPath = join(base, filhaNome);
    // Caso A: pasta tem FECHAMENTO/SIMPLES NACIONAL direto → 1 filial só
    if (acharSubpasta(filhaPath, ['FECHAMENTO', 'SIMPLES NACIONAL'])) {
      const r = await escanearEstabelecimento(filhaPath);
      r._origem = `${pastaEmpresa}/${filhaNome}`;
      r._tipo = 'filial';
      r._nomeFilial = filhaNome;
      estabelecimentos.push(r);
    } else {
      // Caso B: tem sub-pastas (FILIAIS/0002, FILIAIS/0006, etc.)
      const subitens = tentarListar(filhaPath) ?? [];
      for (const sub of subitens) {
        const subPath = join(filhaPath, sub);
        if (!ehDiretorio(subPath)) continue;
        if (acharSubpasta(subPath, ['FECHAMENTO', 'SIMPLES NACIONAL'])) {
          const r = await escanearEstabelecimento(subPath);
          r._origem = `${pastaEmpresa}/${filhaNome}/${sub}`;
          r._tipo = 'filial';
          r._nomeFilial = `${filhaNome}/${sub}`;
          estabelecimentos.push(r);
        }
      }
    }
  }
  return estabelecimentos;
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isSample = args.includes('--sample');
  const empresaIdx = args.indexOf('--empresa');
  const empresaFiltro = empresaIdx >= 0 ? args[empresaIdx + 1] : null;

  console.log(`🔍 Descoberta v2 (ano alvo: ${ANO_ALVO})`);
  console.log(`📂 Lendo de: ${T_ROOT}\n`);

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: depts } = await supabase.from('departamentos').select('id, nome');
  const fiscalIds = (depts ?? []).filter((d) => /fiscal/i.test(d.nome)).map((d) => d.id);
  console.log(`📋 Departamentos fiscais: ${fiscalIds.length}`);

  const { data: respRows } = await supabase
    .from('responsaveis')
    .select('empresa_id, departamento_id, usuario_id')
    .in('departamento_id', fiscalIds)
    .not('usuario_id', 'is', null);
  const empresaIdsComFiscal = new Set((respRows ?? []).map((r) => r.empresa_id));
  console.log(`👥 ${empresaIdsComFiscal.size} empresas com responsável fiscal`);

  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, codigo, razao_social, apelido, cnpj, estado, desligada_em');

  let alvo = (empresas ?? []).filter((e) => !e.desligada_em && empresaIdsComFiscal.has(e.id));
  if (empresaFiltro) {
    const norm = normalizar(empresaFiltro);
    alvo = alvo.filter((e) => normalizar(e.razao_social).includes(norm) || normalizar(e.apelido ?? '').includes(norm));
  }
  alvo.sort((a, b) => (a.razao_social || '').localeCompare(b.razao_social || ''));
  if (isSample) alvo = alvo.slice(0, 10);

  // Index por CNPJ (sem pontuação) pra match preciso de filiais
  const empresaPorCnpj = new Map();
  for (const e of empresas ?? []) {
    const c = (e.cnpj ?? '').replace(/\D/g, '');
    if (c.length === 14) empresaPorCnpj.set(c, e);
  }

  // Agrupa empresas-alvo pela pasta no T: (matriz e filiais podem compartilhar)
  const empresasPorPasta = new Map();
  for (const emp of alvo) {
    const pasta = acharPastaEmpresa(emp.razao_social, emp.apelido);
    if (!pasta) continue;
    if (!empresasPorPasta.has(pasta)) empresasPorPasta.set(pasta, []);
    empresasPorPasta.get(pasta).push(emp);
  }

  console.log(`🎯 ${alvo.length} empresa(s) a escanear — ${empresasPorPasta.size} pasta(s) únicas no T:\n`);

  const resultados = [];
  const empresasJaUsadas = new Set();
  let i = 0;
  for (const emp of alvo) {
    i++;
    if (empresasJaUsadas.has(emp.id)) continue; // já foi associada a um estabelecimento

    const pasta = acharPastaEmpresa(emp.razao_social, emp.apelido);
    if (!pasta) {
      console.log(`[${i}/${alvo.length}] ⚠️  ${emp.razao_social} — pasta NÃO encontrada`);
      resultados.push({ empresa: emp, pasta: null, tipoRegime: null, obrigacoes: {}, semPasta: true });
      empresasJaUsadas.add(emp.id);
      continue;
    }

    // Escaneia matriz + todas as filiais dessa pasta
    const estabelecimentos = await escanearEmpresa(pasta);
    // Empresas-candidatas pra essa pasta (matriz + filiais no banco)
    const candidatas = empresasPorPasta.get(pasta) ?? [emp];

    // Associa cada estabelecimento à empresa correta pelo CNPJ detectado
    for (const est of estabelecimentos) {
      let empAlvo = null;
      if (est.cnpjDetectado) {
        empAlvo = empresaPorCnpj.get(est.cnpjDetectado);
      }
      // Se não achou pelo CNPJ, tenta pelo tipo (matriz = empresa principal)
      if (!empAlvo) {
        if (est._tipo === 'matriz') {
          // pega a candidata que NÃO foi usada ainda E que aparenta ser matriz (cnpj termina /0001)
          empAlvo = candidatas.find((c) => !empresasJaUsadas.has(c.id) && /\/0001/.test(c.cnpj ?? ''))
                    ?? candidatas.find((c) => !empresasJaUsadas.has(c.id));
        } else {
          empAlvo = candidatas.find((c) => !empresasJaUsadas.has(c.id) && !/\/0001/.test(c.cnpj ?? ''))
                    ?? candidatas.find((c) => !empresasJaUsadas.has(c.id));
        }
      }
      if (!empAlvo || empresasJaUsadas.has(empAlvo.id)) continue;
      empresasJaUsadas.add(empAlvo.id);

      const obrigs = Object.keys(est.obrigacoes);
      const resumo = obrigs.length === 0
        ? `nada`
        : obrigs.map((o) => {
            const info = est.obrigacoes[o];
            const cods = info.codigosArr.length > 0 ? `[${info.codigosArr.join('|')}]` : '';
            const baixa = info.count < 2 ? '?' : '';
            return `${o}×${info.count}${baixa}${cods}`;
          }).join(', ');
      const sufixoTipo = est._tipo === 'filial' ? ` [FILIAL ${est._nomeFilial ?? ''}]` : '';
      console.log(`[${i}/${alvo.length}] ${empAlvo.razao_social}${sufixoTipo} (${est.tipoRegime ?? '?'}) cnpj=${est.cnpjDetectado ?? '?'} → ${resumo}`);
      resultados.push({ empresa: empAlvo, pasta: est._origem, ...est });
    }
  }

  // ── gera CSV ──────────────────────────────────────────────────────────
  const linhas = ['codigo_empresa;razao_social;cnpj;estado;tipo_regime;pasta_servidor;obrigacao;codigos;confianca;quantidade;exemplo;trecho'];
  for (const r of resultados) {
    const e = r.empresa;
    if (Object.keys(r.obrigacoes || {}).length === 0) {
      linhas.push([
        e.codigo, esc(e.razao_social), e.cnpj, e.estado, r.tipoRegime ?? '',
        r.pasta ?? 'NAO ENCONTRADA', '', '', '', '',
        r.semPasta ? 'pasta nao encontrada' : 'nenhuma obrigacao detectada',
        '',
      ].join(';'));
      continue;
    }
    for (const [obrig, info] of Object.entries(r.obrigacoes)) {
      const trimestral = ['CSLL', 'IRPJ', 'DARF'].includes(obrig);
      const confianca = info.count >= 2 ? 'alta' : (trimestral ? 'alta-trim' : 'baixa');
      linhas.push([
        e.codigo, esc(e.razao_social), e.cnpj, e.estado, r.tipoRegime,
        r.pasta, obrig, info.codigosArr.join('|'), confianca, info.count, esc(info.exemplos[0] || ''),
        esc((info.exemploTrecho || '').slice(0, 500)),
      ].join(';'));
    }
  }
  const csvPath = resolve(__dirname, 'output-codigos-fiscal.csv');
  writeFileSync(csvPath, linhas.join('\n'), 'utf8');
  console.log(`\n💾 CSV gerado: ${csvPath}`);
  console.log(`   ${linhas.length - 1} linhas (${resultados.length} empresas)`);
}

function esc(s) {
  if (s == null) return '';
  const str = String(s).replace(/"/g, '""').replace(/;/g, ',');
  return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
