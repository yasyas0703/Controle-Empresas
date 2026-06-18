import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { compactarLogsAntigos } from '@/lib/logsRetencao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Compactação do histórico: zera o diff detalhado de logs antigos, mantendo o
// resumo (quem/o quê/quando) pra sempre. A política e a lógica ficam em
// @/lib/logsRetencao. Este endpoint é o gatilho MANUAL (ex.: ?dry=1 pra prever
// quantos seriam compactados, ou força uma rodada). A execução AUTOMÁTICA roda
// acoplada ao cron diário /api/cron/alertar-pendencias-auto — assim não consome
// um 3º slot de cron (plano Hobby da Vercel permite só 2).
export async function GET(req: Request) {
  // Autoriza só com Authorization: Bearer ${CRON_SECRET}. Fail-closed.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') || '';
  const esperado = `Bearer ${cronSecret}`;
  const ba = Buffer.from(auth);
  const bb = Buffer.from(esperado);
  if (ba.length !== bb.length || !timingSafeEqual(ba, bb)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  // ?dry=1 só conta quantos seriam compactados, sem escrever nada.
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  try {
    // Gatilho manual = catch-up: drena lotes maiores que o piggyback diário.
    // Pra um backlog grande, basta chamar de novo até `compactados` vir 0.
    const resultado = await compactarLogsAntigos(getSupabaseAdmin(), { dry, maxBatches: 40 });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    // Detalhe técnico só no log do Vercel — corpo HTTP genérico (rota pública atrás de CRON_SECRET).
    console.error('[cron compactar-logs] erro:', err);
    return NextResponse.json({ error: 'Erro ao compactar logs.' }, { status: 500 });
  }
}
