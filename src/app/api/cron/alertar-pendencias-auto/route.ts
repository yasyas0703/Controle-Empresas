// Cron de rede de segurança do AUTO-ENVIO (Fase 1).
//
// Faz duas coisas a cada execução:
//   1) RESUMO POR EMAIL das guias que travaram e ainda não foram avisadas por
//      email (guias_auto_problemas: resolvido_em IS NULL e alertado_em IS NULL).
//      O sino já foi disparado na hora pelo /auto-enviar; aqui é o canal email.
//   2) HEARTBEAT (dead-man switch): se o watcher parou de bater ponto em horário
//      comercial, alerta "o watcher parou — nenhuma guia está sendo processada"
//      (sino + email), com throttle pra não repetir.
//
// Auth: Authorization: Bearer ${CRON_SECRET} (injetado pelo Vercel Cron).

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmailViaUserGmail } from '@/lib/gmailSend';
import {
  resolverDestinatariosFiscais, criarNotificacaoSistema, rotuloTipoProblema,
} from '@/lib/alertasAutoEnvio';
import { fecharLotesMaduros } from '../../checklist-fiscal/auto-enviar/_shared-lote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sem heartbeat há mais que isto (horas), em horário comercial = watcher parado.
const HORAS_HEARTBEAT_LIMITE = 3;
// Não repete o alerta de "watcher parado" antes disso (horas).
const HORAS_REALERTA_HEARTBEAT = 12;
const MAX_PENDENCIAS_NO_EMAIL = 200;

function autorizado(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const auth = req.headers.get('authorization') || '';
  const esperado = `Bearer ${cronSecret}`;
  const ba = Buffer.from(auth);
  const bb = Buffer.from(esperado);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function ehHorarioComercialBrasilia(): boolean {
  const tz = 'America/Sao_Paulo';
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
  const dia = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
  const fimDeSemana = dia === 'Sat' || dia === 'Sun';
  return !fimDeSemana && hora >= 8 && hora < 19;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Pendencia = {
  id: string;
  nome_arquivo: string | null;
  empresa_id: string | null;
  empresa_nome_pasta: string | null;
  tipo_problema: string;
  obrigacao_parseada: string | null;
  competencia_parseada: string | null;
  criado_em: string;
};

async function processar() {
  const admin = getSupabaseAdmin();
  const ghostUserId = process.env.GHOST_USER_ID || null;
  const resultado: Record<string, unknown> = { ts: new Date().toISOString() };

  // Backstop dos lotes de livros: fecha+envia os lotes maduros que o watcher não
  // fechou (ex: watcher caiu). Gatilho primário é o watcher chamando /fechar-lotes.
  if (ghostUserId) {
    try {
      resultado.lotesLivros = await fecharLotesMaduros(admin, {
        ghostUserId,
        baseUrl: process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, '') ?? null,
      });
    } catch (e) {
      console.error('[cron] falha ao fechar lotes de livros:', e);
    }
  }

  // Destinatários fiscais (gerentes/admins; fallback admins). Usados nos dois alertas.
  const destinatarios = await resolverDestinatariosFiscais(admin, null);
  const idsDestino = destinatarios.map((u) => u.id);
  const emailsDestino = [...new Set(destinatarios.map((u) => u.email).filter((e): e is string => !!e))];

  // ── 1. Resumo por email das NOVAS pendências ──────────────────────────────
  const { data: pendData } = await admin
    .from('guias_auto_problemas')
    .select('id, nome_arquivo, empresa_id, empresa_nome_pasta, tipo_problema, obrigacao_parseada, competencia_parseada, criado_em')
    .is('resolvido_em', null)
    .is('alertado_em', null)
    .order('criado_em', { ascending: true })
    .limit(MAX_PENDENCIAS_NO_EMAIL);
  const pendentes = (pendData ?? []) as Pendencia[];

  let emailPendenciasEnviado = false;
  if (pendentes.length > 0) {
    // Nomes das empresas referenciadas (pra mensagem legível).
    const empresaIds = [...new Set(pendentes.map((p) => p.empresa_id).filter((v): v is string => !!v))];
    const nomePorEmpresa = new Map<string, string>();
    if (empresaIds.length) {
      const { data: emps } = await admin
        .from('empresas')
        .select('id, apelido, razao_social, codigo')
        .in('id', empresaIds);
      for (const e of (emps ?? []) as Array<{ id: string; apelido: string | null; razao_social: string | null; codigo: string | null }>) {
        nomePorEmpresa.set(e.id, e.apelido || e.razao_social || e.codigo || e.id);
      }
    }

    const linhaTxt = (p: Pendencia) => {
      const emp = p.empresa_id ? (nomePorEmpresa.get(p.empresa_id) ?? 'Empresa não identificada') : 'Empresa não identificada';
      const extra = [p.obrigacao_parseada, p.competencia_parseada].filter(Boolean).join(' · ');
      return `• [${rotuloTipoProblema(p.tipo_problema)}] ${emp}${extra ? ` (${extra})` : ''} — ${p.nome_arquivo ?? 'arquivo'}`;
    };
    const corpoLinhasTxt = pendentes.map(linhaTxt).join('\n');
    const corpoLinhasHtml = pendentes
      .map((p) => `<li>${escapeHtml(linhaTxt(p).replace(/^•\s*/, ''))}</li>`)
      .join('');

    const assunto = `[Auto-envio] ${pendentes.length} guia(s) precisam de atenção`;
    const bodyText =
      `${pendentes.length} guia(s) não foram enviadas automaticamente e estão aguardando:\n\n` +
      `${corpoLinhasTxt}\n\n` +
      `Resolva em: Vencimentos Fiscais › Auto-problemas.`;
    const bodyHtml =
      `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">` +
      `<p><strong>${pendentes.length} guia(s)</strong> não foram enviadas automaticamente e estão aguardando:</p>` +
      `<ul>${corpoLinhasHtml}</ul>` +
      `<p>Resolva no painel <strong>Vencimentos Fiscais › Auto-problemas</strong>.</p></div>`;

    if (ghostUserId && emailsDestino.length > 0) {
      const r = await sendEmailViaUserGmail(ghostUserId, { to: emailsDestino, subject: assunto, bodyText, bodyHtml });
      emailPendenciasEnviado = r.ok;
      if (!r.ok) console.error('[cron-pendencias] falha ao enviar email de pendências:', r.error);
    }

    // Marca como avisadas mesmo se o email falhar? Não — se o email falhou,
    // deixa alertado_em NULL pra tentar de novo na próxima rodada. Só marca
    // quando o email saiu (ou quando não há a quem mandar, pra não acumular).
    if (emailPendenciasEnviado || emailsDestino.length === 0 || !ghostUserId) {
      await admin
        .from('guias_auto_problemas')
        .update({ alertado_em: new Date().toISOString() })
        .in('id', pendentes.map((p) => p.id));
    }
  }
  resultado.pendencias_novas = pendentes.length;
  resultado.email_pendencias_enviado = emailPendenciasEnviado;

  // ── 2. Heartbeat / dead-man switch ────────────────────────────────────────
  const { data: ws } = await admin
    .from('watcher_status')
    .select('ultimo_heartbeat, heartbeat_alertado_em')
    .eq('id', 'singleton')
    .maybeSingle();

  const ultimo = ws?.ultimo_heartbeat ? new Date(ws.ultimo_heartbeat).getTime() : null;
  const horasDesde = ultimo != null ? (Date.now() - ultimo) / 3_600_000 : Infinity;
  // Só consideramos "parado" se já bateu ponto alguma vez (ultimo != null) e
  // ficou velho. Heartbeat nunca registrado (null) não dispara alarme — evita
  // falso positivo logo após o deploy / antes do watcher subir.
  const parado = ultimo != null && horasDesde > HORAS_HEARTBEAT_LIMITE;
  const jaAvisadoRecente = ws?.heartbeat_alertado_em
    ? (Date.now() - new Date(ws.heartbeat_alertado_em).getTime()) / 3_600_000 < HORAS_REALERTA_HEARTBEAT
    : false;

  let alertouHeartbeat = false;
  if (parado && ehHorarioComercialBrasilia() && !jaAvisadoRecente) {
    const horasInt = Math.round(horasDesde);
    const titulo = 'Watcher de guias parado';
    const mensagem =
      `O watcher de guias não dá sinal há ~${horasInt}h. Enquanto isso, nenhuma guia da pasta está sendo ` +
      `processada nem enviada. Verifique se o computador/serviço que roda o watcher está ligado.`;
    await criarNotificacaoSistema(admin, { titulo, mensagem, tipo: 'erro', empresaId: null, destinatarios: idsDestino });
    if (ghostUserId && emailsDestino.length > 0) {
      await sendEmailViaUserGmail(ghostUserId, {
        to: emailsDestino,
        subject: '[Auto-envio] Watcher parado — guias não estão sendo processadas',
        bodyText: mensagem,
        bodyHtml: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#b91c1c"><p>${escapeHtml(mensagem)}</p></div>`,
      }).catch((e) => console.error('[cron-pendencias] falha email heartbeat:', e));
    }
    await admin.from('watcher_status').update({ heartbeat_alertado_em: new Date().toISOString() }).eq('id', 'singleton');
    alertouHeartbeat = true;
  } else if (!parado && ws?.heartbeat_alertado_em) {
    // Voltou a bater — zera o marcador pra que a PRÓXIMA queda alerte de novo.
    await admin.from('watcher_status').update({ heartbeat_alertado_em: null }).eq('id', 'singleton');
  }

  resultado.heartbeat_horas_desde = Number.isFinite(horasDesde) ? Math.round(horasDesde * 10) / 10 : null;
  resultado.heartbeat_parado = parado;
  resultado.alertou_heartbeat = alertouHeartbeat;
  resultado.destinatarios = idsDestino.length;
  return resultado;
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 503 });
  }
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    const r = await processar();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error('[cron-pendencias] erro:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'erro' }, { status: 500 });
  }
}
