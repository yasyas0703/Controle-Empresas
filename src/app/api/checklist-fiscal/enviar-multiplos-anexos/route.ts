// Variante de /enviar-anexo que aceita MÚLTIPLOS arquivos no mesmo email.
// Usado pra obrigações tipo LIVROS FISCAIS (5-6 PDFs numa entrega só).
//
// Comportamento:
//   1. Recebe array de arquivos já no Storage
//   2. Baixa todos, monta UM email com todos anexos
//   3. Envia via Gmail OAuth da usuária logada
//   4. Pra cada arquivo: insere linha em portal_documentos (1 entrega = N docs)
//   5. Dispara 1 push notification mencionando N arquivos
//   6. Marca o checklist_fiscal como concluído

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { sendPushToCliente } from '@/lib/webPush';
import { vencimentoDoMes, vencimentoDoMesSn } from '@/app/utils/regrasVencimentosFiscais';
import {
  autenticarRequest, assertPodeEnviar, checkRateLimit, buscarEnvioAnterior,
  validarPdfNoServidor, carregarEmpresaCompleta, getSupabaseAdmin, isErroApi,
} from '../_shared';

export const runtime = 'nodejs';

const BUCKET = 'documentos';

function resolveBaseUrl(req: Request): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return null;
  return `${proto}://${host}`;
}

interface SendPayload {
  empresaId: string;
  mes: string;
  obrigacao: string;
  checklistId?: string;
  arquivos: Array<{ path: string; nome: string }>;
  // Códigos esperados (passados pra validação no servidor; aqui geralmente
  // não usado pq LIVROS FISCAIS não tem código de receita, mas mantemos compat).
  codigosEsperados?: string[];
  confirmarReenvio?: boolean;
  forcarEnvio?: boolean;
  motivoForcar?: string;
}

function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

function encodeRfc2047(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function mimeTypeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls': return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'txt': return 'text/plain';
    case 'zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

function buildMimeMulti(params: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: Array<{ filename: string; mime: string; content: Buffer }>;
}): string {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const altBoundary = `----=_Alt_${Math.random().toString(36).slice(2)}_${Date.now()}`;

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to.join(', ')}`,
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

  const attParts = params.attachments.map((att) => {
    const b64 = att.content.toString('base64');
    const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
    return [
      `--${boundary}`,
      `Content-Type: ${att.mime}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      wrapped,
    ].join('\r\n');
  });

  return [headers, '', altPart, '', ...attParts, '', `--${boundary}--`].join('\r\n');
}

function sanitizarNome(nome: string): string {
  const ext = (nome.split('.').pop() ?? '').toLowerCase();
  const base = nome.replace(/\.[^.]+$/, '');
  const slug = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arquivo';
  return ext ? `${slug}.${ext}` : slug;
}

export async function POST(req: Request) {
  try {
    // ─── 0. Auth ───────────────────────────────────────────────────────
    const auth = await autenticarRequest(req);
    if (isErroApi(auth)) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const userId = auth.userId;

    const body = (await req.json().catch(() => null)) as SendPayload | null;
    if (!body || !body.empresaId || !body.mes || !body.obrigacao || !Array.isArray(body.arquivos) || body.arquivos.length === 0) {
      return NextResponse.json(
        { error: 'Payload inválido (empresaId, mes, obrigacao, arquivos[] obrigatórios).' },
        { status: 400 },
      );
    }
    if (body.arquivos.length > 20) {
      return NextResponse.json({ error: 'Máximo 20 arquivos por envio.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // ─── 1. Permissão: funcionário comum só envia das empresas dele ───
    const perm = await assertPodeEnviar(admin, userId, body.empresaId);
    if (isErroApi(perm)) {
      return NextResponse.json({ error: perm.error, code: perm.code }, { status: perm.status });
    }

    // ─── 2. Rate limit ─────────────────────────────────────────────────
    const rl = await checkRateLimit(admin, userId);
    if (isErroApi(rl)) {
      return NextResponse.json({ error: rl.error, code: rl.code }, { status: rl.status });
    }

    // ─── 3. Guard de envio duplicado ───────────────────────────────────
    if (!body.confirmarReenvio) {
      const anterior = await buscarEnvioAnterior(admin, body.empresaId, body.mes, body.obrigacao);
      if (anterior) {
        const dataFmt = new Date(anterior.enviadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        return NextResponse.json(
          {
            error: `Já enviado em ${dataFmt}${anterior.enviadoPorNome ? ' por ' + anterior.enviadoPorNome : ''}. Confirme se quer reenviar.`,
            code: 'duplicado',
            meta: { enviadoEm: anterior.enviadoEm, enviadoPorNome: anterior.enviadoPorNome, destinatarios: anterior.destinatarios },
          },
          { status: 409 },
        );
      }
    }

    // ─── 4. Token Gmail ────────────────────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await admin
      .from('usuario_gmail_tokens')
      .select('email, refresh_token_enc, revoked')
      .eq('usuario_id', userId)
      .maybeSingle();
    if (tokenErr) return NextResponse.json({ error: 'Erro ao consultar token Gmail.' }, { status: 500 });
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json({ error: 'Gmail não conectado. Conecte na página de Obrigações.' }, { status: 400 });
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(tokenRow.refresh_token_enc);
    } catch {
      return NextResponse.json({ error: 'Falha ao decodificar token Gmail. Reconecte.' }, { status: 500 });
    }

    // 5. Empresa completa + emails + role do user (pra forçar)
    const [empresaResult, emailsRes, userRoleRes] = await Promise.all([
      carregarEmpresaCompleta(admin, body.empresaId),
      admin.from('empresa_emails_cliente').select('email').eq('empresa_id', body.empresaId).eq('ativo', true),
      admin.from('usuarios').select('role').eq('id', userId).maybeSingle(),
    ]);
    if (isErroApi(empresaResult)) {
      return NextResponse.json({ error: empresaResult.error }, { status: empresaResult.status });
    }
    if (emailsRes.error) return NextResponse.json({ error: 'Erro ao consultar emails da empresa.' }, { status: 500 });
    const empresa = empresaResult;
    const role = (userRoleRes.data as { role?: string } | null)?.role;
    const podeForcar = role === 'admin' || role === 'gerente';
    const emails = ((emailsRes.data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
    if (emails.length === 0) {
      return NextResponse.json({ error: 'Empresa não tem emails cadastrados.' }, { status: 400 });
    }

    // 6. Vencimento
    const calcularVencimento = (): string | null => {
      const fiscal = vencimentoDoMes(body.obrigacao, empresa.estado, body.mes, empresa.cidade);
      if (fiscal) return fiscal;
      const sn = vencimentoDoMesSn(body.obrigacao, empresa.estado, body.mes, empresa.cidade);
      if (sn) return sn;
      const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const alvo = normalizar(body.obrigacao);
      const manual = (empresa.vencimentosFiscais ?? []).find((v) => v?.nome && normalizar(v.nome) === alvo);
      return manual?.vencimento || null;
    };
    const vencimentoIso = calcularVencimento();
    const vencimentoLabel = vencimentoIso
      ? new Date(vencimentoIso.length === 10 ? vencimentoIso + 'T00:00:00' : vencimentoIso).toLocaleDateString('pt-BR')
      : null;

    // 7. Baixa todos os arquivos do storage
    const buffers: Array<{ nome: string; mime: string; content: Buffer; path: string }> = [];
    for (const arq of body.arquivos) {
      const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(arq.path);
      if (dlErr || !blob) {
        return NextResponse.json({ error: `Falha ao baixar arquivo ${arq.nome}.` }, { status: 500 });
      }
      buffers.push({
        nome: arq.nome,
        mime: mimeTypeFromFilename(arq.nome),
        content: Buffer.from(await blob.arrayBuffer()),
        path: arq.path,
      });
    }

    // ─── 8. Revalida cada PDF no servidor (defesa em profundidade) ─────
    // Pra LIVROS FISCAIS, a obrigação não tem perfil de validação específico,
    // então só checa que o CNPJ da empresa aparece em cada arquivo.
    for (const buf of buffers) {
      const validacao = await validarPdfNoServidor({
        buffer: buf.content,
        empresa,
        obrigacao: body.obrigacao,
        codigosEsperados: body.codigosEsperados ?? [],
        forcarEnvio: !!body.forcarEnvio,
        motivoForcar: body.motivoForcar,
        podeForcar,
      });
      if (isErroApi(validacao)) {
        return NextResponse.json(
          {
            error: `Arquivo "${buf.nome}": ${validacao.error}`,
            code: validacao.code,
            meta: { ...validacao.meta, arquivo: buf.nome },
          },
          { status: validacao.status },
        );
      }
    }

    // 5. Email + pixel de tracking (mesmo padrão do /enviar-anexo single)
    const empresaNome = empresa.razao_social || empresa.apelido || empresa.codigo;
    const competenciaLabel = formatComp(body.mes);
    const subject = `${body.obrigacao} (${buffers.length} arquivos) — ${empresaNome} (${competenciaLabel})`;
    const linhaVencimento = vencimentoLabel ? `\nVencimento: ${vencimentoLabel}\n` : '';
    const listaArquivos = buffers.map((b, i) => `  ${i + 1}. ${b.nome}`).join('\n');
    const bodyText =
      `Olá,\n\n` +
      `Segue em anexo ${buffers.length} arquivo${buffers.length === 1 ? '' : 's'} referente${buffers.length === 1 ? '' : 's'} à obrigação ${body.obrigacao}, competência ${competenciaLabel}:\n\n` +
      listaArquivos + '\n' +
      linhaVencimento +
      `\nQualquer dúvida, estamos à disposição.\n\nAtenciosamente.`;

    const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

    // Pixel de tracking de abertura (1x1). Igual ao /enviar-anexo single.
    const envioId = randomUUID();
    const baseUrl = resolveBaseUrl(req);
    const pixelTag = (body.checklistId && baseUrl)
      ? `<img src="${baseUrl}/api/checklist-fiscal/track-open/${body.checklistId}/${envioId}.gif" width="1" height="1" alt="" style="display:none;border:0;outline:none;text-decoration:none;" />`
      : '';

    const bodyHtml =
      `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>` +
      pixelTag;

    // 6. Envia Gmail
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const mime = buildMimeMulti({
      from: tokenRow.email,
      to: emails,
      subject, bodyText, bodyHtml,
      attachments: buffers.map((b) => ({ filename: b.nome, mime: b.mime, content: b.content })),
    });
    const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    let gmailMessageId: string | undefined;
    let gmailThreadId: string | undefined;
    try {
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      gmailMessageId = res.data.id ?? undefined;
      gmailThreadId = res.data.threadId ?? undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar pelo Gmail.';
      return NextResponse.json({ error: `Gmail: ${message}` }, { status: 502 });
    }

    const nowIso = new Date().toISOString();
    await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', userId);

    // 7. Sobe cada arquivo no portal_documentos (1 linha por arquivo)
    // Soft-delete envios anteriores ativos
    if (body.checklistId) {
      await admin.from('portal_documentos')
        .update({ removido_em: nowIso, removido_por_usuario_id: userId })
        .eq('checklist_fiscal_id', body.checklistId)
        .is('removido_em', null);
    }

    const portalIds: string[] = [];
    for (const arq of buffers) {
      try {
        const nomeSeguro = sanitizarNome(arq.nome);
        const portalPath = `${body.empresaId}/${randomUUID()}-${nomeSeguro}`;
        const { error: upErr } = await admin.storage
          .from('portal-documentos')
          .upload(portalPath, arq.content, { contentType: arq.mime, upsert: false });
        if (upErr) {
          console.error('[enviar-multiplos] falha upload portal:', arq.nome, upErr);
          continue;
        }
        const { data: novo } = await admin.from('portal_documentos').insert({
          empresa_id: body.empresaId,
          checklist_fiscal_id: body.checklistId ?? null,
          obrigacao_nome: body.obrigacao,
          competencia: body.mes,
          vencimento: vencimentoIso,
          arquivo_storage_path: portalPath,
          arquivo_nome_original: arq.nome,
          arquivo_mime: arq.mime,
          arquivo_tamanho_bytes: arq.content.byteLength,
          enviado_email: true,
          enviado_email_em: nowIso,
          criado_por_usuario_id: userId,
        }).select('id').maybeSingle();
        if (novo?.id) portalIds.push(novo.id);
      } catch (err) {
        console.error('[enviar-multiplos] erro portal arquivo:', arq.nome, err);
      }
    }

    // 8. Push notification (1 só)
    if (portalIds.length > 0) {
      try {
        const { data: clienteRow } = await admin.from('clientes_portal')
          .select('id').eq('empresa_id', body.empresaId).eq('ativo', true).maybeSingle();
        if (clienteRow?.id) {
          const competenciaLabel = formatComp(body.mes);
          const pushBody = vencimentoLabel
            ? `${buffers.length} arquivos · Competência ${competenciaLabel} · vence ${vencimentoLabel}.`
            : `${buffers.length} arquivos · Competência ${competenciaLabel}.`;
          await sendPushToCliente(clienteRow.id, {
            title: `${body.obrigacao} — ${buffers.length} arquivos`,
            body: pushBody,
            url: portalIds[0] ? `/portal/documentos/${portalIds[0]}` : '/portal',
            tag: `portal-multi-${body.checklistId ?? 'sem-id'}`,
          });
        }
      } catch (pushErr) {
        console.error('[enviar-multiplos] falha push:', pushErr);
      }
    }

    return NextResponse.json({
      ok: true,
      enviadoPara: emails,
      de: tokenRow.email,
      enviadoEm: nowIso,
      gmailMessageId,
      gmailThreadId,
      envioId,
      pixelEmbedado: pixelTag !== '',
      arquivosEnviados: buffers.length,
      portalDocumentosIds: portalIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
