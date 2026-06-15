// Auto-envio de CERTIDÃO (opt-in, só quando o watcher manda --auto-enviar).
// Trava em camadas:
//   - só Negativa/PEN (Positiva nunca; FGTS/Trabalhista só Negativa) — certidaoPodeEnviar;
//   - só pra empresa que TEM e-mail tipo='cadastro' ativo;
//   - dedup: não reenvia se já houve envio com sucesso nesse empresa+certidão+mês;
//   - manda pela conta GHOST (igual o fiscal automático).
// Espelha o buildMime/helpers do route manual de cadastro.

import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { colunaDaCertidao, certidaoPodeEnviar } from '@/app/utils/certidoes';
import { CADASTRO_CERTIDAO_LABEL } from '@/app/types';
import type { CadastroCertidao, CadastroResultado, Empresa } from '@/app/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

function stripCrlf(t: string): string { return t.replace(/[\r\n]/g, ' ').trim(); }
function encodeRfc2047(t: string): string {
  const safe = stripCrlf(t);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}
function sanitizeMimeFilename(name: string): string { return stripCrlf(name).replace(/"/g, ''); }
function mimeTypeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}
function buildMime(params: {
  from: string; to: string[]; subject: string; bodyText: string; bodyHtml: string;
  attachment: { filename: string; mime: string; content: Buffer };
}): string {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const altBoundary = `----=_Alt_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const headers = [
    `From: ${stripCrlf(params.from)}`,
    `To: ${params.to.map(stripCrlf).join(', ')}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join('\r\n');
  const altPart = [
    `--${boundary}`, `Content-Type: multipart/alternative; boundary="${altBoundary}"`, '',
    `--${altBoundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(params.bodyText, 'utf8').toString('base64'), '',
    `--${altBoundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(params.bodyHtml, 'utf8').toString('base64'), '', `--${altBoundary}--`,
  ].join('\r\n');
  const attB64 = params.attachment.content.toString('base64');
  const attWrapped = attB64.match(/.{1,76}/g)?.join('\r\n') ?? attB64;
  const fn = sanitizeMimeFilename(params.attachment.filename);
  const attPart = [
    `--${boundary}`, `Content-Type: ${stripCrlf(params.attachment.mime)}; name="${fn}"`,
    'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${fn}"`, '', attWrapped,
  ].join('\r\n');
  return [headers, '', altPart, '', attPart, '', `--${boundary}--`].join('\r\n');
}

export interface AutoEnvioResultado {
  enviou: boolean;
  motivo?: 'nao_enviavel' | 'sem_email_cadastro' | 'ja_enviada' | 'ghost_sem_gmail' | 'erro_envio';
  destinatarios?: string[];
  erro?: string;
}

export async function autoEnviarCertidao(admin: Admin, params: {
  empresa: Empresa;
  certidao: CadastroCertidao;
  mes: string;
  resultado: CadastroResultado | null;
  arquivoNome: string;
  fileBuffer: Buffer;
  ghostUserId: string;
}): Promise<AutoEnvioResultado> {
  const { empresa, certidao, mes, resultado, arquivoNome, fileBuffer, ghostUserId } = params;
  const coluna = colunaDaCertidao(certidao);

  // 1. Regra do escritório: só Negativa/PEN (Positiva nunca; FGTS/Trab só Negativa).
  if (!certidaoPodeEnviar(coluna, resultado)) return { enviou: false, motivo: 'nao_enviavel' };

  // 2. Destinatários tipo='cadastro' ativos.
  const { data: emailRows } = await admin.from('empresa_emails_cliente')
    .select('email').eq('empresa_id', empresa.id).eq('tipo', 'cadastro').eq('ativo', true);
  const emails = ((emailRows ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (!emails.length) return { enviou: false, motivo: 'sem_email_cadastro' };

  // 3. Dedup: já enviada com sucesso nesse empresa+certidão+mês?
  const { data: cell } = await admin.from('checklist_cadastro')
    .select('envios_historico').eq('empresa_id', empresa.id).eq('certidao', certidao).eq('mes', mes).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enviosAnt = Array.isArray(cell?.envios_historico) ? (cell.envios_historico as any[]) : [];
  if (enviosAnt.some((e) => e && e.sucesso === true)) return { enviou: false, motivo: 'ja_enviada' };

  // 4. Token Gmail do GHOST.
  const { data: tokenRow } = await admin.from('usuario_gmail_tokens')
    .select('email, refresh_token_enc, revoked').eq('usuario_id', ghostUserId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr = tokenRow as any;
  if (!tr || tr.revoked || !tr.refresh_token_enc) return { enviou: false, motivo: 'ghost_sem_gmail' };
  let refreshToken: string;
  try { refreshToken = decryptToken(tr.refresh_token_enc); } catch { return { enviou: false, motivo: 'ghost_sem_gmail' }; }
  const from = tr.email as string;

  // 5. Monta o e-mail.
  const certLabel = CADASTRO_CERTIDAO_LABEL[coluna];
  const empresaNome = empresa.razao_social || empresa.apelido || empresa.codigo || 'cliente';
  const compLabel = formatComp(mes);
  const resLabel = resultado === 'PEN' ? 'Positiva com efeito de negativa' : (resultado ?? '');
  const subject = `Certidão ${certLabel} — ${empresaNome} (${compLabel})`;
  const bodyText =
    `Olá,\n\nSegue em anexo a Certidão ${certLabel}${resLabel ? ` (${resLabel})` : ''}, referente a ${compLabel}.\n\n` +
    `Qualquer dúvida, estamos à disposição.\n\nAtenciosamente.`;
  const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>`;

  // 6. Envia via ghost.
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const mime = buildMime({ from, to: emails, subject, bodyText, bodyHtml,
    attachment: { filename: arquivoNome, mime: mimeTypeFromFilename(arquivoNome), content: fileBuffer } });
  const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let gmailMessageId: string | undefined, gmailThreadId: string | undefined;
  try {
    const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    gmailMessageId = sendRes.data.id ?? undefined;
    gmailThreadId = sendRes.data.threadId ?? undefined;
  } catch (err) {
    return { enviou: false, motivo: 'erro_envio', erro: err instanceof Error ? err.message : 'falha gmail' };
  }

  // 7. Registra o evento + marca concluído (append, mais novo primeiro).
  const nowIso = new Date().toISOString();
  const evento = {
    id: randomUUID(), enviado_em: nowIso, enviado_por_id: ghostUserId, enviado_por_nome: 'Envio automático',
    remetente_email: from, destinatarios: emails, arquivo_nome: arquivoNome, sucesso: true,
    gmail_message_id: gmailMessageId ?? null, gmail_thread_id: gmailThreadId ?? null, entrega_status: 'pendente',
  };
  await admin.from('checklist_cadastro').upsert({
    empresa_id: empresa.id, certidao, mes,
    envios_historico: [evento, ...enviosAnt],
    concluido: true, concluido_por_id: ghostUserId, concluido_por_nome: 'Envio automático', concluido_em: nowIso,
    atualizado_em: nowIso,
  }, { onConflict: 'empresa_id,certidao,mes' });
  await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', ghostUserId);

  return { enviou: true, destinatarios: emails };
}
