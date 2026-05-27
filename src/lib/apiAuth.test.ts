import { describe, it, expect } from 'vitest';
import { getBearerToken } from './apiAuth';

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://x', { headers });
}

describe('getBearerToken', () => {
  it('extrai token de "Authorization: Bearer X"', () => {
    expect(getBearerToken(makeReq({ Authorization: 'Bearer abc123' }))).toBe('abc123');
  });

  it('extrai com header em lowercase', () => {
    expect(getBearerToken(makeReq({ authorization: 'Bearer xyz' }))).toBe('xyz');
  });

  it('é case-insensitive no esquema "bearer"', () => {
    expect(getBearerToken(makeReq({ Authorization: 'bearer abc' }))).toBe('abc');
    expect(getBearerToken(makeReq({ Authorization: 'BEARER abc' }))).toBe('abc');
  });

  it('aceita JWT longo com pontos/underscores', () => {
    const jwt = 'eyJhbGc.eyJzdWIi.signature-here_with-symbols';
    expect(getBearerToken(makeReq({ Authorization: `Bearer ${jwt}` }))).toBe(jwt);
  });

  it('null quando header ausente', () => {
    expect(getBearerToken(makeReq({}))).toBeNull();
  });

  it('null quando esquema é outro (Basic, ApiKey, etc)', () => {
    expect(getBearerToken(makeReq({ Authorization: 'Basic abc' }))).toBeNull();
    expect(getBearerToken(makeReq({ Authorization: 'ApiKey abc' }))).toBeNull();
  });

  it('null quando o header é só "Bearer" sem token', () => {
    expect(getBearerToken(makeReq({ Authorization: 'Bearer' }))).toBeNull();
  });
});
