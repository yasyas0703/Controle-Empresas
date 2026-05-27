import { describe, it, expect } from 'vitest';
import { getBearerToken, assertManager, getClientIpNullable } from './apiAuth';

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

describe('getClientIpNullable', () => {
  it('pega o primeiro IP de x-forwarded-for (cadeia de proxies)', () => {
    const ip = getClientIpNullable(makeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' }));
    expect(ip).toBe('1.2.3.4');
  });

  it('faz trim de espaços', () => {
    expect(getClientIpNullable(makeReq({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('cai pra x-real-ip se x-forwarded-for ausente', () => {
    expect(getClientIpNullable(makeReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('prefere x-forwarded-for quando os dois existem', () => {
    expect(
      getClientIpNullable(makeReq({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '9.9.9.9' })),
    ).toBe('1.1.1.1');
  });

  it('null se nenhum header presente', () => {
    expect(getClientIpNullable(makeReq({}))).toBeNull();
  });

  it('null se x-forwarded-for é string vazia', () => {
    // Edge case: proxy mal configurado pode mandar header vazio
    expect(getClientIpNullable(makeReq({ 'x-forwarded-for': '' }))).toBeNull();
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
