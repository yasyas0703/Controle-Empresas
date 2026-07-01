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
import { ehObrigacaoSempreInterna } from '@/app/types';
import { avaliarJanelaCompetencia, competenciaEsperada } from '@/app/utils/competencia';
import { aplicarOverrideEmailTeste } from '@/lib/modoTesteEnvio';
import { formatarRemetente } from '@/lib/remetente';

export const runtime = 'nodejs';

const BUCKET = 'documentos';

// checklistId é interpolado no src do pixel de tracking (HTML do e-mail).
// Validar como UUID impede injeção de HTML/link via valor forjado (phishing
// partindo do Gmail do escritório). Ver auditoria de segurança 2026-06-11.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveBaseUrl(req: Request): string | null {
  // Host da requisição PRIMEIRO: o pixel precisa apontar pro domínio em que o
  // app está rodando agora. Se priorizarmos NEXT_PUBLIC_APP_URL e ela ficar
  // num domínio antigo (ex: rename do projeto no Vercel), o pixel embute uma
  // URL morta (404) e o tracking de abertura para de funcionar silenciosamente.
  // A env vira só fallback pra chamadas sem host (server-to-server).
  // SEGURANÇA: proto/host vêm de headers controláveis pelo cliente e são
  // interpolados no atributo src do pixel. Host com aspas/<> quebraria o
  // atributo e injetaria HTML/link no e-mail. Validamos: proto só http|https,
  // host só [a-zA-Z0-9.-:]. Inválido → cai no env (ou null).
  const proto = req.headers.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  const rawHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const host = rawHost && /^[a-zA-Z0-9.\-:]+$/.test(rawHost) ? rawHost : null;
  if (host) return `${proto}://${host}`;
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return null;
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

// Strip CRLF — defesa contra header injection no email.
function stripCrlf(text: string): string {
  return text.replace(/[\r\n]/g, ' ').trim();
}

function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function sanitizeMimeFilename(name: string): string {
  return stripCrlf(name).replace(/"/g, '');
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
    `From: ${formatarRemetente(params.from)}`,
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

  const attParts = params.attachments.map((att) => {
    const b64 = att.content.toString('base64');
    const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
    const safeFilename = sanitizeMimeFilename(att.filename);
    const safeMime = stripCrlf(att.mime);
    return [
      `--${boundary}`,
      `Content-Type: ${safeMime}; name="${safeFilename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeFilename}"`,
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

    // Todos os envios (manual ou automático) saem da MESMA conta Gmail central
    // (envio@triarcontabilidade.com.br, conectada sob o ghost user) — decisão
    // da Yasmin 2026-06-25. `userId` continua valendo pra permissão/rate-limit/"enviado por".
    const envioUserId = process.env.GHOST_USER_ID;
    if (!envioUserId) {
      return NextResponse.json({ error: 'GHOST_USER_ID não configurado no servidor.' }, { status: 500 });
    }

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

    // Anti path-traversal / IDOR de arquivo: TODO path tem que ser desta empresa
    // (uploads vão pra empresas/<empresaId>/...). Barra apontar arquivo de outra empresa.
    const prefixoEmpresa = `empresas/${body.empresaId}/`;
    if (body.arquivos.some((a) => !a?.path || !a.path.startsWith(prefixoEmpresa) || a.path.includes('..'))) {
      return NextResponse.json({ error: 'Caminho de arquivo inválido.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // ─── 1. Permissão: funcionário comum só envia das empresas dele ───
    const perm = await assertPodeEnviar(admin, userId, body.empresaId);
    if (isErroApi(perm)) {
      return NextResponse.json({ error: perm.error, code: perm.code }, { status: perm.status });
    }

    // ─── 1.4 Guard: obrigação SEMPRE interna — nunca envia pro cliente ────
    if (ehObrigacaoSempreInterna(body.obrigacao)) {
      return NextResponse.json(
        { error: 'Esta obrigação é interna (não vai pro cliente). Marque como feita — sem enviar e-mail.', code: 'obrigacao_interna' },
        { status: 409 },
      );
    }

    // ─── 1.5 Gate: não envia obrigação DESATIVADA no envio (config.ativa=false) ──
    {
      const { data: cfgRow } = await admin
        .from('empresa_obrigacoes_config')
        .select('ativa')
        .eq('empresa_id', body.empresaId)
        .eq('obrigacao', body.obrigacao.normalize('NFC'))
        .maybeSingle();
      if (cfgRow && (cfgRow as { ativa?: boolean }).ativa === false) {
        return NextResponse.json(
          { error: 'Esta obrigação está inativa no envio para esta empresa. Ative em "Configurar Obrigações" antes de enviar.', code: 'obrigacao_inativa' },
          { status: 409 },
        );
      }
    }

    // ─── 1.6 Janela de competência: só o MÊS ANTERIOR (defesa do servidor) ──
    // LIVROS (multi) seguem a janela como qualquer guia. Hard block aqui (o fluxo
    // multi não tem caminho de "forçar" na UI). Espelha o front.
    {
      const janela = avaliarJanelaCompetencia(body.mes);
      if (janela !== 'ok') {
        const esperada = competenciaEsperada();
        return NextResponse.json(
          {
            error: `Competência ${body.mes} fora da janela — agora só se envia ${esperada} (mês anterior).`,
            code: 'fora_da_janela',
            meta: { competencia: body.mes, esperada, janela },
          },
          { status: 409 },
        );
      }
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

    // ─── 4. Token Gmail da conta central de envio ─────────────────────
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
    try {
      refreshToken = decryptToken(tokenRow.refresh_token_enc);
    } catch {
      return NextResponse.json({ error: 'Falha ao decodificar token Gmail. Reconecte.' }, { status: 500 });
    }

    // 5. Empresa completa + emails + role do user (pra forçar)
    const [empresaResult, emailsRes, userRoleRes] = await Promise.all([
      carregarEmpresaCompleta(admin, body.empresaId),
      // Guia fiscal vai SÓ pro e-mail tipo 'fiscal' (não vaza pro e-mail do Cadastro).
      admin.from('empresa_emails_cliente').select('email').eq('empresa_id', body.empresaId).eq('ativo', true).eq('tipo', 'fiscal'),
      admin.from('usuarios').select('role').eq('id', userId).maybeSingle(),
    ]);
    if (isErroApi(empresaResult)) {
      return NextResponse.json({ error: empresaResult.error }, { status: empresaResult.status });
    }
    if (emailsRes.error) return NextResponse.json({ error: 'Erro ao consultar emails da empresa.' }, { status: 500 });
    const empresa = empresaResult;
    const role = (userRoleRes.data as { role?: string } | null)?.role;
    const podeForcar = role === 'admin' || role === 'gerente';
    const emails = aplicarOverrideEmailTeste(
      ((emailsRes.data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean),
    );
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

    const envioId = randomUUID();
    const baseUrl = resolveBaseUrl(req);

    // 6. Envia Gmail — UM email por destinatário (não um único "To" com todos
    // juntos), igual ao /enviar-anexo single: cada cópia leva seu próprio
    // pixel, pra saber QUAL endereço abriu em vez de marcar "aberto" pra
    // todos juntos.
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    interface EnvioPorDestinatario {
      destId: string; email: string; sucesso: boolean; erro?: string;
      gmailMessageId?: string; gmailThreadId?: string;
    }
    const destinatariosDetalhe: EnvioPorDestinatario[] = [];

    for (const email of emails) {
      const destId = randomUUID();
      const pixelTag = (body.checklistId && UUID_RE.test(body.checklistId) && baseUrl)
        ? `<img src="${baseUrl}/api/checklist-fiscal/track-open/${body.checklistId}/${envioId}/${destId}.gif" width="1" height="1" alt="" style="display:none;border:0;outline:none;text-decoration:none;" />`
        : '';
      const bodyHtml =
        `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>` +
        pixelTag;

      const mime = buildMimeMulti({
        from: tokenRow.email,
        to: [email],
        subject, bodyText, bodyHtml,
        attachments: buffers.map((b) => ({ filename: b.nome, mime: b.mime, content: b.content })),
      });
      const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      try {
        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        destinatariosDetalhe.push({
          destId, email, sucesso: true,
          gmailMessageId: res.data.id ?? undefined,
          gmailThreadId: res.data.threadId ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao enviar pelo Gmail.';
        destinatariosDetalhe.push({ destId, email, sucesso: false, erro: message });
      }
    }

    const algumSucesso = destinatariosDetalhe.some((d) => d.sucesso);
    if (!algumSucesso) {
      const primeiroErro = destinatariosDetalhe[0]?.erro ?? 'Falha ao enviar pelo Gmail.';
      return NextResponse.json({ error: `Gmail: ${primeiroErro}` }, { status: 502 });
    }
    const primeiroSucesso = destinatariosDetalhe.find((d) => d.sucesso);
    const gmailMessageId = primeiroSucesso?.gmailMessageId;
    const gmailThreadId = primeiroSucesso?.gmailThreadId;

    const nowIso = new Date().toISOString();
    await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', envioUserId);

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
      enviadoPara: destinatariosDetalhe.filter((d) => d.sucesso).map((d) => d.email),
      de: tokenRow.email,
      enviadoEm: nowIso,
      gmailMessageId,
      gmailThreadId,
      envioId,
      pixelEmbedado: !!(body.checklistId && UUID_RE.test(body.checklistId) && baseUrl),
      destinatariosDetalhe,
      arquivosEnviados: buffers.length,
      portalDocumentosIds: portalIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
