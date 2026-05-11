import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || 'mailto:noreply@triarcontabilidade.com.br';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
  return true;
}

export type PortalPushPayload = {
  title: string;
  body: string;
  url?: string;       // path destino ao clicar (default /portal)
  tag?: string;       // dedupe — push com mesmo tag substitui anterior
  icon?: string;
};

/**
 * Envia push para TODAS as subscriptions ativas de um cliente.
 * Se uma subscription retornar 404/410 (expirada), removemos do DB.
 * Erros de outros tipos são logados mas não derrubam a chamada.
 */
export async function sendPushToCliente(
  clienteId: string,
  payload: PortalPushPayload,
): Promise<{ enviadas: number; falhas: number; removidas: number }> {
  if (!ensureConfigured()) {
    console.warn('[webPush] VAPID keys ausentes — pulando envio.');
    return { enviadas: 0, falhas: 0, removidas: 0 };
  }

  const admin = getSupabaseAdmin();
  const { data: subs } = await admin
    .from('portal_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('cliente_id', clienteId);

  if (!subs || subs.length === 0) {
    return { enviadas: 0, falhas: 0, removidas: 0 };
  }

  const body = JSON.stringify(payload);
  let enviadas = 0;
  let falhas = 0;
  let removidas = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        enviadas++;
        // best-effort: atualiza ultimo_uso_em
        void admin
          .from('portal_push_subscriptions')
          .update({ ultimo_uso_em: new Date().toISOString() })
          .eq('id', s.id);
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        // 404 = endpoint inexistente, 410 = unsubscribe / token expirado
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('portal_push_subscriptions').delete().eq('id', s.id);
          removidas++;
        } else {
          falhas++;
          console.error('[webPush] erro ao enviar push:', statusCode, (err as Error)?.message);
        }
      }
    }),
  );

  return { enviadas, falhas, removidas };
}
