import { describe, it, expect } from 'vitest';
import { getBearerToken, assertManager } from './apiAuth';

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

// assertManager depende de Supabase + DB — testes profundos exigem mock que
// não vale a complexidade. Os smoke tests abaixo cobrem só os early-returns
// (env ausente, header ausente) que não tocam o Supabase.
describe('assertManager (smoke)', () => {
  it('falha 500 se NEXT_PUBLIC_SUPABASE_URL ausente', async () => {
    const orig = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const r = await assertManager(makeReq({}));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(500);
        expect(r.message).toMatch(/Supabase env/);
      }
    } finally {
      if (orig !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = orig;
    }
  });

  it('falha 401 se Authorization ausente (env configurada)', async () => {
    // Garante env mínima pra passar do primeiro guard
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'fake-anon-key-pra-teste';
    const r = await assertManager(makeReq({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.message).toMatch(/Missing Authorization/i);
    }
  });
});
