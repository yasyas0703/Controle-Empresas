import { describe, it, expect } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it('aceita UUIDs v4 válidos', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isUuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
  });

  it('aceita UUIDs com maiúsculas (case-insensitive)', () => {
    expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    expect(isUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true);
  });

  it('rejeita strings sem hífens', () => {
    expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejeita strings com tamanho errado', () => {
    expect(isUuid('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('rejeita strings com caracteres não-hex', () => {
    expect(isUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false);
    expect(isUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });

  it('rejeita não-strings', () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({})).toBe(false);
    expect(isUuid([])).toBe(false);
  });

  it('rejeita SQL injection attempts', () => {
    expect(isUuid("'; DROP TABLE users; --")).toBe(false);
    expect(isUuid('1 OR 1=1')).toBe(false);
  });

  it('rejeita path traversal', () => {
    expect(isUuid('../../etc/passwd')).toBe(false);
    expect(isUuid('..%2F..%2Fetc%2Fpasswd')).toBe(false);
  });
});
