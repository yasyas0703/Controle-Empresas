// Ações sobre problemas/pendências do envio automático.
//
// Ações:
//   - marcar_resolvido (guias_auto_problemas)
//       Marca o problema como resolvido + registra quem/quando/comentário.
//       Próximo PDF do mesmo path passa por toda a validação de novo —
//       se o erro persistir, abre novo problema (com novo hash).
//   - ignorar_definitivo (guias_auto_problemas)
//       Igual ao marcar_resolvido mas com flag 'ignorado' — pra problemas
//       que não vão ser corrigidos (ex: empresa antiga que não usa mais).
//   - rejeitar_pendencia (guias_auto_processadas)
//       Marca como 'erro' uma pendente_aprovacao_*. NÃO envia o PDF.
//       Pra forçar reenvio depois, usar a UI manual /vencimentos-fiscais/envio.
//
// Aprovar pendência (1ª vez / competência antiga) é INTENCIONALMENTE não
// suportado aqui ainda — aprovar envolve fazer o envio Gmail naquele
// momento, que duplica boa parte da rota auto-enviar. Pra primeiro release,
// admin aprova subindo via /vencimentos-fiscais/envio (já existe, valida).
// Depois evoluir pra botão "Enviar agora" aqui mesmo.

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';
import { deletarPendente } from '@/app/api/checklist-fiscal/auto-enviar/_shared-envio';

export const runtime = 'nodejs';

type Acao = 'marcar_resolvido' | 'ignorar_definitivo' | 'rejeitar_pendencia';

interface Body {
  acao: Acao;
  /** ID da linha em guias_auto_problemas (pras 2 primeiras ações) ou
   *  guias_auto_processadas (pra rejeitar_pendencia). */
  id: string;
  /** Comentário do admin — opcional pra marcar_resolvido, obrigatório
   *  pras outras 2 (deixa rastro do porquê). */
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

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id obrigatório.' }, { status: 400 });
  }
  if (!['marcar_resolvido', 'ignorar_definitivo', 'rejeitar_pendencia'].includes(body.acao)) {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }

  // Comentário obrigatório pra ações de fim-de-vida (ignorar / rejeitar) —
  // facilita auditoria depois de "por que essa guia não foi enviada?".
  if ((body.acao === 'ignorar_definitivo' || body.acao === 'rejeitar_pendencia')
      && (!body.comentario || body.comentario.trim().length < 5)) {
    return NextResponse.json({ error: 'Comentário obrigatório (mín. 5 caracteres).' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Carrega nome do caller pra logar no resolvido_por_nome
  const { data: userRow } = await admin
    .from('usuarios')
    .select('nome')
    .eq('id', authz.callerId)
    .maybeSingle();
  const callerNome = (userRow as { nome?: string } | null)?.nome ?? 'Desconhecido';

  const nowIso = new Date().toISOString();

  if (body.acao === 'marcar_resolvido' || body.acao === 'ignorar_definitivo') {
    const resolucao = body.acao === 'ignorar_definitivo'
      ? `[IGNORADO] ${body.comentario}`
      : (body.comentario?.trim() || 'Resolvido manualmente');

    const { data, error } = await admin
      .from('guias_auto_problemas')
      .update({
        resolvido_em: nowIso,
        resolvido_por_id: authz.callerId,
        resolvido_por_nome: callerNome,
        resolucao,
      })
      .eq('id', body.id)
      .is('resolvido_em', null)  // Idempotente: só resolve se ainda não resolvido
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar problema.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Problema já resolvido ou não encontrado.' }, { status: 404 });
    }

    // Log de auditoria (best-effort)
    await admin.from('logs').insert({
      user_id: authz.callerId,
      action: body.acao,
      entity: 'guias_auto_problemas',
      entity_id: body.id,
      message: `${callerNome} ${body.acao === 'ignorar_definitivo' ? 'ignorou definitivamente' : 'resolveu'} problema: ${resolucao}`,
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true });
  }

  if (body.acao === 'rejeitar_pendencia') {
    // Carrega a row antes pra pegar o path do blob pendente (se houver).
    // Sem isso a row vira "erro" mas o PDF fica no Storage pra sempre.
    const { data: rowAntes } = await admin
      .from('guias_auto_processadas')
      .select('detalhes')
      .eq('id', body.id)
      .in('status', ['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga'])
      .maybeSingle();
    const detalhesAntes = (rowAntes as { detalhes?: Record<string, unknown> | null } | null)?.detalhes ?? {};
    const pathPendente = (detalhesAntes && typeof detalhesAntes === 'object' && 'arquivo_pendente_path' in detalhesAntes)
      ? String(detalhesAntes.arquivo_pendente_path ?? '')
      : '';

    const { data, error } = await admin
      .from('guias_auto_processadas')
      .update({
        status: 'erro',
        detalhes: {
          ...detalhesAntes,
          motivo: 'rejeitada_admin',
          comentario: body.comentario,
          rejeitada_por_id: authz.callerId,
          rejeitada_por_nome: callerNome,
          rejeitada_em: nowIso,
        },
      })
      .eq('id', body.id)
      .in('status', ['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga'])
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Erro ao rejeitar pendência.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Pendência não encontrada ou já processada.' }, { status: 404 });
    }

    // Cleanup do blob — best-effort, não falha a request se der erro
    if (pathPendente) {
      await deletarPendente(admin, pathPendente);
    }

    await admin.from('logs').insert({
      user_id: authz.callerId,
      action: 'rejeitar_pendencia',
      entity: 'guias_auto_processadas',
      entity_id: body.id,
      message: `${callerNome} rejeitou pendência automática: ${body.comentario}`,
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Ação não tratada.' }, { status: 400 });
}
