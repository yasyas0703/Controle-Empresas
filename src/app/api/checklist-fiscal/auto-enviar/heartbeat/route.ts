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
import { criarNotificacaoSistema, resolverDestinatariosFiscais } from '@/lib/alertasAutoEnvio';

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

  // Alertas de "arquivo preso na entrada" que o watcher carrega no heartbeat:
  // arquivos que ele NÃO conseguiu enviar (PDF inválido/truncado, lock de
  // leitura persistente, erro de rede contínuo). Cria a notificação no sino —
  // mesmo mecanismo das pendências do auto-envio. O watcher deduplica por
  // arquivo (só re-envia um alerta se a entrega falhar), então aqui é só
  // sanitizar e relatar. Best-effort: falha aqui não derruba o heartbeat.
  const presosRaw = meta && Array.isArray((meta as { arquivosPresos?: unknown }).arquivosPresos)
    ? ((meta as { arquivosPresos: unknown[] }).arquivosPresos)
    : [];
  if (presosRaw.length > 0) {
    try {
      const presos = presosRaw.slice(0, 20).map((p) => {
        const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
        return {
          nome: typeof o.nomeArquivo === 'string' ? o.nomeArquivo.slice(0, 180) : 'arquivo',
          motivo: typeof o.motivo === 'string' ? o.motivo.slice(0, 200) : 'motivo desconhecido',
          min: typeof o.minutosParado === 'number' && Number.isFinite(o.minutosParado)
            ? Math.round(o.minutosParado)
            : null,
        };
      });
      const destinatarios = (await resolverDestinatariosFiscais(admin, null)).map((u) => u.id);
      const linhas = presos.map((p) => `"${p.nome}" — ${p.motivo}${p.min != null ? ` (parado há ~${p.min} min)` : ''}`);
      await criarNotificacaoSistema(admin, {
        titulo: presos.length === 1
          ? 'Guia parada na pasta de entrada (não enviada)'
          : `${presos.length} guias paradas na pasta de entrada (não enviadas)`,
        mensagem:
          `O watcher não conseguiu enviar: ${linhas.join('; ')}. ` +
          'O arquivo continua em "1-GUIAS A ENVIAR" (ou foi pra _PENDENTES se o PDF é inválido). ' +
          'Confira o arquivo e jogue uma versão válida na pasta pra reprocessar.',
        tipo: 'erro',
        empresaId: null,
        destinatarios,
      });
    } catch (e) {
      console.error('[heartbeat] falha ao alertar arquivos presos:', e);
    }
  }

  return NextResponse.json({ ok: true, recebido_em: agora });
}
