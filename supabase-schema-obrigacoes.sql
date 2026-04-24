-- ============================================================
-- Controle Triar — Módulo Obrigações (tarefas recorrentes)
-- Cole no SQL Editor do Supabase quando quiser sair do localStorage.
-- Assume que o schema base (supabase-schema.sql) já foi executado,
-- pois depende das funções public.is_active_user(), is_manager(),
-- is_admin() e can_access_empresa().
-- ============================================================

-- ============================================================
-- 1. obrigacoes
--    Template configurável de uma tarefa recorrente
-- ============================================================
create table if not exists obrigacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text,
  departamento text not null check (departamento in ('fiscal', 'pessoal', 'contabil', 'cadastro')),
  esfera text not null default 'federal' check (esfera in ('federal', 'estadual', 'municipal', 'interna')),
  frequencia text not null check (
    frequencia in ('mensal', 'bimestral', 'trimestral', 'quadrimestral', 'semestral', 'anual', 'eventual')
  ),
  -- Prazo oficial e prazo interno (meta)
  tipo_data_legal text not null default 'dia_util' check (tipo_data_legal in ('dia_util', 'dia_corrido', 'dia_fixo')),
  dia_data_legal int not null default 20 check (dia_data_legal between 1 and 31),
  tipo_data_meta text not null default 'dia_util' check (tipo_data_meta in ('dia_util', 'dia_corrido', 'dia_fixo')),
  dia_data_meta int not null default 15 check (dia_data_meta between 1 and 31),
  -- Competência em relação ao mês de geração. -1 = competência é o mês anterior
  competencia_offset int not null default -1,
  pontuacao int not null default 1,
  agrupador text,
  notificar_cliente boolean not null default true,
  gera_multa boolean not null default true,
  auto_concluir boolean not null default true,
  -- Palavras-chave usadas para reconhecimento automático do PDF
  palavras_chave text[] not null default '{}',
  template_email_assunto text,
  template_email_corpo text,
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_obrigacoes_departamento on obrigacoes (departamento);
create index if not exists idx_obrigacoes_ativo on obrigacoes (ativo);

-- ============================================================
-- 2. obrigacao_empresas
--    Vínculo N:N entre obrigação e empresa
-- ============================================================
create table if not exists obrigacao_empresas (
  obrigacao_id uuid not null references obrigacoes(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (obrigacao_id, empresa_id)
);

create index if not exists idx_oe_empresa on obrigacao_empresas (empresa_id);

-- ============================================================
-- 3. obrigacao_tarefas
--    Tarefas geradas por competência (uma linha por empresa+obrigação+mês)
-- ============================================================
create table if not exists obrigacao_tarefas (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid not null references obrigacoes(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  competencia text not null, -- formato 'YYYY-MM'
  data_legal date,
  data_meta date,
  status text not null default 'aberta' check (
    status in ('aberta', 'em_andamento', 'aguardando_cliente', 'concluida', 'atrasada', 'cancelada')
  ),
  responsavel_id uuid references usuarios(id) on delete set null,
  concluida_em timestamptz,
  concluida_por_id uuid references usuarios(id) on delete set null,
  arquivo_url text,         -- caminho no Storage da guia enviada
  vencimento_detectado date,
  competencia_detectada text,
  valor_detectado numeric(14,2),
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obrigacao_id, empresa_id, competencia)
);

create index if not exists idx_tarefas_empresa on obrigacao_tarefas (empresa_id);
create index if not exists idx_tarefas_competencia on obrigacao_tarefas (competencia);
create index if not exists idx_tarefas_status on obrigacao_tarefas (status);
create index if not exists idx_tarefas_responsavel on obrigacao_tarefas (responsavel_id);

-- ============================================================
-- 4. obrigacao_envios
--    Histórico de envios de guias por email (tracking de abertura)
-- ============================================================
create table if not exists obrigacao_envios (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references obrigacao_tarefas(id) on delete cascade,
  enviado_por_id uuid references usuarios(id) on delete set null,
  remetente_email text,         -- email do login do usuário que enviou (pode ser OAuth Gmail)
  destinatarios text[] not null default '{}',
  cc text[] not null default '{}',
  assunto text,
  corpo text,
  arquivo_url text,             -- guia enviada
  tracking_id uuid not null default gen_random_uuid(), -- usado no pixel + link
  enviado_em timestamptz not null default now(),
  -- Tracking
  aberto_em timestamptz,
  ultimo_aberto_em timestamptz,
  total_aberturas int not null default 0,
  clicado_em timestamptz,
  ultimo_clicado_em timestamptz,
  total_cliques int not null default 0,
  bounce boolean not null default false,
  erro text,
  user_agent_abertura text,
  ip_abertura text
);

create index if not exists idx_envios_tarefa on obrigacao_envios (tarefa_id);
create index if not exists idx_envios_tracking on obrigacao_envios (tracking_id);

-- ============================================================
-- 5. RLS
--    Admin/ghost gerencia templates; qualquer usuário ativo vê
--    e pode trabalhar nas tarefas da empresa a que tem acesso
-- ============================================================
alter table obrigacoes enable row level security;
alter table obrigacao_empresas enable row level security;
alter table obrigacao_tarefas enable row level security;
alter table obrigacao_envios enable row level security;

-- Templates: todos ativos leem, só admin escreve
drop policy if exists obrigacoes_select on obrigacoes;
drop policy if exists obrigacoes_write on obrigacoes;
create policy obrigacoes_select on obrigacoes
  for select using (public.is_active_user());
create policy obrigacoes_write on obrigacoes
  for all using (public.is_admin())
  with check (public.is_admin());

-- Vínculos: mesma regra dos templates
drop policy if exists obrigacao_empresas_select on obrigacao_empresas;
drop policy if exists obrigacao_empresas_write on obrigacao_empresas;
create policy obrigacao_empresas_select on obrigacao_empresas
  for select using (public.is_active_user());
create policy obrigacao_empresas_write on obrigacao_empresas
  for all using (public.is_admin())
  with check (public.is_admin());

-- Tarefas: usuário ativo lê; escreve quem tem acesso à empresa
drop policy if exists obrigacao_tarefas_select on obrigacao_tarefas;
drop policy if exists obrigacao_tarefas_write on obrigacao_tarefas;
create policy obrigacao_tarefas_select on obrigacao_tarefas
  for select using (public.is_active_user());
create policy obrigacao_tarefas_write on obrigacao_tarefas
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

-- Envios: herdam o acesso da tarefa
drop policy if exists obrigacao_envios_select on obrigacao_envios;
drop policy if exists obrigacao_envios_write on obrigacao_envios;
create policy obrigacao_envios_select on obrigacao_envios
  for select using (public.is_active_user());
create policy obrigacao_envios_write on obrigacao_envios
  for all using (
    exists (
      select 1 from obrigacao_tarefas t
      where t.id = obrigacao_envios.tarefa_id
        and public.can_access_empresa(t.empresa_id)
    )
  ) with check (
    exists (
      select 1 from obrigacao_tarefas t
      where t.id = obrigacao_envios.tarefa_id
        and public.can_access_empresa(t.empresa_id)
    )
  );
