// Rate limiter simples em memória (sem dependência externa)
// Limita por IP. Reseta automaticamente após a janela de tempo.

const hits = new Map<string, { count: number; resetAt: number }>();

// Limpa entradas expiradas a cada 60s
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key);
    }
  }, 60_000);
}

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return { ok: false, remaining: 0 };
  }

  return { ok: true, remaining: maxRequests - entry.count };
}

import { getClientIpNullable } from '@/lib/apiAuth';

/**
 * Versão "always-string" do IP do cliente — usa 'unknown' como fallback
 * pra servir de chave de rate-limit (rate-limit nunca pode ter null como
 * key). Delegação fina pra `getClientIpNullable` evitar duplicar a
 * lógica de leitura dos headers.
 */
export function getClientIp(req: Request): string {
  return getClientIpNullable(req) ?? 'unknown';
}
