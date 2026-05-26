import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isoNow,
  toISODate,
  parseISODate,
  daysUntil,
  isWithinDays,
  formatBR,
  isRetRenovado,
} from './date';

describe('parseISODate', () => {
  it('parseia YYYY-MM-DD como data local (sem timezone shift)', () => {
    const d = parseISODate('2026-02-09');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    // Mês é 0-indexed
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(9);
  });

  it('retorna null pra string vazia ou undefined', () => {
    expect(parseISODate('')).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
  });

  it('retorna null pra string que nem parece data', () => {
    expect(parseISODate('não-é-data')).toBeNull();
  });

  it('NÃO valida overflow de mês/dia — JS Date faz wraparound', () => {
    // Limitação conhecida: "9999-99-99" não dispara erro de parse, JS
    // interpreta mês 99 como ~ano+8. Se algum dia for problema, validar
    // ranges (1-12, 1-31) ANTES de chamar parseISODate.
    expect(parseISODate('9999-99-99')).not.toBeNull();
  });

  it('parseia datas no início e fim do ano sem virar pro ano errado por UTC', () => {
    // Bug histórico: "2026-01-01" virava 2025-12-31 em UTC-3
    const ano = parseISODate('2026-01-01');
    expect(ano!.getFullYear()).toBe(2026);
    expect(ano!.getMonth()).toBe(0);
    expect(ano!.getDate()).toBe(1);
  });
});

describe('toISODate', () => {
  it('converte Date pra YYYY-MM-DD', () => {
    expect(toISODate(new Date(2026, 4, 26))).toBe('2026-05-26');
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('aceita string e re-formata', () => {
    expect(toISODate('2026-05-26')).toBe('2026-05-26');
  });

  it('retorna string vazia pra entrada inválida', () => {
    expect(toISODate('lixo')).toBe('');
  });
});

describe('daysUntil', () => {
  beforeEach(() => {
    // Fixa "hoje" em 2026-05-26 (data corrente no projeto)
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna 0 pra hoje', () => {
    expect(daysUntil('2026-05-26')).toBe(0);
  });

  it('retorna 1 pra amanhã', () => {
    expect(daysUntil('2026-05-27')).toBe(1);
  });

  it('retorna -1 pra ontem (vencido)', () => {
    expect(daysUntil('2026-05-25')).toBe(-1);
  });

  it('retorna 30 pra daqui 30 dias', () => {
    expect(daysUntil('2026-06-25')).toBe(30);
  });

  it('retorna null pra entrada vazia', () => {
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('retorna null pra data inválida', () => {
    expect(daysUntil('lixo')).toBeNull();
  });

  it('lida com viradas de ano sem erro de timezone', () => {
    expect(daysUntil('2027-01-01')).toBeGreaterThan(200);
    expect(daysUntil('2025-12-31')).toBeLessThan(0);
  });
});

describe('isWithinDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('true pra hoje (0 dias)', () => {
    expect(isWithinDays('2026-05-26', 5)).toBe(true);
  });

  it('true dentro da janela', () => {
    expect(isWithinDays('2026-05-31', 5)).toBe(true);
  });

  it('false fora da janela (futuro)', () => {
    expect(isWithinDays('2026-06-15', 5)).toBe(false);
  });

  it('false pra datas no passado (vencidas)', () => {
    expect(isWithinDays('2026-05-25', 5)).toBe(false);
  });

  it('false pra entrada inválida', () => {
    expect(isWithinDays(undefined, 5)).toBe(false);
    expect(isWithinDays('lixo', 5)).toBe(false);
  });
});

describe('formatBR', () => {
  it('formata YYYY-MM-DD pro padrão brasileiro', () => {
    expect(formatBR('2026-05-26')).toBe('26/05/2026');
    expect(formatBR('2026-01-01')).toBe('01/01/2026');
  });

  it('retorna "-" pra entrada vazia', () => {
    expect(formatBR(undefined)).toBe('-');
    expect(formatBR('')).toBe('-');
  });

  it('retorna "-" pra data inválida', () => {
    expect(formatBR('lixo')).toBe('-');
  });
});

describe('isRetRenovado', () => {
  it('true quando renovação >= vencimento', () => {
    expect(isRetRenovado('2026-05-10', '2026-05-10')).toBe(true);
    expect(isRetRenovado('2026-05-10', '2026-05-11')).toBe(true);
    expect(isRetRenovado('2026-05-10', '2026-12-31')).toBe(true);
  });

  it('false quando renovação anterior ao vencimento', () => {
    expect(isRetRenovado('2026-05-10', '2026-05-09')).toBe(false);
    expect(isRetRenovado('2026-05-10', '2025-12-31')).toBe(false);
  });

  it('false quando falta alguma data', () => {
    expect(isRetRenovado(undefined, '2026-05-10')).toBe(false);
    expect(isRetRenovado('2026-05-10', undefined)).toBe(false);
    expect(isRetRenovado(undefined, undefined)).toBe(false);
    expect(isRetRenovado('', '2026-05-10')).toBe(false);
  });
});

describe('isoNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T15:30:45Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna ISO 8601 com Z final', () => {
    expect(isoNow()).toBe('2026-05-26T15:30:45.000Z');
  });
});
