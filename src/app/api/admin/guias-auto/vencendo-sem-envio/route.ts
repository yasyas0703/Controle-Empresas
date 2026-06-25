// Lista guias que vencem em até JANELA_DIAS (ou já venceram) e ainda não
// foram marcadas como enviadas no checklist do mês — base do alerta piscante
// do dashboard ("Empresa X, ICMS vence dia tal, ainda não enviado").
//
// Mesma lógica de aplicabilidade (UF/cidade, overrides, regime SN x Fiscal)
// do checklist em /vencimentos-fiscais/checklist — duplicada aqui porque
// aquela é client-side (depende de dados já carregados no SistemaContext) e
// este endpoint precisa rodar num poll leve, sem montar a tela toda.
//
// Visível pra: admin + qualquer usuário ativo do depto Fiscal/Fiscal-SN
// (não só gerente — "as meninas do fiscal" também precisam ver).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBearerToken } from '@/lib/apiAuth';
import {
  VENCIMENTOS_FISCAIS_NOMES,
  VENCIMENTOS_FISCAIS_SN_NOMES,
  ehObrigacaoSempreInterna,
  FISCAL_DEPT_NOME,
  FISCAL_SN_DEPT_NOME,
} from '@/app/types';
import {
  vencimentoDoMes,
  vencimentoDoMesSn,
  obrigacaoAplicaParaEmpresa,
  obrigacaoSnAplicaParaEmpresa,
} from '@/app/utils/regrasVencimentosFiscais';
import { daysUntil } from '@/app/utils/date';

export const runtime = 'nodejs';

/** Pisca quando faltam até N dias pro vencimento (inclui já vencido). */
const JANELA_DIAS = 3;

interface ItemUrgente {
  empresaId: string;
  empresaNome: string;
  obrigacao: string;
  vencimento: string;
  dias: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function overrideHabilitadaNoMes(
  override: { habilitada: boolean; vigenteDesde: string | null; habilitadaAntes: boolean | null } | undefined,
  mes: string,
): boolean | null {
  if (!override) return null;
  if (override.vigenteDesde && mes < override.vigenteDesde) return override.habilitadaAntes ?? null;
  return override.habilitada;
}

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: 'Sessão ausente' }, { status: 401 });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: profile } = await admin
    .from('usuarios')
    .select('id, role, ativo, departamento_id, departamentos_extras_ids')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (!profile?.ativo) return NextResponse.json({ error: 'Usuário inativo' }, { status: 403 });

  const { data: deptosData } = await admin.from('departamentos').select('id, nome');
  const deptos = (deptosData ?? []) as { id: string; nome: string }[];
  const fiscalDept = deptos.find((d) => d.nome.trim().toLowerCase() === FISCAL_DEPT_NOME)
    ?? deptos.find((d) => { const n = d.nome.toLowerCase(); return n.includes('fiscal') && !n.includes('sn'); })
    ?? null;
  const fiscalSnDept = deptos.find((d) => d.nome.trim().toLowerCase() === FISCAL_SN_DEPT_NOME) ?? null;
  const fiscalDeptIds = [fiscalDept?.id, fiscalSnDept?.id].filter((v): v is string => !!v);

  const meusDeptos = new Set(
    [profile.departamento_id, ...(profile.departamentos_extras_ids ?? [])].filter((v): v is string => !!v),
  );
  const podeVer = profile.role === 'admin' || fiscalDeptIds.some((id) => meusDeptos.has(id));
  if (!podeVer) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });

  const mesAtual = currentMonth();

  const [{ data: empresasData }, { data: respData }, { data: usuariosData }, { data: checklistData }, { data: overridesData }, { data: configData }] =
    await Promise.all([
      admin.from('empresas').select('id, codigo, apelido, razao_social, estado, cidade').neq('cadastrada', false),
      fiscalDeptIds.length
        ? admin.from('responsaveis').select('empresa_id, departamento_id, usuario_id').in('departamento_id', fiscalDeptIds)
        : Promise.resolve({ data: [] }),
      admin.from('usuarios').select('id, departamento_id'),
      admin.from('checklist_fiscal').select('empresa_id, obrigacao, concluido, status').eq('mes', mesAtual),
      admin.from('empresa_obrigacoes_habilitadas').select('empresa_id, obrigacao, habilitada, vigente_desde, habilitada_antes'),
      admin.from('empresa_obrigacoes_config').select('empresa_id, obrigacao, ativa, nao_envia_cliente'),
    ]);

  type EmpresaRow = { id: string; codigo: string; apelido: string | null; razao_social: string | null; estado: string | null; cidade: string | null };
  const empresas = (empresasData ?? []) as EmpresaRow[];

  const usuarioDeptoPorId = new Map<string, string | null>();
  for (const u of (usuariosData ?? []) as { id: string; departamento_id: string | null }[]) {
    usuarioDeptoPorId.set(u.id, u.departamento_id);
  }

  // Responsável fiscal por empresa: prioriza depto Fiscal (normal); cai pro
  // Fiscal-SN se não tiver — mesma ordem do checklist (getResponsavelFiscal).
  const respPorEmpresa = new Map<string, string>();
  for (const r of (respData ?? []) as { empresa_id: string; departamento_id: string; usuario_id: string | null }[]) {
    if (!r.usuario_id) continue;
    const jaTem = respPorEmpresa.get(r.empresa_id);
    if (jaTem && fiscalDept && r.departamento_id !== fiscalDept.id) continue; // não sobrescreve fiscal com SN
    if (!jaTem || (fiscalDept && r.departamento_id === fiscalDept.id)) {
      respPorEmpresa.set(r.empresa_id, r.usuario_id);
    }
  }

  const checklistMap = new Map<string, { concluido: boolean; status: string | null }>();
  for (const c of (checklistData ?? []) as { empresa_id: string; obrigacao: string; concluido: boolean | null; status: string | null }[]) {
    checklistMap.set(`${c.empresa_id}|${c.obrigacao}`, { concluido: !!c.concluido, status: c.status });
  }

  const overridesMap = new Map<string, { habilitada: boolean; vigenteDesde: string | null; habilitadaAntes: boolean | null }>();
  for (const o of (overridesData ?? []) as { empresa_id: string; obrigacao: string; habilitada: boolean; vigente_desde: string | null; habilitada_antes: boolean | null }[]) {
    overridesMap.set(`${o.empresa_id}|${o.obrigacao}`, { habilitada: o.habilitada, vigenteDesde: o.vigente_desde, habilitadaAntes: o.habilitada_antes });
  }

  const configMap = new Map<string, { ativa: boolean; naoEnviaCliente: boolean }>();
  for (const c of (configData ?? []) as { empresa_id: string; obrigacao: string; ativa: boolean | null; nao_envia_cliente: boolean | null }[]) {
    configMap.set(`${c.empresa_id}|${c.obrigacao}`, { ativa: c.ativa !== false, naoEnviaCliente: !!c.nao_envia_cliente });
  }

  const itens: ItemUrgente[] = [];

  for (const empresa of empresas) {
    const respId = respPorEmpresa.get(empresa.id);
    if (!respId) continue; // sem responsável fiscal — fora do checklist, fora do alerta
    const deptoResp = usuarioDeptoPorId.get(respId) ?? null;
    const aba: 'sn' | 'fiscal' = fiscalSnDept && deptoResp === fiscalSnDept.id ? 'sn' : 'fiscal';
    const obrigacoes = aba === 'sn' ? VENCIMENTOS_FISCAIS_SN_NOMES : VENCIMENTOS_FISCAIS_NOMES;

    for (const obrigacao of obrigacoes) {
      if (ehObrigacaoSempreInterna(obrigacao)) continue;

      const key = `${empresa.id}|${obrigacao}`;
      const config = configMap.get(key);
      if (config && (!config.ativa || config.naoEnviaCliente)) continue;

      const override = overridesMap.get(key);
      const overrideResolvido = overrideHabilitadaNoMes(override, mesAtual);
      const aplica = overrideResolvido ?? (aba === 'sn'
        ? obrigacaoSnAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade)
        : obrigacaoAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade));
      if (!aplica) continue;

      const vencIso = aba === 'sn'
        ? vencimentoDoMesSn(obrigacao, empresa.estado, mesAtual, empresa.cidade)
        : vencimentoDoMes(obrigacao, empresa.estado, mesAtual, empresa.cidade);
      if (!vencIso) continue; // obrigação sem dia fixo (ex.: livros) — não entra nesse alerta

      const dias = daysUntil(vencIso);
      if (dias == null || dias > JANELA_DIAS) continue;

      const item = checklistMap.get(key);
      const concluido = !!item && (item.concluido || item.status === 'sem_obrigacao');
      if (concluido) continue;

      itens.push({
        empresaId: empresa.id,
        empresaNome: empresa.apelido || empresa.razao_social || empresa.codigo,
        obrigacao,
        vencimento: vencIso,
        dias,
      });
    }
  }

  itens.sort((a, b) => a.dias - b.dias);

  return NextResponse.json({ ok: true, mes: mesAtual, total: itens.length, itens: itens.slice(0, 100) });
}
