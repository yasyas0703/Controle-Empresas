import { describe, it, expect } from 'vitest';
import { validarGuia, obrigacoesComValidacao } from './validarGuia';
import type { Empresa } from '@/app/types';

// Helper pra construir empresa mock com defaults sensatos. Cada teste só
// sobrescreve os campos que importam pra ele.
function mockEmpresa(over: Partial<Empresa> = {}): Empresa {
  return {
    id: 'emp-test',
    codigo: 'CODE',
    razao_social: 'Empresa Teste LTDA',
    apelido: 'Teste',
    cnpj: '12.345.678/0001-99',
    cidade: 'Belo Horizonte',
    estado: 'MG',
    inscricao_estadual: '001234567',
    ...over,
  } as Empresa;
}

// ─────────────────────────────────────────────────────────────────────────
// CNPJ / IE — identificação da empresa
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — identificação da empresa', () => {
  it('bloqueia quando empresa não aparece no PDF (nem CNPJ nem IE)', () => {
    const texto = 'documento de arrecadacao PIS - faturamento';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.severidade === 'bloqueio' && p.motivo.includes('não identificada'))).toBe(true);
  });

  it('aceita CNPJ presente no PDF (com formatação)', () => {
    const texto = 'documento de arrecadacao PIS - faturamento empresa cnpj 12.345.678/0001-99 valor';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.cnpjEncontrado).toBe('12345678000199');
  });

  it('aceita CNPJ presente como dígitos crus (sem máscara)', () => {
    const texto = 'documento de arrecadacao PIS - faturamento 12345678000199 empresa';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.cnpjEncontrado).toBe('12345678000199');
  });

  it('aceita CNPJ-base (8 primeiros dígitos) — DARE-SP usa só raiz', () => {
    const texto = 'documento de arrecadacao PIS - faturamento empresa CNPJ raiz 12345678 valor';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.cnpjEncontrado).toBe('12345678000199');
  });

  it('identifica pela IE quando CNPJ ausente (guia estadual)', () => {
    // Texto sem CNPJ visível, mas com IE
    const texto = 'fazenda de minas gerais dapi declaracao de apuracao IE 001234567 valor mg';
    const r = validarGuia(texto, mockEmpresa({ cnpj: '' }), 'DAPI');
    expect(r.problemas.some((p) => p.severidade === 'info' && p.motivo.includes('Inscrição Estadual'))).toBe(true);
  });

  it('aviso (não bloqueio) quando empresa sem CNPJ nem IE cadastrados', () => {
    const texto = 'documento de arrecadacao PIS - faturamento';
    const r = validarGuia(texto, mockEmpresa({ cnpj: '', inscricao_estadual: '' }), 'PIS');
    const aviso = r.problemas.find((p) => p.motivo.includes('sem CNPJ ou IE'));
    expect(aviso?.severidade).toBe('aviso');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PIS / COFINS / IRPJ / CSLL — perfis federais (DARF)
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — DARF PIS', () => {
  const pisOk = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento codigo 8109';

  it('PDF válido passa', () => {
    const r = validarGuia(pisOk, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(true);
    expect(r.perfilUsado).toBe('PIS');
    expect(r.detectado.denominacaoEncontrada).toMatch(/pis/);
  });

  it('bloqueia quando âncora "documento de arrecadacao" falta', () => {
    const texto = 'pis - faturamento 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.motivo.includes('Tipo de guia não confere'))).toBe(true);
  });

  it('bloqueia quando denominação "PIS -" falta (denominação no DARF é regra de ouro)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 outro tributo qualquer';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.motivo.includes('Denominação não confere'))).toBe(true);
  });

  it('bloqueia se "simples nacional" aparece (palavra proibida)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - simples nacional contribuicoes';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.motivo.includes('outro tributo'))).toBe(true);
  });

  it('bloqueia se denominação COFINS aparece num PDF declarado como PIS', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento cofins - contrib';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.valido).toBe(false);
  });
});

describe('validarGuia — DARF IRPJ', () => {
  it('IRPJ válido passa', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 irpj - lucro presumido cod 2089';
    const r = validarGuia(texto, mockEmpresa(), 'IRPJ');
    expect(r.valido).toBe(true);
    expect(r.perfilUsado).toBe('IRPJ');
  });

  it('bloqueia se "csll -" presente (anti-confusão)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 irpj - lucro presumido csll - liquido';
    const r = validarGuia(texto, mockEmpresa(), 'IRPJ');
    expect(r.valido).toBe(false);
  });
});

describe('validarGuia — DARF CSLL', () => {
  it('CSLL válido passa', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 csll - liquido cod 2372';
    const r = validarGuia(texto, mockEmpresa(), 'CSLL');
    expect(r.valido).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DAS — Simples Nacional
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — DAS (Simples Nacional)', () => {
  const dasOk = 'documento de arrecadacao do simples nacional 12.345.678/0001-99 cod 1001';

  it('DAS válido passa', () => {
    const r = validarGuia(dasOk, mockEmpresa(), 'EMISSÃO GUIA DAS');
    expect(r.valido).toBe(true);
    expect(r.perfilUsado).toBe('EMISSÃO GUIA DAS');
  });

  it('alias "DAS" resolve pra perfil EMISSÃO GUIA DAS', () => {
    const r = validarGuia(dasOk, mockEmpresa(), 'DAS');
    expect(r.perfilUsado).toBe('EMISSÃO GUIA DAS');
  });

  it('bloqueia se "darf" aparece num DAS (anti-confusão DARF vs DAS)', () => {
    const texto = 'documento de arrecadacao do simples nacional 12.345.678/0001-99 darf cod 8109';
    const r = validarGuia(texto, mockEmpresa(), 'EMISSÃO GUIA DAS');
    expect(r.valido).toBe(false);
  });

  it('bloqueia quando âncora "simples nacional" falta', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 cod 1001 receita federal';
    const r = validarGuia(texto, mockEmpresa(), 'EMISSÃO GUIA DAS');
    expect(r.valido).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ISS — verifica município
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — ISS (verifica município)', () => {
  it('passa quando cidade da empresa aparece no PDF', () => {
    const texto = 'issqn prestacao de servicos prefeitura de belo horizonte 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(r.valido).toBe(true);
    expect(r.detectado.cidadeEncontrada).toBe('Belo Horizonte');
  });

  it('cidade com acento → normaliza pra comparação (NFD strip)', () => {
    const texto = 'issqn prestacao de servicos prefeitura de sao paulo 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa({ cidade: 'São Paulo' }), 'ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(r.detectado.cidadeEncontrada).toBe('São Paulo');
  });

  it('bloqueia quando cidade da empresa NÃO aparece no PDF', () => {
    const texto = 'issqn prestacao de servicos prefeitura de outra cidade 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa({ cidade: 'Belo Horizonte' }), 'ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.motivo.includes('Município'))).toBe(true);
  });

  it('aviso (não bloqueio) quando empresa sem cidade cadastrada', () => {
    const texto = 'issqn prestacao de servicos 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa({ cidade: '' }), 'ISS - PRESTAÇÃO DE SERVIÇOS');
    const aviso = r.problemas.find((p) => p.motivo.includes('sem cidade'));
    expect(aviso?.severidade).toBe('aviso');
  });

  it('ISS - PRESTAÇÃO bloqueia se "tomados" aparece (palavra proibida)', () => {
    const texto = 'issqn tomados prefeitura de belo horizonte 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(r.valido).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Estado esperado (DAPI, DIME)
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — DAPI/DIME (estado esperado)', () => {
  it('DAPI válido com sigla MG presente', () => {
    const texto = 'fazenda de minas gerais dapi declaracao de apuracao uf: mg ie 001234567';
    const r = validarGuia(texto, mockEmpresa({ cnpj: '', estado: 'MG' }), 'DAPI');
    expect(r.valido).toBe(true);
  });

  it('aviso quando sigla MG não aparece (mas passa — só aviso, não bloqueio)', () => {
    const texto = 'fazenda de minas gerais dapi declaracao de apuracao ie 001234567';
    const r = validarGuia(texto, mockEmpresa({ cnpj: '', estado: 'MG' }), 'DAPI');
    expect(r.valido).toBe(true);
    expect(r.problemas.some((p) => p.severidade === 'aviso' && p.motivo.includes('Estado'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Códigos de receita esperados (vem do empresa_obrigacoes_config)
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — códigos de receita esperados', () => {
  it('passa quando código esperado bate', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento cod 8109';
    const r = validarGuia(texto, mockEmpresa(), 'PIS', ['8109']);
    expect(r.valido).toBe(true);
    expect(r.detectado.codigoReceitaEncontrado).toBe('8109');
  });

  it('bloqueia quando código esperado NÃO aparece', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento cod 8109';
    const r = validarGuia(texto, mockEmpresa(), 'PIS', ['3703']);
    expect(r.valido).toBe(false);
    expect(r.problemas.some((p) => p.motivo.includes('Código de receita'))).toBe(true);
  });

  it('mensagem de erro mostra qual código apareceu no PDF (pra debug)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento cod 8109';
    const r = validarGuia(texto, mockEmpresa(), 'PIS', ['3703']);
    const erro = r.problemas.find((p) => p.motivo.includes('Código'));
    expect(erro?.detalhe).toContain('8109');
  });

  it('código curto "46-2" (sem zero) bate "046-2" no PDF (gera variante com zero — length < 5)', () => {
    // Esse fallback existe pra planilhas que omitem o zero à esquerda em
    // codigos curtos como "46-2" — PDF traz "046-2" e a validação aceita.
    const texto = 'documento de arrecadacao 12.345.678/0001-99 irpj - lucro presumido cod 046-2';
    const r = validarGuia(texto, mockEmpresa(), 'IRPJ', ['46-2']);
    expect(r.valido).toBe(true);
    expect(r.detectado.codigoReceitaEncontrado).toBe('46-2');
  });

  it('código com zero "0121-4" no esperado bate "121-4" no PDF (variante sem zero — sempre gerada)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 irpj - lucro presumido cod 121-4';
    const r = validarGuia(texto, mockEmpresa(), 'IRPJ', ['0121-4']);
    expect(r.valido).toBe(true);
  });

  it('lista vazia de códigos esperados = não exige', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento';
    const r = validarGuia(texto, mockEmpresa(), 'PIS', []);
    expect(r.valido).toBe(true);
  });

  it('sem códigos esperados = popula só preview se perfil tem conhecidos', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento cod 8109';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.codigoReceitaEncontrado).toBe('8109');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Extração de dados (competência, vencimento, valor)
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — extração de competência', () => {
  it('extrai "PA: MM/YYYY"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento PA: 05/2026';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.competencia).toBe('2026-05');
  });

  it('extrai "Período de Apuração MM/YYYY"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento periodo de apuracao 05/2026';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.competencia).toBe('2026-05');
  });

  it('extrai "Competência MM/YYYY"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento competencia 12/2025';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.competencia).toBe('2025-12');
  });

  it('rejeita mês inválido (13/2026)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento PA: 13/2026';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.competencia).toBeNull();
  });

  it('null quando não acha competência', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.competencia).toBeNull();
  });
});

describe('validarGuia — extração de vencimento', () => {
  it('extrai "Data de Vencimento DD/MM/YYYY"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento data de vencimento 25/05/2026';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.vencimento).toBe('2026-05-25');
  });

  it('extrai "Pagável até DD/MM/YY" (ano abreviado)', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento pagavel ate 25/05/26';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.vencimento).toBe('2026-05-25');
  });

  it('null quando não acha vencimento', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.vencimento).toBeNull();
  });
});

describe('validarGuia — extração de valor', () => {
  it('extrai "Valor total do documento R$ X,XX"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento valor total do documento R$ 1.234,56';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.valor).toBe(1234.56);
  });

  it('extrai "Total a recolher R$ X,XX"', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento total a recolher R$ 500,00';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.valor).toBe(500.00);
  });

  it('null quando não acha valor', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 pis - faturamento';
    const r = validarGuia(texto, mockEmpresa(), 'PIS');
    expect(r.detectado.valor).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Aliases e fallbacks
// ─────────────────────────────────────────────────────────────────────────

describe('validarGuia — aliases', () => {
  it('"DARF" resolve pra DARF-SERVIÇOS TOMADOS', () => {
    const texto = 'documento de arrecadacao 12.345.678/0001-99 irrf - servicos cod 1708';
    const r = validarGuia(texto, mockEmpresa(), 'DARF');
    expect(r.perfilUsado).toBe('DARF-SERVIÇOS TOMADOS');
  });

  it('"DIFAL" resolve pra DIFERENCIAL DE ALIQUOTA', () => {
    const texto = 'icms diferenca de aliquota 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'DIFAL');
    expect(r.perfilUsado).toBe('DIFERENCIAL DE ALIQUOTA');
  });

  it('alias case insensitive ("difal" minúsculo)', () => {
    const texto = 'icms diferenca de aliquota 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'difal');
    expect(r.perfilUsado).toBe('DIFERENCIAL DE ALIQUOTA');
  });

  it('obrigação desconhecida = aviso (não bloqueio) + perfilUsado null', () => {
    const texto = 'qualquer coisa 12.345.678/0001-99';
    const r = validarGuia(texto, mockEmpresa(), 'OBRIGACAO INEXISTENTE');
    expect(r.valido).toBe(true);
    expect(r.perfilUsado).toBeNull();
    expect(r.problemas.some((p) => p.severidade === 'aviso' && p.motivo.includes('Sem regra'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Lista de obrigações com validação
// ─────────────────────────────────────────────────────────────────────────

describe('obrigacoesComValidacao', () => {
  it('lista os principais perfis', () => {
    const lista = obrigacoesComValidacao();
    expect(lista).toContain('PIS');
    expect(lista).toContain('COFINS');
    expect(lista).toContain('IRPJ');
    expect(lista).toContain('CSLL');
    expect(lista).toContain('EMISSÃO GUIA DAS');
    expect(lista).toContain('DAPI');
    expect(lista).toContain('ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(lista.length).toBeGreaterThan(15);
  });
});
