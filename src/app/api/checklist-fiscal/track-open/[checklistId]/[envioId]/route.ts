import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GIF89a 1x1 transparente (43 bytes)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const PIXEL_HEADERS: Record<string, string> = {
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_GIF.length),
  // Sem cache: queremos contar cada abertura, não servir do cache do cliente.
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

function pixelResponse(): Response {
  // Tipagem do BodyInit no edge/node aceita Buffer via Uint8Array.
  return new Response(new Uint8Array(PIXEL_GIF), { status: 200, headers: PIXEL_HEADERS });
}

function stripExtension(value: string): string {
  // Aceita tanto `{envioId}` quanto `{envioId}.gif` no path.
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
  context: { params: Promise<{ checklistId: string; envioId: string }> },
): Promise<Response> {
  // Resposta sempre é o pixel — qualquer erro é silencioso pra não vazar
  // info pro cliente de email e pra não quebrar a renderização.
  try {
    const { checklistId: rawChecklistId, envioId: rawEnvioId } = await context.params;
    const checklistId = stripExtension(rawChecklistId);
    const envioId = stripExtension(rawEnvioId);

    if (!isUuid(checklistId) || !isUuid(envioId)) {
      return pixelResponse();
    }

    const admin = getSupabaseAdmin();

    const { data: row, error: getErr } = await admin
      .from('checklist_fiscal')
      .select('envios_historico')
      .eq('id', checklistId)
      .maybeSingle();

    if (getErr || !row) {
      return pixelResponse();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envios = Array.isArray((row as any).envios_historico) ? ((row as any).envios_historico as any[]) : [];
    const idx = envios.findIndex((e) => e && typeof e === 'object' && String(e.id) === envioId);
    if (idx === -1) {
      return pixelResponse();
    }

    const nowIso = new Date().toISOString();
    const ua = req.headers.get('user-agent') ?? null;
    const ip = clientIp(req);
    const evento = { ...envios[idx] };

    const aberturasAtual = typeof evento.aberturas === 'number' ? evento.aberturas : 0;
    const primeiraAbertura = typeof evento.aberto_em === 'string' && evento.aberto_em
      ? evento.aberto_em
      : nowIso;

    envios[idx] = {
      ...evento,
      aberto_em: primeiraAbertura,
      aberto_em_ultimo: nowIso,
      aberturas: aberturasAtual + 1,
      aberto_user_agent: ua,
      aberto_ip: ip,
    };

    // Best-effort: race entre múltiplos hits concorrentes pode perder uma
    // contagem. Aceitável — pixel tracking é lossy por natureza.
    await admin
      .from('checklist_fiscal')
      .update({ envios_historico: envios })
      .eq('id', checklistId);

    return pixelResponse();
  } catch {
    return pixelResponse();
  }
}
