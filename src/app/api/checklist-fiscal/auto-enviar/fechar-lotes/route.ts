// Fecha os lotes de livros fiscais maduros e manda cada um (1 email, N anexos).
//
// Chamado pelo watcher ao fim de cada ciclo (gatilho primário — o Vercel Hobby
// não permite cron sub-diário) e pelo cron diário /api/cron/alertar-pendencias-auto
// como backstop. "Maduro" = já tem os 5 tipos de livro conhecidos OU parou de
// receber arquivo há mais de LOTE_DEBOUNCE_MIN minutos (debounce).
//
// Auth: mesmo X-Machine-Token do auto-enviar (env AUTO_ENVIO_TOKEN).

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fecharLotesMaduros } from '../_shared-lote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function baseUrlDe(req: Request): string | null {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, '') ?? null;
}

export async function POST(req: Request) {
  const expected = process.env.AUTO_ENVIO_TOKEN;
  if (!expected) return NextResponse.json({ ok: false, motivo: 'AUTO_ENVIO_TOKEN não configurado' }, { status: 500 });
  const header = req.headers.get('x-machine-token') || '';
  if (!header || !tokensIguais(header, expected)) {
    return NextResponse.json({ ok: false, motivo: 'Token inválido' }, { status: 401 });
  }
  const ghostUserId = process.env.GHOST_USER_ID;
  if (!ghostUserId) return NextResponse.json({ ok: false, motivo: 'GHOST_USER_ID não configurado' }, { status: 500 });

  const admin = getSupabaseAdmin();
  try {
    const r = await fecharLotesMaduros(admin, { ghostUserId, baseUrl: baseUrlDe(req) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('[fechar-lotes] erro:', e);
    return NextResponse.json({ ok: false, motivo: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}
