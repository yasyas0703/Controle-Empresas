import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mesmo pixel 1x1 transparente da rota sem destId (ver pasta [envioId]/route.ts).
// Essa rota é a versão NOVA — embeda destId (token por destinatário), o que
// permite saber QUAL e-mail abriu, em vez de marcar "aberto" pra todos os
// destinatários do mesmo envio (limitação da rota antiga).
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const PIXEL_HEADERS: Record<string, string> = {
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_GIF.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

function pixelResponse(): Response {
  return new Response(new Uint8Array(PIXEL_GIF), { status: 200, headers: PIXEL_HEADERS });
}

function stripExtension(value: string): string {
  const idx = value.lastIndexOf('.');
  return idx > 0 ? value.slice(0, idx) : value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim() || null;
  return req.headers.get('x-real-ip');
}

export async function GET(
  req: Request,
  context: { params: Promise<{ checklistId: string; envioId: string; destId: string }> },
): Promise<Response> {
  try {
    const { checklistId: rawChecklistId, envioId, destId: rawDestId } = await context.params;
    const checklistId = stripExtension(rawChecklistId);
    const destId = stripExtension(rawDestId);

    if (!isUuid(checklistId) || !isUuid(envioId) || !isUuid(destId)) {
      return pixelResponse();
    }

    const admin = getSupabaseAdmin();

    const { data: row, error: getErr } = await admin
      .from('checklist_fiscal')
      .select('envios_historico')
      .eq('id', checklistId)
      .maybeSingle();
    if (getErr || !row) return pixelResponse();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envios = Array.isArray((row as any).envios_historico) ? ((row as any).envios_historico as any[]) : [];
    const idxEvento = envios.findIndex((e) => e && typeof e === 'object' && String(e.id) === envioId);
    if (idxEvento === -1) return pixelResponse();

    const evento = { ...envios[idxEvento] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detalhes: any[] = Array.isArray(evento.destinatarios_detalhe) ? [...evento.destinatarios_detalhe] : [];
    const idxDest = detalhes.findIndex((d) => d && typeof d === 'object' && String(d.dest_id) === destId);
    if (idxDest === -1) return pixelResponse();

    const nowIso = new Date().toISOString();
    const ua = req.headers.get('user-agent') ?? null;
    const ip = clientIp(req);
    const dest = { ...detalhes[idxDest] };

    const aberturasAtual = typeof dest.aberturas === 'number' ? dest.aberturas : 0;
    const primeiraAbertura = typeof dest.aberto_em === 'string' && dest.aberto_em ? dest.aberto_em : nowIso;

    const statusAtual = dest.entrega_status;
    const statusPromovido = statusAtual === 'bounced' || statusAtual === 'entregue' ? statusAtual : 'entregue';

    detalhes[idxDest] = {
      ...dest,
      aberto_em: primeiraAbertura,
      aberto_em_ultimo: nowIso,
      aberturas: aberturasAtual + 1,
      aberto_user_agent: ua,
      aberto_ip: ip,
      entrega_status: statusPromovido,
    };

    // Também atualiza os campos agregados do EVENTO (nível topo) — é o que a
    // tela do Checklist usa pro badge "Visualizado" quando o envio tem só 1
    // destinatário (o detalhe por destinatário só aparece na UI quando há
    // mais de 1). Sem isso, abrir o email não refletia em nada visível pra
    // quem manda pra um único e-mail (ex.: modo teste, tudo pra 1 endereço).
    const aberturasEventoAtual = typeof evento.aberturas === 'number' ? evento.aberturas : 0;
    const primeiraAberturaEvento = typeof evento.aberto_em === 'string' && evento.aberto_em ? evento.aberto_em : nowIso;
    const statusEventoAtual = evento.entrega_status;
    const statusEventoPromovido = statusEventoAtual === 'bounced' || statusEventoAtual === 'entregue' ? statusEventoAtual : 'entregue';

    // Best-effort: race entre hits concorrentes pode perder uma contagem —
    // aceitável, pixel tracking é lossy por natureza (mesma observação da
    // rota antiga).
    envios[idxEvento] = {
      ...evento,
      destinatarios_detalhe: detalhes,
      aberto_em: primeiraAberturaEvento,
      aberto_em_ultimo: nowIso,
      aberturas: aberturasEventoAtual + 1,
      aberto_user_agent: ua,
      aberto_ip: ip,
      entrega_status: statusEventoPromovido,
    };
    await admin.from('checklist_fiscal').update({ envios_historico: envios }).eq('id', checklistId);

    return pixelResponse();
  } catch {
    return pixelResponse();
  }
}
