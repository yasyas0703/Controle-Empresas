// Amostra os 5 PDFs de LIVROS FISCAIS de várias empresas pra descobrir
// quais palavras/cabeçalhos aparecem em cada tipo (Entrada/Saída/ICMS/IPI/ISS).
//
// ATENÇÃO: este script SÓ LÊ. Jamais grava, move ou apaga em T:.
//
// Uso:
//   node scripts/amostrar-livros-fiscais.mjs              # 10 empresas, todos os PDFs de LIVROS FISCAIS
//   node scripts/amostrar-livros-fiscais.mjs --limit 30   # mais empresas
//
// Saída:
//   scripts/output-livros-fiscais-amostra.csv  → 1 linha por PDF lido
//   stdout                                     → resumo com palavras-chave mais comuns por tipo

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const requireCJS = createRequire(import.meta.url);
const pdfjsLib = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = 'T:\\Fiscal\\EMPRESA';
const ANO_ALVO = String(new Date().getFullYear());

const argv = process.argv.slice(2);
const limit = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? Number(argv[i + 1]) || 10 : 10;
})();

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Classifica pelo nome do arquivo — só pra agrupar amostras.
// O objetivo do script é DESCOBRIR como classificar pelo conteúdo,
// então essa classificação aqui é só pra organizar a saída.
function tipoPeloNome(nome) {
  const n = norm(nome);
  if (/livro\s*de\s*entrada/.test(n)) return 'entrada';
  if (/livro\s*de\s*saida/.test(n)) return 'saida';
  if (/\bicms\b/.test(n)) return 'icms';
  if (/\bipi\b/.test(n)) return 'ipi';
  if (/\biss\b/.test(n)) return 'iss';
  return 'outros';
}

async function extrairTextoPdf(filePath, maxPaginas = 1) {
  try {
    const buffer = readFileSync(filePath);
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({
      data, useWorker: false, disableWorker: true, verbosity: 0,
    }).promise;
    const limitePag = Math.min(doc.numPages, maxPaginas);
    const partes = [];
    for (let p = 1; p <= limitePag; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i) => i.str).join(' '));
    }
    return partes.join('\n');
  } catch (e) {
    return '';
  }
}

function listarPdfsDe(pasta) {
  if (!existsSync(pasta)) return [];
  try {
    return readdirSync(pasta)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => join(pasta, f));
  } catch {
    return [];
  }
}

function listarPastasEmpresa() {
  if (!existsSync(T_ROOT)) {
    console.error(`❌ ${T_ROOT} não existe ou não está montado.`);
    process.exit(1);
  }
  return readdirSync(T_ROOT).filter((nome) => {
    const p = join(T_ROOT, nome);
    try { return statSync(p).isDirectory(); } catch { return false; }
  });
}

// ─── main ─────────────────────────────────────────────────────────────────
const pastasEmpresa = listarPastasEmpresa();
console.log(`🔍 ${pastasEmpresa.length} pastas em ${T_ROOT}, vou amostrar ${limit}.\n`);

const linhasCsv = [['empresa', 'arquivo', 'tipo_pelo_nome', 'trecho_pdf_300chars'].join(',')];
const amostrasPorTipo = { entrada: [], saida: [], icms: [], ipi: [], iss: [], outros: [] };

let usadas = 0;
for (const nomeEmp of pastasEmpresa) {
  if (usadas >= limit) break;
  const pastaLivros = join(T_ROOT, nomeEmp, 'LIVROS FISCAIS', ANO_ALVO);
  const pdfs = listarPdfsDe(pastaLivros);
  if (pdfs.length === 0) continue;
  usadas++;

  console.log(`📁 ${nomeEmp} (${pdfs.length} PDFs)`);
  for (const pdfPath of pdfs) {
    const arquivo = pdfPath.split(/[\\/]/).pop();
    const texto = await extrairTextoPdf(pdfPath, 1);
    const trecho = norm(texto).slice(0, 300).replace(/[",\n]/g, ' ');
    const tipo = tipoPeloNome(arquivo);
    amostrasPorTipo[tipo].push({ empresa: nomeEmp, arquivo, trecho });
    const csvRow = [
      `"${nomeEmp.replace(/"/g, "''")}"`,
      `"${arquivo.replace(/"/g, "''")}"`,
      tipo,
      `"${trecho.replace(/"/g, "''")}"`,
    ].join(',');
    linhasCsv.push(csvRow);
    console.log(`   [${tipo.padEnd(8)}] ${arquivo}`);
    console.log(`              → ${trecho.slice(0, 120)}…`);
  }
}

const outPath = resolve(__dirname, 'output-livros-fiscais-amostra.csv');
writeFileSync(outPath, linhasCsv.join('\n'), 'utf8');
console.log(`\n💾 CSV salvo em ${outPath}`);

// ─── Sugestão de palavras-chave: pega a 1ª linha (até ~100 chars) que
//     aparece em pelo menos 80% das amostras de cada tipo ──────────────────
console.log('\n🔎 Cabeçalhos detectados (primeiros 100 chars do PDF) por tipo:\n');
for (const tipo of ['entrada', 'saida', 'icms', 'ipi', 'iss', 'outros']) {
  const amostras = amostrasPorTipo[tipo];
  if (amostras.length === 0) continue;
  console.log(`── ${tipo.toUpperCase()} (${amostras.length} amostras) ──`);
  // Conta tokens (palavras de 4+ letras) que aparecem em quantos PDFs
  const ocorrenciasPorPalavra = new Map();
  for (const a of amostras) {
    const palavras = new Set(a.trecho.split(/\s+/).filter((w) => w.length >= 4));
    for (const w of palavras) {
      ocorrenciasPorPalavra.set(w, (ocorrenciasPorPalavra.get(w) ?? 0) + 1);
    }
  }
  const top = [...ocorrenciasPorPalavra.entries()]
    .filter(([, c]) => c >= Math.max(2, Math.ceil(amostras.length * 0.5)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  console.log(`   palavras frequentes (≥${Math.max(2, Math.ceil(amostras.length * 0.5))}/${amostras.length}):`);
  for (const [w, c] of top) console.log(`      ${c}×  ${w}`);
  console.log(`   trecho exemplo:`);
  console.log(`      ${amostras[0].trecho.slice(0, 200)}…\n`);
}

console.log('✅ pronto.');
