// Importa o CSV de descobrir-codigos-fiscal.mjs pra empresa_obrigacoes_config.
//
// Uso:
//   node scripts/importar-codigos-fiscal.mjs --dry-run    # preview
//   node scripts/importar-codigos-fiscal.mjs              # aplica
//
// Lógica:
//   - Obrigações DETECTADAS no T: → ativa=true, codigos=[...], nao_envia conforme tipo
//   - Obrigações NÃO detectadas → ativa=false, motivo automático
//     (assim a aba "Envio de Guias" mostra só as que a empresa realmente tem)
//   - Antes de aplicar, apaga configs antigas geradas por seed/import (alterada_por_nome
//     começa com 'seed' ou 'import') pra evitar lixo de runs anteriores

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// Trimestrais: count baixo é OK (vê PDF a cada 3 meses)
const TRIMESTRAIS = new Set(['CSLL', 'IRPJ', 'DARF']);

// Obrigações internas — não enviam ao cliente por padrão.
// LIVROS FISCAIS NÃO entra aqui: o pessoal envia as 6 guias pelo Onvio
// pra dar como concluído. DEMONSTR. APURAÇÃO continua interno (Créd. Pres.).
const INTERNAS = new Set([
  'SPED ICMS/IPI',
  'SPED CONTRIBUIÇÕES',
  'REINF',
  'DEMONSTR. APURAÇÃO',
]);

// Todas as obrigações que existem no sistema (pra marcar não-detectadas como inativas)
const TODAS_REGIME_NORMAL = [
  'ICMS NORMAL', 'ICMS TDD', 'SPED ICMS/IPI', 'IPI', 'GIA-ST', 'ICMS-ST',
  'ISS - PRESTAÇÃO DE SERVIÇOS', 'ISS - SERVIÇOS TOMADOS', 'REINF', 'DARF-SERVIÇOS TOMADOS',
  'PIS', 'COFINS', 'SPED CONTRIBUIÇÕES', 'CSLL', 'IRPJ', 'DIFERENCIAL DE ALIQUOTA',
  'DAPI', 'DIME',
];
const TODAS_SN = [
  'EMISSÃO GUIA DAS', 'RECIBO DAS', 'DECLARAÇÃO DAS', 'SINTEGRA', 'DESTDA',
  'DIFERENCIAL DE ALIQUOTA', 'ICMS ANTECIPADO', 'ST ANTECIPADO',
];
// Internas que só fazem sentido pra empresas do regime normal
const TODAS_INTERNAS = ['LIVROS FISCAIS', 'DEMONSTR. APURAÇÃO'];

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

function parseCsv(text) {
  const linhas = text.split(/\r?\n/).filter(Boolean);
  const header = linhas[0].split(';');
  return linhas.slice(1).map((linha) => {
    const cols = linha.split(';');
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

// Mapa nome detectado → nome canônico em VENCIMENTOS_FISCAIS_NOMES
const ALIASES = {
  'DARF': 'DARF-SERVIÇOS TOMADOS',
  'GIA': 'GIA-ST',
  'DIFAL': 'ICMS-ST',
};

function canonicalizar(obrig) {
  return ALIASES[obrig] || obrig;
}

async function main() {
  console.log(`${isDryRun ? '🧪 DRY RUN' : '💾 GRAVANDO'} — Import v2\n`);

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const csvPath = resolve(__dirname, 'output-codigos-fiscal.csv');
  const linhas = parseCsv(readFileSync(csvPath, 'utf8'));
  console.log(`📋 ${linhas.length} linhas no CSV`);

  // Mapa: codigo_empresa → empresaId
  const codigos = [...new Set(linhas.map((l) => l.codigo_empresa).filter(Boolean))];
  const { data: empresasDb } = await supabase
    .from('empresas')
    .select('id, codigo')
    .in('codigo', codigos);
  const empresaIdPorCodigo = new Map((empresasDb ?? []).map((e) => [e.codigo, e.id]));
  console.log(`🔗 ${empresaIdPorCodigo.size} empresas casaram\n`);

  // Agrupa por empresa+obrigacao detectada
  const detectadas = new Map(); // key=empresaId|obrig, value={ empresaId, obrigacao, codigos:Set, razao, tipoRegime }
  const empresasComDeteccao = new Set();
  // Empresas que apareceram no CSV mas SEM obrigação detectada (pasta vazia,
  // sem 2026, sem pasta) — todas as obrigações vão pra inativa pra não
  // aparecer na aba Envio cheia de "27 pend."
  const empresasSemDeteccao = new Map(); // empresaId → razao

  for (const linha of linhas) {
    const empresaId = empresaIdPorCodigo.get(linha.codigo_empresa);
    if (!empresaId) continue;
    if (!linha.obrigacao) {
      if (!empresasSemDeteccao.has(empresaId)) {
        empresasSemDeteccao.set(empresaId, linha.razao_social);
      }
      continue;
    }
    if (linha.confianca === 'baixa' && !TRIMESTRAIS.has(linha.obrigacao)) continue;

    const obrigCanon = canonicalizar(linha.obrigacao);
    const key = `${empresaId}|${obrigCanon}`;
    if (!detectadas.has(key)) {
      detectadas.set(key, {
        empresaId,
        obrigacao: obrigCanon,
        codigos: new Set(),
        razao: linha.razao_social,
        tipoRegime: linha.tipo_regime,
        exemploArquivo: linha.exemplo || null,
        exemploTrecho: linha.trecho || null,
      });
    } else {
      // Mantém primeiro exemplo (mais "limpo" pq vem antes no CSV)
      const det = detectadas.get(key);
      if (!det.exemploArquivo) det.exemploArquivo = linha.exemplo || null;
      if (!det.exemploTrecho) det.exemploTrecho = linha.trecho || null;
    }
    const cods = linha.codigos.split('|').map((c) => c.trim()).filter(Boolean);
    for (const c of cods) detectadas.get(key).codigos.add(c);
    empresasComDeteccao.add(empresaId);
  }

  console.log(`✅ ${detectadas.size} obrigações detectadas em ${empresasComDeteccao.size} empresas`);

  // Pra empresas com detecção, calcular as NÃO-detectadas (pra marcar como ativa=false)
  // Pra cada empresa, sabemos o tipo de regime detectado (normal/sn/normal+sn)
  const empresaParaTipoRegime = new Map();
  for (const linha of linhas) {
    const empresaId = empresaIdPorCodigo.get(linha.codigo_empresa);
    if (!empresaId || !linha.tipo_regime) continue;
    empresaParaTipoRegime.set(empresaId, linha.tipo_regime);
  }

  const naoDetectadas = []; // { empresaId, obrigacao, razao }
  for (const empresaId of empresasComDeteccao) {
    const tipoRegime = empresaParaTipoRegime.get(empresaId) || '';
    const todas = new Set();
    if (tipoRegime.includes('normal')) {
      for (const o of TODAS_REGIME_NORMAL) todas.add(o);
      for (const o of TODAS_INTERNAS) todas.add(o);
    }
    if (tipoRegime.includes('sn')) {
      for (const o of TODAS_SN) todas.add(o);
    }
    const detectadasDaEmpresa = new Set();
    for (const det of detectadas.values()) {
      if (det.empresaId === empresaId) detectadasDaEmpresa.add(det.obrigacao);
    }
    for (const obrig of todas) {
      if (!detectadasDaEmpresa.has(obrig)) {
        const razao = [...detectadas.values()].find((d) => d.empresaId === empresaId)?.razao;
        naoDetectadas.push({ empresaId, obrigacao: obrig, razao });
      }
    }
  }

  // Pra empresas SEM detecção (pasta vazia/inexistente), marca TODAS as
  // obrigações (regime normal + SN + internas) como inativas. Assim a aba
  // Envio não mostra "27 pend." pra empresas sem documentos.
  for (const [empresaId, razao] of empresasSemDeteccao) {
    const todas = new Set([...TODAS_REGIME_NORMAL, ...TODAS_INTERNAS, ...TODAS_SN]);
    for (const obrig of todas) {
      naoDetectadas.push({ empresaId, obrigacao: obrig, razao });
    }
  }

  console.log(`🚫 ${naoDetectadas.length} obrigações serão marcadas como inativas (não detectadas no servidor)`);
  console.log(`   ↳ ${empresasSemDeteccao.size} empresas SEM detecção (pasta vazia/inexistente)`);

  if (isDryRun) {
    console.log('\n📊 Exemplos de detectadas:');
    let n = 0;
    for (const d of detectadas.values()) {
      if (n++ >= 8) break;
      const cods = [...d.codigos];
      const interna = INTERNAS.has(d.obrigacao) ? ' [INTERNA]' : '';
      console.log(`   ${d.razao} · ${d.obrigacao}${interna} → [${cods.join('|') || 'sem código'}]`);
    }
    console.log('\n📊 Exemplos de inativas:');
    for (let n = 0; n < 5 && n < naoDetectadas.length; n++) {
      const nd = naoDetectadas[n];
      console.log(`   ${nd.razao} · ${nd.obrigacao} → ativa=false`);
    }
    console.log('\n🧪 DRY RUN: nada foi gravado.');
    return;
  }

  // Limpa configs antigas geradas automaticamente (mas preserva configs editadas à mão)
  console.log('\n🧹 Apagando configs antigas geradas por seed/import automático...');
  const { error: errDel } = await supabase
    .from('empresa_obrigacoes_config')
    .delete()
    .or('alterada_por_nome.ilike.seed%,alterada_por_nome.ilike.import%');
  if (errDel) console.error('   ⚠️ erro ao limpar:', errDel.message);
  else console.log('   ✅ limpo');

  // Aplica detectadas
  console.log('\n💾 Gravando obrigações detectadas...');
  const now = new Date().toISOString();
  let okDet = 0, errDet = 0;
  for (const d of detectadas.values()) {
    const { error } = await supabase
      .from('empresa_obrigacoes_config')
      .upsert({
        empresa_id: d.empresaId,
        obrigacao: d.obrigacao,
        ativa: true,
        codigos: [...d.codigos],
        nao_envia_cliente: INTERNAS.has(d.obrigacao),
        motivo: null,
        exemplo_arquivo: d.exemploArquivo,
        exemplo_trecho: d.exemploTrecho,
        alterada_em: now,
        alterada_por_nome: 'import descobrir-codigos-fiscal v3',
      }, { onConflict: 'empresa_id,obrigacao' });
    if (error) { console.error(`   ❌ ${d.razao} · ${d.obrigacao}: ${error.message}`); errDet++; }
    else okDet++;
  }
  console.log(`   ✅ ${okDet} detectadas (${errDet} erros)`);

  // Aplica não detectadas como inativas
  console.log('\n💾 Marcando obrigações não detectadas como inativas...');
  let okInat = 0, errInat = 0;
  for (const nd of naoDetectadas) {
    const { error } = await supabase
      .from('empresa_obrigacoes_config')
      .upsert({
        empresa_id: nd.empresaId,
        obrigacao: nd.obrigacao,
        ativa: false,
        codigos: [],
        nao_envia_cliente: false,
        motivo: 'não detectada na pasta do servidor T:',
        alterada_em: now,
        alterada_por_nome: 'import descobrir-codigos-fiscal v2',
      }, { onConflict: 'empresa_id,obrigacao' });
    if (error) errInat++;
    else okInat++;
  }
  console.log(`   ✅ ${okInat} inativas (${errInat} erros)`);

  console.log(`\n✅ Total: ${okDet + okInat} configs gravadas, ${errDet + errInat} erros.`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
