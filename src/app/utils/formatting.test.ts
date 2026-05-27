import { describe, it, expect } from 'vitest';
import { formatRetNumber } from './formatting';

describe('formatRetNumber', () => {
  it('formata sem hífen quando tem ≤11 dígitos', () => {
    expect(formatRetNumber('12')).toBe('12');
    expect(formatRetNumber('123')).toBe('12.3');
    expect(formatRetNumber('12345678901')).toBe('12.345678901');
  });

  it('formata com hífen quando passa de 11 dígitos', () => {
    expect(formatRetNumber('123456789012')).toBe('12.345678901-2');
    expect(formatRetNumber('1234567890123')).toBe('12.345678901-23');
  });

  it('trunca em 13 dígitos', () => {
    expect(formatRetNumber('12345678901234567')).toBe('12.345678901-23');
  });

  it('strip de não-dígitos antes de formatar', () => {
    expect(formatRetNumber('12.345.678.901-23')).toBe('12.345678901-23');
    expect(formatRetNumber('abc123def456')).toBe('12.3456');
  });

  it('retorna string vazia pra entrada vazia/null/undefined', () => {
    expect(formatRetNumber('')).toBe('');
    expect(formatRetNumber(null)).toBe('');
    expect(formatRetNumber(undefined)).toBe('');
  });

  it('formata 1 dígito (caso edge inicial de digitação)', () => {
    expect(formatRetNumber('1')).toBe('1');
  });
});
