import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBearerToken } from '@/lib/apiAuth';
import { checkRateLimit, isErroApi } from '../../checklist-fiscal/_shared';

export const runtime = 'nodejs';

const GUIA_BUCKET = 'documentos';



interface SendPayload {
  empresaId: string;
  obrigacaoId: string;
  competencia: string;
  arquivoPath: string;
  vencimento?: string | null;
  valor?: number | null;
}

function formatBR(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

function formatBRL(v?: number | null): string {
  if (v == null) return '';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

// Tira CR/LF pra impedir injeção de cabeçalho de e-mail (um nome de empresa com
// "\nBcc: ..." poderia injetar cabeçalhos no MIME).
function stripCrlf(text: string): string {
  return text.replace(/[\r\n]/g, ' ').trim();
}

function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
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
  const safeFilename = stripCrlf(params.attachment.filename).replace(/"/g, '');
  const attPart = [
    `--${boundary}`,
    `Content-Type: ${stripCrlf(params.attachment.mime)}; name="${safeFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeFilename}"`,
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
    if (!body || !body.empresaId || !body.obrigacaoId || !body.competencia || !body.arquivoPath) {
      return NextResponse.json({ error: 'Payload inválido (empresaId, obrigacaoId, competencia, arquivoPath obrigatórios).' }, { status: 400 });
    }

    // Anti path-traversal / IDOR de arquivo: o caminho TEM que ser desta empresa
    // (uploadGuiaPdf salva em obrigacoes/<empresaId>/...). Sem isso, dava pra baixar
    // e enviar qualquer arquivo do bucket apontando um path de outra empresa.
    if (!body.arquivoPath.startsWith(`obrigacoes/${body.empresaId}/`) || body.arquivoPath.includes('..')) {
      return NextResponse.json({ error: 'Caminho de arquivo inválido.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Autorização (IDOR): só admin/gerente, ou quem é responsável por esta empresa
    // em algum departamento. Sem isso, qualquer staff logado enviava guia (e baixava
    // arquivo) de QUALQUER empresa.
    const [{ data: userRow }, { data: empAuth }] = await Promise.all([
      admin.from('usuarios').select('role').eq('id', userId).maybeSingle(),
      admin.from('empresas').select('responsaveis').eq('id', body.empresaId).maybeSingle(),
    ]);
    const role = (userRow as { role?: string } | null)?.role;
    if (role !== 'admin' && role !== 'gerente') {
      const responsaveis = ((empAuth as { responsaveis?: Record<string, string | null> } | null)?.responsaveis) ?? {};
      if (!Object.values(responsaveis).includes(userId)) {
        return NextResponse.json({ error: 'Você não é responsável por esta empresa.' }, { status: 403 });
      }
    }

    // Rate limit (anti-abuso da quota Gmail do escritório).
    const rl = await checkRateLimit(admin, userId);
    if (isErroApi(rl)) {
      return NextResponse.json({ error: rl.error }, { status: rl.status });
    }

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
      return NextResponse.json({ error: 'Gmail não conectado. Conecte na página de Obrigações.' }, { status: 400 });
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(tokenRow.refresh_token_enc);
    } catch {
      return NextResponse.json({ error: 'Falha ao decodificar token Gmail. Reconecte.' }, { status: 500 });
    }

    // 2. Carrega empresa, obrigação e emails
    const [empresaRes, obrigacaoRes, emailsRes] = await Promise.all([
      admin.from('empresas').select('id, codigo, razao_social, apelido, cnpj').eq('id', body.empresaId).maybeSingle(),
      admin.from('obrigacoes').select('id, nome, codigo, template_email_assunto, template_email_corpo, notificar_cliente').eq('id', body.obrigacaoId).maybeSingle(),
      // Guia fiscal vai SÓ pro e-mail tipo 'fiscal' (não vaza pro e-mail do Cadastro).
      admin.from('empresa_emails_cliente').select('email').eq('empresa_id', body.empresaId).eq('ativo', true).eq('tipo', 'fiscal'),
    ]);

    if (empresaRes.error || !empresaRes.data) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    }
    if (obrigacaoRes.error || !obrigacaoRes.data) {
      return NextResponse.json({ error: 'Obrigação não encontrada.' }, { status: 404 });
    }
    if (emailsRes.error) {
      return NextResponse.json({ error: 'Erro ao consultar emails da empresa.' }, { status: 500 });
    }

    const empresa = empresaRes.data as { codigo: string; razao_social?: string | null; apelido?: string | null; cnpj?: string | null };
    const obrigacao = obrigacaoRes.data as {
      nome: string;
      codigo?: string | null;
      template_email_assunto?: string | null;
      template_email_corpo?: string | null;
      notificar_cliente?: boolean;
    };
    const emails = ((emailsRes.data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);

    if (emails.length === 0) {
      return NextResponse.json({ error: 'Empresa não tem emails cadastrados (ative no cadastro da empresa).' }, { status: 400 });
    }

    // 3. Baixa o PDF do storage
    const { data: fileBlob, error: dlErr } = await admin.storage.from(GUIA_BUCKET).download(body.arquivoPath);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: 'Não foi possível baixar a guia do storage.' }, { status: 500 });
    }
    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());
    const filename = `${(obrigacao.codigo || obrigacao.nome).replace(/[^\w\-]+/g, '_')}_${body.competencia}.pdf`;

    // 4. Monta assunto/corpo
    const empresaNome = empresa.razao_social || empresa.apelido || empresa.codigo;
    const vars: Record<string, string> = {
      empresa: empresaNome,
      empresa_codigo: empresa.codigo,
      empresa_cnpj: empresa.cnpj ?? '',
      obrigacao: obrigacao.nome,
      competencia: formatComp(body.competencia),
      vencimento: formatBR(body.vencimento ?? null),
      valor: formatBRL(body.valor ?? null),
    };

    const assuntoTpl = obrigacao.template_email_assunto?.trim()
      || `Guia ${obrigacao.nome} — ${empresaNome} (${formatComp(body.competencia)})`;
    const corpoTpl = obrigacao.template_email_corpo?.trim()
      || 'Olá,\n\nSegue em anexo a guia de {{obrigacao}} referente à competência {{competencia}}'
      + (body.vencimento ? ', com vencimento em {{vencimento}}' : '')
      + (body.valor != null ? ', no valor de {{valor}}' : '')
      + '.\n\nQualquer dúvida, estamos à disposição.\n\nAtenciosamente.';

    const subject = applyTemplate(assuntoTpl, vars);
    const bodyText = applyTemplate(corpoTpl, vars);
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${bodyText.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</div>`;

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
      attachment: { filename, mime: 'application/pdf', content: fileBuffer },
    });

    const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar pelo Gmail.';
      return NextResponse.json({ error: `Gmail: ${message}` }, { status: 502 });
    }

    const nowIso = new Date().toISOString();
    await admin
      .from('usuario_gmail_tokens')
      .update({ last_used_at: nowIso })
      .eq('usuario_id', userId);

    // Marca a tarefa como concluída
    let concluida = false;
    const { error: updTarefaErr } = await admin
      .from('obrigacao_tarefas')
      .update({
        status: 'concluida',
        concluida_em: nowIso,
        concluida_por_id: userId,
        atualizado_em: nowIso,
      })
      .eq('obrigacao_id', body.obrigacaoId)
      .eq('empresa_id', body.empresaId)
      .eq('competencia', body.competencia);
    if (!updTarefaErr) concluida = true;

    return NextResponse.json({ ok: true, enviadoPara: emails, de: tokenRow.email, concluida });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
