// Funções compartilhadas entre:
//   - /api/checklist-fiscal/auto-enviar (watcher dispara)
//   - /api/admin/guias-auto/aprovar-e-enviar (admin aprova pendência)
//
// Centralizar evita divergência de comportamento entre os 2 fluxos —
// validação, montagem de email, upload pro portal, marcação de checklist
// e publicação no portal cliente todos passam pelos mesmos passos.

import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { sendPushToCliente } from '@/lib/webPush';
import { vencimentoDoMes, vencimentoDoMesSn } from '@/app/utils/regrasVencimentosFiscais';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Empresa } from '@/app/types';

const BUCKET_DOCUMENTOS = 'documentos';
const BUCKET_PORTAL = 'portal-documentos';

// ─── Sanitização ────────────────────────────────────────────────────────────
// Mesmo conjunto de helpers do route.ts da auto-enviar — duplicar aqui seria
// pior do que importar, mas dependência circular complica. Como são puros e
// pequenos, ficam aqui também (versão canônica).

export function stripCrlf(text: string): string {
  return text.replace(/[\r\n]/g, ' ').trim();
}

export function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

export function sanitizeMimeFilename(name: string): string {
  return stripCrlf(name).replace(/"/g, '');
}

export function mimeTypeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

export function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

export function calcularVencimento(obrigacao: string, empresa: Empresa, mes: string): string | null {
  const fiscal = vencimentoDoMes(obrigacao, empresa.estado, mes, empresa.cidade);
  if (fiscal) return fiscal;
  const sn = vencimentoDoMesSn(obrigacao, empresa.estado, mes, empresa.cidade);
  if (sn) return sn;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const obrigAlvo = norm(obrigacao);
  const manual = (empresa.vencimentosFiscais ?? []).find((v) => v?.nome && norm(v.nome) === obrigAlvo);
  return manual?.vencimento || null;
}

// ─── MIME builder ───────────────────────────────────────────────────────────

export function buildMime(params: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
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
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
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

  const attachmentB64 = params.attachment.content.toString('base64');
  const attachmentB64Wrapped = attachmentB64.match(/.{1,76}/g)?.join('\r\n') ?? attachmentB64;
  const safeFilename = sanitizeMimeFilename(params.attachment.filename);
  const safeMime = stripCrlf(params.attachment.mime);
  const attPart = [
    `--${boundary}`,
    `Content-Type: ${safeMime}; name="${safeFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    '',
    attachmentB64Wrapped,
  ].join('\r\n');

  return [headers, '', altPart, '', attPart, '', `--${boundary}--`].join('\r\n');
}

// ─── Storage helpers ────────────────────────────────────────────────────────

const PATH_PENDENTE_PREFIX = 'pendentes-auto/';

/**
 * Path pra blob de pendência. Quando uma guia entra como pendente_aprovacao_*,
 * a gente sobe o PDF aqui pra poder ser aprovada depois (Vercel não enxerga T:\).
 * UUID isola pendências do mesmo arquivo no nome.
 */
export function pathPendenteAuto(uuid: string, nomeArquivo: string): string {
  return `${PATH_PENDENTE_PREFIX}${uuid}-${sanitizeMimeFilename(nomeArquivo)}`;
}

/** Confere se um path veio do prefixo de pendente — defesa contra
 *  aprovar-e-enviar receber path arbitrário. */
export function isPathPendente(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false;
  // Bloqueia path-traversal (`..`) e qualquer prefixo errado.
  if (path.includes('..')) return false;
  return path.startsWith(PATH_PENDENTE_PREFIX);
}

export async function subirPendente(
  admin: SupabaseClient,
  buffer: Buffer,
  nomeArquivo: string,
): Promise<{ path: string } | { erro: string }> {
  const path = pathPendenteAuto(randomUUID(), nomeArquivo);
  const { error } = await admin.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: false });
  if (error) return { erro: error.message };
  return { path };
}

export async function baixarPendente(
  admin: SupabaseClient,
  path: string,
): Promise<{ buffer: Buffer } | { erro: string }> {
  if (!isPathPendente(path)) return { erro: 'Path de pendência inválido.' };
  const { data, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(path);
  if (error || !data) return { erro: error?.message ?? 'Falha ao baixar pendência.' };
  const ab = await data.arrayBuffer();
  return { buffer: Buffer.from(ab) };
}

export async function deletarPendente(
  admin: SupabaseClient,
  path: string,
): Promise<void> {
  if (!isPathPendente(path)) return;
  await admin.storage.from(BUCKET_DOCUMENTOS).remove([path]).then(
    () => undefined,
    (err) => console.error('[deletarPendente] falha:', err),
  );
}

// ─── Envio core (Gmail + portal + checklist) ────────────────────────────────

export interface ResultadoEnvio {
  ok: true;
  gmailMessageId?: string;
  destinatarios: string[];
  enviadoDe: string;
  portalDocumentoId: string | null;
  checklistId: string | null;
}

export interface ErroEnvio {
  ok: false;
  motivo: 'gmail_nao_conectado' | 'sem_emails' | 'storage_upload_failed' | 'gmail_send_failed';
  erro: string;
}

/**
 * Roda o pipeline completo de envio dado uma empresa + obrigação + buffer.
 * Compartilhado entre auto-enviar (watcher) e aprovar-e-enviar (admin).
 *
 * Pré-requisito do caller: PDF já passou pela validação rigorosa
 * (validarPdfNoServidor). Esta função NÃO re-valida — assume confiança.
 *
 * Faz: upload bucket documentos, monta email, envia Gmail, upload portal,
 * registra checklist, push pro cliente.
 */
export async function enviarGuia(
  admin: SupabaseClient,
  params: {
    empresa: Empresa;
    obrigacao: string;
    competencia: string;
    nomeArquivo: string;
    fileBuffer: Buffer;
    ghostUserId: string;
    /** Se preenchido, sobrescreve quem fica como "enviado_por" no histórico
     *  (ex: ao aprovar, queremos registrar o admin que aprovou). */
    enviadoPorIdOverride?: string;
    enviadoPorNomeOverride?: string;
  },
): Promise<ResultadoEnvio | ErroEnvio> {
  // 1. Carrega token Gmail do ghost user
  const { data: tokenRow } = await admin
    .from('usuario_gmail_tokens')
    .select('email, refresh_token_enc, revoked')
    .eq('usuario_id', params.ghostUserId)
    .maybeSingle();

  if (!tokenRow || tokenRow.revoked) {
    return { ok: false, motivo: 'gmail_nao_conectado', erro: 'Token Gmail do ghost ausente ou revogado.' };
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(tokenRow.refresh_token_enc);
  } catch {
    return { ok: false, motivo: 'gmail_nao_conectado', erro: 'Falha ao decodificar token Gmail.' };
  }

  // 2. Emails da empresa
  const { data: emailsRes } = await admin
    .from('empresa_emails_cliente')
    .select('email')
    .eq('empresa_id', params.empresa.id)
    .eq('ativo', true);

  const emails = ((emailsRes ?? []) as Array<{ email: string }>).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) {
    return { ok: false, motivo: 'sem_emails', erro: 'Empresa sem emails de cliente cadastrados.' };
  }

  // 3. Upload bucket interno
  const docPath = `empresas/${params.empresa.id}/auto/${randomUUID()}-${sanitizeMimeFilename(params.nomeArquivo)}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(docPath, params.fileBuffer, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    return { ok: false, motivo: 'storage_upload_failed', erro: upErr.message };
  }

  // 4. Email
  const empresaNome = params.empresa.razao_social || params.empresa.apelido || params.empresa.codigo;
  const competenciaLabel = formatComp(params.competencia);
  const vencimentoIso = calcularVencimento(params.obrigacao, params.empresa, params.competencia);
  const vencimentoLabel = vencimentoIso
    ? new Date(vencimentoIso.length === 10 ? vencimentoIso + 'T00:00:00' : vencimentoIso).toLocaleDateString('pt-BR')
    : null;
  const subject = `${params.obrigacao} — ${empresaNome} (${competenciaLabel})`;
  const linhaVencimento = vencimentoLabel ? `\nVencimento: ${vencimentoLabel}\n` : '';
  const bodyText =
    `Olá,\n\n` +
    `Segue em anexo o arquivo referente à obrigação ${params.obrigacao}, competência ${competenciaLabel}.` +
    linhaVencimento +
    `\nQualquer dúvida, estamos à disposição.\n\n` +
    `Atenciosamente.`;
  const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>`;

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const mime = buildMime({
    from: tokenRow.email, to: emails, subject, bodyText, bodyHtml,
    attachment: { filename: params.nomeArquivo, mime: mimeTypeFromFilename(params.nomeArquivo), content: params.fileBuffer },
  });
  const raw = Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  let gmailMessageId: string | undefined;
  try {
    const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    gmailMessageId = sendRes.data.id ?? undefined;
  } catch (err) {
    return { ok: false, motivo: 'gmail_send_failed', erro: err instanceof Error ? err.message : 'Falha Gmail' };
  }

  const nowIso = new Date().toISOString();
  await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', params.ghostUserId);

  // 5. Marca checklist
  const checklistId = await marcarChecklistComoFeito(admin, {
    empresaId: params.empresa.id,
    mes: params.competencia,
    obrigacao: params.obrigacao,
    ghostUserId: params.ghostUserId,
    arquivoNome: params.nomeArquivo,
    fonte: 'auto-enviado',
    destinatarios: emails,
    gmailMessageId,
    enviadoPorIdOverride: params.enviadoPorIdOverride,
    enviadoPorNomeOverride: params.enviadoPorNomeOverride,
  });

  // 6. Portal (best-effort)
  let portalDocumentoId: string | null = null;
  try {
    const portalPath = `${params.empresa.id}/${randomUUID()}-${sanitizeMimeFilename(params.nomeArquivo)}`;
    const { error: upPortalErr } = await admin.storage
      .from(BUCKET_PORTAL)
      .upload(portalPath, params.fileBuffer, { contentType: 'application/pdf', upsert: false });
    if (!upPortalErr) {
      if (checklistId) {
        await admin
          .from('portal_documentos')
          .update({ removido_em: nowIso, removido_por_usuario_id: params.ghostUserId })
          .eq('checklist_fiscal_id', checklistId)
          .is('removido_em', null);
      }
      const { data: novoPortal } = await admin
        .from('portal_documentos')
        .insert({
          empresa_id: params.empresa.id,
          checklist_fiscal_id: checklistId,
          obrigacao_nome: params.obrigacao,
          competencia: params.competencia,
          vencimento: vencimentoIso,
          arquivo_storage_path: portalPath,
          arquivo_nome_original: params.nomeArquivo,
          arquivo_mime: 'application/pdf',
          arquivo_tamanho_bytes: params.fileBuffer.byteLength,
          enviado_email: true,
          enviado_email_em: nowIso,
          criado_por_usuario_id: params.ghostUserId,
        })
        .select('id')
        .maybeSingle();
      portalDocumentoId = novoPortal?.id ?? null;

      if (portalDocumentoId) {
        try {
          const { data: clienteRow } = await admin
            .from('clientes_portal').select('id').eq('empresa_id', params.empresa.id).eq('ativo', true).maybeSingle();
          if (clienteRow?.id) {
            const pushBody = vencimentoLabel
              ? `Competência ${competenciaLabel} · vence ${vencimentoLabel}.`
              : `Competência ${competenciaLabel}. Toque para abrir.`;
            await sendPushToCliente(clienteRow.id, {
              title: `Nova guia: ${params.obrigacao}`,
              body: pushBody,
              url: `/portal/documentos/${portalDocumentoId}`,
              tag: `portal-doc-${portalDocumentoId}`,
            });
          }
        } catch (pushErr) {
          console.error('[enviarGuia] falha push:', pushErr);
        }
      }
    }
  } catch (portalErr) {
    console.error('[enviarGuia] falha ao publicar no portal:', portalErr);
  }

  return {
    ok: true,
    gmailMessageId,
    destinatarios: emails,
    enviadoDe: tokenRow.email,
    portalDocumentoId,
    checklistId,
  };
}

/**
 * Marca o checklist como concluído + adiciona entrada no envios_historico.
 * Suporta override de quem é "enviado_por" pra aprovações administrativas.
 */
export async function marcarChecklistComoFeito(
  admin: SupabaseClient,
  payload: {
    empresaId: string;
    mes: string;
    obrigacao: string;
    ghostUserId: string;
    arquivoNome: string;
    fonte: 'auto-enviado' | 'auto-interna' | 'aprovado-admin';
    destinatarios?: string[];
    gmailMessageId?: string;
    enviadoPorIdOverride?: string;
    enviadoPorNomeOverride?: string;
  },
): Promise<string | null> {
  const nowIso = new Date().toISOString();

  const { data: ghostRow } = await admin
    .from('usuarios').select('nome').eq('id', payload.ghostUserId).maybeSingle();
  const ghostNome = (ghostRow as { nome?: string } | null)?.nome ?? 'Sistema (automático)';

  const enviadoPorId = payload.enviadoPorIdOverride ?? payload.ghostUserId;
  const enviadoPorNome = payload.enviadoPorNomeOverride ?? ghostNome;

  const { data: existente } = await admin
    .from('checklist_fiscal')
    .select('id, envios_historico')
    .eq('empresa_id', payload.empresaId)
    .eq('mes', payload.mes)
    .eq('obrigacao', payload.obrigacao)
    .maybeSingle();

  const novoEvento = {
    id: randomUUID(),
    sucesso: payload.fonte !== 'auto-interna' ? true : true,  // ambos contam como sucesso
    enviado_em: nowIso,
    enviado_por_id: enviadoPorId,
    enviado_por_nome: enviadoPorNome,
    destinatarios: payload.destinatarios ?? [],
    arquivo_nome: payload.arquivoNome,
    gmail_message_id: payload.gmailMessageId,
    automatico: payload.fonte !== 'aprovado-admin',
    fonte: payload.fonte,
  };

  const camposChecklist = {
    concluido: true,
    status: 'feito',
    concluido_em: nowIso,
    concluido_por_id: enviadoPorId,
    concluido_por_nome: enviadoPorNome,
    atualizado_em: nowIso,
  };

  if (existente) {
    const historico = ((existente as { envios_historico?: unknown[] | null }).envios_historico ?? []) as unknown[];
    await admin
      .from('checklist_fiscal')
      .update({
        ...camposChecklist,
        envios_historico: [...historico, novoEvento],
      })
      .eq('id', (existente as { id: string }).id);
    return (existente as { id: string }).id;
  }

  const { data: novo } = await admin
    .from('checklist_fiscal')
    .insert({
      empresa_id: payload.empresaId,
      mes: payload.mes,
      obrigacao: payload.obrigacao,
      ...camposChecklist,
      envios_historico: [novoEvento],
    })
    .select('id')
    .maybeSingle();
  return (novo as { id?: string } | null)?.id ?? null;
}

/** Checa se já houve envio com sucesso pra essa empresa+mês+obrigação. */
export async function jaEnviadaNoChecklist(
  admin: SupabaseClient, empresaId: string, mes: string, obrigacao: string,
): Promise<{ enviadoEm: string } | null> {
  const { data } = await admin
    .from('checklist_fiscal')
    .select('envios_historico')
    .eq('empresa_id', empresaId).eq('mes', mes).eq('obrigacao', obrigacao)
    .maybeSingle();
  if (!data) return null;
  const envios = ((data as { envios_historico?: Array<{ sucesso?: boolean; enviado_em?: string }> | null })
    .envios_historico ?? []);
  const sucessos = envios.filter((e) => e.sucesso === true);
  if (sucessos.length === 0) return null;
  return { enviadoEm: sucessos[sucessos.length - 1].enviado_em ?? '' };
}
