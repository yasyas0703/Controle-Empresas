import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendPushToCliente } from '@/lib/webPush';
import { vencimentoDoMes, vencimentoDoMesSn } from '@/app/utils/regrasVencimentosFiscais';

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

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

interface SendPayload {
  empresaId: string;
  mes: string;        // YYYY-MM
  obrigacao: string;  // ex: "ICMS", "SPED ICMS/IPI", "EMISSÃO GUIA DAS"
  arquivoPath: string;
  arquivoNome: string;
  // Id da linha em `checklist_fiscal`. Se vier, embedamos pixel de tracking
  // de abertura no HTML. Se não vier, o email é enviado sem rastreamento
  // (degradação graciosa — primeiro envio antes do upload, por exemplo).
  checklistId?: string;
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
    default: return 'application/octet-stream';
  }
}

function buildMime(params: {
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

  const attachmentB64 = params.attachment.content.toString('base64');
  const attachmentB64Wrapped = attachmentB64.match(/.{1,76}/g)?.join('\r\n') ?? attachmentB64;
  const attPart = [
    `--${boundary}`,
    `Content-Type: ${params.attachment.mime}; name="${params.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${params.attachment.filename}"`,
    '',
    attachmentB64Wrapped,
  ].join('\r\n');

  return [headers, '', altPart, '', attPart, '', `--${boundary}--`].join('\r\n');
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

    const body = (await req.json().catch(() => null)) as SendPayload | null;
    if (!body || !body.empresaId || !body.mes || !body.obrigacao || !body.arquivoPath || !body.arquivoNome) {
      return NextResponse.json(
        { error: 'Payload inválido (empresaId, mes, obrigacao, arquivoPath, arquivoNome obrigatórios).' },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    // 1. Carrega token Gmail do usuário
    const { data: tokenRow, error: tokenErr } = await admin
      .from('usuario_gmail_tokens')
      .select('email, refresh_token_enc, revoked')
      .eq('usuario_id', userId)
      .maybeSingle();
    if (tokenErr) {
      return NextResponse.json({ error: 'Erro ao consultar token Gmail.' }, { status: 500 });
    }
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json(
        { error: 'Gmail não conectado. Conecte sua conta Gmail na página de Obrigações antes de enviar anexos.' },
        { status: 400 },
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(tokenRow.refresh_token_enc);
    } catch {
      return NextResponse.json(
        { error: 'Falha ao decodificar token Gmail. Reconecte sua conta Gmail.' },
        { status: 500 },
      );
    }

    // 2. Carrega empresa e emails
    const [empresaRes, emailsRes] = await Promise.all([
      admin
        .from('empresas')
        .select('id, codigo, razao_social, apelido, cnpj, estado, cidade, vencimentos_fiscais')
        .eq('id', body.empresaId)
        .maybeSingle(),
      admin.from('empresa_emails_cliente').select('email').eq('empresa_id', body.empresaId).eq('ativo', true),
    ]);

    if (empresaRes.error || !empresaRes.data) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    }
    if (emailsRes.error) {
      return NextResponse.json({ error: 'Erro ao consultar emails da empresa.' }, { status: 500 });
    }

    const empresa = empresaRes.data as {
      codigo: string;
      razao_social?: string | null;
      apelido?: string | null;
      cnpj?: string | null;
      estado?: string | null;
      cidade?: string | null;
      vencimentos_fiscais?: { nome?: string; vencimento?: string | null }[] | null;
    };

    // Calcula o vencimento da obrigação no mês alvo (body.mes = "YYYY-MM").
    // 1ª tentativa: regras automáticas do Fiscal (ICMS, SPED, IPI etc.)
    // 2ª tentativa: regras SN (EMISSÃO GUIA DAS, DECLARAÇÃO DAS etc.)
    // 3ª tentativa: lookup manual em `empresas.vencimentos_fiscais` (caso a
    //   empresa tenha um vencimento sobrescrito manualmente). Ali a data é
    //   fixa e não varia por mês — usado como último recurso.
    const calcularVencimento = (): string | null => {
      const fiscal = vencimentoDoMes(body.obrigacao, empresa.estado, body.mes, empresa.cidade);
      if (fiscal) return fiscal;
      const sn = vencimentoDoMesSn(body.obrigacao, empresa.estado, body.mes, empresa.cidade);
      if (sn) return sn;
      const normalizar = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const obrigAlvo = normalizar(body.obrigacao);
      const manual = (empresa.vencimentos_fiscais ?? []).find(
        (v) => v?.nome && normalizar(v.nome) === obrigAlvo,
      );
      return manual?.vencimento || null;
    };

    const vencimentoIso = calcularVencimento();
    const vencimentoLabel = vencimentoIso
      ? new Date(vencimentoIso.length === 10 ? vencimentoIso + 'T00:00:00' : vencimentoIso).toLocaleDateString('pt-BR')
      : null;
    const emails = ((emailsRes.data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'Empresa não tem emails cadastrados (cadastre um email do cliente em Empresas).' },
        { status: 400 },
      );
    }

    // 3. Baixa o arquivo do storage
    const { data: fileBlob, error: dlErr } = await admin.storage.from(BUCKET).download(body.arquivoPath);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: 'Não foi possível baixar o arquivo do storage.' }, { status: 500 });
    }
    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

    // 4. Monta assunto/corpo (template genérico — checklist não tem template configurado)
    const empresaNome = empresa.razao_social || empresa.apelido || empresa.codigo;
    const competenciaLabel = formatComp(body.mes);
    const subject = `${body.obrigacao} — ${empresaNome} (${competenciaLabel})`;
    const linhaVencimento = vencimentoLabel
      ? `\nVencimento: ${vencimentoLabel}\n`
      : '';
    const bodyText =
      `Olá,\n\n` +
      `Segue em anexo o arquivo referente à obrigação ${body.obrigacao}, competência ${competenciaLabel}.` +
      linhaVencimento +
      `\nQualquer dúvida, estamos à disposição.\n\n` +
      `Atenciosamente.`;
    const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

    // Pixel de tracking de abertura (1x1 transparente). Só embeda se temos
    // checklistId — sem ele a rota de tracking não consegue achar o evento.
    const envioId = randomUUID();
    const baseUrl = resolveBaseUrl(req);
    const pixelTag = (body.checklistId && baseUrl)
      ? `<img src="${baseUrl}/api/checklist-fiscal/track-open/${body.checklistId}/${envioId}.gif" width="1" height="1" alt="" style="display:none;border:0;outline:none;text-decoration:none;" />`
      : '';

    const bodyHtml =
      `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>` +
      pixelTag;

    // 5. Renova access token e envia
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const mime = buildMime({
      from: tokenRow.email,
      to: emails,
      subject,
      bodyText,
      bodyHtml,
      attachment: {
        filename: body.arquivoNome,
        mime: mimeTypeFromFilename(body.arquivoNome),
        content: fileBuffer,
      },
    });

    const raw = Buffer.from(mime, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    let gmailMessageId: string | undefined;
    let gmailThreadId: string | undefined;
    try {
      const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      gmailMessageId = sendRes.data.id ?? undefined;
      gmailThreadId = sendRes.data.threadId ?? undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar pelo Gmail.';
      return NextResponse.json({ error: `Gmail: ${message}` }, { status: 502 });
    }

    const nowIso = new Date().toISOString();
    await admin
      .from('usuario_gmail_tokens')
      .update({ last_used_at: nowIso })
      .eq('usuario_id', userId);

    // 6. Publica a guia no Portal do Cliente (best-effort: erro aqui
    //    não impede sucesso do envio Gmail, que já aconteceu).
    //
    // Estratégia: cada envio = uma linha nova em portal_documentos.
    // Se já existe linha ATIVA pro mesmo checklist (re-envio), marcamos
    // ela como `removido_em = now()` antes de inserir a nova. O arquivo
    // antigo no Storage FICA preservado pra auditoria (histórico imutável).
    let portalDocumentoId: string | null = null;
    try {
      // Sanitiza o nome do arquivo pro path do Storage (Supabase rejeita
      // acentos/cedilha e alguns caracteres). O nome original continua salvo
      // em `arquivo_nome_original` pra exibição.
      const ext = (body.arquivoNome.split('.').pop() ?? '').toLowerCase();
      const baseSemExt = body.arquivoNome.replace(/\.[^.]+$/, '');
      const nomeSlug = baseSemExt
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'arquivo';
      const nomeSeguro = ext ? `${nomeSlug}.${ext}` : nomeSlug;
      const portalPath = `${body.empresaId}/${randomUUID()}-${nomeSeguro}`;
      const mimeType = mimeTypeFromFilename(body.arquivoNome);

      const { error: uploadErr } = await admin.storage
        .from('portal-documentos')
        .upload(portalPath, fileBuffer, { contentType: mimeType, upsert: false });

      if (!uploadErr) {
        // Soft-delete da(s) linha(s) ativa(s) anterior(es) pro mesmo checklist
        if (body.checklistId) {
          await admin
            .from('portal_documentos')
            .update({ removido_em: nowIso, removido_por_usuario_id: userId })
            .eq('checklist_fiscal_id', body.checklistId)
            .is('removido_em', null);
        }

        const { data: novo } = await admin
          .from('portal_documentos')
          .insert({
            empresa_id: body.empresaId,
            checklist_fiscal_id: body.checklistId ?? null,
            obrigacao_nome: body.obrigacao,
            competencia: body.mes,
            vencimento: vencimentoIso,
            arquivo_storage_path: portalPath,
            arquivo_nome_original: body.arquivoNome,
            arquivo_mime: mimeType,
            arquivo_tamanho_bytes: fileBuffer.byteLength,
            enviado_email: true,
            enviado_email_em: nowIso,
            criado_por_usuario_id: userId,
          })
          .select('id')
          .maybeSingle();
        portalDocumentoId = novo?.id ?? null;

        // Dispara push pro cliente da empresa (best-effort)
        if (portalDocumentoId) {
          try {
            const { data: clienteRow } = await admin
              .from('clientes_portal')
              .select('id')
              .eq('empresa_id', body.empresaId)
              .eq('ativo', true)
              .maybeSingle();

            if (clienteRow?.id) {
              const competenciaLabel = formatComp(body.mes);
              const pushBody = vencimentoLabel
                ? `Competência ${competenciaLabel} · vence ${vencimentoLabel}.`
                : `Competência ${competenciaLabel}. Toque para abrir.`;
              await sendPushToCliente(clienteRow.id, {
                title: `Nova guia: ${body.obrigacao}`,
                body: pushBody,
                url: `/portal/documentos/${portalDocumentoId}`,
                tag: `portal-doc-${portalDocumentoId}`,
              });
            }
          } catch (pushErr) {
            console.error('[enviar-anexo] falha ao enviar push:', pushErr);
          }
        }
      }
    } catch (portalErr) {
      // Loga e segue — Gmail já foi com sucesso, não queremos derrubar a UI.
      console.error('[enviar-anexo] falha ao publicar no portal:', portalErr);
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
      portalDocumentoId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
