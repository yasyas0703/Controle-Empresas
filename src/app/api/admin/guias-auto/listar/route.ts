// Lista problemas e pendências do envio automático de guias fiscais.
// Consumida pela página /vencimentos-fiscais/auto-problemas.
//
// Filtros (query params):
//   - tipo=problemas|pendencias|todos (default: problemas)
//     - problemas: guias_auto_problemas WHERE resolvido_em IS NULL
//     - pendencias: guias_auto_processadas WHERE status IN (pendente_aprovacao_*)
//     - todos: union de ambos
//   - limit (default 100, max 500)
//   - empresaId (opcional)

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertManager } from '@/lib/apiAuth';

export const runtime = 'nodejs';

interface ProblemaRow {
  id: string;
  caminho_servidor: string;
  nome_arquivo: string;
  hash_arquivo: string;
  empresa_id: string | null;
  empresa_nome_pasta: string | null;
  tipo_problema: string;
  detalhes: Record<string, unknown> | null;
  competencia_parseada: string | null;
  obrigacao_parseada: string | null;
  criado_em: string | null;
  resolvido_em: string | null;
  resolvido_por_nome: string | null;
  resolucao: string | null;
}

interface ProcessadoRow {
  id: string;
  caminho_servidor: string;
  nome_arquivo: string;
  hash_arquivo: string;
  empresa_id: string | null;
  competencia: string | null;
  obrigacao: string | null;
  status: string;
  detalhes: Record<string, unknown> | null;
  processado_em: string | null;
}

export async function GET(req: Request) {
  const authz = await assertManager(req);
  if (!authz.ok) return NextResponse.json({ error: authz.message }, { status: authz.status });

  const url = new URL(req.url);
  const tipo = (url.searchParams.get('tipo') || 'problemas').toLowerCase();
  const limitRaw = Number(url.searchParams.get('limit') || '100');
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const empresaIdParam = url.searchParams.get('empresaId');

  const admin = getSupabaseAdmin();

  // Carrega nomes das empresas pra anotar nos resultados (1 query, evita N+1)
  const { data: empresasRaw } = await admin
    .from('empresas')
    .select('id, codigo, apelido, razao_social');
  const empresasMap = new Map<string, { codigo: string | null; nome: string }>();
  for (const e of (empresasRaw ?? []) as Array<{ id: string; codigo: string | null; apelido: string | null; razao_social: string | null }>) {
    empresasMap.set(e.id, { codigo: e.codigo, nome: e.razao_social || e.apelido || '(sem nome)' });
  }

  const result: {
    problemas: Array<ProblemaRow & { empresa_nome: string | null; empresa_codigo: string | null }>;
    pendencias: Array<ProcessadoRow & { empresa_nome: string | null; empresa_codigo: string | null }>;
    contagens: { problemasPendentes: number; pendenciasAprovacao: number };
  } = { problemas: [], pendencias: [], contagens: { problemasPendentes: 0, pendenciasAprovacao: 0 } };

  if (tipo === 'problemas' || tipo === 'todos') {
    let query = admin
      .from('guias_auto_problemas')
      .select('*')
      .is('resolvido_em', null)
      .order('criado_em', { ascending: false })
      .limit(limit);
    if (empresaIdParam) query = query.eq('empresa_id', empresaIdParam);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'Erro ao buscar problemas.' }, { status: 500 });
    result.problemas = ((data ?? []) as ProblemaRow[]).map((p) => {
      const emp = p.empresa_id ? empresasMap.get(p.empresa_id) : null;
      return {
        ...p,
        empresa_nome: emp?.nome ?? null,
        empresa_codigo: emp?.codigo ?? null,
      };
    });
  }

  if (tipo === 'pendencias' || tipo === 'todos') {
    let query = admin
      .from('guias_auto_processadas')
      .select('*')
      .in('status', ['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga'])
      .order('processado_em', { ascending: false })
      .limit(limit);
    if (empresaIdParam) query = query.eq('empresa_id', empresaIdParam);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'Erro ao buscar pendências.' }, { status: 500 });
    result.pendencias = ((data ?? []) as ProcessadoRow[]).map((p) => {
      const emp = p.empresa_id ? empresasMap.get(p.empresa_id) : null;
      return {
        ...p,
        empresa_nome: emp?.nome ?? null,
        empresa_codigo: emp?.codigo ?? null,
      };
    });
  }

  // Contagens sempre — pra badge no menu mesmo quando filtra por empresa
  const [{ count: cntProblemas }, { count: cntPendencias }] = await Promise.all([
    admin
      .from('guias_auto_problemas')
      .select('id', { count: 'exact', head: true })
      .is('resolvido_em', null),
    admin
      .from('guias_auto_processadas')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pendente_aprovacao_primeira_vez', 'pendente_aprovacao_competencia_antiga']),
  ]);
  result.contagens.problemasPendentes = cntProblemas ?? 0;
  result.contagens.pendenciasAprovacao = cntPendencias ?? 0;

  return NextResponse.json(result);
}
