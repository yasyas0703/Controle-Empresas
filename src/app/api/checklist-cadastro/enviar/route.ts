// Envio de CERTIDÃO ao cliente (Controle Cadastro).
// Espelha /api/checklist-fiscal/enviar-anexo, mas:
//   - destinatários: e-mails tipo='cadastro' (separados do fiscal);
//   - BLOQUEIA Positiva (e PEN em Trabalhista/FGTS) — só Negativa e PEN saem;
//   - sem janela de competência (certidão pode ser de qualquer mês) e sem
//     revalidação por perfil de guia (certidão não está nos perfis do fiscal).
// Defesa em profundidade preservada: auth, permissão, rate limit, guard de
// duplicado, magic-byte %PDF e varredura anti-Positiva no texto do PDF.

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import {
  autenticarRequest, checkRateLimit, extrairTextoPdfServidor, getSupabaseAdmin, isErroApi,
} from '../../checklist-fiscal/_shared';
import { normalizarNomeDepartamento } from '@/app/utils/departamento';
import { colunaDaCertidao, certidaoPodeEnviar } from '@/app/utils/certidoes';
import { resolveBaseUrl, pixelTagCadastro } from '../_pixel';
import { CADASTRO_CERTIDAO_LABEL } from '@/app/types';
import type { CadastroCertidao, CadastroResultado } from '@/app/types';

export const runtime = 'nodejs';

const BUCKET = 'documentos';

interface SendPayload {
  empresaId: string;
  mes: string;            // YYYY-MM
  certidao: CadastroCertidao;
  arquivoPath: string;
  arquivoNome: string;
  resultado?: CadastroResultado | null;
  checklistId?: string;
  confirmarReenvio?: boolean;
  motivoReenvio?: string;
}

const CERTIDOES_VALIDAS: CadastroCertidao[] = ['FGTS', 'TRABALHISTA', 'ESTADUAL', 'ESTADUAL_ADM', 'ESTADUAL_DA', 'MUNICIPAL', 'FEDERAL'];

function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

function stripCrlf(text: string): string { return text.replace(/[\r\n]/g, ' ').trim(); }
function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}
function sanitizeMimeFilename(name: string): string { return stripCrlf(name).replace(/"/g, ''); }
function mimeTypeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}
function temAssinaturaPdf(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
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

/**
 * Permissão pro envio de certidões: admin/gerente OU usuário cujo departamento
 * (principal OU extras) é "cadastro". Espelha o gate da página Controle Cadastro.
 */
async function assertPodeEnviarCadastro(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, userId: string,
): Promise<{ ok: true } | { error: string; status: number; code?: string }> {
  const [userRes, deptsRes] = await Promise.all([
    admin.from('usuarios').select('role, departamento_id, departamentos_extras_ids, ativo').eq('id', userId).maybeSingle(),
    admin.from('departamentos').select('id, nome'),
  ]);
  if (userRes.error || !userRes.data) return { error: 'Usuário não encontrado.', status: 401 };
  const u = userRes.data as { role?: string; departamento_id?: string | null; departamentos_extras_ids?: string[] | null; ativo?: boolean };
  if (u.ativo === false) return { error: 'Usuário inativo.', status: 403, code: 'permissao' };
  if (u.role === 'admin' || u.role === 'gerente') return { ok: true };
  const depts = (deptsRes.data ?? []) as Array<{ id: string; nome: string }>;
  const nomePorId = new Map(depts.map((d) => [d.id, d.nome]));
  const ids = [u.departamento_id, ...(Array.isArray(u.departamentos_extras_ids) ? u.departamentos_extras_ids : [])].filter(Boolean) as string[];
  const ehCadastro = ids.some((id) => normalizarNomeDepartamento(nomePorId.get(id)) === 'cadastro');
  if (ehCadastro) return { ok: true };
  return { error: 'Você não tem acesso ao Cadastro. Apenas o departamento Cadastro (ou gerente/admin) pode enviar certidões.', status: 403, code: 'permissao' };
}

export async function POST(req: Request) {
  try {
    const auth = await autenticarRequest(req);
    if (isErroApi(auth)) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    const userId = auth.userId;

    const body = (await req.json().catch(() => null)) as SendPayload | null;
    if (!body || !body.empresaId || !body.mes || !body.certidao || !body.arquivoPath || !body.arquivoNome) {
      return NextResponse.json({ error: 'Payload inválido (empresaId, mes, certidao, arquivoPath, arquivoNome obrigatórios).' }, { status: 400 });
    }
    if (!CERTIDOES_VALIDAS.includes(body.certidao)) {
      return NextResponse.json({ error: 'Certidão inválida.' }, { status: 400 });
    }
    // Anti path-traversal / IDOR: o arquivo TEM que ser desta empresa.
    if (!body.arquivoPath.startsWith(`empresas/${body.empresaId}/`) || body.arquivoPath.includes('..')) {
      return NextResponse.json({ error: 'Caminho de arquivo inválido.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // 1. Permissão (cadastro)
    const perm = await assertPodeEnviarCadastro(admin, userId);
    if (!('ok' in perm)) return NextResponse.json({ error: perm.error, code: perm.code }, { status: perm.status });

    // 2. Rate limit (30/min por usuário — mesma tabela do fiscal)
    const rl = await checkRateLimit(admin, userId);
    if (isErroApi(rl)) return NextResponse.json({ error: rl.error, code: rl.code }, { status: rl.status });

    // 3. Lê a linha da certidão (fonte da verdade do resultado) + guard de duplicado
    const { data: linha } = await admin
      .from('checklist_cadastro')
      .select('resultado, envios_historico')
      .eq('empresa_id', body.empresaId)
      .eq('certidao', body.certidao)
      .eq('mes', body.mes)
      .maybeSingle();

    const coluna = colunaDaCertidao(body.certidao);
    const resultado = ((linha as { resultado?: string } | null)?.resultado ?? body.resultado ?? null) as CadastroResultado | null;

    // 3a. BLOQUEIO: só Negativa e PEN saem (Trabalhista/FGTS só Negativa).
    if (!certidaoPodeEnviar(coluna, resultado)) {
      return NextResponse.json({
        error: resultado === 'Positiva'
          ? 'Certidão Positiva NÃO é enviada ao cliente.'
          : `Esta certidão (${resultado ?? 'sem resultado'}) não é enviável. Só Negativa e Positiva com efeito de negativa são enviadas (Trabalhista e FGTS, só Negativa).`,
        code: 'certidao_positiva',
      }, { status: 409 });
    }

    // 3b. Guard de duplicado
    if (!body.confirmarReenvio) {
      const envios = ((linha as { envios_historico?: unknown[] } | null)?.envios_historico ?? []) as Array<{ sucesso?: boolean; enviado_em?: string; enviado_por_nome?: string | null; destinatarios?: string[] }>;
      const sucessos = envios.filter((e) => e.sucesso === true);
      if (sucessos.length > 0) {
        const ultimo = sucessos[0]; // mais novo primeiro
        const dataFmt = ultimo.enviado_em ? new Date(ultimo.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        return NextResponse.json({
          error: `Já enviada${dataFmt ? ' em ' + dataFmt : ''}${ultimo.enviado_por_nome ? ' por ' + ultimo.enviado_por_nome : ''}. Confirme o reenvio com motivo.`,
          code: 'duplicado',
          meta: { enviadoEm: ultimo.enviado_em, enviadoPorNome: ultimo.enviado_por_nome, destinatarios: ultimo.destinatarios },
        }, { status: 409 });
      }
    }
    // Reenvio exige motivo (>=10 chars)
    if (body.confirmarReenvio && (body.motivoReenvio?.trim().length ?? 0) < 10) {
      return NextResponse.json({ error: 'Informe o motivo do reenvio (mínimo 10 caracteres).' }, { status: 400 });
    }

    // Todos os envios (manual ou automático) saem da MESMA conta Gmail central
    // (envio@triarcontabilidade.com.br, conectada sob o ghost user) — decisão
    // da Yasmin 2026-06-25. `userId` continua valendo pra permissão/rate-limit/"enviado por".
    const envioUserId = process.env.GHOST_USER_ID;
    if (!envioUserId) {
      return NextResponse.json({ error: 'GHOST_USER_ID não configurado no servidor.' }, { status: 500 });
    }

    // 4. Token Gmail da conta central de envio
    const { data: tokenRow, error: tokenErr } = await admin
      .from('usuario_gmail_tokens')
      .select('email, refresh_token_enc, revoked')
      .eq('usuario_id', envioUserId)
      .maybeSingle();
    if (tokenErr) return NextResponse.json({ error: 'Erro ao consultar token Gmail.' }, { status: 500 });
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json({ error: 'Gmail da conta central de envio não conectado. Avise o admin pra reconectar.' }, { status: 400 });
    }
    let refreshToken: string;
    try { refreshToken = decryptToken(tokenRow.refresh_token_enc); }
    catch { return NextResponse.json({ error: 'Falha ao decodificar token Gmail. Reconecte sua conta.' }, { status: 500 }); }

    // 5. Destinatários: e-mails tipo='cadastro' (fallback se a coluna ainda não existe)
    let emailRows: Array<{ email: string; tipo?: string }> = [];
    {
      const comTipo = await admin
        .from('empresa_emails_cliente')
        .select('email, tipo')
        .eq('empresa_id', body.empresaId)
        .eq('ativo', true);
      if (comTipo.error) {
        // Coluna `tipo` provavelmente ausente — sem ela não há e-mail de cadastro.
        return NextResponse.json({
          error: 'E-mails do cadastro não configurados (rode a migration supabase-migration-checklist-cadastro.sql e cadastre um e-mail do tipo "Cadastro").',
          code: 'sem_emails_cadastro',
        }, { status: 400 });
      }
      emailRows = (comTipo.data ?? []) as Array<{ email: string; tipo?: string }>;
    }
    const emails = emailRows.filter((r) => r.tipo === 'cadastro').map((r) => r.email).filter(Boolean);
    if (emails.length === 0) {
      return NextResponse.json({
        error: 'Esta empresa não tem e-mail do CADASTRO cadastrado. Adicione um e-mail do tipo "Cadastro" na ficha da empresa.',
        code: 'sem_emails_cadastro',
      }, { status: 400 });
    }

    // 6. Baixa o arquivo
    const { data: fileBlob, error: dlErr } = await admin.storage.from(BUCKET).download(body.arquivoPath);
    if (dlErr || !fileBlob) return NextResponse.json({ error: 'Não foi possível baixar o arquivo do storage.' }, { status: 500 });
    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

    // 7. Magic-byte %PDF
    if (!temAssinaturaPdf(fileBuffer)) {
      return NextResponse.json({ error: 'O arquivo não é um PDF válido (assinatura %PDF ausente).', code: 'validacao_pdf' }, { status: 422 });
    }

    // 7b. Varredura anti-Positiva no texto (defesa contra rótulo errado). Best-effort.
    try {
      const texto = (await extrairTextoPdfServidor(fileBuffer)).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const temPositiva = /certidao positiva|certidao\s+de\s+debitos\s+positiva/.test(texto);
      const temEfeitoNegativa = /efeito\s+de\s+negativa|efeitos\s+de\s+negativa/.test(texto);
      if (temPositiva && !temEfeitoNegativa) {
        return NextResponse.json({
          error: 'O texto do PDF indica uma Certidão POSITIVA — não é enviada ao cliente. Revise o resultado.',
          code: 'certidao_positiva',
        }, { status: 422 });
      }
    } catch (err) {
      // PDF ilegível (scanneado/criptografado) — segue (o gate de resultado já barra Positiva rotulada).
      console.warn('[cadastro/enviar] não foi possível varrer texto do PDF:', err);
    }

    // 8. Assunto / corpo
    const { data: empresaRow } = await admin.from('empresas').select('razao_social, apelido, codigo').eq('id', body.empresaId).maybeSingle();
    const e = (empresaRow ?? {}) as { razao_social?: string; apelido?: string; codigo?: string };
    const empresaNome = e.razao_social || e.apelido || e.codigo || 'cliente';
    const certLabel = CADASTRO_CERTIDAO_LABEL[coluna];
    const competenciaLabel = formatComp(body.mes);
    const resultadoLabel = resultado === 'PEN' ? 'Positiva com efeito de negativa' : (resultado ?? '');
    const subject = `Certidão ${certLabel} — ${empresaNome} (${competenciaLabel})`;
    const bodyText =
      `Olá,\n\n` +
      `Segue em anexo a Certidão ${certLabel}${resultadoLabel ? ` (${resultadoLabel})` : ''}, referente a ${competenciaLabel}.\n\n` +
      `Qualquer dúvida, estamos à disposição.\n\nAtenciosamente.`;
    const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    // Pixel de visualização: gera o envioId AGORA (antes do e-mail) pra embedar no
    // src e devolver o MESMO id — assim a rota de track-open acha o evento gravado.
    const envioId = randomUUID();
    const pixel = pixelTagCadastro(resolveBaseUrl(req), body.checklistId, envioId);
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>${pixel}`;

    // 9. Envia
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const mime = buildMime({
      from: tokenRow.email, to: emails, subject, bodyText, bodyHtml,
      attachment: { filename: body.arquivoNome, mime: mimeTypeFromFilename(body.arquivoNome), content: fileBuffer },
    });
    const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
    await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', envioUserId);

    return NextResponse.json({
      ok: true,
      enviadoPara: emails,
      de: tokenRow.email,
      enviadoEm: nowIso,
      gmailMessageId,
      gmailThreadId,
      envioId,
      pixelEmbedado: pixel !== '',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
