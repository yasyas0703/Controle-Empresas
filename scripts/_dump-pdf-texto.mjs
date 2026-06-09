// Dump do TEXTO que o reconhecedor enxerga num PDF de guia. Só leitura.
// Uso: node scripts/_dump-pdf-texto.mjs "T:\Fiscal\EMPRESA\...\arquivo.pdf" [outro.pdf ...]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireCJS = createRequire(import.meta.url);
const pdfjsLib = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function extrair(filePath, maxPaginas = 3) {
  const buffer = readFileSync(filePath);
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useWorker: false, disableWorker: true, verbosity: 0 }).promise;
  const limite = Math.min(doc.numPages, maxPaginas);
  const partes = [];
  for (let p = 1; p <= limite; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    partes.push(content.items.map((i) => i.str ?? '').join(' '));
  }
  return { texto: partes.join('\n'), paginas: doc.numPages };
}

const arquivos = process.argv.slice(2);
for (const f of arquivos) {
  console.log('\n' + '='.repeat(90));
  console.log('ARQUIVO:', f);
  try {
    const { texto, paginas } = await extrair(f);
    const norm = normalizar(texto);
    console.log('paginas:', paginas, '| chars extraidos:', texto.length);
    console.log('--- TESTES DE REGEX (no texto normalizado) ---');
    console.log('  tem texto?            ', texto.trim().length > 0);
    console.log('  /(iss|issqn)/  (atual) ', /(iss|issqn)/i.test(norm));
    console.log('  /\\b(iss|issqn)\\b/      ', /\b(iss|issqn)\b/i.test(norm));
    console.log('  /imposto sobre servic/ ', /imposto\s+sobre\s+servic/i.test(norm));
    console.log('  /arrecadacao municipal/', /arrecadacao\s+municipal/i.test(norm));
    console.log('  /prefeitura/           ', /prefeitura/i.test(norm));
    console.log('  /tomad/                ', /tomad/i.test(norm));
    console.log('  /dime/  (DIME)         ', /dime/i.test(norm));
    console.log('  /declaracao do ic ms/  ', /declaracao\s*do\s*ic\s*ms\s*mensal/i.test(norm));
    console.log('  /substituic|st /       ', /substituic|(\bst\b)/i.test(norm));
    console.log('--- TEXTO NORMALIZADO (completo) ---');
    console.log(norm.slice(0, 4000));
  } catch (e) {
    console.log('ERRO ao extrair:', e?.message || e);
  }
}
