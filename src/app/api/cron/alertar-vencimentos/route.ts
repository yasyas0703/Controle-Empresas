import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
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
    return `${total} ${total === 1 ? 'obrigação vence' : 'obrigações vencem'} em 2 dias`;
  }
  if (marco === 'd-0') {
    return `${total} ${total === 1 ? 'obrigação vence' : 'obrigações vencem'} HOJE`;
  }
  return `${total} ${total === 1 ? 'obrigação atrasada' : 'obrigações atrasadas'}`;
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

  // Modo simulação: ?simular=2026-05-18 finge que "hoje" é essa data e ?dry=1 não grava nada
  const url = new URL(req.url);
  const simular = url.searchParams.get('simular');
  const dry = url.searchParams.get('dry') === '1';

  try {
    return await processarCron({ simularDataIso: simular, dry });
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

async function processarCron(opts: { simularDataIso?: string | null; dry?: boolean } = {}): Promise<NextResponse> {
  const admin = getSupabaseAdmin();
  const { simularDataIso, dry } = opts;
  // Data de referência (default = hoje; usar ?simular=YYYY-MM-DD pra fingir outro dia)
  const dataRef = simularDataIso ? new Date(simularDataIso + 'T00:00:00') : new Date();
  if (Number.isNaN(dataRef.getTime())) {
    return NextResponse.json({ error: `Data simular inválida: ${simularDataIso}` }, { status: 400 });
  }

  // ── 1. Carrega dados básicos em paralelo ────────────────────────────────
  const [empresasRes, departamentosRes, usuariosRes, overridesRes, responsaveisRes] = await Promise.all([
    admin
      .from('empresas')
      .select('id, codigo, razao_social, apelido, cnpj, estado, cidade, vencimentos_fiscais, desligada_em')
      .is('desligada_em', null),
    admin.from('departamentos').select('id, nome'),
    admin.from('usuarios').select('id, role, departamento_id, departamentos_extras_ids, ativo'),
    admin.from('obrigacao_empresas').select('empresa_id, obrigacao, habilitada'),
    admin.from('responsaveis').select('empresa_id, departamento_id, usuario_id'),
  ]);

  if (empresasRes.error) return NextResponse.json({ error: empresasRes.error.message }, { status: 500 });
  if (departamentosRes.error) return NextResponse.json({ error: departamentosRes.error.message }, { status: 500 });
  if (usuariosRes.error) return NextResponse.json({ error: usuariosRes.error.message }, { status: 500 });
  if (responsaveisRes.error) return NextResponse.json({ error: responsaveisRes.error.message }, { status: 500 });

  const empresas = (empresasRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    razao_social: string | null;
    apelido: string | null;
    estado: string | null;
    cidade: string | null;
    vencimentos_fiscais: Array<{ nome?: string; vencimento?: string | null }> | null;
  }>;

  // Monta Map<empresaId, Record<departamentoId, usuarioId>> a partir da tabela responsaveis
  const responsaveisMap = new Map<string, Record<string, string | null>>();
  for (const r of (responsaveisRes.data ?? []) as Array<{
    empresa_id: string; departamento_id: string; usuario_id: string | null;
  }>) {
    const atual = responsaveisMap.get(r.empresa_id) ?? {};
    atual[r.departamento_id] = r.usuario_id;
    responsaveisMap.set(r.empresa_id, atual);
  }
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
  const mesAtual = `${dataRef.getFullYear()}-${String(dataRef.getMonth() + 1).padStart(2, '0')}`;
  const mesAnt = new Date(dataRef);
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

  // Função local de "dias até vencer" baseada na data de referência (default hoje)
  const refMidnight = new Date(dataRef);
  refMidnight.setHours(0, 0, 0, 0);
  const refMs = refMidnight.getTime();
  function diasAteRef(vencimentoIso: string): number | null {
    if (!vencimentoIso) return null;
    const v = new Date(vencimentoIso + 'T00:00:00');
    if (Number.isNaN(v.getTime())) return null;
    v.setHours(0, 0, 0, 0);
    return Math.round((v.getTime() - refMs) / (1000 * 60 * 60 * 24));
  }

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

      const d = diasAteRef(v.vencimento);
      if (d === null) continue;
      const marco = marcoDeDias(d);
      if (!marco) continue;

      if (jaMarcado(emp.id, v.nome, v.vencimento)) continue;

      const respDaEmpresa = responsaveisMap.get(emp.id) ?? {};
      const respId = (fiscalDept ? respDaEmpresa[fiscalDept.id] : null)
        || (fiscalSnDept ? respDaEmpresa[fiscalSnDept.id] : null)
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
  // Quando dry=1, só simula: monta a lista mas NÃO insere notif/alerta no banco.
  let notifsCriadas = 0;
  let falhas = 0;
  const previewNotifs: Array<{ destinatarioId: string; marco: Marco; titulo: string; quantidade: number }> = [];

  for (const [destinatarioId, porMarco] of porDestinatario.entries()) {
    for (const [marco, items] of porMarco.entries()) {
      const titulo = tituloAgregado(marco, items.length);
      if (dry) {
        previewNotifs.push({ destinatarioId, marco, titulo, quantidade: items.length });
        notifsCriadas++;
        continue;
      }
      const { error: insErr } = await admin.from('notificacoes').insert({
        titulo,
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
  if (!dry && novos.length > 0) {
    const log = novos.map((c) => ({
      empresa_id: c.empresaId,
      obrigacao: c.obrigacao,
      vencimento: c.vencimento,
      marco: c.marco,
    }));
    const { error: logErr } = await admin
      .from('vencimento_alertas')
      .upsert(log, { onConflict: 'empresa_id,obrigacao,vencimento,marco', ignoreDuplicates: true });
    if (logErr) console.error('[cron] erro ao registrar alertas:', logErr);
  }

  return NextResponse.json({
    ok: true,
    data_referencia: refMidnight.toISOString().slice(0, 10),
    dry_run: !!dry,
    candidatos_em_janela: candidatos.length,
    novos_alertas: novos.length,
    ja_alertados: candidatos.length - novos.length,
    notificacoes_criadas: notifsCriadas,
    destinatarios_unicos: porDestinatario.size,
    falhas,
    preview: dry ? previewNotifs : undefined,
    timestamp: new Date().toISOString(),
  });
}
