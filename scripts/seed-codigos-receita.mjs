// Importa a planilha "CODIGOS EMPRESAS.xlsx" pra tabela empresa_obrigacoes_config.
// Uso: node scripts/seed-codigos-receita.mjs [--dry-run]
//
// Pré-requisitos:
//   1. Rodar a migration supabase-migration-empresa-obrigacoes-config.sql primeiro
//   2. Ter SUPABASE_SERVICE_ROLE_KEY no .env.local
//   3. Ter CODIGOS EMPRESAS.xlsx na raiz do projeto
//
// O script:
//   - Lê a planilha (2 seções: regime normal e simples nacional)
//   - Faz match das empresas pelo nome (fuzzy, ignorando acentos/case)
//   - Faz upsert em empresa_obrigacoes_config (codigos por obrigação)
//   - Reporta empresas não encontradas
//
// Use --dry-run pra ver o que ia inserir sem gravar nada.

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

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
    .replace(/\bltda\b|\bme\b|\beirelli\b|\bs\.a\.?\b|\bsa\b|\beireli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellString(cell) {
  if (cell == null) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) {
    return v.richText.map((t) => t.text).join('').trim();
  }
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  return String(v).trim();
}

function parseCodigos(cellValue) {
  // Aceita "0317-8", "0317-8 / 102-8", "3-000/ 3-100 / 3-102"
  if (!cellValue) return [];
  return String(cellValue)
    .split(/[\/,;]/)
    .map((c) => c.trim())
    .filter((c) => c && c !== '*');
}

// Mapeamento coluna da planilha → nome canônico em VENCIMENTOS_FISCAIS_NOMES
const MAPA_REGIME_NORMAL = {
  'ICMS NORMAL': 'ICMS NORMAL',
  'ICMS TDD': 'ICMS TDD',
  'IPI': 'IPI',
  'COFINS': 'COFINS',
  'PIS': 'PIS',
  'IRPJ': 'IRPJ',
  'CSLL': 'CSLL',
  'DIFERELCIAL ALIQOTA': 'DIFERENCIAL DE ALIQUOTA',
  'DIFERENCIAL ALIQUOTA': 'DIFERENCIAL DE ALIQUOTA',
};

const MAPA_SN = {
  'ICMS ANT': 'ICMS ANTECIPADO',
  'DIFERELCIAL ALIQOTA': 'DIFERENCIAL DE ALIQUOTA',
  'DIFERENCIAL ALIQUOTA': 'DIFERENCIAL DE ALIQUOTA',
  'DIFAL': 'DIFERENCIAL DE ALIQUOTA',
  'ICMS ST': 'ST ANTECIPADO',
};

async function main() {
  console.log(`${isDryRun ? '🧪 DRY RUN' : '💾 GRAVANDO'} — Seed códigos de receita\n`);

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Faltando NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Lê empresas do banco
  console.log('📂 Lendo empresas do banco...');
  const { data: empresasDb, error: errEmp } = await supabase
    .from('empresas')
    .select('id, codigo, razao_social, apelido, cnpj, estado');
  if (errEmp) {
    console.error('Erro lendo empresas:', errEmp.message);
    process.exit(1);
  }
  console.log(`   ${empresasDb.length} empresas no banco\n`);

  // Index pra match rápido
  const indice = empresasDb.map((e) => ({
    ...e,
    normRazao: normalizar(e.razao_social),
    normApelido: normalizar(e.apelido),
    normCodigo: normalizar(e.codigo),
  }));

  function acharEmpresa(nomePlanilha, estadoPlanilha) {
    const alvo = normalizar(nomePlanilha);
    if (!alvo) return null;
    // Match exato razão social
    let cands = indice.filter((e) => e.normRazao === alvo);
    if (cands.length === 0) {
      // Razão social começa com o nome da planilha (ou vice-versa)
      cands = indice.filter((e) => e.normRazao.startsWith(alvo) || alvo.startsWith(e.normRazao));
    }
    if (cands.length === 0) {
      // Apelido
      cands = indice.filter((e) => e.normApelido === alvo);
    }
    if (cands.length === 0) {
      // Conteúdo
      cands = indice.filter((e) => e.normRazao.includes(alvo) || alvo.includes(e.normRazao));
    }
    if (cands.length > 1 && estadoPlanilha) {
      const filt = cands.filter((e) => (e.estado ?? '').toUpperCase() === estadoPlanilha.toUpperCase());
      if (filt.length > 0) cands = filt;
    }
    return cands[0] ?? null;
  }

  // 2) Lê planilha
  console.log('📋 Lendo planilha CODIGOS EMPRESAS.xlsx...');
  const planilhaPath = resolve(__dirname, '..', 'CODIGOS EMPRESAS.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(planilhaPath);
  const ws = wb.worksheets[0];

  // 3) Identifica as 2 seções (regime normal e simples nacional)
  //    A planilha tem um cabeçalho na linha 1 e outro cabeçalho na linha 148 (simples nacional).
  let secaoAtual = 'normal';
  let mapaColunas = null; // { 'C': 'ICMS NORMAL', 'D': 'ICMS TDD', ... }

  const resultados = {
    encontradas: 0,
    naoEncontradas: [],
    upserts: 0,
    pulos: 0,
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const valoresLinha = [];
    row.eachCell({ includeEmpty: true }, (cell) => valoresLinha.push(cellString(cell)));

    const primeiraColuna = (valoresLinha[0] || '').trim();
    if (!primeiraColuna) return;

    // Detecta cabeçalhos
    if (primeiraColuna === 'EMPRESA' || primeiraColuna === 'EMPRESA ') {
      // É um cabeçalho — mapeia colunas
      const segundo = (valoresLinha[1] || '').toUpperCase();
      secaoAtual = segundo === 'ESTADO' || valoresLinha.some((v) => /ICMS ANT/i.test(v))
        ? (valoresLinha.some((v) => /ICMS ANT/i.test(v)) ? 'sn' : 'normal')
        : 'normal';
      mapaColunas = {};
      valoresLinha.forEach((header, idx) => {
        if (idx < 2) return; // pula EMPRESA e ESTADO
        const h = (header || '').toUpperCase().trim();
        const mapa = secaoAtual === 'sn' ? MAPA_SN : MAPA_REGIME_NORMAL;
        if (mapa[h]) mapaColunas[idx] = mapa[h];
      });
      console.log(`\n📑 Linha ${rowNumber}: cabeçalho seção "${secaoAtual}" — colunas: ${JSON.stringify(mapaColunas)}`);
      return;
    }

    if (primeiraColuna.toLowerCase() === 'simples') {
      // Linha separadora "simples | simples | ..." entre as seções
      return;
    }

    if (!mapaColunas) return; // ainda não vimos cabeçalho

    // Linha de empresa
    const nome = primeiraColuna.replace(/\*/g, '').trim();
    const estado = (valoresLinha[1] || '').trim();
    const empresa = acharEmpresa(nome, estado);

    if (!empresa) {
      resultados.naoEncontradas.push({ linha: rowNumber, nome, estado });
      return;
    }

    resultados.encontradas++;

    // Pra cada coluna mapeada, faz upsert
    for (const [idxStr, obrigacao] of Object.entries(mapaColunas)) {
      const idx = Number(idxStr);
      const cellValue = valoresLinha[idx];
      const codigos = parseCodigos(cellValue);
      if (codigos.length === 0) continue;

      // Acumula pra batch
      pendentesUpsert.push({
        empresaId: empresa.id,
        empresaNome: empresa.razao_social,
        obrigacao,
        codigos,
        linha: rowNumber,
      });
    }
  });

  // 4) Aplica os upserts
  console.log(`\n🎯 ${resultados.encontradas} empresas casaram, ${pendentesUpsert.length} configs pra upsert`);

  if (resultados.naoEncontradas.length > 0) {
    console.log(`\n⚠️  ${resultados.naoEncontradas.length} empresas da planilha NÃO encontradas no banco:`);
    for (const nf of resultados.naoEncontradas) {
      console.log(`   linha ${nf.linha}: "${nf.nome}" (${nf.estado || '?'})`);
    }
  }

  if (isDryRun) {
    console.log('\n📊 Primeiros 10 upserts que seriam feitos:');
    for (const u of pendentesUpsert.slice(0, 10)) {
      console.log(`   ${u.empresaNome} · ${u.obrigacao} → [${u.codigos.join(', ')}]`);
    }
    console.log('\n🧪 DRY RUN: nada foi gravado. Rode sem --dry-run pra aplicar.');
    return;
  }

  console.log('\n💾 Aplicando upserts no banco...');
  const now = new Date().toISOString();
  let ok = 0;
  let err = 0;
  for (const u of pendentesUpsert) {
    const { error } = await supabase
      .from('empresa_obrigacoes_config')
      .upsert({
        empresa_id: u.empresaId,
        obrigacao: u.obrigacao,
        ativa: true,
        codigos: u.codigos,
        motivo: null,
        alterada_em: now,
        alterada_por_nome: 'seed CODIGOS EMPRESAS.xlsx',
      }, { onConflict: 'empresa_id,obrigacao' });
    if (error) {
      console.error(`   ❌ ${u.empresaNome} · ${u.obrigacao}: ${error.message}`);
      err++;
    } else {
      ok++;
    }
  }
  console.log(`\n✅ ${ok} configs salvas, ${err} erros.`);
}

const pendentesUpsert = [];
main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
