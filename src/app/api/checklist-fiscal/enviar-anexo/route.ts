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
import { avaliarJanelaCompetencia, competenciaEsperada, competenciaEfetiva } from '@/app/utils/competencia';
import { aplicarOverrideEmailTeste } from '@/lib/modoTesteEnvio';

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
  mes: string;        // YYYY-MM
  obrigacao: string;  // ex: "ICMS", "SPED ICMS/IPI", "EMISSÃO GUIA DAS"
  arquivoPath: string;
  arquivoNome: string;
  // Id da linha em `checklist_fiscal`. Se vier, embedamos pixel de tracking
  // de abertura no HTML. Se não vier, o email é enviado sem rastreamento
  // (degradação graciosa — primeiro envio antes do upload, por exemplo).
  checklistId?: string;
  // Códigos de receita esperados (de empresa_obrigacoes_config). Usado na
  // revalidação do PDF no servidor.
  codigosEsperados?: string[];
  // Quando o usuário confirma reenviar uma guia já enviada antes.
  confirmarReenvio?: boolean;
  // Quando admin/gerente força envio mesmo com bloqueios na validação.
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
    // da Yasmin 2026-06-25: não é mais "cada usuária envia da própria conta".
    // `userId` continua valendo pra permissão/rate-limit/"enviado por".
    const envioUserId = process.env.GHOST_USER_ID;
    if (!envioUserId) {
      return NextResponse.json({ error: 'GHOST_USER_ID não configurado no servidor.' }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as SendPayload | null;
    if (!body || !body.empresaId || !body.mes || !body.obrigacao || !body.arquivoPath || !body.arquivoNome) {
      return NextResponse.json(
        { error: 'Payload inválido (empresaId, mes, obrigacao, arquivoPath, arquivoNome obrigatórios).' },
        { status: 400 },
      );
    }

    // Anti path-traversal / IDOR de arquivo: o caminho TEM que ser desta empresa
    // (uploads vão pra empresas/<empresaId>/...). Sem isso, um usuário autorizado
    // nesta empresa poderia baixar e enviar um arquivo de OUTRA empresa.
    if (!body.arquivoPath.startsWith(`empresas/${body.empresaId}/`) || body.arquivoPath.includes('..')) {
      return NextResponse.json({ error: 'Caminho de arquivo inválido.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // ─── 1. Permissão: funcionário comum só envia das empresas dele ───
    const perm = await assertPodeEnviar(admin, userId, body.empresaId);
    if (isErroApi(perm)) {
      return NextResponse.json({ error: perm.error, code: perm.code }, { status: perm.status });
    }

    // ─── 1.4 Guard: obrigação SEMPRE interna (RECIBO/DECLARAÇÃO do DAS) ─────
    // NUNCA envia e-mail pro cliente — só é marcada/arquivada. A UI roteia
    // internas pra "marcar feito", mas aqui é a defesa no servidor (cobre o
    // Checklist Mensal e qualquer caller direto).
    if (ehObrigacaoSempreInterna(body.obrigacao)) {
      return NextResponse.json(
        { error: 'Esta obrigação é interna (não vai pro cliente). Marque como feita — o arquivo fica arquivado sem enviar e-mail.', code: 'obrigacao_interna' },
        { status: 409 },
      );
    }

    // ─── 1.5 Gate: não envia obrigação DESATIVADA no envio (config.ativa=false) ──
    // Espelha o gate do auto-envio. A aba Envio já esconde o botão de obrigação
    // inativa, mas DevTools poderia burlar — aqui é a defesa no servidor.
    // Obrigação SEM config ou ATIVA segue normal (default permissivo, não quebra
    // empresa nova/não-configurada). Normaliza NFC pra casar acento decomposto.
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

    // ─── 2. Rate limit: máx 30 envios/min por usuário ──────────────────
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

    // ─── 4. Carrega token Gmail da conta central de envio ─────────────
    const { data: tokenRow, error: tokenErr } = await admin
      .from('usuario_gmail_tokens')
      .select('email, refresh_token_enc, revoked')
      .eq('usuario_id', envioUserId)
      .maybeSingle();
    if (tokenErr) {
      return NextResponse.json({ error: 'Erro ao consultar token Gmail.' }, { status: 500 });
    }
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json(
        { error: 'Gmail da conta central de envio não conectado. Avise o admin pra reconectar.' },
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

    // 5. Carrega empresa completa (pra validação) + emails + role do user
    const [empresaResult, emailsRes, userRoleRes] = await Promise.all([
      carregarEmpresaCompleta(admin, body.empresaId),
      // Guia fiscal vai SÓ pro e-mail tipo 'fiscal' (não vaza pro e-mail do Cadastro).
      admin.from('empresa_emails_cliente').select('email').eq('empresa_id', body.empresaId).eq('ativo', true).eq('tipo', 'fiscal'),
      admin.from('usuarios').select('role').eq('id', userId).maybeSingle(),
    ]);

    if (isErroApi(empresaResult)) {
      return NextResponse.json({ error: empresaResult.error }, { status: empresaResult.status });
    }
    if (emailsRes.error) {
      return NextResponse.json({ error: 'Erro ao consultar emails da empresa.' }, { status: 500 });
    }
    const empresa = empresaResult;
    const role = (userRoleRes.data as { role?: string } | null)?.role;
    const podeForcar = role === 'admin' || role === 'gerente';

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
      const manual = (empresa.vencimentosFiscais ?? []).find(
        (v) => v?.nome && normalizar(v.nome) === obrigAlvo,
      );
      return manual?.vencimento || null;
    };

    const vencimentoIso = calcularVencimento();
    const vencimentoLabel = vencimentoIso
      ? new Date(vencimentoIso.length === 10 ? vencimentoIso + 'T00:00:00' : vencimentoIso).toLocaleDateString('pt-BR')
      : null;
    const emails = aplicarOverrideEmailTeste(
      ((emailsRes.data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean),
    );

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'Empresa não tem emails cadastrados (cadastre um email do cliente em Empresas).' },
        { status: 400 },
      );
    }

    // 6. Baixa o arquivo do storage
    const { data: fileBlob, error: dlErr } = await admin.storage.from(BUCKET).download(body.arquivoPath);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: 'Não foi possível baixar o arquivo do storage.' }, { status: 500 });
    }
    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

    // ─── 7. Revalida PDF no servidor (defesa em profundidade) ──────────
    // O front já validou, mas DevTools permite burlar. Reaplica `validarGuia`
    // pra garantir que o PDF realmente confere com a empresa+obrigação.
    const validacao = await validarPdfNoServidor({
      buffer: fileBuffer,
      empresa,
      obrigacao: body.obrigacao,
      codigosEsperados: body.codigosEsperados ?? [],
      forcarEnvio: !!body.forcarEnvio,
      motivoForcar: body.motivoForcar,
      podeForcar,
    });
    if (isErroApi(validacao)) {
      return NextResponse.json(
        { error: validacao.error, code: validacao.code, meta: validacao.meta },
        { status: validacao.status },
      );
    }

    // ─── 7.5 Bloqueio de competência divergente ────────────────────────────
    // O PDF TEM que ser do mês selecionado — senão marca o checklist no mês
    // errado. Espelha o bloqueio do front (envio manual no mês certo). Hard
    // block (não forçável): a correção é selecionar o mês certo. Defesa no
    // servidor cobre tanto a aba Envio quanto o Checklist Mensal (mesma rota).
    // IRPJ/CSLL trimestral: o PDF mostra o mês do fim do trimestre, mas a guia é
    // da leva do mês anterior — compara pela competência EFETIVA (06 → 05).
    const compDetectada = competenciaEfetiva(body.obrigacao, validacao.resultado.detectado.competencia);
    if (compDetectada && compDetectada !== body.mes) {
      return NextResponse.json(
        {
          error: `Este arquivo é da competência ${compDetectada}, mas você selecionou ${body.mes}. Envie no mês correto.`,
          code: 'competencia_divergente',
          meta: { detectada: compDetectada, selecionada: body.mes },
        },
        { status: 422 },
      );
    }

    // ─── 7.6 Janela de competência: só o MÊS ANTERIOR ──────────────────────
    // Em junho, só se envia maio. Fora da janela é bloqueado — admin/gerente
    // PODE forçar com motivo (>=10 chars) pra atrasada legítima. Espelha o front
    // e a pendência do auto-envio. body.mes já foi confirmado == competência do PDF.
    {
      const janela = avaliarJanelaCompetencia(body.mes);
      const podeForcarJanela = !!body.forcarEnvio && podeForcar && (body.motivoForcar?.trim().length ?? 0) >= 10;
      if (janela !== 'ok' && !podeForcarJanela) {
        const esperada = competenciaEsperada();
        return NextResponse.json(
          {
            error: janela === 'antiga'
              ? `Competência ${body.mes} é mais antiga que ${esperada} (mês anterior). Só admin/gerente pode enviar guia atrasada, com motivo.`
              : `Competência ${body.mes} é do mês atual ou futuro. Agora só se envia ${esperada} (mês anterior).`,
            code: 'fora_da_janela',
            meta: { competencia: body.mes, esperada, janela },
          },
          { status: 409 },
        );
      }
    }

    // 8. Monta assunto/corpo (template genérico — checklist não tem template configurado)
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

    const envioId = randomUUID();
    const baseUrl = resolveBaseUrl(req);

    // 5. Renova access token e envia — UM email por destinatário (não um
    // único "To" com todos juntos). É o que permite saber QUAL endereço
    // abriu: cada cópia leva seu próprio pixel, único por destinatário
    // (antes, abrir em qualquer um dos e-mails cadastrados marcava "aberto"
    // pra todos, porque era o mesmo pixel no mesmo corpo compartilhado).
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    interface EnvioPorDestinatario {
      destId: string;
      email: string;
      sucesso: boolean;
      erro?: string;
      gmailMessageId?: string;
      gmailThreadId?: string;
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

      const mime = buildMime({
        from: tokenRow.email,
        to: [email],
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

      try {
        const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        destinatariosDetalhe.push({
          destId, email, sucesso: true,
          gmailMessageId: sendRes.data.id ?? undefined,
          gmailThreadId: sendRes.data.threadId ?? undefined,
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
    // gmailMessageId/gmailThreadId no nível do evento ficam com o primeiro
    // envio bem-sucedido — só pra manter compatibilidade com código antigo
    // que assumia 1 mensagem por evento. O detalhe completo está em
    // destinatariosDetalhe (1 gmailMessageId por destinatário).
    const primeiroSucesso = destinatariosDetalhe.find((d) => d.sucesso);
    const gmailMessageId = primeiroSucesso?.gmailMessageId;
    const gmailThreadId = primeiroSucesso?.gmailThreadId;

    const nowIso = new Date().toISOString();
    await admin
      .from('usuario_gmail_tokens')
      .update({ last_used_at: nowIso })
      .eq('usuario_id', envioUserId);

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
      enviadoPara: destinatariosDetalhe.filter((d) => d.sucesso).map((d) => d.email),
      de: tokenRow.email,
      enviadoEm: nowIso,
      gmailMessageId,
      gmailThreadId,
      envioId,
      pixelEmbedado: !!(body.checklistId && UUID_RE.test(body.checklistId) && baseUrl),
      destinatariosDetalhe,
      portalDocumentoId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
