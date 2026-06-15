import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GIF89a 1x1 transparente (43 bytes)
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

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

// Pixel de abertura do envio de CERTIDÃO. Atualiza o evento no
// checklist_cadastro.envios_historico. Sempre responde o pixel (erro silencioso).
export async function GET(
  req: Request,
  context: { params: Promise<{ checklistId: string; envioId: string }> },
): Promise<Response> {
  try {
    const { checklistId: rawChecklistId, envioId: rawEnvioId } = await context.params;
    const checklistId = stripExtension(rawChecklistId);
    const envioId = stripExtension(rawEnvioId);
    if (!isUuid(checklistId) || !isUuid(envioId)) return pixelResponse();

    const admin = getSupabaseAdmin();
    const { data: row, error: getErr } = await admin
      .from('checklist_cadastro')
      .select('envios_historico')
      .eq('id', checklistId)
      .maybeSingle();
    if (getErr || !row) return pixelResponse();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envios = Array.isArray((row as any).envios_historico) ? ((row as any).envios_historico as any[]) : [];
    const idx = envios.findIndex((e) => e && typeof e === 'object' && String(e.id) === envioId);
    if (idx === -1) return pixelResponse();

    const nowIso = new Date().toISOString();
    const ua = req.headers.get('user-agent') ?? null;
    const ip = clientIp(req);
    const evento = { ...envios[idx] };

    const aberturasAtual = typeof evento.aberturas === 'number' ? evento.aberturas : 0;
    const primeiraAbertura = typeof evento.aberto_em === 'string' && evento.aberto_em ? evento.aberto_em : nowIso;
    // Abriu → foi entregue. Promove pendente→entregue (bounce, se houver, fica).
    const statusAtual = evento.entrega_status ?? evento.entregaStatus;
    const statusPromovido = statusAtual === 'bounced' || statusAtual === 'entregue' ? statusAtual : 'entregue';

    envios[idx] = {
      ...evento,
      aberto_em: primeiraAbertura,
      aberto_em_ultimo: nowIso,
      aberturas: aberturasAtual + 1,
      aberto_user_agent: ua,
      aberto_ip: ip,
      entrega_status: statusPromovido,
      ...(statusAtual !== statusPromovido ? { entrega_verificada_em: nowIso } : {}),
    };

    await admin.from('checklist_cadastro').update({ envios_historico: envios }).eq('id', checklistId);
    return pixelResponse();
  } catch {
    return pixelResponse();
  }
}
