import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBearerToken } from '@/lib/apiAuth';

export const runtime = 'nodejs';



/** Quantos dias pra trás varremos a inbox em busca de bounces. */
const SCAN_LOOKBACK_DAYS = 14;

interface EnvioPendente {
  rowId: string;             // id da linha em checklist_fiscal
  eventoId: string;          // id do evento dentro de envios_historico
  threadId?: string;
  messageId?: string;
  enviadoEm: string;
  destinatarios: string[];
}

interface BounceDetectado {
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  enderecosFalha: string[];
  motivo: string;
  recebidoEm: string;
}

/**
 * Lê headers específicos de uma mensagem Gmail. Como pedimos `format: 'metadata'`
 * + `metadataHeaders`, nem precisamos do escopo total — `gmail.readonly` cobre.
 */
function getHeader(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers.find((x) => (x.name ?? '').toLowerCase() === name.toLowerCase());
  return h?.value ?? undefined;
}

/** Extrai endereços do tipo "x-failed-recipients" (header padrão de NDR). */
function parseFailedRecipients(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
    }
    const userId = authData.user.id;

    const admin = getSupabaseAdmin();

    // 1. Carrega token Gmail
    const { data: tokenRow, error: tokenErr } = await admin
      .from('usuario_gmail_tokens')
      .select('email, refresh_token_enc, revoked, scope')
      .eq('usuario_id', userId)
      .maybeSingle();
    if (tokenErr) {
      return NextResponse.json({ error: 'Erro ao consultar token Gmail.' }, { status: 500 });
    }
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json({ error: 'Gmail não conectado.' }, { status: 400 });
    }

    // Verifica se o scope de leitura está presente — quem conectou antes da
    // mudança não tem `gmail.readonly` e precisa reconectar.
    const scope = String(tokenRow.scope ?? '');
    if (!scope.includes('gmail.readonly')) {
      return NextResponse.json({
        error: 'reconexao_necessaria',
        mensagem: 'Para detectar entregas, reconecte sua conta Gmail (foi adicionada uma permissão extra de leitura para identificar bounces).',
      }, { status: 400 });
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(tokenRow.refresh_token_enc);
    } catch {
      return NextResponse.json({ error: 'Falha ao decodificar token Gmail.' }, { status: 500 });
    }

    // 2. Carrega envios pendentes deste usuário (sucesso=true, entrega ainda
    //    pendente, dentro da janela de scan)
    const limiteIso = new Date(Date.now() - SCAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error: rowsErr } = await admin
      .from('checklist_fiscal')
      .select('id, envios_historico')
      .gte('atualizado_em', limiteIso);
    if (rowsErr) {
      return NextResponse.json({ error: 'Erro ao listar envios pendentes.' }, { status: 500 });
    }

    const pendentes: EnvioPendente[] = [];
    for (const row of rows ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const envios = Array.isArray((row as any).envios_historico) ? (row as any).envios_historico : [];
      for (const e of envios) {
        if (!e || typeof e !== 'object') continue;
        if (e.sucesso !== true) continue;
        const status = e.entrega_status ?? e.entregaStatus;
        // Já finalizado (entregue/bounced) — pula
        if (status === 'entregue' || status === 'bounced') continue;
        // Sem qualquer rastreio — também pula (não conseguimos fazer match sem messageId/threadId)
        const messageId = e.gmail_message_id ?? e.gmailMessageId;
        const threadId = e.gmail_thread_id ?? e.gmailThreadId;
        if (!messageId && !threadId) continue;
        const enviadoEm = e.enviado_em ?? e.enviadoEm;
        if (!enviadoEm || typeof enviadoEm !== 'string') continue;
        // Limita ao usuário que está pedindo verificação (envios da própria conta)
        if (e.enviado_por_id && e.enviado_por_id !== userId) continue;
        pendentes.push({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rowId: String((row as any).id),
          eventoId: String(e.id ?? ''),
          threadId: typeof threadId === 'string' ? threadId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          enviadoEm,
          destinatarios: Array.isArray(e.destinatarios) ? e.destinatarios : [],
        });
      }
    }

    if (pendentes.length === 0) {
      return NextResponse.json({ ok: true, verificados: 0, entregues: 0, bounced: 0 });
    }

    // 3. Lista bounces na inbox (mailer-daemon) das últimas N dias
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const query = `from:mailer-daemon@googlemail.com OR from:mailer-daemon@google.com OR subject:"Delivery Status Notification" newer_than:${SCAN_LOOKBACK_DAYS}d`;

    const bounces: BounceDetectado[] = [];
    try {
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
      });
      const msgIds = (list.data.messages ?? []).map((m) => m.id).filter((x): x is string => !!x);

      for (const msgId of msgIds) {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'In-Reply-To', 'References', 'X-Failed-Recipients', 'Date'],
        });
        const headers = msg.data.payload?.headers ?? [];
        const subject = getHeader(headers, 'Subject') ?? '';
        const inReplyTo = getHeader(headers, 'In-Reply-To');
        const references = getHeader(headers, 'References');
        const xFailed = getHeader(headers, 'X-Failed-Recipients');
        const dateHeader = getHeader(headers, 'Date');
        bounces.push({
          threadId: msg.data.threadId ?? null,
          inReplyTo: inReplyTo ?? null,
          references: references ?? null,
          enderecosFalha: parseFailedRecipients(xFailed),
          motivo: subject,
          recebidoEm: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao ler inbox.';
      return NextResponse.json({ error: `Gmail: ${message}` }, { status: 502 });
    }

    // 4. Faz match entre bounces e envios pendentes
    const updatesPorRow = new Map<string, Map<string, { entregaStatus: 'entregue' | 'bounced'; bounceMotivo?: string; bounceDestinatarios?: string[] }>>();

    for (const env of pendentes) {
      // Procura bounce que case por threadId ou messageId
      const matchedBounce = bounces.find((b) => {
        if (env.threadId && b.threadId === env.threadId) return true;
        if (env.messageId && b.inReplyTo && b.inReplyTo.includes(env.messageId)) return true;
        if (env.messageId && b.references && b.references.includes(env.messageId)) return true;
        return false;
      });

      let novaEntrega: 'entregue' | 'bounced' | null = null;
      let bounceMotivo: string | undefined;
      let bounceDestinatarios: string[] | undefined;

      if (matchedBounce) {
        novaEntrega = 'bounced';
        bounceMotivo = matchedBounce.motivo;
        bounceDestinatarios = matchedBounce.enderecosFalha.length > 0 ? matchedBounce.enderecosFalha : undefined;
      }
      // Sem bounce → mantém 'pendente'. A promoção pra 'entregue' acontece
      // só quando o pixel de abertura dispara (track-open), o que prova que
      // o destinatário abriu o email. Sem essa prova, deixamos como Enviado.

      if (novaEntrega) {
        const inner = updatesPorRow.get(env.rowId) ?? new Map();
        inner.set(env.eventoId, {
          entregaStatus: novaEntrega,
          bounceMotivo,
          bounceDestinatarios,
        });
        updatesPorRow.set(env.rowId, inner);
      }
    }

    // 5. Aplica updates por linha — read-modify-write do JSONB
    let entregues = 0;
    let bouncedCount = 0;

    for (const [rowId, eventosUpdates] of updatesPorRow) {
      const { data: rowData, error: getErr } = await admin
        .from('checklist_fiscal')
        .select('envios_historico')
        .eq('id', rowId)
        .maybeSingle();
      if (getErr || !rowData) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const envios = Array.isArray((rowData as any).envios_historico) ? (rowData as any).envios_historico as any[] : [];
      const verificadoEm = new Date().toISOString();
      const atualizado = envios.map((e) => {
        if (!e || typeof e !== 'object') return e;
        const id = String(e.id ?? '');
        const upd = eventosUpdates.get(id);
        if (!upd) return e;
        if (upd.entregaStatus === 'entregue') entregues++;
        else if (upd.entregaStatus === 'bounced') bouncedCount++;
        return {
          ...e,
          entrega_status: upd.entregaStatus,
          entrega_verificada_em: verificadoEm,
          ...(upd.bounceMotivo ? { bounce_motivo: upd.bounceMotivo } : {}),
          ...(upd.bounceDestinatarios ? { bounce_destinatarios: upd.bounceDestinatarios } : {}),
        };
      });
      await admin
        .from('checklist_fiscal')
        .update({ envios_historico: atualizado })
        .eq('id', rowId);
    }

    return NextResponse.json({
      ok: true,
      verificados: pendentes.length,
      entregues,
      bounced: bouncedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
