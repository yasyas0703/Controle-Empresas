// Contagem leve de guias NÃO enviadas (problemas + pendências de aprovação),
// pro alerta no topo do app. Mesma fonte do painel /vencimentos-fiscais/auto-problemas,
// mas só os números (head:true) — barato pra polling.
//
// Auth: assertManager (admin/gerente) — mesma exigência da rota `listar`.

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const admin = getSupabaseAdmin();
  const [{ count: problemas }, { count: pendencias }] = await Promise.all([
    admin
      .from('guias_auto_problemas')
      .select('id', { count: 'exact', head: true })
      .is('resolvido_em', null),
    admin
      .from('guias_auto_processadas')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga']),
  ]);

  return NextResponse.json({
    problemasPendentes: problemas ?? 0,
    pendenciasAprovacao: pendencias ?? 0,
  });
}
