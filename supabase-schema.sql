-- ============================================================
-- Controle Triar — Script de criação de tabelas (Supabase)
-- Cole tudo no SQL Editor do Supabase e clique "Run"
-- ============================================================

-- 1. Departamentos
create table departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 2. Usuários
create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  role text not null default 'usuario' check (role in ('admin', 'gerente', 'usuario')),
  departamento_id uuid references departamentos(id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 3. Serviços
create table servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

-- 4. Empresas
create table empresas (
  id uuid primary key default gen_random_uuid(),
  cadastrada boolean not null default false,
  cnpj text,
  codigo text not null default '',
  razao_social text,
  apelido text,
  data_abertura text,
  tipo_estabelecimento text not null default '' check (tipo_estabelecimento in ('', 'matriz', 'filial')),
  tipo_inscricao text not null default '' check (tipo_inscricao in ('', 'CNPJ', 'CPF', 'MEI', 'CEI', 'CAEPF', 'CNO')),
  servicos text[] not null default '{}',
  possui_ret boolean not null default false,
  inscricao_estadual text,
  inscricao_municipal text,
  regime_federal text,
  regime_estadual text,
  regime_municipal text,
  estado text,
  cidade text,
  bairro text,
  logradouro text,
  numero text,
  cep text,
  email text,
  telefone text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 5. RETs (vinculados a empresa)
create table rets (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  numero_pta text not null,
  nome text not null,
  vencimento date not null,
  ultima_renovacao date
);

-- 6. Responsáveis (empresa <-> departamento -> usuário)
create table responsaveis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  departamento_id uuid not null references departamentos(id) on delete cascade,
  usuario_id uuid references usuarios(id) on delete set null,
  unique(empresa_id, departamento_id)
);

-- 7. Documentos de empresa
create table documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  validade date not null,
  arquivo_url text,
  departamentos_ids uuid[] not null default '{}',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 8. Observações (chat interno da empresa)
create table observacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  texto text not null,
  autor_id uuid references usuarios(id) on delete set null,
  autor_nome text not null,
  criado_em timestamptz not null default now()
);

-- 9. Logs de auditoria
create table logs (
  id uuid primary key default gen_random_uuid(),
  em timestamptz not null default now(),
  user_id uuid references usuarios(id) on delete set null,
  user_nome text,
  action text not null check (action in ('login', 'logout', 'create', 'update', 'delete', 'alert')),
  entity text not null check (entity in ('empresa', 'usuario', 'departamento', 'documento', 'ret', 'notificacao')),
  entity_id uuid,
  message text not null,
  diff jsonb
);

-- 10. Lixeira (itens excluídos: empresas, documentos, observações)
create table lixeira (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'empresa' check (tipo in ('empresa', 'documento', 'observacao')),
  empresa_data jsonb not null,
  documento_data jsonb,
  observacao_data jsonb,
  empresa_id uuid,
  excluido_por_id uuid references usuarios(id) on delete set null,
  excluido_por_nome text not null,
  excluido_em timestamptz not null default now()
);

-- 11. Notificações (lidas_por: array de user IDs que já leram)
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensagem text not null,
  tipo text not null default 'info' check (tipo in ('info', 'sucesso', 'aviso', 'erro')),
  lida boolean not null default false,
  lidas_por uuid[] not null default '{}',
  empresa_id uuid references empresas(id) on delete set null,
  destinatarios uuid[] not null default '{}',
  criado_em timestamptz not null default now(),
  autor_id uuid references usuarios(id) on delete set null,
  autor_nome text
);

-- ============================================================
-- Seed: Departamentos e perfil Admin padrão
-- OBS: o LOGIN (email/senha) é criado no Supabase Auth.
-- A tabela public.usuarios guarda apenas o perfil (role/ativo/departamento).
-- ============================================================

insert into departamentos (nome) values
  ('Cadastro'),
  ('Fiscal'),
  ('Contábil');

insert into usuarios (nome, email, role) values
  ('Yasmin', 'yasmin@triarcontabilidade.com.br', 'gerente');

-- ============================================================
-- Índices para performance
-- ============================================================
create index idx_empresas_codigo on empresas(codigo);
create index idx_empresas_cnpj on empresas(cnpj);
create index idx_documentos_empresa on documentos(empresa_id);
create index idx_observacoes_empresa on observacoes(empresa_id);
create index idx_rets_empresa on rets(empresa_id);
create index idx_responsaveis_empresa on responsaveis(empresa_id);
create index idx_logs_em on logs(em desc);
create index idx_notificacoes_criado on notificacoes(criado_em desc);
create index idx_lixeira_excluido on lixeira(excluido_em desc);

-- ============================================================
-- Storage: Bucket para documentos
-- OBS: Se preferir criar manualmente, vá em Storage no Supabase
-- e crie um bucket "documentos" com acesso público.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', true, 10485760)
on conflict (id) do nothing;

-- Policy: qualquer usuário autenticado pode fazer upload
drop policy if exists "Authenticated users can upload docs" on storage.objects;
create policy "Authenticated users can upload docs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documentos');

-- Policy: qualquer um pode ver (bucket público)
drop policy if exists "Public read access for docs" on storage.objects;
create policy "Public read access for docs"
  on storage.objects for select
  to public
  using (bucket_id = 'documentos');

-- Policy: usuários autenticados podem deletar seus uploads
drop policy if exists "Authenticated users can delete docs" on storage.objects;
create policy "Authenticated users can delete docs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documentos');

-- ============================================================
-- RLS (Row Level Security) — desabilitado para simplicidade
-- Se quiser habilitar depois, configure policies adequadas
-- ============================================================
alter table departamentos enable row level security;
alter table usuarios enable row level security;
alter table servicos enable row level security;
alter table empresas enable row level security;
alter table rets enable row level security;
alter table responsaveis enable row level security;
alter table documentos enable row level security;
alter table observacoes enable row level security;
alter table logs enable row level security;
alter table lixeira enable row level security;
alter table notificacoes enable row level security;

-- ============================================================
-- Segurança máxima (RLS):
-- - Bloqueia acesso anônimo
-- - Exige usuário autenticado e ativo
-- - Gerente (role='gerente') pode gerenciar cadastros globais
-- - Usuário comum vê/edita apenas empresas onde é responsável
-- ============================================================

-- Helper: usuário ativo
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.usuarios u
    where u.id = auth.uid()
      and u.ativo = true
  );
$$;

-- Helper: gerente
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.usuarios u
    where u.id = auth.uid()
      and u.ativo = true
      and (u.role = 'gerente' or u.role = 'admin')
  );
$$;

-- Helper: usuário pode acessar uma empresa (gerente ou responsável)
create or replace function public.can_access_empresa(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager()
     or exists(
        select 1 from public.responsaveis r
        where r.empresa_id = eid
          and r.usuario_id = auth.uid()
     );
$$;

-- Trigger: cria/garante perfil em public.usuarios ao criar usuário no Auth
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Se já existe registro com esse email (do seed), vincula o id do Auth
  update public.usuarios set id = new.id
    where email = new.email and id != new.id;

  -- Se não existe, insere novo
  insert into public.usuarios (id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1), 'Usuário'),
    new.email,
    'usuario',
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- =====================
-- Policies
-- =====================

-- Departamentos: leitura para autenticados; escrita só gerente
drop policy if exists departamentos_select on departamentos;
drop policy if exists departamentos_write on departamentos;
create policy departamentos_select on departamentos
  for select using (public.is_active_user());
create policy departamentos_write on departamentos
  for insert with check (public.is_manager())
  ;
create policy departamentos_update on departamentos
  for update using (public.is_manager()) with check (public.is_manager());
create policy departamentos_delete on departamentos
  for delete using (public.is_manager());

-- Serviços: leitura para autenticados; escrita só gerente
drop policy if exists servicos_select on servicos;
drop policy if exists servicos_write on servicos;
create policy servicos_select on servicos
  for select using (public.is_active_user());
create policy servicos_insert on servicos
  for insert with check (public.is_manager());
create policy servicos_update on servicos
  for update using (public.is_manager()) with check (public.is_manager());
create policy servicos_delete on servicos
  for delete using (public.is_manager());

-- Usuários (perfil): cada usuário lê apenas o próprio perfil
drop policy if exists usuarios_self_select on usuarios;
create policy usuarios_self_select on usuarios
  for select using (auth.uid() = id);

-- Empresas: qualquer usuário ativo pode visualizar; editar só gerente/responsável; criar/excluir só gerente
drop policy if exists empresas_select on empresas;
drop policy if exists empresas_insert on empresas;
drop policy if exists empresas_update on empresas;
drop policy if exists empresas_delete on empresas;
create policy empresas_select on empresas
  for select using (public.is_active_user());
create policy empresas_insert on empresas
  for insert with check (public.is_manager());
create policy empresas_update on empresas
  for update using (public.can_access_empresa(id))
  with check (public.can_access_empresa(id));
create policy empresas_delete on empresas
  for delete using (public.is_manager());

-- Responsáveis: qualquer usuário ativo pode ler; gerente gerencia escrita
drop policy if exists responsaveis_select on responsaveis;
drop policy if exists responsaveis_write on responsaveis;
create policy responsaveis_select on responsaveis
  for select using (public.is_active_user());
create policy responsaveis_insert on responsaveis
  for insert with check (public.is_manager());
create policy responsaveis_update on responsaveis
  for update using (public.is_manager()) with check (public.is_manager());
create policy responsaveis_delete on responsaveis
  for delete using (public.is_manager());

-- RETs: qualquer usuário ativo pode ler; escrita apenas para quem acessa a empresa
drop policy if exists rets_all on rets;
drop policy if exists rets_select on rets;
drop policy if exists rets_write on rets;
create policy rets_select on rets
  for select using (public.is_active_user());
create policy rets_write on rets
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

drop policy if exists documentos_all on documentos;
drop policy if exists documentos_select on documentos;
drop policy if exists documentos_write on documentos;
create policy documentos_select on documentos
  for select using (public.is_active_user());
create policy documentos_write on documentos
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

drop policy if exists observacoes_all on observacoes;
drop policy if exists observacoes_select on observacoes;
drop policy if exists observacoes_write on observacoes;
create policy observacoes_select on observacoes
  for select using (public.is_active_user());
create policy observacoes_write on observacoes
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

-- Logs: qualquer autenticado pode inserir e ler (filtro de visível é no app)
drop policy if exists logs_insert on logs;
drop policy if exists logs_select on logs;
create policy logs_insert on logs
  for insert with check (public.is_active_user());
create policy logs_select on logs
  for select using (public.is_active_user());

-- Lixeira: somente gerente
drop policy if exists lixeira_all on lixeira;
create policy lixeira_all on lixeira
  for all using (public.is_manager())
  with check (public.is_manager());

-- Notificações: autenticados podem ler/escrever (são globais no app atual)
drop policy if exists notificacoes_all on notificacoes;
create policy notificacoes_all on notificacoes
  for all using (public.is_active_user())
  with check (public.is_active_user());
