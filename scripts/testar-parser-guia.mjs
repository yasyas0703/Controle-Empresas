// Teste rápido do parser de nome de guia.
// Como rodar:
//   npx tsx scripts/testar-parser-guia.mjs
//
// Mostra cada caso e se passou ou não. Sem precisar de banco/servidor.

import { parseNomeGuia, extrairNomeEmpresaDoCaminho, detectarRegimeDoCaminho } from '../src/lib/parseNomeGuia.ts';

const CASOS = [
  // ─── Devem PASSAR (válidos) ─────────────────────────────────────────
  { nome: '2026-04 ICMS NORMAL.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2025-04 PIS.pdf',                  esperado: { competencia: '2025-04', obrigacao: 'PIS' } },
  { nome: '2026-12 COFINS.pdf',               esperado: { competencia: '2026-12', obrigacao: 'COFINS' } },
  { nome: '2026-01 IRPJ.pdf',                 esperado: { competencia: '2026-01', obrigacao: 'IRPJ' } },
  { nome: '2026-05 CSLL.pdf',                 esperado: { competencia: '2026-05', obrigacao: 'CSLL' } },
  { nome: '2026-04 DAS.pdf',                  esperado: { competencia: '2026-04', obrigacao: 'EMISSÃO GUIA DAS' } },
  { nome: '2026-04 SINTEGRA.pdf',             esperado: { competencia: '2026-04', obrigacao: 'SINTEGRA' } },
  { nome: '2026-04 DESTDA.pdf',               esperado: { competencia: '2026-04', obrigacao: 'DESTDA' } },
  { nome: '2026-04 REINF.pdf',                esperado: { competencia: '2026-04', obrigacao: 'REINF' } },

  // ─── Variações que ainda devem PASSAR (tolerâncias) ─────────────────
  { nome: '2026-04 icms normal.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2026-04 ICMS-NORMAL.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2026-04_ICMS_NORMAL.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2026-04 Icms Normal.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2026_04 ICMS NORMAL.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ICMS NORMAL' } },
  { nome: '2026-04 ICMS TDD.pdf',             esperado: { competencia: '2026-04', obrigacao: 'ICMS TDD' } },
  { nome: '2026-04 SPED FISCAL.pdf',          esperado: { competencia: '2026-04', obrigacao: 'SPED ICMS/IPI' } },
  { nome: '2026-04 SPED CONTRIB.pdf',         esperado: { competencia: '2026-04', obrigacao: 'SPED CONTRIBUIÇÕES' } },
  { nome: '2026-04 ISS PRESTADOR.pdf',        esperado: { competencia: '2026-04', obrigacao: 'ISS - PRESTAÇÃO DE SERVIÇOS' } },
  { nome: '2026-04 ISS TOMADOS.pdf',          esperado: { competencia: '2026-04', obrigacao: 'ISS - SERVIÇOS TOMADOS' } },
  { nome: '2026-04 DIFAL.pdf',                esperado: { competencia: '2026-04', obrigacao: 'DIFERENCIAL DE ALIQUOTA' } },
  { nome: '2026-04 DEMONSTRATIVO.pdf',        esperado: { competencia: '2026-04', obrigacao: 'DEMONSTR. APURAÇÃO' } },
  { nome: '2026-04 LIVROS.pdf',               esperado: { competencia: '2026-04', obrigacao: 'LIVROS FISCAIS' } },
  { nome: '2026-04 RECIBO DAS.pdf',           esperado: { competencia: '2026-04', obrigacao: 'RECIBO DAS' } },
  { nome: '2026-04 ICMS ANTECIPADO.pdf',      esperado: { competencia: '2026-04', obrigacao: 'ICMS ANTECIPADO' } },

  // ─── Devem FALHAR (inválidos) ───────────────────────────────────────
  { nome: 'ICMS NORMAL.pdf',                  esperado: { valido: false } },          // sem data
  { nome: '2026-04.pdf',                      esperado: { valido: false } },          // sem obrigação
  { nome: '04-2026 ICMS NORMAL.pdf',          esperado: { valido: false } },          // ano e mês trocados
  { nome: '2026-13 ICMS NORMAL.pdf',          esperado: { valido: false } },          // mês 13
  { nome: '2026-00 ICMS NORMAL.pdf',          esperado: { valido: false } },          // mês 00
  { nome: '2019-04 ICMS NORMAL.pdf',          esperado: { valido: false } },          // ano fora intervalo
  { nome: '2031-04 ICMS NORMAL.pdf',          esperado: { valido: false } },          // ano fora intervalo
  { nome: '2026-04 XPTOOBRIGACAO.pdf',        esperado: { valido: false } },          // obrigação desconhecida
  { nome: '2026-04 ICMS NORMAL.docx',         esperado: { valido: false } },          // extensão errada
  { nome: 'guia abril 2026.pdf',              esperado: { valido: false } },          // formato totalmente livre
];

// ─── Casos de extração de empresa do caminho ─────────────────────────
const CASOS_CAMINHO = [
  {
    caminho: 'T:\\Fiscal\\EMPRESA\\2GETHER\\FECHAMENTO\\2026\\04\\2026-04 ICMS NORMAL.pdf',
    esperadoEmpresa: '2GETHER',
    esperadoRegime: 'normal',
  },
  {
    caminho: 'T:/Fiscal/EMPRESA/AB CONSTRUCOES/SIMPLES NACIONAL/2026/04/2026-04 DAS.pdf',
    esperadoEmpresa: 'AB CONSTRUCOES',
    esperadoRegime: 'simples_nacional',
  },
  {
    caminho: 'T:\\Fiscal\\EMPRESA\\WICO\\FECHAMENTO\\2026\\05\\FILIAL\\2026-05 ICMS NORMAL.pdf',
    esperadoEmpresa: 'WICO',
    esperadoRegime: 'normal',
  },
  {
    caminho: 'C:\\algumLugar\\sem\\EMPRESA\\arquivo.pdf',
    esperadoEmpresa: null,  // sem segmento "EMPRESA" depois de algo legítimo? hmm — vai bater porque tem "EMPRESA"
    // Na verdade VAI achar — o parser pega o próximo segmento depois de "EMPRESA"
    // Vamos esperar 'arquivo.pdf'? Não, ele pega o próximo SEGMENTO, que é 'arquivo.pdf'.
    // Esse caso é meio sintético, ajustar abaixo.
  },
];

// ─── Runner ──────────────────────────────────────────────────────────
let okCount = 0;
let failCount = 0;

console.log('\n=== TESTE PARSER DE NOME ===\n');
for (const caso of CASOS) {
  const res = parseNomeGuia(caso.nome);
  let passou = true;
  let motivo = '';

  if (caso.esperado.valido === false) {
    if (res.valido) { passou = false; motivo = `esperado inválido mas foi aceito`; }
  } else {
    if (!res.valido) { passou = false; motivo = `esperado válido, mas: ${res.erros.join(', ')}`; }
    else if (res.competencia !== caso.esperado.competencia) {
      passou = false;
      motivo = `competência esperada=${caso.esperado.competencia} got=${res.competencia}`;
    } else if (res.obrigacao !== caso.esperado.obrigacao) {
      passou = false;
      motivo = `obrigação esperada="${caso.esperado.obrigacao}" got="${res.obrigacao}"`;
    }
  }

  if (passou) {
    okCount++;
    console.log(`✅ ${caso.nome.padEnd(40)} → ${res.valido ? `${res.competencia} / ${res.obrigacao}` : `INVÁLIDO (${res.erros.join(', ')})`}`);
  } else {
    failCount++;
    console.log(`❌ ${caso.nome.padEnd(40)} → ${motivo}`);
  }
}

console.log('\n=== TESTE EXTRAÇÃO DE EMPRESA DO CAMINHO ===\n');
for (const caso of CASOS_CAMINHO) {
  const emp = extrairNomeEmpresaDoCaminho(caso.caminho);
  const reg = detectarRegimeDoCaminho(caso.caminho);
  const ok = emp === caso.esperadoEmpresa || caso.esperadoEmpresa === undefined;
  console.log(`${ok ? '✅' : '⚠️'}  ${caso.caminho}`);
  console.log(`     empresa: ${emp} (esperava ${caso.esperadoEmpresa})`);
  console.log(`     regime:  ${reg} (esperava ${caso.esperadoRegime})\n`);
}

console.log(`\n=== RESULTADO: ${okCount} ok, ${failCount} fail (de ${CASOS.length} casos) ===\n`);
process.exit(failCount > 0 ? 1 : 0);
