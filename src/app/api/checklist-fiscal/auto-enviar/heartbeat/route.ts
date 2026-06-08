// Heartbeat do watcher de guias (dead-man switch).
//
// O daemon (scripts/watcher-guias.mjs) bate ponto aqui de tempos em tempos.
// O cron /api/cron/alertar-pendencias-auto checa o último heartbeat: se ficar
// velho demais em horário comercial, avisa "o watcher parou — nenhuma guia
// está sendo processada". Cobre o pior cenário silencioso (PC desligado, drive
// caiu, token quebrou, processo morreu) — onde hoje ninguém é avisado.
//
// Auth: mesmo X-Machine-Token do auto-enviar (env AUTO_ENVIO_TOKEN).

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  const expected = process.env.AUTO_ENVIO_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, motivo: 'AUTO_ENVIO_TOKEN não configurado' }, { status: 500 });
  }
  const header = req.headers.get('x-machine-token') || '';
  if (!header || !tokensIguais(header, expected)) {
    return NextResponse.json({ ok: false, motivo: 'Token inválido' }, { status: 401 });
  }

  // Meta opcional (versão do watcher, hostname, pendentes na pasta) — best-effort.
  let meta: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    if (body && typeof body === 'object') meta = body as Record<string, unknown>;
  } catch {
    meta = null;
  }

  const admin = getSupabaseAdmin();
  const agora = new Date().toISOString();
  const { error } = await admin
    .from('watcher_status')
    .upsert(
      { id: 'singleton', ultimo_heartbeat: agora, heartbeat_meta: meta, atualizado_em: agora },
      { onConflict: 'id' },
    );
  if (error) {
    console.error('[heartbeat] falha ao gravar:', error.message);
    return NextResponse.json({ ok: false, motivo: 'Falha ao gravar heartbeat' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recebido_em: agora });
}
