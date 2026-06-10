// Aprova uma pendência (1ª vez ou competência antiga) e dispara o envio
// pelo Gmail do ghost, marcando o checklist como feito.
//
// Fluxo:
//   1. Auth: admin/gerente via Bearer (validado pelo proxy + assertManager)
//   2. Carrega a row de guias_auto_processadas com status pendente_aprovacao_*
//   3. Confere que tem `arquivo_pendente_path` em detalhes (subido pela auto-enviar)
//   4. Baixa o PDF do Storage
//   5. RE-VALIDA o PDF (defesa em profundidade — pode ter passado tempo,
//      cadastro da empresa pode ter mudado entre a pendência e a aprovação)
//   6. RE-CHECA duplicado (alguém pode ter mandado manual no meio do caminho)
//   7. Chama enviarGuia (mesmo fluxo da auto-enviar)
//   8. Atualiza status pra 'enviado'
//   9. Deleta o blob pendente do Storage

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';
import { validarPdfNoServidor, carregarEmpresaCompleta, isErroApi } from '@/app/api/checklist-fiscal/_shared';
import {
  enviarGuia, baixarPendente, deletarPendente, jaEnviadaNoChecklist,
  marcarChecklistComoFeito, subirDocumentoInterno,
} from '@/app/api/checklist-fiscal/auto-enviar/_shared-envio';
import { ehObrigacaoSempreInterna } from '@/app/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  /** ID da row em guias_auto_processadas (status pendente_aprovacao_*) */
  id: string;
  /** Comentário opcional pro audit log. */
  comentario?: string;
}

export async function POST(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  if (!body?.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id obrigatório.' }, { status: 400 });
  }

  const ghostUserId = process.env.GHOST_USER_ID;
  if (!ghostUserId) {
    return NextResponse.json({ error: 'GHOST_USER_ID não configurado.' }, { status: 500 });
  }

  const admin = getSupabaseAdmin();

  // 1. Carrega a pendência
  const { data: pendRow, error: pendErr } = await admin
    .from('guias_auto_processadas')
    .select('*')
    .eq('id', body.id)
    .maybeSingle();
  if (pendErr) {
    return NextResponse.json({ error: 'Erro ao carregar pendência.' }, { status: 500 });
  }
  if (!pendRow) {
    return NextResponse.json({ error: 'Pendência não encontrada.' }, { status: 404 });
  }

  const pend = pendRow as {
    id: string;
    empresa_id: string | null;
    competencia: string | null;
    obrigacao: string | null;
    nome_arquivo: string;
    status: string;
    detalhes: Record<string, unknown> | null;
  };

  if (!['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga'].includes(pend.status)) {
    return NextResponse.json({ error: `Status atual "${pend.status}" não é aprovável.` }, { status: 409 });
  }
  if (!pend.empresa_id || !pend.competencia || !pend.obrigacao) {
    return NextResponse.json({ error: 'Pendência sem empresa/competência/obrigação — não pode aprovar.' }, { status: 422 });
  }

  const pathPendente = (pend.detalhes && typeof pend.detalhes === 'object' && 'arquivo_pendente_path' in pend.detalhes)
    ? String(pend.detalhes.arquivo_pendente_path ?? '')
    : '';
  if (!pathPendente) {
    return NextResponse.json({
      error: 'Pendência criada antes do upload automático estar ativo. Use /vencimentos-fiscais/envio (manual).',
    }, { status: 422 });
  }

  // 2. Baixa o PDF
  const baixou = await baixarPendente(admin, pathPendente);
  if ('erro' in baixou) {
    return NextResponse.json({ error: `Falha ao baixar arquivo pendente: ${baixou.erro}` }, { status: 500 });
  }
  const fileBuffer = baixou.buffer;

  // 3. Carrega empresa completa
  const empresa = await carregarEmpresaCompleta(admin, pend.empresa_id);
  if (isErroApi(empresa)) {
    return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  }

  // 4. Re-valida (defesa em profundidade — passou tempo desde a pendência)
  const { data: configRow } = await admin
    .from('empresa_obrigacoes_config')
    .select('ativa, codigos, nao_envia_cliente, motivo')
    .eq('empresa_id', pend.empresa_id)
    .eq('obrigacao', pend.obrigacao)
    .maybeSingle();
  const config = configRow as { ativa: boolean; codigos: string[]; nao_envia_cliente: boolean } | null;
  const codigosEsperados = config?.codigos ?? [];

  const validacao = await validarPdfNoServidor({
    buffer: fileBuffer,
    empresa,
    obrigacao: pend.obrigacao,
    codigosEsperados,
    // Admin pode forçar — está aprovando explicitamente. Mas exigimos comentário
    // do caller pra ficar registrado o porquê de ter aprovado mesmo com erro.
    forcarEnvio: true,
    motivoForcar: body.comentario ?? `Aprovação de pendência ${pend.status}`,
    podeForcar: true,
  });
  if (isErroApi(validacao)) {
    return NextResponse.json({
      error: 'Validação falhou ao aprovar.',
      detalhes: validacao.meta,
    }, { status: 422 });
  }

  // 5. Guard duplicado (alguém pode ter mandado manual entre a pendência e agora)
  const duplicado = await jaEnviadaNoChecklist(admin, pend.empresa_id, pend.competencia, pend.obrigacao);
  if (duplicado) {
    // Atualiza status pra duplicado e limpa o blob
    await admin.from('guias_auto_processadas').update({
      status: 'duplicado_periodo',
      detalhes: {
        ...(pend.detalhes ?? {}),
        motivo_pos_aprovacao: 'duplicado_no_meio_do_caminho',
        duplicado_em: duplicado.enviadoEm,
      },
    }).eq('id', pend.id);
    await deletarPendente(admin, pathPendente);
    return NextResponse.json({
      error: 'Já enviado por outra via no meio do caminho.',
      detalhes: { enviadoEm: duplicado.enviadoEm },
    }, { status: 409 });
  }

  // 6. Carrega nome do admin pra logar como enviado_por
  const { data: userRow } = await admin
    .from('usuarios').select('nome').eq('id', authz.callerId).maybeSingle();
  const callerNome = (userRow as { nome?: string } | null)?.nome ?? 'Admin';

  // 6.5 Interna (RECIBO/DECLARAÇÃO do DAS): aprovar = marcar feito INTERNO, sem
  // e-mail pro cliente. Sem isto, o enviarGuia recusaria (guard interno) e a
  // pendência ficaria presa. Sobe o doc interno + marca o checklist e encerra.
  if (ehObrigacaoSempreInterna(pend.obrigacao)) {
    const docPathInterno = await subirDocumentoInterno(admin, pend.empresa_id, fileBuffer, pend.nome_arquivo);
    await marcarChecklistComoFeito(admin, {
      empresaId: pend.empresa_id, mes: pend.competencia, obrigacao: pend.obrigacao, ghostUserId,
      arquivoNome: pend.nome_arquivo, arquivoUrl: docPathInterno ?? undefined, fonte: 'aprovado-admin',
      enviadoPorIdOverride: authz.callerId, enviadoPorNomeOverride: `${callerNome} (aprovou — interna)`,
    });
    await admin.from('guias_auto_processadas').update({
      status: 'interno_marcado_feito',
      detalhes: { ...(pend.detalhes ?? {}), aprovada_interna_em: new Date().toISOString() },
    }).eq('id', pend.id);
    await deletarPendente(admin, pathPendente);
    return NextResponse.json({ ok: true, interna: true });
  }

  // 7. Envia
  const baseUrl = (() => {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (host) return `${proto}://${host}`;
    return process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, '') ?? null;
  })();
  const envio = await enviarGuia(admin, {
    empresa,
    obrigacao: pend.obrigacao,
    competencia: pend.competencia,
    nomeArquivo: pend.nome_arquivo,
    fileBuffer,
    ghostUserId,
    enviadoPorIdOverride: authz.callerId,
    enviadoPorNomeOverride: `${callerNome} (aprovou pendência)`,
    baseUrl,
  });

  if (!envio.ok) {
    return NextResponse.json({
      error: `Falha no envio: ${envio.motivo}`,
      detalhes: { erro: envio.erro },
    }, { status: envio.motivo === 'gmail_send_failed' ? 502 : 500 });
  }

  // 8. Atualiza status pra 'enviado' + audit
  const nowIso = new Date().toISOString();
  await admin.from('guias_auto_processadas').update({
    status: 'enviado',
    detalhes: {
      ...(pend.detalhes ?? {}),
      aprovado_por_id: authz.callerId,
      aprovado_por_nome: callerNome,
      aprovado_em: nowIso,
      comentario_aprovacao: body.comentario ?? null,
      gmailMessageId: envio.gmailMessageId,
      destinatarios: envio.destinatarios,
      portalDocumentoId: envio.portalDocumentoId,
      checklistId: envio.checklistId,
    },
    processado_em: nowIso,
  }).eq('id', pend.id);

  await admin.from('logs').insert({
    user_id: authz.callerId,
    action: 'aprovar_e_enviar_auto',
    entity: 'guias_auto_processadas',
    entity_id: pend.id,
    message: `${callerNome} aprovou pendência ${pend.status} → enviou ${pend.obrigacao} ${pend.competencia} (${pend.nome_arquivo})${body.comentario ? `: ${body.comentario}` : ''}`,
  }).then(() => undefined, () => undefined);

  // 9. Cleanup do blob pendente
  await deletarPendente(admin, pathPendente);

  return NextResponse.json({
    ok: true,
    gmailMessageId: envio.gmailMessageId,
    destinatarios: envio.destinatarios,
    checklistId: envio.checklistId,
  });
}
