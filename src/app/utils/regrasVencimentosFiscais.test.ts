import { describe, it, expect } from 'vitest';
import {
  getDiaVencimento,
  vencimentoDoMes,
  proximoVencimento,
  proximoVencimentoEmpresa,
  impostosComRegra,
  temRegraAutomatica,
  obrigacaoAplicaParaEmpresa,
  getDiaVencimentoSn,
  vencimentoDoMesSn,
  obrigacaoSnAplicaParaEmpresa,
} from './regrasVencimentosFiscais';

// ─────────────────────────────────────────────────────────────────────────
// getDiaVencimento — ordem de prioridade: cidade > UF > default
// ─────────────────────────────────────────────────────────────────────────

describe('getDiaVencimento', () => {
  it('ICMS NORMAL em MG → dia 8 (regra estadual específica)', () => {
    expect(getDiaVencimento('ICMS NORMAL', 'MG')).toBe(8);
  });

  it('ICMS NORMAL em SP → dia 20', () => {
    expect(getDiaVencimento('ICMS NORMAL', 'SP')).toBe(20);
  });

  it('ICMS NORMAL em BA → dia 10', () => {
    expect(getDiaVencimento('ICMS NORMAL', 'BA')).toBe(10);
  });

  it('ICMS NORMAL em SC → dia 10', () => {
    expect(getDiaVencimento('ICMS NORMAL', 'SC')).toBe(10);
  });

  it('ICMS NORMAL em estado sem regra específica → default 20', () => {
    expect(getDiaVencimento('ICMS NORMAL', 'RJ')).toBe(20);
    expect(getDiaVencimento('ICMS NORMAL', 'CE')).toBe(20);
  });

  it('ICMS NORMAL sem estado → default 20', () => {
    expect(getDiaVencimento('ICMS NORMAL', null)).toBe(20);
    expect(getDiaVencimento('ICMS NORMAL', undefined)).toBe(20);
  });

  it('imposto sem regra cadastrada → null', () => {
    expect(getDiaVencimento('IMPOSTO INEXISTENTE', 'SP')).toBeNull();
  });

  it('DAPI só tem regra pra MG (sem default) → null pra outros estados', () => {
    expect(getDiaVencimento('DAPI', 'MG')).toBe(8);
    expect(getDiaVencimento('DAPI', 'SP')).toBeNull();
    expect(getDiaVencimento('DAPI', null)).toBeNull();
  });

  it('DIME só tem regra pra SC → null pra outros', () => {
    expect(getDiaVencimento('DIME', 'SC')).toBe(10);
    expect(getDiaVencimento('DIME', 'MG')).toBeNull();
    expect(getDiaVencimento('DIME', null)).toBeNull();
  });

  it('PIS/COFINS/IPI sempre dia 25 (default sem variação)', () => {
    expect(getDiaVencimento('PIS', 'MG')).toBe(25);
    expect(getDiaVencimento('COFINS', 'SP')).toBe(25);
    expect(getDiaVencimento('IPI', 'RJ')).toBe(25);
  });

  it('CSLL/IRPJ dia 30', () => {
    expect(getDiaVencimento('CSLL', 'MG')).toBe(30);
    expect(getDiaVencimento('IRPJ', 'SP')).toBe(30);
  });

  describe('ISS — PRESTAÇÃO DE SERVIÇOS (regra por cidade)', () => {
    it('cidade exata cadastrada → usa o dia da cidade', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Ouro Fino')).toBe(10);
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Lavras')).toBe(15);
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Pouso Alegre')).toBe(15);
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'SP', 'Pereira Barreto')).toBe(25);
    });

    it('cidade com acento → normalizada (NFD strip)', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Sapucaí Mirim')).toBe(10);
    });

    it('cidade com case diferente → normalizada pra lowercase', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'OURO FINO')).toBe(10);
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'ouro fino')).toBe(10);
    });

    it('cidade com espaços extras → colapsa', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', '  Ouro   Fino  ')).toBe(10);
    });

    it('cidade NÃO cadastrada → null (sem default)', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Cidade Aleatória')).toBeNull();
    });

    it('sem cidade nem regra estadual → null', () => {
      expect(getDiaVencimento('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', null)).toBeNull();
    });
  });

  describe('ISS — SERVIÇOS TOMADOS', () => {
    it('cidades cadastradas', () => {
      expect(getDiaVencimento('ISS - SERVIÇOS TOMADOS', 'SP', 'São Bernardo do Campo')).toBe(15);
      expect(getDiaVencimento('ISS - SERVIÇOS TOMADOS', 'SP', 'São Paulo')).toBe(10);
      expect(getDiaVencimento('ISS - SERVIÇOS TOMADOS', 'MG', 'Inconfidentes')).toBe(10);
    });
  });

  describe('normalizarUf', () => {
    it('case insensitive (lowercase passa pra uppercase)', () => {
      expect(getDiaVencimento('ICMS NORMAL', 'mg')).toBe(8);
      expect(getDiaVencimento('ICMS NORMAL', 'Sp')).toBe(20);
    });

    it('estado com tamanho ≠ 2 → ignora (vai pro default)', () => {
      expect(getDiaVencimento('ICMS NORMAL', 'MGS')).toBe(20); // 3 chars → null em normalizarUf → default
      expect(getDiaVencimento('ICMS NORMAL', 'M')).toBe(20);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// vencimentoDoMes — calcula data ISO baseada em ano-mes
// ─────────────────────────────────────────────────────────────────────────

describe('vencimentoDoMes', () => {
  it('formato YYYY-MM-DD com zero padding', () => {
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', '2026-05')).toBe('2026-05-08');
    expect(vencimentoDoMes('ICMS NORMAL', 'SP', '2026-01')).toBe('2026-01-20');
  });

  it('aceita YYYY-M (mês sem zero) também', () => {
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', '2026-5')).toBe('2026-05-08');
  });

  it('clampa dia ao último do mês (ex: dia 30 em fevereiro vira 28)', () => {
    expect(vencimentoDoMes('CSLL', 'SP', '2026-02')).toBe('2026-02-28');
    expect(vencimentoDoMes('CSLL', 'SP', '2027-02')).toBe('2027-02-28');
  });

  it('fevereiro bissexto (2028)', () => {
    expect(vencimentoDoMes('CSLL', 'SP', '2028-02')).toBe('2028-02-29');
  });

  it('null se imposto sem regra', () => {
    expect(vencimentoDoMes('IMPOSTO INEXISTENTE', 'SP', '2026-05')).toBeNull();
  });

  it('null se formato de mês inválido', () => {
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', 'lixo')).toBeNull();
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', '2026')).toBeNull();
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', '2026-13')).toBeNull();
    expect(vencimentoDoMes('ICMS NORMAL', 'MG', '2026-00')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// proximoVencimento — escolhe entre mês atual ou próximo
// ─────────────────────────────────────────────────────────────────────────

describe('proximoVencimento', () => {
  it('hoje < dia do vencimento → mês atual', () => {
    // ICMS NORMAL MG vence dia 8. Em 05/05/2026 → próximo é 08/05.
    const ref = new Date(2026, 4, 5); // 5 de maio
    expect(proximoVencimento('ICMS NORMAL', 'MG', ref)).toBe('2026-05-08');
  });

  it('hoje == dia do vencimento → mês atual (inclusive)', () => {
    const ref = new Date(2026, 4, 8);
    expect(proximoVencimento('ICMS NORMAL', 'MG', ref)).toBe('2026-05-08');
  });

  it('hoje > dia do vencimento → mês seguinte', () => {
    const ref = new Date(2026, 4, 25);
    expect(proximoVencimento('ICMS NORMAL', 'MG', ref)).toBe('2026-06-08');
  });

  it('virada de ano: dezembro → janeiro do próximo', () => {
    const ref = new Date(2026, 11, 25); // 25 dez 2026
    expect(proximoVencimento('ICMS NORMAL', 'MG', ref)).toBe('2027-01-08');
  });

  it('clampa dia ao último do mês atual e do próximo', () => {
    // CSLL vence dia 30. Em 28 jan 2027 → mês atual permite (30/01). Em 31 jan → fev (28/02).
    const ref1 = new Date(2027, 0, 28);
    expect(proximoVencimento('CSLL', 'SP', ref1)).toBe('2027-01-30');
    const ref2 = new Date(2027, 0, 31);
    expect(proximoVencimento('CSLL', 'SP', ref2)).toBe('2027-02-28');
  });

  it('null se sem regra', () => {
    expect(proximoVencimento('IMPOSTO INEXISTENTE', 'MG')).toBeNull();
  });

  it('default sem passar referencia usa "hoje"', () => {
    // Só verifica que devolve algo válido — não dá pra fixar Date.now em test sem fake-timers
    const r = proximoVencimento('PIS', 'SP');
    expect(r).toMatch(/^\d{4}-\d{2}-25$/);
  });
});

describe('proximoVencimentoEmpresa', () => {
  it('extrai estado + cidade da empresa', () => {
    const empresa = { estado: 'MG', cidade: 'Ouro Fino' };
    const ref = new Date(2026, 4, 5);
    expect(proximoVencimentoEmpresa(empresa, 'ISS - PRESTAÇÃO DE SERVIÇOS', ref)).toBe('2026-05-10');
  });

  it('empresa sem estado nem cidade → usa só default', () => {
    const empresa = { estado: null, cidade: null };
    const ref = new Date(2026, 4, 5);
    expect(proximoVencimentoEmpresa(empresa, 'PIS', ref)).toBe('2026-05-25');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// obrigacaoAplicaParaEmpresa — controla quais cells aparecem no checklist
// ─────────────────────────────────────────────────────────────────────────

describe('obrigacaoAplicaParaEmpresa', () => {
  it('obrigação sem regra → aplica a todos (true)', () => {
    expect(obrigacaoAplicaParaEmpresa('DARF-SERVIÇOS TOMADOS', 'MG')).toBe(true);
    expect(obrigacaoAplicaParaEmpresa('NÃO EXISTE', null)).toBe(true);
  });

  it('LIVROS FISCAIS / DEMONSTR. APURAÇÃO (regra vazia {}) → não aplica (sem dia)', () => {
    // {} sem default nem cidades → getDiaVencimento devolve null → não aplica
    expect(obrigacaoAplicaParaEmpresa('LIVROS FISCAIS', 'MG')).toBe(false);
    expect(obrigacaoAplicaParaEmpresa('DEMONSTR. APURAÇÃO', 'SP')).toBe(false);
  });

  it('DAPI aplica em MG (true) mas não em SP (false)', () => {
    expect(obrigacaoAplicaParaEmpresa('DAPI', 'MG')).toBe(true);
    expect(obrigacaoAplicaParaEmpresa('DAPI', 'SP')).toBe(false);
  });

  it('DIME aplica em SC, não em outros estados', () => {
    expect(obrigacaoAplicaParaEmpresa('DIME', 'SC')).toBe(true);
    expect(obrigacaoAplicaParaEmpresa('DIME', 'MG')).toBe(false);
  });

  it('ISS aplica só pra empresas com cidade cadastrada', () => {
    expect(obrigacaoAplicaParaEmpresa('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Ouro Fino')).toBe(true);
    expect(obrigacaoAplicaParaEmpresa('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', 'Belo Horizonte')).toBe(false);
    expect(obrigacaoAplicaParaEmpresa('ISS - PRESTAÇÃO DE SERVIÇOS', 'MG', null)).toBe(false);
  });
});

describe('temRegraAutomatica', () => {
  it('retorna true quando há regra aplicável', () => {
    expect(temRegraAutomatica('ICMS NORMAL', 'MG')).toBe(true);
    expect(temRegraAutomatica('PIS')).toBe(true);
  });

  it('false quando sem regra aplicável', () => {
    expect(temRegraAutomatica('DAPI', 'SP')).toBe(false);
    expect(temRegraAutomatica('IMPOSTO INEXISTENTE')).toBe(false);
  });
});

describe('impostosComRegra', () => {
  it('lista todos os impostos do REGRAS', () => {
    const lista = impostosComRegra();
    expect(lista).toContain('ICMS NORMAL');
    expect(lista).toContain('DAPI');
    expect(lista).toContain('ISS - PRESTAÇÃO DE SERVIÇOS');
    expect(lista.length).toBeGreaterThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Simples Nacional
// ─────────────────────────────────────────────────────────────────────────

describe('getDiaVencimentoSn', () => {
  it('EMISSÃO GUIA DAS, RECIBO DAS, SINTEGRA, DESTDA → dia 20', () => {
    expect(getDiaVencimentoSn('EMISSÃO GUIA DAS')).toBe(20);
    expect(getDiaVencimentoSn('RECIBO DAS')).toBe(20);
    expect(getDiaVencimentoSn('SINTEGRA')).toBe(20);
    expect(getDiaVencimentoSn('DESTDA')).toBe(20);
  });

  it('DECLARAÇÃO DAS → dia 0 (convenção: último dia do mês)', () => {
    expect(getDiaVencimentoSn('DECLARAÇÃO DAS')).toBe(0);
  });

  it('DIFERENCIAL DE ALIQUOTA → dia 4', () => {
    expect(getDiaVencimentoSn('DIFERENCIAL DE ALIQUOTA')).toBe(4);
  });

  it('ICMS ANTECIPADO → dia 20', () => {
    expect(getDiaVencimentoSn('ICMS ANTECIPADO')).toBe(20);
  });

  it('ST ANTECIPADO → dia 29', () => {
    expect(getDiaVencimentoSn('ST ANTECIPADO')).toBe(29);
  });

  it('null pra imposto inexistente', () => {
    expect(getDiaVencimentoSn('NÃO EXISTE')).toBeNull();
  });
});

describe('vencimentoDoMesSn', () => {
  it('vencimentos normais', () => {
    expect(vencimentoDoMesSn('EMISSÃO GUIA DAS', null, '2026-05')).toBe('2026-05-20');
    expect(vencimentoDoMesSn('ST ANTECIPADO', null, '2026-05')).toBe('2026-05-29');
  });

  it('DECLARAÇÃO DAS (dia 0) → último dia do mês', () => {
    expect(vencimentoDoMesSn('DECLARAÇÃO DAS', null, '2026-05')).toBe('2026-05-31');
    expect(vencimentoDoMesSn('DECLARAÇÃO DAS', null, '2026-02')).toBe('2026-02-28');
    expect(vencimentoDoMesSn('DECLARAÇÃO DAS', null, '2028-02')).toBe('2028-02-29'); // bissexto
    expect(vencimentoDoMesSn('DECLARAÇÃO DAS', null, '2026-04')).toBe('2026-04-30');
  });

  it('ST ANTECIPADO (dia 29) em fevereiro → clampa pra 28 (ou 29 bissexto)', () => {
    expect(vencimentoDoMesSn('ST ANTECIPADO', null, '2026-02')).toBe('2026-02-28');
    expect(vencimentoDoMesSn('ST ANTECIPADO', null, '2028-02')).toBe('2028-02-29');
  });

  it('null pra mes inválido', () => {
    expect(vencimentoDoMesSn('EMISSÃO GUIA DAS', null, '2026-13')).toBeNull();
    expect(vencimentoDoMesSn('EMISSÃO GUIA DAS', null, 'lixo')).toBeNull();
  });
});

describe('obrigacaoSnAplicaParaEmpresa', () => {
  it('obrigações SN todas têm default → aplicam a qualquer UF', () => {
    expect(obrigacaoSnAplicaParaEmpresa('EMISSÃO GUIA DAS', 'MG')).toBe(true);
    expect(obrigacaoSnAplicaParaEmpresa('DECLARAÇÃO DAS', 'SP')).toBe(true);
    expect(obrigacaoSnAplicaParaEmpresa('SINTEGRA', null)).toBe(true);
  });

  it('obrigação não cadastrada → aplica (true, comportamento conservador)', () => {
    expect(obrigacaoSnAplicaParaEmpresa('NÃO EXISTE', 'MG')).toBe(true);
  });
});
