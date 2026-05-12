import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { daysUntil } from '@/app/utils/date';
import { obrigacaoAplicaParaEmpresa, obrigacaoSnAplicaParaEmpresa } from '@/app/utils/regrasVencimentosFiscais';
import {
  FISCAL_DEPT_NOME, FISCAL_SN_DEPT_NOME,
  VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES,
} from '@/app/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Marcos do alerta:
//  d-2 = vence em 2 dias  (daysUntil retorna 2)
//  d-0 = vence hoje       (daysUntil retorna 0)
//  d+1 = atrasado 1 dia   (daysUntil retorna -1)
type Marco = 'd-2' | 'd-0' | 'd+1';

const MARCOS: Marco[] = ['d-2', 'd-0', 'd+1'];
const MAX_ITEMS_NA_MENSAGEM = 10;

function marcoDeDias(d: number): Marco | null {
  if (d === 2) return 'd-2';
  if (d === 0) return 'd-0';
  if (d === -1) return 'd+1';
  return null;
}

function normalizarNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tipoDoAlerta(marco: Marco): 'aviso' | 'erro' {
  return marco === 'd+1' ? 'erro' : 'aviso';
}

function tituloAgregado(marco: Marco, total: number): string {
  if (marco === 'd-2') {
    return `⚠️ ${total} ${total === 1 ? 'obrigação vence' : 'obrigações vencem'} em 2 dias`;
  }
  if (marco === 'd-0') {
    return `🚨 ${total} ${total === 1 ? 'obrigação vence' : 'obrigações vencem'} HOJE`;
  }
  return `🔥 ${total} ${total === 1 ? 'obrigação atrasada' : 'obrigações atrasadas'}`;
}

interface CandidatoOut {
  empresaId: string;
  empresaCodigo: string;
  empresaNome: string;
  obrigacao: string;
  vencimento: string;
  marco: Marco;
  responsavelId: string | null;
}

function mensagemAgregada(marco: Marco, items: CandidatoOut[]): string {
  const intro = marco === 'd-2' ? 'Vence em 2 dias:'
    : marco === 'd-0' ? 'Vence HOJE:'
    : 'Atrasadas há 1 dia (urgente):';

  const formatItem = (i: CandidatoOut) => {
    const dataLabel = new Date(i.vencimento + 'T00:00:00').toLocaleDateString('pt-BR');
    return `• ${i.obrigacao} — ${i.empresaCodigo} ${i.empresaNome} (${dataLabel})`;
  };

  // Ordena alfabeticamente por (obrigação, empresa)
  const ordenados = [...items].sort((a, b) => {
    const c = a.obrigacao.localeCompare(b.obrigacao);
    if (c !== 0) return c;
    return a.empresaCodigo.localeCompare(b.empresaCodigo);
  });

  const mostrados = ordenados.slice(0, MAX_ITEMS_NA_MENSAGEM).map(formatItem);
  const extras = ordenados.length - mostrados.length;

  let msg = `${intro}\n` + mostrados.join('\n');
  if (extras > 0) msg += `\n• ... e mais ${extras}`;
  msg += '\n\nDetalhes em Hoje / Checklist.';
  return msg;
}

export async function GET(req: Request) {
  // Autoriza só se vier do Vercel Cron (Authorization: Bearer ${CRON_SECRET})
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
  }

  try {
    return await processarCron();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[cron] erro fatal:', err);
    return NextResponse.json(
      { error: message, stack: stack?.split('\n').slice(0, 6) },
      { status: 500 },
    );
  }
}

async function processarCron(): Promise<NextResponse> {
  const admin = getSupabaseAdmin();

  // ── 1. Carrega dados básicos em paralelo ────────────────────────────────
  const [empresasRes, departamentosRes, usuariosRes, overridesRes] = await Promise.all([
    admin
      .from('empresas')
      .select('id, codigo, razao_social, apelido, cnpj, estado, cidade, vencimentos_fiscais, responsaveis, desligada_em')
      .is('desligada_em', null),
    admin.from('departamentos').select('id, nome'),
    admin.from('usuarios').select('id, role, departamento_id, departamentos_extras_ids, ativo'),
    admin.from('obrigacao_empresas').select('empresa_id, obrigacao, habilitada'),
  ]);

  if (empresasRes.error) return NextResponse.json({ error: empresasRes.error.message }, { status: 500 });
  if (departamentosRes.error) return NextResponse.json({ error: departamentosRes.error.message }, { status: 500 });
  if (usuariosRes.error) return NextResponse.json({ error: usuariosRes.error.message }, { status: 500 });

  const empresas = (empresasRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    razao_social: string | null;
    apelido: string | null;
    estado: string | null;
    cidade: string | null;
    vencimentos_fiscais: Array<{ nome?: string; vencimento?: string | null }> | null;
    responsaveis: Record<string, string | null> | null;
  }>;
  const departamentos = (departamentosRes.data ?? []) as Array<{ id: string; nome: string }>;
  const usuarios = (usuariosRes.data ?? []) as Array<{
    id: string;
    role: string;
    departamento_id: string | null;
    departamentos_extras_ids: string[] | null;
    ativo: boolean;
  }>;

  // ── 2. Departamentos Fiscal e Fiscal-SN ────────────────────────────────
  const fiscalDept = departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_DEPT_NOME)
    ?? departamentos.find((d) => {
      const n = d.nome.toLowerCase();
      return n.includes('fiscal') && !n.includes('sn');
    });
  const fiscalSnDept = departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_SN_DEPT_NOME);

  // ── 3. Gerentes do Fiscal e SN ─────────────────────────────────────────
  const gerenteIds: string[] = [];
  for (const u of usuarios) {
    if (!u.ativo) continue;
    if (u.role !== 'gerente' && u.role !== 'admin') continue;
    const deptos = new Set([u.departamento_id, ...(u.departamentos_extras_ids ?? [])].filter(Boolean) as string[]);
    if (fiscalDept && deptos.has(fiscalDept.id)) gerenteIds.push(u.id);
    else if (fiscalSnDept && deptos.has(fiscalSnDept.id)) gerenteIds.push(u.id);
  }

  // ── 4. Overrides ───────────────────────────────────────────────────────
  const overrides = new Map<string, boolean>();
  for (const o of (overridesRes.data ?? []) as Array<{ empresa_id: string; obrigacao: string; habilitada: boolean }>) {
    overrides.set(`${o.empresa_id}|${o.obrigacao}`, o.habilitada);
  }

  // ── 5. Checklist do mês corrente + anterior ────────────────────────────
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const mesAnt = new Date(hoje);
  mesAnt.setMonth(mesAnt.getMonth() - 1);
  const mesAnterior = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth() + 1).padStart(2, '0')}`;

  const checklistRes = await admin
    .from('checklist_fiscal')
    .select('empresa_id, obrigacao, mes, concluido, status')
    .in('mes', [mesAtual, mesAnterior]);

  const marcadosSet = new Set<string>();
  for (const c of (checklistRes.data ?? []) as Array<{
    empresa_id: string;
    obrigacao: string;
    mes: string;
    concluido: boolean | null;
    status: string | null;
  }>) {
    const marcado = c.concluido === true || c.status === 'feito' || c.status === 'sem_obrigacao';
    if (marcado) marcadosSet.add(`${c.empresa_id}|${normalizarNome(c.obrigacao)}|${c.mes}`);
  }

  function jaMarcado(empresaId: string, obrigacao: string, vencISO: string): boolean {
    const v = new Date(vencISO + 'T00:00:00');
    const mesmoMes = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(v);
    prev.setMonth(prev.getMonth() - 1);
    const mesAntVenc = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const norm = normalizarNome(obrigacao);
    return marcadosSet.has(`${empresaId}|${norm}|${mesAntVenc}`) || marcadosSet.has(`${empresaId}|${norm}|${mesmoMes}`);
  }

  // ── 6. Filtro de obrigações válidas ────────────────────────────────────
  const obrigacoesValidasNorm = new Set([
    ...VENCIMENTOS_FISCAIS_NOMES,
    ...VENCIMENTOS_FISCAIS_SN_NOMES,
  ].map(normalizarNome));

  // ── 7. Loop pra montar candidatos ──────────────────────────────────────
  const candidatos: CandidatoOut[] = [];
  for (const emp of empresas) {
    const empresaNome = emp.razao_social || emp.apelido || emp.codigo;
    for (const v of emp.vencimentos_fiscais ?? []) {
      if (!v?.nome || !v?.vencimento) continue;
      const obrigNorm = normalizarNome(v.nome);
      if (!obrigacoesValidasNorm.has(obrigNorm)) continue;

      const overrideKey = `${emp.id}|${v.nome}`;
      const override = overrides.get(overrideKey);
      const aplica = typeof override === 'boolean'
        ? override
        : (obrigacaoAplicaParaEmpresa(v.nome, emp.estado, emp.cidade)
          || obrigacaoSnAplicaParaEmpresa(v.nome, emp.estado, emp.cidade));
      if (!aplica) continue;

      const d = daysUntil(v.vencimento);
      if (d === null) continue;
      const marco = marcoDeDias(d);
      if (!marco) continue;

      if (jaMarcado(emp.id, v.nome, v.vencimento)) continue;

      const respId = (fiscalDept ? emp.responsaveis?.[fiscalDept.id] : null)
        || (fiscalSnDept ? emp.responsaveis?.[fiscalSnDept.id] : null)
        || null;

      candidatos.push({
        empresaId: emp.id,
        empresaCodigo: emp.codigo,
        empresaNome,
        obrigacao: v.nome,
        vencimento: v.vencimento,
        marco,
        responsavelId: respId,
      });
    }
  }

  // ── 8. Filtra os que já foram alertados antes (bulk check) ─────────────
  const { data: jaAlertadosData } = await admin
    .from('vencimento_alertas')
    .select('empresa_id, obrigacao, vencimento, marco')
    .in('marco', MARCOS);

  const alertadosSet = new Set<string>();
  for (const a of (jaAlertadosData ?? []) as Array<{
    empresa_id: string; obrigacao: string; vencimento: string; marco: string;
  }>) {
    alertadosSet.add(`${a.empresa_id}|${normalizarNome(a.obrigacao)}|${a.vencimento}|${a.marco}`);
  }

  const novos = candidatos.filter((c) => !alertadosSet.has(
    `${c.empresaId}|${normalizarNome(c.obrigacao)}|${c.vencimento}|${c.marco}`,
  ));

  // ── 9. AGREGA por destinatário + marco ─────────────────────────────────
  // Estrutura: Map<destinatarioId, Map<marco, CandidatoOut[]>>
  const porDestinatario = new Map<string, Map<Marco, CandidatoOut[]>>();

  function adicionarPara(destinatarioId: string, c: CandidatoOut) {
    let porMarco = porDestinatario.get(destinatarioId);
    if (!porMarco) {
      porMarco = new Map();
      porDestinatario.set(destinatarioId, porMarco);
    }
    let lista = porMarco.get(c.marco);
    if (!lista) {
      lista = [];
      porMarco.set(c.marco, lista);
    }
    lista.push(c);
  }

  for (const c of novos) {
    if (c.responsavelId) adicionarPara(c.responsavelId, c);
    for (const gid of gerenteIds) adicionarPara(gid, c);
  }

  // ── 10. Cria 1 notif agregada por (destinatário, marco) ────────────────
  let notifsCriadas = 0;
  let falhas = 0;

  for (const [destinatarioId, porMarco] of porDestinatario.entries()) {
    for (const [marco, items] of porMarco.entries()) {
      const { error: insErr } = await admin.from('notificacoes').insert({
        titulo: tituloAgregado(marco, items.length),
        mensagem: mensagemAgregada(marco, items),
        tipo: tipoDoAlerta(marco),
        lida: false,
        lidas_por: [],
        autor_id: null,
        autor_nome: 'Sistema',
        empresa_id: null,
        destinatarios: [destinatarioId],
      });
      if (insErr) {
        console.error('[cron] erro ao inserir notif agregada:', insErr);
        falhas++;
        continue;
      }
      notifsCriadas++;
    }
  }

  // ── 11. Marca todos os items como "já alertados" (bulk insert) ─────────
  if (novos.length > 0) {
    const log = novos.map((c) => ({
      empresa_id: c.empresaId,
      obrigacao: c.obrigacao,
      vencimento: c.vencimento,
      marco: c.marco,
    }));
    // Upsert pra ignorar conflito (caso paralelismo)
    const { error: logErr } = await admin
      .from('vencimento_alertas')
      .upsert(log, { onConflict: 'empresa_id,obrigacao,vencimento,marco', ignoreDuplicates: true });
    if (logErr) console.error('[cron] erro ao registrar alertas:', logErr);
  }

  return NextResponse.json({
    ok: true,
    candidatos_em_janela: candidatos.length,
    novos_alertas: novos.length,
    ja_alertados: candidatos.length - novos.length,
    notificacoes_criadas: notifsCriadas,
    destinatarios_unicos: porDestinatario.size,
    falhas,
    timestamp: new Date().toISOString(),
  });
}
