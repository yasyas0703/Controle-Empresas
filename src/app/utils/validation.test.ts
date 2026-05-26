import { describe, it, expect } from 'vitest';
import {
  cepSchema,
  cpfSchema,
  cnpjSchema,
  detectTipoInscricao,
  detectTipoEstabelecimento,
  formatarDocumento,
  getTipoInscricaoDisplay,
  getTipoEstabelecimentoDisplay,
} from './validation';

describe('cepSchema', () => {
  it('aceita CEP com 8 dígitos', () => {
    expect(cepSchema.parse('01310-100')).toBe('01310100');
    expect(cepSchema.parse('01310100')).toBe('01310100');
  });
  it('rejeita CEP com tamanho errado', () => {
    expect(() => cepSchema.parse('1234')).toThrow();
    expect(() => cepSchema.parse('1234567890')).toThrow();
  });
});

describe('cpfSchema', () => {
  it('aceita CPF formatado e cru com 11 dígitos', () => {
    expect(cpfSchema.parse('123.456.789-09')).toBe('12345678909');
    expect(cpfSchema.parse('12345678909')).toBe('12345678909');
  });
  it('rejeita com tamanho diferente', () => {
    expect(() => cpfSchema.parse('123')).toThrow();
    expect(() => cpfSchema.parse('123456789012')).toThrow();
  });
});

describe('cnpjSchema', () => {
  it('aceita CNPJ formatado e cru com 14 dígitos', () => {
    expect(cnpjSchema.parse('11.222.333/0001-44')).toBe('11222333000144');
    expect(cnpjSchema.parse('11222333000144')).toBe('11222333000144');
  });
  it('rejeita com tamanho diferente', () => {
    expect(() => cnpjSchema.parse('123')).toThrow();
    expect(() => cnpjSchema.parse('11222333000144999')).toThrow();
  });
});

describe('detectTipoInscricao', () => {
  it('11 dígitos = CPF', () => {
    expect(detectTipoInscricao('12345678909')).toBe('CPF');
    expect(detectTipoInscricao('123.456.789-09')).toBe('CPF');
  });

  it('14 dígitos = CNPJ por padrão', () => {
    expect(detectTipoInscricao('11222333000144')).toBe('CNPJ');
  });

  it('14 dígitos preserva CAEPF/MEI quando já é o tipo atual', () => {
    expect(detectTipoInscricao('11222333000144', 'CAEPF')).toBe('CAEPF');
    expect(detectTipoInscricao('11222333000144', 'MEI')).toBe('MEI');
  });

  it('12 dígitos NÃO assume CNO/CEI sem tipo atual (deixa user terminar de digitar)', () => {
    // Bug histórico: assumir CNO em 12 dígitos cortava em 15 chars e impedia
    // o usuário de chegar nos 14 do CNPJ. Por isso mantém o tipo atual.
    expect(detectTipoInscricao('112223334441')).toBe('');
    expect(detectTipoInscricao('112223334441', 'CNPJ')).toBe('CNPJ');
  });

  it('12 dígitos respeita CNO/CEI já selecionados', () => {
    expect(detectTipoInscricao('112223334441', 'CNO')).toBe('CNO');
    expect(detectTipoInscricao('112223334441', 'CEI')).toBe('CEI');
  });

  it('tamanho qualquer outro mantém tipo atual', () => {
    expect(detectTipoInscricao('1234', 'CPF')).toBe('CPF');
    expect(detectTipoInscricao('1234')).toBe('');
  });
});

describe('detectTipoEstabelecimento', () => {
  it('CNPJ com /0001 = matriz', () => {
    expect(detectTipoEstabelecimento('11222333000144')).toBe('matriz');
    expect(detectTipoEstabelecimento('11.222.333/0001-44')).toBe('matriz');
  });

  it('CNPJ com /0002+ = filial', () => {
    expect(detectTipoEstabelecimento('11222333000244')).toBe('filial');
    expect(detectTipoEstabelecimento('11222333099944')).toBe('filial');
  });

  it('não-CNPJ retorna string vazia', () => {
    expect(detectTipoEstabelecimento('12345678909')).toBe('');
    expect(detectTipoEstabelecimento('')).toBe('');
  });
});

describe('formatarDocumento', () => {
  it('formata CPF (11 dígitos) auto-detect', () => {
    expect(formatarDocumento('12345678909')).toBe('123.456.789-09');
  });

  it('formata CNPJ (14 dígitos) auto-detect', () => {
    expect(formatarDocumento('11222333000144')).toBe('11.222.333/0001-44');
  });

  it('14 dígitos sempre cai no formato CNPJ no auto-detect', () => {
    expect(formatarDocumento('12345678909999')).toBe('12.345.678/9099-99');
  });

  it('formata CAEPF quando tipo explícito', () => {
    expect(formatarDocumento('12345678901234', 'CAEPF')).toBe('123.456.789/012-34');
  });

  it('formata CNO quando tipo explícito (15 chars: XX.XXX.XXXXX-XX)', () => {
    expect(formatarDocumento('123456789012', 'CNO')).toBe('12.345.67890-12');
  });

  it('formata progressivamente conforme usuário digita', () => {
    expect(formatarDocumento('1')).toBe('1');
    expect(formatarDocumento('123')).toBe('123');
    expect(formatarDocumento('1234')).toBe('123.4');
    expect(formatarDocumento('1234567')).toBe('123.456.7');
  });

  it('retorna string vazia pra entrada vazia', () => {
    expect(formatarDocumento('')).toBe('');
    expect(formatarDocumento('abc')).toBe(''); // só strip de não-dígitos
  });

  it('ignora caracteres não numéricos no input', () => {
    expect(formatarDocumento('abc12345678909xyz')).toBe('123.456.789-09');
  });
});

describe('getTipoInscricaoDisplay', () => {
  it('preserva tipo já definido', () => {
    expect(getTipoInscricaoDisplay('11222333000144', 'CAEPF')).toBe('CAEPF');
  });

  it('detecta quando tipo está vazio', () => {
    expect(getTipoInscricaoDisplay('11222333000144', '')).toBe('CNPJ');
    expect(getTipoInscricaoDisplay('12345678909', '')).toBe('CPF');
  });

  it('retorna vazio quando doc indefinido', () => {
    expect(getTipoInscricaoDisplay(undefined, '')).toBe('');
  });
});

describe('getTipoEstabelecimentoDisplay', () => {
  it('preserva tipo já definido', () => {
    expect(getTipoEstabelecimentoDisplay('11222333000244', 'matriz')).toBe('matriz');
  });

  it('detecta quando tipo está vazio', () => {
    expect(getTipoEstabelecimentoDisplay('11222333000144', '')).toBe('matriz');
    expect(getTipoEstabelecimentoDisplay('11222333000244', '')).toBe('filial');
  });

  it('retorna vazio quando doc indefinido', () => {
    expect(getTipoEstabelecimentoDisplay(undefined, '')).toBe('');
  });
});
