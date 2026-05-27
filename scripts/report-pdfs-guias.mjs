// Gera relatório CSV de TODOS os PDFs em T:/Fiscal/EMPRESA/*/{FECHAMENTO,SIMPLES NACIONAL}/...
// classificando cada um: padrão OK, nome desconhecido, competência antiga, etc.
//
// Útil pra ANTES de ligar o daemon: ver a foto do que tá lá e decidir
// o que renomear/ignorar.
//
// NÃO faz nada com a API, nem move arquivos. Só LÊ a estrutura e gera CSV.
//
// Uso:
//   npx tsx scripts/report-pdfs-guias.mjs                       # todas as empresas
//   npx tsx scripts/report-pdfs-guias.mjs --empresa "2GETHER"   # 1 empresa
//   npx tsx scripts/report-pdfs-guias.mjs --limit 50            # primeiras 50 empresas
//
// Saída: scripts/output-pdfs-relatorio.csv

import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNomeGuia } from '../src/lib/parseNomeGuia.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T_ROOT = 'T:\\Fiscal\\EMPRESA';
const ANOS = [2024, 2025, 2026, 2027];
const DIAS_LIMITE = 60;

const args = process.argv.slice(2);
const EMPRESA_FILTRO = (() => {
  const i = args.indexOf('--empresa');
  return i >= 0 ? args[i + 1] : null;
})();
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────
function listarDiretorios(pai) {
  try {
    return readdirSync(pai).filter((d) => {
      try {
        return statSync(join(pai, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function listarPdfsRecursivo(raiz, acumulador = []) {
  let entries;
  try {
    entries = readdirSync(raiz);
  } catch {
    return acumulador;
  }
  for (const e of entries) {
    const p = join(raiz, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      listarPdfsRecursivo(p, acumulador);
    } else if (s.isFile() && /\.pdf$/i.test(e)) {
      acumulador.push(p);
    }
  }
  return acumulador;
}

function competenciaEhRecente(competencia) {
  const [y, m] = competencia.split('-').map(Number);
  if (!y || !m) return false;
  const fimMes = new Date(Date.UTC(y, m, 0));
  const diff = (Date.now() - fimMes.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= DIAS_LIMITE;
}

function classificar(parse) {
  if (!parse.valido) {
    if (parse.erros.includes('obrigacao_desconhecida')) return 'nome_obrigacao_desconhecida';
    if (parse.erros.includes('data_invalida')) return 'nome_data_invalida';
    if (parse.erros.includes('obrigacao_vazia')) return 'nome_sem_obrigacao';
    return 'nome_invalido';
  }
  if (!competenciaEhRecente(parse.competencia)) return 'competencia_antiga';
  return 'padrao_ok';
}

// ─── Scan ─────────────────────────────────────────────────────────────────
if (!existsSync(T_ROOT)) {
  console.error(`❌ ${T_ROOT} não encontrado.`);
  process.exit(1);
}

let empresas = listarDiretorios(T_ROOT);
if (EMPRESA_FILTRO) {
  empresas = empresas.filter((e) => e.toUpperCase().includes(EMPRESA_FILTRO.toUpperCase()));
  if (empresas.length === 0) {
    console.error(`❌ Nenhuma pasta contendo "${EMPRESA_FILTRO}".`);
    process.exit(1);
  }
  console.log(`🔎 Filtro: ${empresas.length} empresa(s) selecionada(s).`);
}

if (empresas.length > LIMIT) {
  empresas = empresas.slice(0, LIMIT);
  console.log(`🔢 Limitando a ${LIMIT} primeiras empresas.`);
}

console.log(`\n📂 Escaneando ${empresas.length} empresa(s) em ${T_ROOT}...\n`);

const linhasCsv = ['empresa_pasta;subpasta;ano;caminho;nome_arquivo;classificacao;competencia_parseada;obrigacao_parseada;erros'];
const stats = {};
let totalPdfs = 0;

for (let i = 0; i < empresas.length; i++) {
  const empresa = empresas[i];
  const pastaEmpresa = join(T_ROOT, empresa);

  for (const sub of ['FECHAMENTO', 'SIMPLES NACIONAL']) {
    const pastaSub = join(pastaEmpresa, sub);
    if (!existsSync(pastaSub)) continue;

    for (const ano of ANOS) {
      const pastaAno = join(pastaSub, String(ano));
      if (!existsSync(pastaAno)) continue;

      const pdfs = listarPdfsRecursivo(pastaAno);
      for (const pdf of pdfs) {
        totalPdfs++;
        const nome = basename(pdf);
        const parse = parseNomeGuia(nome);
        const cls = classificar(parse);
        stats[cls] = (stats[cls] || 0) + 1;
        linhasCsv.push([
          empresa,
          sub,
          ano,
          pdf.replace(/;/g, ','), // evitar quebrar CSV
          nome.replace(/;/g, ','),
          cls,
          parse.competencia ?? '',
          parse.obrigacao ?? '',
          parse.erros.join('|'),
        ].join(';'));
      }
    }
  }

  if ((i + 1) % 20 === 0) {
    process.stdout.write(`  ... ${i + 1}/${empresas.length} (${totalPdfs} PDFs)\r`);
  }
}

const outPath = resolve(__dirname, 'output-pdfs-relatorio.csv');
writeFileSync(outPath, linhasCsv.join('\n'), 'utf8');

console.log(`\n\n✅ Escaneou ${totalPdfs} PDFs em ${empresas.length} empresa(s).`);
console.log(`💾 CSV salvo em: ${outPath}\n`);

console.log('📊 Classificação:');
const ordem = ['padrao_ok', 'competencia_antiga', 'nome_obrigacao_desconhecida', 'nome_data_invalida', 'nome_sem_obrigacao', 'nome_invalido'];
for (const k of ordem) {
  if (stats[k]) {
    const pct = ((stats[k] / totalPdfs) * 100).toFixed(1);
    const cor = k === 'padrao_ok' ? '\x1b[32m' : (k === 'competencia_antiga' ? '\x1b[33m' : '\x1b[31m');
    console.log(`  ${cor}${k.padEnd(35)}\x1b[0m ${stats[k].toString().padStart(5)} (${pct}%)`);
  }
}
console.log('');

if (stats.padrao_ok > 0) {
  console.log(`🚀 ${stats.padrao_ok} PDFs sairiam automaticamente (compl. recente + nome OK + validação passa)`);
}
if (stats.competencia_antiga > 0) {
  console.log(`🔒 ${stats.competencia_antiga} PDFs ficariam pendentes de aprovação (compl. antiga)`);
}
const nomeRuim = (stats.nome_obrigacao_desconhecida || 0) + (stats.nome_data_invalida || 0) + (stats.nome_sem_obrigacao || 0) + (stats.nome_invalido || 0);
if (nomeRuim > 0) {
  console.log(`⚠️  ${nomeRuim} PDFs com nome fora do padrão (vão pra fila de problemas)`);
}
console.log('');
