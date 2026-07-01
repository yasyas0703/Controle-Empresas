// Lote de Livros Fiscais — agrupar os livros de uma empresa/competência e mandar
// todos JUNTOS num e-mail só (em vez de 1 por vez, que o guard de duplicado barrava).
//
// Fluxo:
//   1. route.ts reconhece um PDF como 'LIVROS FISCAIS' → chama estagiarItemLote
//      (sobe o PDF, abre/atualiza o lote, NÃO envia ainda; tarefa fica pendente).
//   2. O watcher chama /fechar-lotes a cada ciclo; o cron diário é backstop.
//      fecharLotesMaduros fecha os lotes "maduros": já têm os 5 tipos conhecidos,
//      OU pararam de receber arquivo há > LOTE_DEBOUNCE_MIN (default 15 min).
//   3. enviarLote baixa todos os PDFs do lote, manda 1 e-mail com N anexos,
//      marca o checklist 1 vez (1 pixel) e publica no portal. Se fechar com < 5
//      tipos, manda mesmo assim e marca como parcial (o caller alerta "N de 5").

import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { sendPushToCliente } from '@/lib/webPush';
import {
  stripCrlf, encodeRfc2047, sanitizeMimeFilename, storageKeySafe,
  formatComp, calcularVencimento, marcarChecklistComoFeito,
} from './_shared-envio';
import { TIPOS_LIVRO_CANONICOS, type TipoLivro } from '@/app/utils/validarGuia';
import { criarNotificacaoSistema, resolverDestinatariosFiscais } from '@/lib/alertasAutoEnvio';
import { aplicarOverrideEmailTeste } from '@/lib/modoTesteEnvio';
import { formatarRemetente } from '@/lib/remetente';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tipoEmailDaObrigacao, type Empresa } from '@/app/types';

const BUCKET_DOCUMENTOS = 'documentos';
const BUCKET_PORTAL = 'portal-documentos';
const OBRIGACAO_LIVROS = 'LIVROS FISCAIS';
// Lote incompleto parado há mais que isto (horas) → alerta (não envia). Default 18h.
const LOTE_PARADO_HORAS_DEFAULT = Number(process.env.LOTE_PARADO_HORAS ?? 18) || 18;

interface LoteRow {
  id: string;
  empresa_id: string;
  competencia: string;
  obrigacao: string;
  status: string;
  tipos_recebidos: string[] | null;
  qtd_itens: number | null;
  ultimo_item_em: string;
  detalhes: Record<string, unknown> | null;
}
interface ItemRow {
  id: string;
  lote_id: string;
  hash_arquivo: string;
  tipo_livro: string | null;
  nome_arquivo: string;
  storage_path: string;
}

// ─── MIME com N anexos ──────────────────────────────────────────────────────
function buildMimeMulti(params: {
  from: string; to: string[]; subject: string; bodyText: string; bodyHtml: string;
  attachments: Array<{ filename: string; mime: string; content: Buffer }>;
}): string {
  const boundary = `----=_Part_${randomUUID().slice(0, 12)}`;
  const altBoundary = `----=_Alt_${randomUUID().slice(0, 12)}`;
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
  const parts: string[] = [headers, '', altPart];
  for (const a of params.attachments) {
    const b64 = a.content.toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? a.content.toString('base64');
    const fn = sanitizeMimeFilename(a.filename);
    const mime = stripCrlf(a.mime);
    parts.push('', [
      `--${boundary}`,
      `Content-Type: ${mime}; name="${fn}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn}"`,
      '',
      b64,
    ].join('\r\n'));
  }
  parts.push('', `--${boundary}--`);
  return parts.join('\r\n');
}

// ─── Estagiar um livro no lote (não envia ainda) ────────────────────────────
export async function estagiarItemLote(
  admin: SupabaseClient,
  params: {
    empresa: Empresa; competencia: string; hashArquivo: string; fileBuffer: Buffer;
    nomeArquivo: string; tipoLivro: TipoLivro; caminhoServidor?: string | null;
  },
): Promise<{ loteId: string | null; status: 'estagiado' | 'ja_estagiado' | 'lote_ja_enviado'; tipoLivro: TipoLivro }> {
  const empresaId = params.empresa.id;
  // Abre ou pega o lote (1 por empresa+competência).
  let { data: lote } = await admin
    .from('lotes_livros_fiscais')
    .select('*')
    .eq('empresa_id', empresaId).eq('competencia', params.competencia).eq('obrigacao', OBRIGACAO_LIVROS)
    .maybeSingle();
  if (!lote) {
    const { data: novo } = await admin
      .from('lotes_livros_fiscais')
      .insert({ empresa_id: empresaId, competencia: params.competencia, obrigacao: OBRIGACAO_LIVROS, status: 'aberto' })
      .select('*').maybeSingle();
    lote = novo;
  }
  const loteRow = lote as LoteRow | null;
  if (!loteRow) return { loteId: null, status: 'estagiado', tipoLivro: params.tipoLivro };
  // Lote já enviado → livro atrasado; o caller registra pendência (não duplica envio).
  if (loteRow.status === 'enviado' || loteRow.status === 'enviado_parcial') {
    return { loteId: loteRow.id, status: 'lote_ja_enviado', tipoLivro: params.tipoLivro };
  }
  // Sobe o PDF pro bucket interno.
  const storagePath = `empresas/${empresaId}/lote/${randomUUID()}-${storageKeySafe(params.nomeArquivo)}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(storagePath, params.fileBuffer, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw new Error(`upload do livro falhou: ${upErr.message}`);
  // Insere o item — idempotente por (lote_id, hash). Se já existia, ignora.
  const { data: insItem } = await admin
    .from('lotes_livros_fiscais_itens')
    .upsert({
      lote_id: loteRow.id, hash_arquivo: params.hashArquivo, tipo_livro: params.tipoLivro,
      nome_arquivo: params.nomeArquivo, storage_path: storagePath, caminho_servidor: params.caminhoServidor ?? null,
    }, { onConflict: 'lote_id,hash_arquivo', ignoreDuplicates: true })
    .select('id');
  if (!insItem || insItem.length === 0) {
    // já estava no lote — limpa o PDF duplicado que acabamos de subir.
    await admin.storage.from(BUCKET_DOCUMENTOS).remove([storagePath]).then(() => undefined, () => undefined);
    return { loteId: loteRow.id, status: 'ja_estagiado', tipoLivro: params.tipoLivro };
  }
  // Atualiza o lote: tipo novo, contador, e reseta o relógio do debounce.
  const tipos = Array.isArray(loteRow.tipos_recebidos) ? loteRow.tipos_recebidos.slice() : [];
  if (params.tipoLivro !== 'outro' && !tipos.includes(params.tipoLivro)) tipos.push(params.tipoLivro);
  await admin.from('lotes_livros_fiscais')
    .update({ tipos_recebidos: tipos, qtd_itens: (loteRow.qtd_itens ?? 0) + 1, ultimo_item_em: new Date().toISOString() })
    .eq('id', loteRow.id);
  // Já anexa o livro na célula do checklist (fica salvo/visível na tarefa), mas SEM
  // concluir — a pedido: enquanto o lote não fecha, a usuária vê o que já chegou e a
  // tarefa NÃO conta como feita. A conclusão só acontece quando o lote envia
  // (enviarLote -> marcarChecklistComoFeito). Best-effort: não trava o estágio.
  await anexarParcialNoChecklist(admin, {
    empresaId, competencia: params.competencia, storagePath, nomeArquivo: params.nomeArquivo,
  }).catch((e) => console.error('[estagiarItemLote] anexar parcial falhou:', e));
  return { loteId: loteRow.id, status: 'estagiado', tipoLivro: params.tipoLivro };
}

// Anexa o livro recém-estagiado na célula do checklist de LIVROS FISCAIS, sem
// marcar concluído. Cria a linha se não existir. Nunca rebaixa uma linha já
// concluída (lote já enviado). A célula guarda 1 anexo (arquivo_url) — com vários
// livros parciais, mostra o último que chegou; o conjunto completo vai no envio.
async function anexarParcialNoChecklist(
  admin: SupabaseClient,
  params: { empresaId: string; competencia: string; storagePath: string; nomeArquivo: string },
): Promise<void> {
  const { data: ja } = await admin
    .from('checklist_fiscal')
    .select('id, concluido')
    .eq('empresa_id', params.empresaId).eq('mes', params.competencia).eq('obrigacao', OBRIGACAO_LIVROS)
    .maybeSingle();
  const linha = ja as { id?: string; concluido?: boolean } | null;
  if (linha?.concluido) return; // já enviado/concluído — não mexe
  const nowIso = new Date().toISOString();
  if (linha?.id) {
    await admin.from('checklist_fiscal')
      .update({ arquivo_url: params.storagePath, arquivo_nome: params.nomeArquivo, atualizado_em: nowIso })
      .eq('id', linha.id);
  } else {
    await admin.from('checklist_fiscal')
      .insert({
        empresa_id: params.empresaId, mes: params.competencia, obrigacao: OBRIGACAO_LIVROS,
        arquivo_url: params.storagePath, arquivo_nome: params.nomeArquivo,
      });
  }
}

// ─── Enviar o lote (1 email, N anexos) ──────────────────────────────────────
type ResultadoLote = { ok: boolean; motivo?: string; enviados: number; parcial: boolean; tiposAusentes: TipoLivro[]; gmailMessageId?: string };

export async function enviarLote(
  admin: SupabaseClient,
  params: { lote: LoteRow; empresa: Empresa; ghostUserId: string; baseUrl?: string | null },
): Promise<ResultadoLote> {
  const { data: itensData } = await admin
    .from('lotes_livros_fiscais_itens').select('*').eq('lote_id', params.lote.id)
    .order('adicionado_em', { ascending: true });
  const itens = (itensData ?? []) as ItemRow[];
  const tiposPresentes = new Set(itens.map((i) => i.tipo_livro));
  const tiposAusentes = TIPOS_LIVRO_CANONICOS.filter((t) => !tiposPresentes.has(t));
  const parcial = tiposAusentes.length > 0;
  const falha = (motivo: string): ResultadoLote => ({ ok: false, motivo, enviados: 0, parcial, tiposAusentes });

  if (itens.length === 0) return falha('lote_vazio');

  const { data: tokenRow } = await admin
    .from('usuario_gmail_tokens').select('email, refresh_token_enc, revoked')
    .eq('usuario_id', params.ghostUserId).maybeSingle();
  if (!tokenRow || tokenRow.revoked) return falha('gmail_nao_conectado');
  let refreshToken: string;
  try { refreshToken = decryptToken(tokenRow.refresh_token_enc); } catch { return falha('gmail_nao_conectado'); }

  // Livros fiscais vão SÓ pro e-mail tipo 'livros_fiscais' (separado das guias e
  // do Cadastro). Sem e-mail desse tipo cadastrado, cai em 'sem_emails' e bloqueia.
  const { data: emailsRes } = await admin
    .from('empresa_emails_cliente').select('email').eq('empresa_id', params.empresa.id).eq('ativo', true)
    .eq('tipo', tipoEmailDaObrigacao(OBRIGACAO_LIVROS));
  const emails = aplicarOverrideEmailTeste(
    ((emailsRes ?? []) as Array<{ email: string }>).map((r) => r.email).filter(Boolean),
  );
  if (emails.length === 0) return falha('sem_emails');

  // Baixa todos os PDFs do lote.
  const anexos: Array<{ filename: string; mime: string; content: Buffer; storagePath: string }> = [];
  for (const it of itens) {
    const { data: blob, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(it.storage_path);
    if (error || !blob) { console.error('[enviarLote] falha ao baixar item', it.storage_path, error?.message); continue; }
    anexos.push({ filename: it.nome_arquivo, mime: 'application/pdf', content: Buffer.from(await blob.arrayBuffer()), storagePath: it.storage_path });
  }
  if (anexos.length === 0) return falha('storage_download_failed');

  const empresaNome = params.empresa.razao_social || params.empresa.apelido || params.empresa.codigo;
  const competenciaLabel = formatComp(params.lote.competencia);
  const vencimentoIso = calcularVencimento(OBRIGACAO_LIVROS, params.empresa, params.lote.competencia);
  const subject = `Livros Fiscais — ${empresaNome} (${competenciaLabel}) — ${anexos.length} arquivo(s)`;
  const bodyText =
    `Olá,\n\n` +
    `Seguem em anexo os livros fiscais referentes à competência ${competenciaLabel} (${anexos.length} arquivo(s)).\n\n` +
    `Qualquer dúvida, estamos à disposição.\n\nAtenciosamente.`;
  const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

  // Pixel: 1 envioId + garante a linha do checklist (sem marcar feito ainda).
  const envioId = randomUUID();
  let checklistIdPixel: string | null = null;
  {
    const { data: ja } = await admin.from('checklist_fiscal').select('id')
      .eq('empresa_id', params.empresa.id).eq('mes', params.lote.competencia).eq('obrigacao', OBRIGACAO_LIVROS).maybeSingle();
    if ((ja as { id?: string } | null)?.id) checklistIdPixel = (ja as { id: string }).id;
    else {
      const { data: criado } = await admin.from('checklist_fiscal')
        .insert({ empresa_id: params.empresa.id, mes: params.lote.competencia, obrigacao: OBRIGACAO_LIVROS })
        .select('id').maybeSingle();
      checklistIdPixel = (criado as { id?: string } | null)?.id ?? null;
    }
  }
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // Um email por destinatário (não um único "To" com todos juntos) — mesmo
  // padrão do envio de obrigação única: cada cópia leva seu próprio pixel,
  // pra saber QUAL endereço abriu em vez de marcar "aberto" pra todos juntos.
  interface EnvioPorDestinatario {
    destId: string; email: string; sucesso: boolean; erro?: string;
    gmailMessageId?: string; gmailThreadId?: string;
  }
  const destinatariosDetalhe: EnvioPorDestinatario[] = [];

  for (const email of emails) {
    const destId = randomUUID();
    const pixelTag = (params.baseUrl && checklistIdPixel)
      ? `<img src="${params.baseUrl.replace(/\/+$/, '')}/api/checklist-fiscal/track-open/${checklistIdPixel}/${envioId}/${destId}.gif" width="1" height="1" alt="" style="display:none;border:0;outline:none;text-decoration:none;" />`
      : '';
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>${pixelTag}`;
    const mime = buildMimeMulti({ from: tokenRow.email, to: [email], subject, bodyText, bodyHtml, attachments: anexos.map((a) => ({ filename: a.filename, mime: a.mime, content: a.content })) });
    const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
      const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      destinatariosDetalhe.push({
        destId, email, sucesso: true,
        gmailMessageId: sendRes.data.id ?? undefined,
        gmailThreadId: sendRes.data.threadId ?? undefined,
      });
    } catch (err) {
      destinatariosDetalhe.push({ destId, email, sucesso: false, erro: err instanceof Error ? err.message : 'Falha Gmail' });
    }
  }

  const primeiroSucesso = destinatariosDetalhe.find((d) => d.sucesso);
  if (!primeiroSucesso) {
    return falha(`gmail_send_failed: ${destinatariosDetalhe[0]?.erro ?? 'Falha Gmail'}`);
  }
  const gmailMessageId = primeiroSucesso.gmailMessageId;

  const nowIso = new Date().toISOString();
  await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', params.ghostUserId);

  // Marca o checklist UMA vez (1 evento, pixels individuais por destinatário).
  const checklistId = await marcarChecklistComoFeito(admin, {
    empresaId: params.empresa.id, mes: params.lote.competencia, obrigacao: OBRIGACAO_LIVROS,
    ghostUserId: params.ghostUserId, arquivoNome: `Livros Fiscais (${anexos.length} arquivos)`,
    arquivoUrl: anexos[0].storagePath, fonte: 'auto-enviado', destinatarios: emails, gmailMessageId,
    destinatariosDetalhe, envioId,
  });

  // Portal: 1 documento por livro (best-effort) + 1 push.
  try {
    if (checklistId) {
      await admin.from('portal_documentos')
        .update({ removido_em: nowIso, removido_por_usuario_id: params.ghostUserId })
        .eq('checklist_fiscal_id', checklistId).is('removido_em', null);
    }
    let primeiroPortalId: string | null = null;
    for (const a of anexos) {
      const portalPath = `${params.empresa.id}/${randomUUID()}-${storageKeySafe(a.filename)}`;
      const { error: upPortalErr } = await admin.storage.from(BUCKET_PORTAL).upload(portalPath, a.content, { contentType: 'application/pdf', upsert: false });
      if (upPortalErr) continue;
      const { data: novoPortal } = await admin.from('portal_documentos').insert({
        empresa_id: params.empresa.id, checklist_fiscal_id: checklistId, obrigacao_nome: OBRIGACAO_LIVROS,
        competencia: params.lote.competencia, vencimento: vencimentoIso, arquivo_storage_path: portalPath,
        arquivo_nome_original: a.filename, arquivo_mime: 'application/pdf', arquivo_tamanho_bytes: a.content.byteLength,
        enviado_email: true, enviado_email_em: nowIso, criado_por_usuario_id: params.ghostUserId,
      }).select('id').maybeSingle();
      if (!primeiroPortalId) primeiroPortalId = (novoPortal as { id?: string } | null)?.id ?? null;
    }
    if (primeiroPortalId) {
      const { data: clienteRow } = await admin.from('clientes_portal').select('id').eq('empresa_id', params.empresa.id).eq('ativo', true).maybeSingle();
      if ((clienteRow as { id?: string } | null)?.id) {
        await sendPushToCliente((clienteRow as { id: string }).id, {
          title: `Novos livros fiscais (${anexos.length})`,
          body: `Competência ${competenciaLabel}. Toque para abrir.`,
          url: `/portal/documentos/${primeiroPortalId}`,
          tag: `portal-lote-${params.lote.id}`,
        });
      }
    }
  } catch (portalErr) {
    console.error('[enviarLote] falha portal:', portalErr);
  }

  await admin.from('lotes_livros_fiscais').update({
    status: parcial ? 'enviado_parcial' : 'enviado',
    enviado_em: nowIso, checklist_id: checklistId,
    detalhes: { gmail_message_id: gmailMessageId, destinatarios: emails, anexos: anexos.length, tipos_recebidos: [...tiposPresentes].filter(Boolean), tipos_ausentes: tiposAusentes },
  }).eq('id', params.lote.id);

  return { ok: true, enviados: anexos.length, parcial, tiposAusentes, gmailMessageId };
}

// ─── Fecha os lotes maduros (chamado pelo watcher e pelo cron backstop) ──────
export async function fecharLotesMaduros(
  admin: SupabaseClient,
  params: { ghostUserId: string; baseUrl?: string | null },
): Promise<{ fechados: number; enviados: number; parciais: number; falhas: number }> {
  const out = { fechados: 0, enviados: 0, parciais: 0, falhas: 0 };

  const { data: abertosData } = await admin.from('lotes_livros_fiscais').select('*').eq('status', 'aberto');
  const abertos = (abertosData ?? []) as LoteRow[];
  if (abertos.length === 0) return out;

  // "SEMPRE 5" (decisão da usuária): o lote só fecha e envia quando os 5 tipos
  // conhecidos chegaram. Incompleto NÃO é enviado — fica aberto; o cron chama
  // alertarLotesIncompletosParados pra avisar se ficar muito tempo sem completar,
  // pra nunca sumir em silêncio.
  const maduros = abertos.filter((l) => {
    const tipos = (l.tipos_recebidos ?? []).filter((t) => TIPOS_LIVRO_CANONICOS.includes(t as TipoLivro));
    return tipos.length >= TIPOS_LIVRO_CANONICOS.length;
  });
  if (maduros.length === 0) return out;

  // Carrega as empresas dos lotes maduros.
  const empresaIds = [...new Set(maduros.map((l) => l.empresa_id))];
  const { data: empresasData } = await admin.from('empresas').select('*').in('id', empresaIds);
  const empresasMap = new Map<string, Empresa>();
  for (const e of (empresasData ?? []) as Empresa[]) empresasMap.set(e.id, e);

  for (const lote of maduros) {
    out.fechados++;
    const empresa = empresasMap.get(lote.empresa_id);
    if (!empresa) { out.falhas++; continue; }
    let res: ResultadoLote;
    try {
      res = await enviarLote(admin, { lote, empresa, ghostUserId: params.ghostUserId, baseUrl: params.baseUrl });
    } catch (e) {
      console.error('[fecharLotesMaduros] erro ao enviar lote', lote.id, e);
      out.falhas++; continue;
    }
    if (res.ok) {
      out.enviados++;
      if (res.parcial) out.parciais++; // não deve ocorrer (só fecha com os 5) — defensivo.
    } else {
      out.falhas++;
      // Mantém o lote 'aberto' pra tentar de novo no próximo ciclo; alerta UMA vez.
      await alertarLoteFalhou(admin, empresa, lote, res.motivo ?? 'erro');
    }
  }
  return out;
}

const ROTULO_TIPO: Record<string, string> = {
  entradas: 'Entradas', saidas: 'Saídas', apuracao_icms: 'Apuração ICMS', apuracao_ipi: 'Apuração IPI', iss: 'ISS',
};

/**
 * Rede de segurança do "sempre 5": como o lote incompleto NÃO é enviado, esta
 * função (chamada pelo cron) avisa quando um lote fica parado há muito tempo sem
 * completar os 5 tipos — pra a pessoa colocar o que falta ou resolver manual.
 * Não envia nada; só alerta. Dedup por lote (detalhes.parado_alertado_em).
 */
export async function alertarLotesIncompletosParados(
  admin: SupabaseClient,
  params: { staleHoras?: number },
): Promise<{ alertados: number }> {
  const staleHoras = params.staleHoras ?? LOTE_PARADO_HORAS_DEFAULT;
  const out = { alertados: 0 };
  const { data: abertosData } = await admin.from('lotes_livros_fiscais').select('*').eq('status', 'aberto');
  const abertos = (abertosData ?? []) as LoteRow[];
  const cutoff = Date.now() - staleHoras * 3_600_000;
  const parados = abertos.filter((l) => {
    const tipos = (l.tipos_recebidos ?? []).filter((t) => TIPOS_LIVRO_CANONICOS.includes(t as TipoLivro));
    const incompleto = tipos.length < TIPOS_LIVRO_CANONICOS.length;
    const velho = new Date(l.ultimo_item_em).getTime() < cutoff;
    const jaAlertado = !!(l.detalhes && (l.detalhes as { parado_alertado_em?: string }).parado_alertado_em);
    return incompleto && velho && !jaAlertado;
  });
  if (parados.length === 0) return out;
  const empresaIds = [...new Set(parados.map((l) => l.empresa_id))];
  const { data: empresasData } = await admin.from('empresas').select('*').in('id', empresaIds);
  const empresasMap = new Map<string, Empresa>();
  for (const e of (empresasData ?? []) as Empresa[]) empresasMap.set(e.id, e);
  for (const lote of parados) {
    const empresa = empresasMap.get(lote.empresa_id);
    if (!empresa) continue;
    const nome = empresa.apelido || empresa.razao_social || empresa.codigo;
    const tipos = (lote.tipos_recebidos ?? []).filter((t) => TIPOS_LIVRO_CANONICOS.includes(t as TipoLivro));
    const faltam = TIPOS_LIVRO_CANONICOS.filter((t) => !tipos.includes(t)).map((t) => ROTULO_TIPO[t] ?? t).join(', ');
    const destinatarios = (await resolverDestinatariosFiscais(admin, empresa.id)).map((u) => u.id);
    await criarNotificacaoSistema(admin, {
      titulo: `Livros incompletos parados — ${nome}`,
      mensagem: `O lote de livros de ${nome} (${lote.competencia}) está com ${tipos.length} de ${TIPOS_LIVRO_CANONICOS.length} tipos e parado há mais de ${staleHoras}h. Faltam: ${faltam}. Coloque os livros que faltam (ou resolva manual) — não envio incompleto.`,
      tipo: 'aviso', empresaId: empresa.id, destinatarios,
    });
    await admin.from('lotes_livros_fiscais')
      .update({ detalhes: { ...(lote.detalhes ?? {}), parado_alertado_em: new Date().toISOString() } })
      .eq('id', lote.id);
    out.alertados++;
  }
  return out;
}

async function alertarLoteFalhou(admin: SupabaseClient, empresa: Empresa, lote: LoteRow, motivo: string): Promise<void> {
  // Dedup: só alerta uma vez por lote (marca em detalhes.alertado_em).
  if (lote.detalhes && (lote.detalhes as { alertado_em?: string }).alertado_em) return;
  const nome = empresa.apelido || empresa.razao_social || empresa.codigo;
  const destinatarios = (await resolverDestinatariosFiscais(admin, empresa.id)).map((u) => u.id);
  await criarNotificacaoSistema(admin, {
    titulo: `Falha ao enviar livros — ${nome}`,
    mensagem: `Não consegui enviar os livros de ${nome} (${lote.competencia}): ${motivo}. Vou tentar de novo automaticamente; se persistir, verifique.`,
    tipo: 'erro', empresaId: empresa.id, destinatarios,
  });
  await admin.from('lotes_livros_fiscais')
    .update({ detalhes: { ...(lote.detalhes ?? {}), alertado_em: new Date().toISOString(), ultimo_erro: motivo } })
    .eq('id', lote.id);
}
