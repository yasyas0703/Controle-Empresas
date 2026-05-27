import { google } from 'googleapis';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Strip de CRLF de qualquer valor que vai pra header de email. Sem isso,
 * se algum caller passa `subject` ou `to` com `\r\n` (vindo de razao_social
 * controlada por user autenticado), atacante pode injetar headers extras
 * (Bcc: evil@x.com). É CRLF Injection clássico em SMTP.
 *
 * Aplicado em TODOS os campos que viram parte do header (from, to, subject).
 */
function stripCrlf(text: string): string {
  return text.replace(/[\r\n]/g, ' ').trim();
}

function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function buildSimpleMime(params: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
}): string {
  const altBoundary = `----=_Alt_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  // Sanitiza CRLF em TODOS os campos do header — defesa contra
  // CRLF injection (ex: razao_social com `\r\nBcc:` injetaria Bcc).
  const safeTo = params.to.map(stripCrlf).join(', ');
  const safeFrom = stripCrlf(params.from);
  const headers = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
  ].join('\r\n');

  const body = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.bodyText, 'utf8').toString('base64'),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.bodyHtml, 'utf8').toString('base64'),
    '',
    `--${altBoundary}--`,
  ].join('\r\n');

  return [headers, '', body].join('\r\n');
}

export type GmailSendResult =
  | { ok: true; messageId?: string; threadId?: string; from: string }
  | { ok: false; error: string };

/**
 * Envia um email simples (HTML + texto, sem anexo) usando o Gmail OAuth
 * do usuário interno (token armazenado em `usuario_gmail_tokens`).
 */
export async function sendEmailViaUserGmail(
  usuarioId: string,
  params: { to: string[]; subject: string; bodyText: string; bodyHtml: string },
): Promise<GmailSendResult> {
  const admin = getSupabaseAdmin();

  const { data: tokenRow, error: tokenErr } = await admin
    .from('usuario_gmail_tokens')
    .select('email, refresh_token_enc, revoked')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (tokenErr) return { ok: false, error: 'Erro ao consultar token Gmail.' };
  if (!tokenRow || tokenRow.revoked) {
    return { ok: false, error: 'Gmail não conectado. Conecte sua conta Gmail antes de enviar.' };
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(tokenRow.refresh_token_enc);
  } catch {
    return { ok: false, error: 'Falha ao decodificar token Gmail. Reconecte sua conta.' };
  }

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const mime = buildSimpleMime({
    from: tokenRow.email,
    to: params.to,
    subject: params.subject,
    bodyText: params.bodyText,
    bodyHtml: params.bodyHtml,
  });
  const raw = Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    void admin
      .from('usuario_gmail_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('usuario_id', usuarioId);
    return {
      ok: true,
      messageId: res.data.id ?? undefined,
      threadId: res.data.threadId ?? undefined,
      from: tokenRow.email,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao enviar pelo Gmail.' };
  }
}
