// Script CLI: extrai todas as empresas únicas (código + nome) de uma planilha
// XLSX do controle contábil, com contagem de bancos. Usado pra analisar
// padrões de naming entre anos diferentes (2023..2026) sem precisar
// rodar o app inteiro.
//
// Uso:
//   node scripts/analisar-planilhas.mjs <caminho.xlsx> [<caminho2.xlsx> ...]

import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

function lerTexto(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text).join('').trim();
    }
    if ('result' in v) return v.result == null ? '' : String(v.result).trim();
    if ('text' in v) return String(v.text ?? '').trim();
  }
  return String(v).trim();
}

async function analisar(caminho) {
  const buf = readFileSync(caminho);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return null;

  const empresas = new Map(); // chave "codigo||nome" → { codigo, nome, bancos:Set, linhasInicio, linhasFim }
  let secao = null;
  const SECAO_REGEX = /^(lucro real|lucro presumido|simples nacional)$/i;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codigoRaw = lerTexto(row.getCell(1));
    const nomeRaw = lerTexto(row.getCell(2));
    const bancoRaw = lerTexto(row.getCell(3));

    // detecta seção
    if (codigoRaw && !nomeRaw && !bancoRaw && SECAO_REGEX.test(codigoRaw)) {
      secao = codigoRaw.toLowerCase();
      continue;
    }

    if (!codigoRaw || !nomeRaw) continue;
    if (codigoRaw.toLowerCase() === 'onge' || codigoRaw.toLowerCase() === 'codigo') continue;

    const chave = `${codigoRaw}||${nomeRaw}`;
    if (!empresas.has(chave)) {
      empresas.set(chave, {
        codigo: codigoRaw,
        nome: nomeRaw,
        secao,
        bancos: new Set(),
        linhasInicio: r,
        linhasFim: r,
      });
    }
    const e = empresas.get(chave);
    e.linhasFim = r;
    if (bancoRaw) e.bancos.add(bancoRaw);
  }

  return {
    arquivo: basename(caminho),
    totalEmpresas: empresas.size,
    empresas: Array.from(empresas.values()).map((e) => ({
      codigo: e.codigo,
      nome: e.nome,
      secao: e.secao,
      qtdBancos: e.bancos.size,
      bancos: Array.from(e.bancos),
      linha: `${e.linhasInicio}-${e.linhasFim}`,
    })),
  };
}

const arquivos = process.argv.slice(2);
if (arquivos.length === 0) {
  console.error('Uso: node analisar-planilhas.mjs <xlsx> [<xlsx>...]');
  process.exit(1);
}

const todosResultados = [];
for (const f of arquivos) {
  console.log(`\n=== Analisando ${basename(f)} ===`);
  const r = await analisar(f);
  if (!r) { console.error(`Falha ao ler ${f}`); continue; }
  console.log(`Total de empresas únicas (código+nome): ${r.totalEmpresas}`);
  todosResultados.push(r);
}

// Cruzamento entre anos: agrupa por código pra ver variações de nome
const porCodigo = new Map(); // codigo → [{ano, nome, qtdBancos}]
for (const r of todosResultados) {
  const ano = r.arquivo.replace(/\.xlsx$/i, '');
  for (const e of r.empresas) {
    if (!porCodigo.has(e.codigo)) porCodigo.set(e.codigo, []);
    porCodigo.get(e.codigo).push({ ano, nome: e.nome, qtdBancos: e.qtdBancos, secao: e.secao });
  }
}

// Identifica códigos com nomes DIFERENTES entre anos (variação de naming)
const variacoes = [];
for (const [codigo, entries] of porCodigo) {
  const nomesUnicos = new Set(entries.map((e) => e.nome));
  if (nomesUnicos.size > 1) {
    variacoes.push({ codigo, nomes: Array.from(nomesUnicos), anos: entries.map((e) => e.ano) });
  }
}

console.log(`\n=== Códigos com VARIAÇÃO de nome entre anos: ${variacoes.length} ===`);
for (const v of variacoes.slice(0, 50)) {
  console.log(`  ${v.codigo} (${v.anos.join(',')}):`);
  for (const n of v.nomes) console.log(`    - ${n}`);
}

const saida = {
  resumoPorAno: todosResultados.map((r) => ({
    arquivo: r.arquivo,
    totalEmpresas: r.totalEmpresas,
  })),
  variacoesDeNomePorCodigo: variacoes,
  empresasPorAno: todosResultados,
};

const arquivoSaida = './analise-planilhas.json';
writeFileSync(arquivoSaida, JSON.stringify(saida, null, 2));
console.log(`\nRelatório salvo em ${arquivoSaida}`);
