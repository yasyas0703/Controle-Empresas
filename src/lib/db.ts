import { supabase } from '@/lib/supabase';
import type {
  Departamento,
  DocumentoEmpresa,
  Empresa,
  LixeiraItem,
  LogEntry,
  Notificacao,
  Observacao,
  RetItem,
  Servico,
  Usuario,
  UUID,
} from '@/app/types';

// ─── helpers ────────────────────────────────────────────────

function toIso(v: string | null | undefined): string {
  return v ? new Date(v).toISOString() : '';
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão ausente. Faça login novamente.');
  return token;
}

// ─── Departamentos ──────────────────────────────────────────

export async function fetchDepartamentos(): Promise<Departamento[]> {
  const { data, error } = await supabase.from('departamentos').select('*').order('criado_em', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    criadoEm: toIso(d.criado_em),
    atualizadoEm: toIso(d.atualizado_em),
  }));
}

export async function insertDepartamento(nome: string): Promise<Departamento> {
  const { data, error } = await supabase.from('departamentos').insert({ nome }).select().single();
  if (error) throw error;
  return { id: data.id, nome: data.nome, criadoEm: toIso(data.criado_em), atualizadoEm: toIso(data.atualizado_em) };
}

export async function deleteDepartamento(id: UUID) {
  const { error } = await supabase.from('departamentos').delete().eq('id', id);
  if (error) throw error;
  // cascade: responsaveis deleted, usuarios.departamento_id set null
}

// ─── Usuários ───────────────────────────────────────────────

export async function fetchUsuarios(): Promise<Usuario[]> {
  // Manager-only list is loaded via admin API in fetchUsuariosAdmin.
  // Keep this as a safe fallback (self-only) when RLS is strict.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('Sessão ausente. Faça login novamente.');
  return fetchUsuarioById(userId);
}

export async function fetchUsuarioById(id: UUID): Promise<Usuario[]> {
  const { data, error } = await supabase.from('usuarios').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return [];
  return [
    {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.role as Usuario['role'],
      departamentoId: data.departamento_id,
      ativo: data.ativo,
      criadoEm: toIso(data.criado_em),
      atualizadoEm: toIso(data.atualizado_em),
    },
  ];
}

export async function fetchUsuariosAdmin(): Promise<Usuario[]> {
  const token = await getAccessToken();
  const resp = await fetch('/api/admin/users', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const json = await resp.json().catch(() => ([]));
  if (!resp.ok) throw new Error(json?.error ?? 'Falha ao carregar usuários');
  return (Array.isArray(json) ? json : []).map((u: any) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role,
    departamentoId: u.departamentoId,
    ativo: u.ativo,
    criadoEm: toIso(u.criadoEm),
    atualizadoEm: toIso(u.atualizadoEm),
  })) as Usuario[];
}

export async function insertUsuario(payload: Omit<Usuario, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<Usuario> {
  const token = await getAccessToken();
  const resp = await fetch('/api/admin/users', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error ?? 'Falha ao criar usuário');
  return {
    id: json.id,
    nome: json.nome,
    email: json.email,
    role: json.role,
    departamentoId: json.departamentoId,
    ativo: json.ativo,
    criadoEm: toIso(json.criadoEm),
    atualizadoEm: toIso(json.atualizadoEm),
  } as Usuario;
}

export type BatchUserPayload = {
  nome: string;
  email: string;
  senha: string;
  role: 'gerente' | 'usuario';
  departamentoId: string | null;
  ativo: boolean;
};

export type BatchUserResult = {
  nome: string;
  email: string;
  id: string | null;
  error: string | null;
  status: 'created' | 'existing' | 'failed';
};

/**
 * Cria múltiplos usuários em uma única chamada ao servidor.
 * Apenas 1 verificação de permissão — o servidor faz os delays internamente.
 */
export async function insertUsuariosBatch(
  users: BatchUserPayload[]
): Promise<{ results: BatchUserResult[]; summary: { total: number; created: number; existing: number; failed: number } }> {
  const token = await getAccessToken();
  const resp = await fetch('/api/admin/users/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ users }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error ?? 'Falha ao criar usuários em batch');
  return json;
}

export async function updateUsuario(id: UUID, patch: Partial<Usuario>) {
  const token = await getAccessToken();

  // profile update through admin API (keeps RLS strict on table)
  const profilePatch: Record<string, unknown> = {};
  if (patch.nome !== undefined) profilePatch.nome = patch.nome;
  if (patch.email !== undefined) profilePatch.email = patch.email;
  if (patch.role !== undefined) profilePatch.role = patch.role;
  if (patch.departamentoId !== undefined) profilePatch.departamentoId = patch.departamentoId;
  if (patch.ativo !== undefined) profilePatch.ativo = patch.ativo;

  // password change goes through admin API (auth)
  if (patch.senha !== undefined && String(patch.senha).trim()) {
    const resp = await fetch(`/api/admin/users/${id}/password`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ senha: patch.senha }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error ?? 'Falha ao alterar senha');
  }

  // profile update
  if (Object.keys(profilePatch).length > 0) {
    const resp = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(profilePatch),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error ?? 'Falha ao atualizar usuário');
  }
}

export async function deleteUsuario(id: UUID) {
  const token = await getAccessToken();
  const resp = await fetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error ?? 'Falha ao remover usuário');
}

// ─── Serviços ───────────────────────────────────────────────

export async function fetchServicos(): Promise<Servico[]> {
  const { data, error } = await supabase.from('servicos').select('*').order('criado_em', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    criadoEm: toIso(s.criado_em),
  }));
}

export async function insertServico(nome: string): Promise<Servico> {
  const { data, error } = await supabase.from('servicos').insert({ nome }).select().single();
  if (error) throw error;
  return { id: data.id, nome: data.nome, criadoEm: toIso(data.criado_em) };
}

export async function deleteServico(id: UUID, servicoNome: string) {
  // Remove from empresas that have this service
  const { data: empresasComServico } = await supabase
    .from('empresas')
    .select('id, servicos')
    .contains('servicos', [servicoNome]);

  if (empresasComServico) {
    for (const e of empresasComServico) {
      const updated = (e.servicos as string[]).filter((s: string) => s !== servicoNome);
      await supabase.from('empresas').update({ servicos: updated }).eq('id', e.id);
    }
  }

  const { error } = await supabase.from('servicos').delete().eq('id', id);
  if (error) throw error;
}

// ─── Empresas ───────────────────────────────────────────────

async function fetchRetsForEmpresa(empresaId: UUID): Promise<RetItem[]> {
  const { data } = await supabase.from('rets').select('*').eq('empresa_id', empresaId);
  return (data ?? []).map((r) => ({
    id: r.id,
    numeroPta: r.numero_pta,
    nome: r.nome,
    vencimento: r.vencimento,
    ultimaRenovacao: r.ultima_renovacao,
  }));
}

async function fetchDocsForEmpresa(empresaId: UUID): Promise<DocumentoEmpresa[]> {
  const { data } = await supabase.from('documentos').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false });
  return (data ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    validade: d.validade,
    criadoEm: toIso(d.criado_em),
    atualizadoEm: toIso(d.atualizado_em),
  }));
}

async function fetchObsForEmpresa(empresaId: UUID): Promise<Observacao[]> {
  const { data } = await supabase.from('observacoes').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: true });
  return (data ?? []).map((o) => ({
    id: o.id,
    texto: o.texto,
    autorId: o.autor_id ?? '',
    autorNome: o.autor_nome,
    criadoEm: toIso(o.criado_em),
  }));
}

async function fetchResponsaveisForEmpresa(empresaId: UUID): Promise<Record<UUID, UUID | null>> {
  const { data } = await supabase.from('responsaveis').select('*').eq('empresa_id', empresaId);
  const map: Record<UUID, UUID | null> = {};
  for (const r of data ?? []) {
    map[r.departamento_id] = r.usuario_id;
  }
  return map;
}

/**
 * Busca TODOS os registros de uma tabela paginando em blocos de PAGE_SIZE,
 * pois o PostgREST do Supabase limita cada request a ~1000 linhas (max-rows).
 */
async function fetchAllRows<T extends Record<string, unknown>>(
  table: string,
  opts?: { order?: { column: string; ascending: boolean } }
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending });
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break; // última página
    from += PAGE_SIZE;
  }
  return all;
}

export async function fetchEmpresas(): Promise<Empresa[]> {
  // Batch-load: busca empresas e todos os relacionamentos em paralelo (evita N+1)
  // Usa fetchAllRows para paginar além do limite de 1000 do PostgREST
  const [empresas, allRets, allDocs, allObs, allResps] = await Promise.all([
    fetchAllRows<Record<string, any>>('empresas', { order: { column: 'criado_em', ascending: false } }),
    fetchAllRows<Record<string, any>>('rets'),
    fetchAllRows<Record<string, any>>('documentos', { order: { column: 'criado_em', ascending: false } }),
    fetchAllRows<Record<string, any>>('observacoes', { order: { column: 'criado_em', ascending: true } }),
    fetchAllRows<Record<string, any>>('responsaveis'),
  ]);

  // Agrupar por empresa_id em memória
  const retsMap = new Map<string, RetItem[]>();
  for (const r of allRets) {
    const list = retsMap.get(r.empresa_id) ?? [];
    list.push({ id: r.id, numeroPta: r.numero_pta, nome: r.nome, vencimento: r.vencimento, ultimaRenovacao: r.ultima_renovacao });
    retsMap.set(r.empresa_id, list);
  }

  const docsMap = new Map<string, DocumentoEmpresa[]>();
  for (const d of allDocs) {
    const list = docsMap.get(d.empresa_id) ?? [];
    list.push({ id: d.id, nome: d.nome, validade: d.validade, arquivoUrl: d.arquivo_url ?? undefined, criadoEm: toIso(d.criado_em), atualizadoEm: toIso(d.atualizado_em) });
    docsMap.set(d.empresa_id, list);
  }

  const obsMap = new Map<string, Observacao[]>();
  for (const o of allObs) {
    const list = obsMap.get(o.empresa_id) ?? [];
    list.push({ id: o.id, texto: o.texto, autorId: o.autor_id ?? '', autorNome: o.autor_nome, criadoEm: toIso(o.criado_em) });
    obsMap.set(o.empresa_id, list);
  }

  const respsMap = new Map<string, Record<UUID, UUID | null>>();
  console.log(`[DB DEBUG] fetchEmpresas: responsaveis carregados do banco: ${allResps.length} registros (paginado)`);
  for (const r of allResps) {
    const map = respsMap.get(r.empresa_id) ?? {};
    map[r.departamento_id] = r.usuario_id;
    respsMap.set(r.empresa_id, map);
  }

  return empresas.map((e) => ({
    id: e.id,
    cadastrada: e.cadastrada,
    cnpj: e.cnpj ?? undefined,
    codigo: e.codigo,
    razao_social: e.razao_social ?? undefined,
    apelido: e.apelido ?? undefined,
    data_abertura: e.data_abertura ?? undefined,
    tipoEstabelecimento: e.tipo_estabelecimento ?? '',
    tipoInscricao: e.tipo_inscricao ?? '',
    servicos: e.servicos ?? [],
    possuiRet: e.possui_ret,
    rets: retsMap.get(e.id) ?? [],
    inscricao_estadual: e.inscricao_estadual ?? undefined,
    inscricao_municipal: e.inscricao_municipal ?? undefined,
    regime_federal: e.regime_federal ?? undefined,
    regime_estadual: e.regime_estadual ?? undefined,
    regime_municipal: e.regime_municipal ?? undefined,
    estado: e.estado ?? undefined,
    cidade: e.cidade ?? undefined,
    bairro: e.bairro ?? undefined,
    logradouro: e.logradouro ?? undefined,
    numero: e.numero ?? undefined,
    cep: e.cep ?? undefined,
    email: e.email ?? undefined,
    telefone: e.telefone ?? undefined,
    responsaveis: respsMap.get(e.id) ?? {},
    documentos: docsMap.get(e.id) ?? [],
    observacoes: obsMap.get(e.id) ?? [],
    criadoEm: toIso(e.criado_em),
    atualizadoEm: toIso(e.atualizado_em),
  }));
}

export async function insertEmpresa(payload: Partial<Empresa>, departamentoIds: UUID[]): Promise<string> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const isRetryableMessage = (msg: string) => /\b429\b|too many requests|rate limit|timed out|timeout|fetch failed|network|connection|econnreset|service unavailable|\b503\b/i.test(msg);
  const isRetryableSupabaseError = (err: unknown) => {
    const msg = (err as any)?.message ?? '';
    const status = (err as any)?.status;
    if (status === 429 || status === 503) return true;
    return isRetryableMessage(String(msg));
  };

  const codigo = String(payload.codigo ?? '').trim();

  // Idempotência: se já existir empresa com o mesmo código, reutiliza para evitar duplicatas em retry/timeouts
  let empresaId: string | null = null;
  if (codigo) {
    const { data: existing, error: existingErr } = await supabase
      .from('empresas')
      .select('id')
      .eq('codigo', codigo)
      .order('criado_em', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing?.id) empresaId = existing.id as string;
  }

  if (!empresaId) {
    const { data, error } = await supabase
      .from('empresas')
      .insert({
        cadastrada: payload.cadastrada ?? false,
        cnpj: payload.cnpj || null,
        codigo,
        razao_social: payload.razao_social || null,
        apelido: payload.apelido || null,
        data_abertura: payload.data_abertura || null,
        tipo_estabelecimento: payload.tipoEstabelecimento ?? '',
        tipo_inscricao: payload.tipoInscricao ?? '',
        servicos: payload.servicos ?? [],
        possui_ret: payload.possuiRet ?? false,
        inscricao_estadual: payload.inscricao_estadual || null,
        inscricao_municipal: payload.inscricao_municipal || null,
        regime_federal: payload.regime_federal || null,
        regime_estadual: payload.regime_estadual || null,
        regime_municipal: payload.regime_municipal || null,
        estado: payload.estado || null,
        cidade: payload.cidade || null,
        bairro: payload.bairro || null,
        logradouro: payload.logradouro || null,
        numero: payload.numero || null,
        cep: payload.cep || null,
        email: payload.email || null,
        telefone: payload.telefone || null,
      })
      .select('id')
      .single();
    if (error) throw error;
    empresaId = data.id as string;
  } else {
    // Mantém os dados sincronizados caso esteja reimportando
    const row: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (payload.cadastrada !== undefined) row.cadastrada = payload.cadastrada;
    if (payload.cnpj !== undefined) row.cnpj = payload.cnpj || null;
    if (payload.razao_social !== undefined) row.razao_social = payload.razao_social || null;
    if (payload.apelido !== undefined) row.apelido = payload.apelido || null;
    if (payload.data_abertura !== undefined) row.data_abertura = payload.data_abertura || null;
    if (payload.tipoEstabelecimento !== undefined) row.tipo_estabelecimento = payload.tipoEstabelecimento;
    if (payload.tipoInscricao !== undefined) row.tipo_inscricao = payload.tipoInscricao;
    if (payload.servicos !== undefined) row.servicos = payload.servicos;
    if (payload.possuiRet !== undefined) row.possui_ret = payload.possuiRet;
    if (payload.inscricao_estadual !== undefined) row.inscricao_estadual = payload.inscricao_estadual || null;
    if (payload.inscricao_municipal !== undefined) row.inscricao_municipal = payload.inscricao_municipal || null;
    if (payload.regime_federal !== undefined) row.regime_federal = payload.regime_federal || null;
    if (payload.regime_estadual !== undefined) row.regime_estadual = payload.regime_estadual || null;
    if (payload.regime_municipal !== undefined) row.regime_municipal = payload.regime_municipal || null;
    if (payload.estado !== undefined) row.estado = payload.estado || null;
    if (payload.cidade !== undefined) row.cidade = payload.cidade || null;
    if (payload.bairro !== undefined) row.bairro = payload.bairro || null;
    if (payload.logradouro !== undefined) row.logradouro = payload.logradouro || null;
    if (payload.numero !== undefined) row.numero = payload.numero || null;
    if (payload.cep !== undefined) row.cep = payload.cep || null;
    if (payload.email !== undefined) row.email = payload.email || null;
    if (payload.telefone !== undefined) row.telefone = payload.telefone || null;

    const { error: updErr } = await supabase.from('empresas').update(row).eq('id', empresaId);
    if (updErr) throw updErr;
  }

  // Responsáveis: unir departamentos do state com os que vêm no payload
  const allDeptIds = new Set(departamentoIds);
  if (payload.responsaveis) {
    for (const depId of Object.keys(payload.responsaveis)) {
      allDeptIds.add(depId);
    }
  }
  console.log(`[DB DEBUG] insertEmpresa ${empresaId}: departamentoIds recebidos:`, departamentoIds.length, ', payload.responsaveis keys:', Object.keys(payload.responsaveis || {}));
  console.log(`[DB DEBUG] allDeptIds (${allDeptIds.size}):`, Array.from(allDeptIds));
  if (allDeptIds.size > 0) {
    const rows = Array.from(allDeptIds).map((depId) => ({
      empresa_id: empresaId,
      departamento_id: depId,
      usuario_id: payload.responsaveis?.[depId] || null,
    }));
    console.log(`[DB DEBUG] Responsáveis rows a inserir (${rows.length}):`, rows.map(r => ({ dept: r.departamento_id, user: r.usuario_id })));
    // Upsert evita 409 (Conflict) no retry/reimport e mantém idempotência
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { error: respError, data: respData, status: respStatus, statusText } = await supabase
          .from('responsaveis')
          .upsert(rows, { onConflict: 'empresa_id,departamento_id' })
          .select();
        console.log(`[DB DEBUG] insertEmpresa ${empresaId}: upsert resultado → status=${respStatus} ${statusText}, data=${respData?.length ?? 'null'} rows, error=${respError?.message ?? 'nenhum'}`);
        if (respError) throw respError;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[DB DEBUG] upsert responsáveis falhou (tentativa ${attempt + 1}/3):`, err);
        if (attempt < 2 && isRetryableSupabaseError(err)) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        break;
      }
    }
    if (lastErr) throw lastErr;
  } else {
    console.warn(`[DB DEBUG] insertEmpresa ${empresaId}: NENHUM departamento para inserir responsáveis!`);
  }

  // RETs
  if (payload.rets && payload.rets.length > 0) {
    const retRows = payload.rets.map((r) => ({
      empresa_id: empresaId,
      numero_pta: r.numeroPta,
      nome: r.nome,
      vencimento: r.vencimento,
      ultima_renovacao: r.ultimaRenovacao,
    }));
    await supabase.from('rets').insert(retRows);
  }

  // Documentos
  if (payload.documentos && payload.documentos.length > 0) {
    const docRows = payload.documentos.map((d) => ({
      empresa_id: empresaId,
      nome: d.nome,
      validade: d.validade,
    }));
    await supabase.from('documentos').insert(docRows);
  }

  // Observações
  if (payload.observacoes && payload.observacoes.length > 0) {
    const obsRows = payload.observacoes.map((o) => ({
      empresa_id: empresaId,
      texto: o.texto,
      autor_id: o.autorId || null,
      autor_nome: o.autorNome,
    }));
    await supabase.from('observacoes').insert(obsRows);
  }

  return empresaId;
}

export async function updateEmpresa(id: UUID, patch: Partial<Empresa>) {
  const row: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (patch.cadastrada !== undefined) row.cadastrada = patch.cadastrada;
  if (patch.cnpj !== undefined) row.cnpj = patch.cnpj || null;
  if (patch.codigo !== undefined) row.codigo = patch.codigo;
  if (patch.razao_social !== undefined) row.razao_social = patch.razao_social || null;
  if (patch.apelido !== undefined) row.apelido = patch.apelido || null;
  if (patch.data_abertura !== undefined) row.data_abertura = patch.data_abertura || null;
  if (patch.tipoEstabelecimento !== undefined) row.tipo_estabelecimento = patch.tipoEstabelecimento;
  if (patch.tipoInscricao !== undefined) row.tipo_inscricao = patch.tipoInscricao;
  if (patch.servicos !== undefined) row.servicos = patch.servicos;
  if (patch.possuiRet !== undefined) row.possui_ret = patch.possuiRet;
  if (patch.inscricao_estadual !== undefined) row.inscricao_estadual = patch.inscricao_estadual || null;
  if (patch.inscricao_municipal !== undefined) row.inscricao_municipal = patch.inscricao_municipal || null;
  if (patch.regime_federal !== undefined) row.regime_federal = patch.regime_federal || null;
  if (patch.regime_estadual !== undefined) row.regime_estadual = patch.regime_estadual || null;
  if (patch.regime_municipal !== undefined) row.regime_municipal = patch.regime_municipal || null;
  if (patch.estado !== undefined) row.estado = patch.estado || null;
  if (patch.cidade !== undefined) row.cidade = patch.cidade || null;
  if (patch.bairro !== undefined) row.bairro = patch.bairro || null;
  if (patch.logradouro !== undefined) row.logradouro = patch.logradouro || null;
  if (patch.numero !== undefined) row.numero = patch.numero || null;
  if (patch.cep !== undefined) row.cep = patch.cep || null;
  if (patch.email !== undefined) row.email = patch.email || null;
  if (patch.telefone !== undefined) row.telefone = patch.telefone || null;

  const { error } = await supabase.from('empresas').update(row).eq('id', id);
  if (error) throw error;

  // Atualizar RETs se fornecidos
  if (patch.rets !== undefined) {
    await supabase.from('rets').delete().eq('empresa_id', id);
    if (patch.rets.length > 0) {
      const retRows = patch.rets.map((r) => ({
        empresa_id: id,
        numero_pta: r.numeroPta,
        nome: r.nome,
        vencimento: r.vencimento,
        ultima_renovacao: r.ultimaRenovacao,
      }));
      await supabase.from('rets').insert(retRows);
    }
  }

  // Atualizar responsáveis se fornecidos (inserir/atualizar sem apagar os que não vieram no patch)
  if (patch.responsaveis !== undefined) {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const isRetryableMessage = (msg: string) => /\b429\b|too many requests|rate limit|timed out|timeout|fetch failed|network|connection|econnreset|service unavailable|\b503\b/i.test(msg);
    const isRetryableSupabaseError = (err: unknown) => {
      const msg = (err as any)?.message ?? '';
      const status = (err as any)?.status;
      if (status === 429 || status === 503) return true;
      return isRetryableMessage(String(msg));
    };

    const rows = Object.entries(patch.responsaveis).map(([depId, userId]) => ({
      empresa_id: id,
      departamento_id: depId,
      usuario_id: userId || null,
    }));
    console.log(`%c[DB DEBUG] updateEmpresa ${id}: upsert responsáveis (${rows.length} rows)`, 'color: dodgerblue; font-weight: bold');
    for (const r of rows) {
      console.log(`  dept=${r.departamento_id} → user=${r.usuario_id ?? 'NULL'}`);
    }
    if (rows.length > 0) {
      // Upsert em batch: evita 409 e reduz requests
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { error: respError, data: respData, status: respStatus, statusText } = await supabase
            .from('responsaveis')
            .upsert(rows, { onConflict: 'empresa_id,departamento_id' })
            .select();
          console.log(`[DB DEBUG] updateEmpresa ${id}: upsert resultado → status=${respStatus} ${statusText}, data=${JSON.stringify(respData?.length ?? 'null')} rows, error=${respError?.message ?? 'nenhum'}`);
          if (respError) throw respError;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`[DB DEBUG] updateEmpresa ${id}: upsert FALHOU (tentativa ${attempt + 1}/3):`, err);
          if (attempt < 2 && isRetryableSupabaseError(err)) {
            await sleep(250 * (attempt + 1));
            continue;
          }
          break;
        }
      }
      if (lastErr) throw lastErr;
    } else {
      console.warn(`[DB DEBUG] updateEmpresa ${id}: patch.responsaveis está vazio, nada para upsert.`);
    }
  }
}

export async function deleteEmpresa(id: UUID) {
  // cascade handles rets, documentos, observacoes, responsaveis
  const { error } = await supabase.from('empresas').delete().eq('id', id);
  if (error) throw error;
}

// ─── Documentos ─────────────────────────────────────────────

export async function insertDocumento(empresaId: UUID, doc: Omit<DocumentoEmpresa, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<DocumentoEmpresa> {
  const { data, error } = await supabase
    .from('documentos')
    .insert({ empresa_id: empresaId, nome: doc.nome, validade: doc.validade, arquivo_url: doc.arquivoUrl || null })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, nome: data.nome, validade: data.validade, arquivoUrl: data.arquivo_url ?? undefined, criadoEm: toIso(data.criado_em), atualizadoEm: toIso(data.atualizado_em) };
}

export async function uploadDocumentoArquivo(empresaId: UUID, file: File): Promise<string> {
  const BUCKET = 'documentos';
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `empresas/${empresaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) {
    if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
      throw new Error(
        'O bucket "documentos" não existe no Supabase Storage. ' +
        'Vá em Storage no painel do Supabase e crie um bucket chamado "documentos" com acesso público.'
      );
    }
    throw error;
  }
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

export async function deleteDocumento(docId: UUID) {
  const { error } = await supabase.from('documentos').delete().eq('id', docId);
  if (error) throw error;
}

// ─── Observações ────────────────────────────────────────────

export async function insertObservacao(empresaId: UUID, texto: string, autorId: UUID | null, autorNome: string): Promise<Observacao> {
  const { data, error } = await supabase
    .from('observacoes')
    .insert({ empresa_id: empresaId, texto, autor_id: autorId, autor_nome: autorNome })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, texto: data.texto, autorId: data.autor_id ?? '', autorNome: data.autor_nome, criadoEm: toIso(data.criado_em) };
}

export async function deleteObservacao(obsId: UUID) {
  const { error } = await supabase.from('observacoes').delete().eq('id', obsId);
  if (error) throw error;
}

// ─── Logs ───────────────────────────────────────────────────

export async function fetchLogs(): Promise<LogEntry[]> {
  const { data, error } = await supabase.from('logs').select('*').order('em', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []).map((l) => ({
    id: l.id,
    em: toIso(l.em),
    userId: l.user_id,
    action: l.action,
    entity: l.entity,
    entityId: l.entity_id,
    message: l.message,
    diff: l.diff ?? undefined,
  }));
}

export async function insertLog(entry: Omit<LogEntry, 'id' | 'em'>): Promise<LogEntry> {
  const { data, error } = await supabase.from('logs').insert({
    user_id: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId,
    message: entry.message,
    diff: entry.diff ?? null,
  }).select().single();
  if (error) throw error;
  return {
    id: data.id,
    em: toIso(data.em),
    userId: data.user_id,
    action: data.action,
    entity: data.entity,
    entityId: data.entity_id,
    message: data.message,
    diff: data.diff ?? undefined,
  };
}

// ─── Lixeira ────────────────────────────────────────────────

export async function fetchLixeira(): Promise<LixeiraItem[]> {
  const { data, error } = await supabase.from('lixeira').select('*').order('excluido_em', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((l) => ({
    id: l.id,
    tipo: l.tipo ?? 'empresa',
    empresa: l.empresa_data as Empresa,
    documento: l.documento_data as DocumentoEmpresa | undefined,
    observacao: l.observacao_data as Observacao | undefined,
    empresaId: l.empresa_id ?? undefined,
    excluidoPorId: l.excluido_por_id,
    excluidoPorNome: l.excluido_por_nome,
    excluidoEm: toIso(l.excluido_em),
  }));
}

export async function insertLixeira(empresa: Empresa, userId: UUID | null, userName: string): Promise<LixeiraItem> {
  const { data, error } = await supabase
    .from('lixeira')
    .insert({
      tipo: 'empresa',
      empresa_data: empresa as unknown as Record<string, unknown>,
      excluido_por_id: userId,
      excluido_por_nome: userName,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    tipo: 'empresa',
    empresa: data.empresa_data as Empresa,
    excluidoPorId: data.excluido_por_id,
    excluidoPorNome: data.excluido_por_nome,
    excluidoEm: toIso(data.excluido_em),
  };
}

export async function insertLixeiraDocumento(
  doc: DocumentoEmpresa,
  empresa: Empresa,
  userId: UUID | null,
  userName: string
): Promise<LixeiraItem> {
  const { data, error } = await supabase
    .from('lixeira')
    .insert({
      tipo: 'documento',
      empresa_data: empresa as unknown as Record<string, unknown>,
      documento_data: doc as unknown as Record<string, unknown>,
      empresa_id: empresa.id,
      excluido_por_id: userId,
      excluido_por_nome: userName,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    tipo: 'documento',
    empresa: data.empresa_data as Empresa,
    documento: data.documento_data as DocumentoEmpresa,
    empresaId: data.empresa_id,
    excluidoPorId: data.excluido_por_id,
    excluidoPorNome: data.excluido_por_nome,
    excluidoEm: toIso(data.excluido_em),
  };
}

export async function insertLixeiraObservacao(
  obs: Observacao,
  empresa: Empresa,
  userId: UUID | null,
  userName: string
): Promise<LixeiraItem> {
  const { data, error } = await supabase
    .from('lixeira')
    .insert({
      tipo: 'observacao',
      empresa_data: empresa as unknown as Record<string, unknown>,
      observacao_data: obs as unknown as Record<string, unknown>,
      empresa_id: empresa.id,
      excluido_por_id: userId,
      excluido_por_nome: userName,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    tipo: 'observacao',
    empresa: data.empresa_data as Empresa,
    observacao: data.observacao_data as Observacao,
    empresaId: data.empresa_id,
    excluidoPorId: data.excluido_por_id,
    excluidoPorNome: data.excluido_por_nome,
    excluidoEm: toIso(data.excluido_em),
  };
}

export async function restoreDocumento(doc: DocumentoEmpresa, empresaId: UUID) {
  // Verificar se o documento ainda existe (pode não ter sido deletado corretamente)
  const { data: existing } = await supabase
    .from('documentos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('nome', doc.nome)
    .eq('validade', doc.validade)
    .limit(1);
  if (existing && existing.length > 0) {
    // Documento já existe — nada a fazer, apenas limpar a lixeira
    return;
  }
  const { error } = await supabase
    .from('documentos')
    .insert({
      empresa_id: empresaId,
      nome: doc.nome,
      validade: doc.validade,
      arquivo_url: doc.arquivoUrl ?? null,
    });
  if (error) throw error;
}

export async function restoreObservacao(obs: Observacao, empresaId: UUID) {
  // Verificar se a observação ainda existe
  const { data: existing } = await supabase
    .from('observacoes')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('texto', obs.texto)
    .eq('autor_nome', obs.autorNome)
    .limit(1);
  if (existing && existing.length > 0) {
    return;
  }
  const { error } = await supabase
    .from('observacoes')
    .insert({
      empresa_id: empresaId,
      texto: obs.texto,
      autor_id: obs.autorId,
      autor_nome: obs.autorNome,
    });
  if (error) throw error;
}

export async function deleteLixeiraItem(id: UUID) {
  const { error } = await supabase.from('lixeira').delete().eq('id', id);
  if (error) throw error;
}

export async function clearLixeira() {
  const { error } = await supabase.from('lixeira').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

/** Remove itens da lixeira com mais de N dias */
export async function purgeLixeiraOlderThan(days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('lixeira').delete().lt('excluido_em', cutoff);
  if (error) throw error;
}

// ─── Notificações ───────────────────────────────────────────

export async function fetchNotificacoes(): Promise<Notificacao[]> {
  const { data, error } = await supabase.from('notificacoes').select('*').order('criado_em', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id,
    titulo: n.titulo,
    mensagem: n.mensagem,
    tipo: n.tipo,
    lida: n.lida,
    criadoEm: toIso(n.criado_em),
    autorId: n.autor_id,
    autorNome: n.autor_nome,
  }));
}

export async function insertNotificacao(notif: Omit<Notificacao, 'id' | 'criadoEm'>): Promise<Notificacao> {
  const { data, error } = await supabase
    .from('notificacoes')
    .insert({
      titulo: notif.titulo,
      mensagem: notif.mensagem,
      tipo: notif.tipo,
      lida: notif.lida,
      autor_id: notif.autorId ?? null,
      autor_nome: notif.autorNome ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    titulo: data.titulo,
    mensagem: data.mensagem,
    tipo: data.tipo,
    lida: data.lida,
    criadoEm: toIso(data.criado_em),
    autorId: data.autor_id,
    autorNome: data.autor_nome,
  };
}

export async function markNotificacaoLida(id: UUID) {
  await supabase.from('notificacoes').update({ lida: true }).eq('id', id);
}

export async function markAllNotificacoesLidas() {
  await supabase.from('notificacoes').update({ lida: true }).eq('lida', false);
}

export async function clearNotificacoes() {
  await supabase.from('notificacoes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}
