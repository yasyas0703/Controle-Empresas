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

export async function fetchEmpresas(): Promise<Empresa[]> {
  // Batch-load: busca empresas e todos os relacionamentos em paralelo (evita N+1)
  // .limit(10000) para garantir que não caia no limite padrão de 1000 do Supabase
  const [empresasRes, allRetsRes, allDocsRes, allObsRes, allRespsRes] = await Promise.all([
    supabase.from('empresas').select('*').order('criado_em', { ascending: false }).limit(10000),
    supabase.from('rets').select('*').limit(10000),
    supabase.from('documentos').select('*').order('criado_em', { ascending: false }).limit(10000),
    supabase.from('observacoes').select('*').order('criado_em', { ascending: true }).limit(10000),
    supabase.from('responsaveis').select('*').limit(10000),
  ]);

  if (empresasRes.error) throw empresasRes.error;

  // Agrupar por empresa_id em memória
  const retsMap = new Map<string, RetItem[]>();
  for (const r of allRetsRes.data ?? []) {
    const list = retsMap.get(r.empresa_id) ?? [];
    list.push({ id: r.id, numeroPta: r.numero_pta, nome: r.nome, vencimento: r.vencimento, ultimaRenovacao: r.ultima_renovacao });
    retsMap.set(r.empresa_id, list);
  }

  const docsMap = new Map<string, DocumentoEmpresa[]>();
  for (const d of allDocsRes.data ?? []) {
    const list = docsMap.get(d.empresa_id) ?? [];
    list.push({ id: d.id, nome: d.nome, validade: d.validade, arquivoUrl: d.arquivo_url ?? undefined, criadoEm: toIso(d.criado_em), atualizadoEm: toIso(d.atualizado_em) });
    docsMap.set(d.empresa_id, list);
  }

  const obsMap = new Map<string, Observacao[]>();
  for (const o of allObsRes.data ?? []) {
    const list = obsMap.get(o.empresa_id) ?? [];
    list.push({ id: o.id, texto: o.texto, autorId: o.autor_id ?? '', autorNome: o.autor_nome, criadoEm: toIso(o.criado_em) });
    obsMap.set(o.empresa_id, list);
  }

  const respsMap = new Map<string, Record<UUID, UUID | null>>();
  console.log(`[DB DEBUG] fetchEmpresas: responsaveis carregados do banco: ${allRespsRes.data?.length ?? 0} registros, error: ${allRespsRes.error?.message ?? 'nenhum'}`);
  for (const r of allRespsRes.data ?? []) {
    const map = respsMap.get(r.empresa_id) ?? {};
    map[r.departamento_id] = r.usuario_id;
    respsMap.set(r.empresa_id, map);
  }

  return (empresasRes.data ?? []).map((e) => ({
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
  const { data, error } = await supabase
    .from('empresas')
    .insert({
      cadastrada: payload.cadastrada ?? false,
      cnpj: payload.cnpj || null,
      codigo: payload.codigo ?? '',
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

  const empresaId = data.id as string;

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
    // delete + insert (upsert com onConflict composto falha silenciosamente no Supabase)
    const { error: delError } = await supabase.from('responsaveis').delete().eq('empresa_id', empresaId);
    if (delError) console.error(`[DB DEBUG] Delete responsáveis falhou:`, delError.message);
    const { data: respData, error: respError } = await supabase
      .from('responsaveis')
      .insert(rows)
      .select();
    console.log(`[DB DEBUG] Insert responsáveis resultado: data =`, respData?.length ?? 0, 'registros, error =', respError?.message ?? 'nenhum');
    if (respError) {
      console.warn('[DB DEBUG] Batch insert de responsáveis falhou, tentando inserts individuais:', respError.message);
      for (const row of rows) {
        const { data: indData, error: indErr } = await supabase
          .from('responsaveis')
          .insert(row)
          .select();
        console.log(`[DB DEBUG] Insert individual dept=${row.departamento_id}: data =`, indData, 'error =', indErr?.message ?? 'ok');
        if (indErr) console.error(`Falha ao inserir responsável dept=${row.departamento_id}:`, indErr.message);
      }
    }
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

  // Atualizar responsáveis se fornecidos (delete + insert é mais confiável que upsert com constraint composta)
  if (patch.responsaveis !== undefined) {
    const rows = Object.entries(patch.responsaveis).map(([depId, userId]) => ({
      empresa_id: id,
      departamento_id: depId,
      usuario_id: userId || null,
    }));
    // Sempre limpar e reinserir para garantir consistência
    await supabase.from('responsaveis').delete().eq('empresa_id', id);
    if (rows.length > 0) {
      const { error: respError } = await supabase
        .from('responsaveis')
        .insert(rows);
      if (respError) {
        console.warn('Batch insert de responsáveis falhou, tentando individuais:', respError.message);
        for (const row of rows) {
          const { error: e } = await supabase
            .from('responsaveis')
            .insert(row);
          if (e) console.error(`Resp insert falhou dept=${row.departamento_id}:`, e.message);
        }
      }
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
