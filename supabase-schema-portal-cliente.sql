-- ============================================================
-- Controle Triar — Portal do Cliente (Fase 1: banco de dados)
-- Cole tudo no SQL Editor do Supabase e clique "Run".
-- ============================================================
--
-- Cria as estruturas pro portal do cliente:
--   - clientes_portal           perfil do cliente (1 login por CNPJ/empresa)
--   - portal_documentos         guias publicadas pro cliente
--   - portal_acessos            log de cada ação do cliente (auditoria)
--   - portal_comprovantes       comprovantes de pagamento (upload opcional)
--   - portal_push_subscriptions tokens de notificação push (PWA)
--
-- Auth: cliente é criado via Supabase Auth com
--   raw_user_meta_data = { tipo: 'cliente_portal', empresa_id: '<uuid>' }
-- O trigger handle_new_auth_user foi atualizado pra rotear o INSERT
-- pra `clientes_portal` em vez de `usuarios` quando o tipo for cliente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. clientes_portal
-- ------------------------------------------------------------
create table if not exists clientes_portal (
  id uuid primary key,                         -- = auth.users.id
  empresa_id uuid not null references empresas(id) on delete cascade,
  email text not null unique,
  nome_contato text,
  telefone text,
  ativo boolean not null default true,
  ultimo_login_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Apenas 1 cliente ativo por empresa (decisão: 1 login por CNPJ).
-- Se quiser permitir múltiplos no futuro, basta remover esse index.
create unique index if not exists uq_clientes_portal_empresa_ativo
  on clientes_portal (empresa_id) where ativo = true;

create index if not exists idx_clientes_portal_empresa on clientes_portal (empresa_id);
create index if not exists idx_clientes_portal_email on clientes_portal (lower(email));

drop trigger if exists trg_clientes_portal_atualizado on clientes_portal;
create trigger trg_clientes_portal_atualizado
  before update on clientes_portal
  for each row execute function set_atualizado_em();


-- ------------------------------------------------------------
-- 2. portal_documentos
-- ------------------------------------------------------------
-- Cada linha = uma guia disponibilizada no portal pra empresa.
-- Pode ter sido enviada por email tb (campo `enviado_email`),
-- mas o portal é a fonte da verdade pra prova de acesso.
create table if not exists portal_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  checklist_fiscal_id uuid references checklist_fiscal(id) on delete set null,

  obrigacao_nome text not null,                -- "DARF", "GPS", "ICMS"...
  competencia text,                            -- "2026-05" (YYYY-MM)
  vencimento date,
  descricao text,

  arquivo_storage_path text not null,          -- ex: empresas/{id}/{uuid}.pdf
  arquivo_nome_original text not null,
  arquivo_mime text,
  arquivo_tamanho_bytes integer,

  enviado_email boolean not null default false,
  enviado_email_em timestamptz,

  -- Estado agregado (cache derivado de portal_acessos pra perf no painel)
  visualizado_em timestamptz,
  baixado_em timestamptz,
  marcado_pago_em timestamptz,

  criado_por_usuario_id uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_portal_documentos_empresa on portal_documentos (empresa_id);
create index if not exists idx_portal_documentos_checklist on portal_documentos (checklist_fiscal_id);
create index if not exists idx_portal_documentos_competencia on portal_documentos (competencia);
create index if not exists idx_portal_documentos_vencimento on portal_documentos (vencimento);

drop trigger if exists trg_portal_documentos_atualizado on portal_documentos;
create trigger trg_portal_documentos_atualizado
  before update on portal_documentos
  for each row execute function set_atualizado_em();


-- ------------------------------------------------------------
-- 3. portal_acessos
-- ------------------------------------------------------------
-- Log append-only de ações do cliente. Histórico imutável.
create table if not exists portal_acessos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes_portal(id) on delete cascade,
  documento_id uuid references portal_documentos(id) on delete cascade,

  acao text not null check (acao in (
    'login',
    'logout',
    'visualizou',
    'baixou',
    'marcou_pago',
    'desmarcou_pago',
    'enviou_comprovante'
  )),

  ip text,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_portal_acessos_cliente on portal_acessos (cliente_id);
create index if not exists idx_portal_acessos_documento on portal_acessos (documento_id);
create index if not exists idx_portal_acessos_criado on portal_acessos (criado_em desc);
create index if not exists idx_portal_acessos_doc_acao on portal_acessos (documento_id, acao);


-- ------------------------------------------------------------
-- 4. portal_comprovantes
-- ------------------------------------------------------------
-- Comprovantes de pagamento (upload opcional pelo cliente
-- quando ele clica em "marquei como pago").
create table if not exists portal_comprovantes (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references portal_documentos(id) on delete cascade,
  cliente_id uuid not null references clientes_portal(id) on delete cascade,

  arquivo_storage_path text not null,
  arquivo_nome_original text not null,
  arquivo_mime text,
  arquivo_tamanho_bytes integer,

  criado_em timestamptz not null default now()
);

create index if not exists idx_portal_comprovantes_documento on portal_comprovantes (documento_id);
create index if not exists idx_portal_comprovantes_cliente on portal_comprovantes (cliente_id);


-- ------------------------------------------------------------
-- 5. portal_push_subscriptions (PWA — Fase 7)
-- ------------------------------------------------------------
-- Tokens de Web Push (gratuito, padrão W3C). Um cliente pode ter
-- vários (celular, desktop, tablet) — não restringimos.
create table if not exists portal_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes_portal(id) on delete cascade,

  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  user_agent text,
  ultimo_uso_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists idx_portal_push_cliente on portal_push_subscriptions (cliente_id);


-- ============================================================
-- Helpers de RLS específicos do portal
-- ============================================================

-- Retorna true se o auth.uid() corrente é um cliente do portal ativo.
create or replace function public.is_active_cliente_portal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.clientes_portal c
    where c.id = auth.uid()
      and c.ativo = true
  );
$$;

-- Retorna o empresa_id do cliente logado (ou null).
create or replace function public.cliente_portal_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.empresa_id
    from public.clientes_portal c
   where c.id = auth.uid()
     and c.ativo = true
   limit 1;
$$;


-- ============================================================
-- Trigger handle_new_auth_user — atualizado pra rotear clientes
-- ============================================================
-- O trigger original só criava em `usuarios`. Agora, se
-- raw_user_meta_data.tipo = 'cliente_portal', cria em
-- `clientes_portal` em vez disso.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_empresa_id uuid;
begin
  v_tipo := nullif(new.raw_user_meta_data->>'tipo', '');

  -- Roteia pro portal do cliente
  if v_tipo = 'cliente_portal' then
    v_empresa_id := nullif(new.raw_user_meta_data->>'empresa_id', '')::uuid;
    if v_empresa_id is null then
      raise exception 'cliente_portal precisa de empresa_id no raw_user_meta_data';
    end if;

    insert into public.clientes_portal (id, empresa_id, email, nome_contato, ativo)
    values (
      new.id,
      v_empresa_id,
      new.email,
      coalesce(nullif(new.raw_user_meta_data->>'nome_contato', ''), null),
      true
    )
    on conflict (id) do nothing;

    return new;
  end if;

  -- Comportamento original: usuário interno
  update public.usuarios set id = new.id
    where email = new.email and id != new.id;

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


-- ============================================================
-- RLS — habilitando e configurando policies
-- ============================================================

alter table clientes_portal enable row level security;
alter table portal_documentos enable row level security;
alter table portal_acessos enable row level security;
alter table portal_comprovantes enable row level security;
alter table portal_push_subscriptions enable row level security;


-- ---- clientes_portal ----
-- O próprio cliente vê e atualiza só o próprio perfil.
-- Usuários internos ativos (meninas do escritório) podem ver/gerenciar.
drop policy if exists clientes_portal_self_select on clientes_portal;
drop policy if exists clientes_portal_self_update on clientes_portal;
drop policy if exists clientes_portal_internal_select on clientes_portal;
drop policy if exists clientes_portal_internal_write on clientes_portal;

create policy clientes_portal_self_select on clientes_portal
  for select using (auth.uid() = id);

create policy clientes_portal_self_update on clientes_portal
  for update using (auth.uid() = id)
  with check (auth.uid() = id and ativo = true);

create policy clientes_portal_internal_select on clientes_portal
  for select using (public.is_active_user());

create policy clientes_portal_internal_write on clientes_portal
  for all using (public.is_manager())
  with check (public.is_manager());


-- ---- portal_documentos ----
-- Cliente vê só os documentos da empresa dele.
-- Usuários internos veem tudo conforme acesso à empresa.
-- Inserção/edição: só usuários internos com acesso à empresa.
drop policy if exists portal_documentos_cliente_select on portal_documentos;
drop policy if exists portal_documentos_cliente_update on portal_documentos;
drop policy if exists portal_documentos_internal_select on portal_documentos;
drop policy if exists portal_documentos_internal_write on portal_documentos;

create policy portal_documentos_cliente_select on portal_documentos
  for select using (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
  );

-- Cliente pode atualizar APENAS os campos de status (marcado_pago_em, etc).
-- A restrição fina dos campos é feita na API; aqui só garantimos que
-- ele só toca em documentos da própria empresa.
create policy portal_documentos_cliente_update on portal_documentos
  for update using (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
  )
  with check (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
  );

create policy portal_documentos_internal_select on portal_documentos
  for select using (public.is_active_user());

create policy portal_documentos_internal_write on portal_documentos
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));


-- ---- portal_acessos ----
-- Cliente vê só os próprios acessos. Insert: cliente cria os próprios,
-- usuários internos podem inserir manualmente (raro, p/ auditoria).
-- Update/delete: ninguém via cliente (log imutável). Service role bypassa.
drop policy if exists portal_acessos_cliente_select on portal_acessos;
drop policy if exists portal_acessos_cliente_insert on portal_acessos;
drop policy if exists portal_acessos_internal_select on portal_acessos;
drop policy if exists portal_acessos_internal_insert on portal_acessos;

create policy portal_acessos_cliente_select on portal_acessos
  for select using (cliente_id = auth.uid());

create policy portal_acessos_cliente_insert on portal_acessos
  for insert with check (
    cliente_id = auth.uid()
    and public.is_active_cliente_portal()
  );

create policy portal_acessos_internal_select on portal_acessos
  for select using (public.is_active_user());

create policy portal_acessos_internal_insert on portal_acessos
  for insert with check (public.is_active_user());


-- ---- portal_comprovantes ----
drop policy if exists portal_comprovantes_cliente_select on portal_comprovantes;
drop policy if exists portal_comprovantes_cliente_insert on portal_comprovantes;
drop policy if exists portal_comprovantes_cliente_delete on portal_comprovantes;
drop policy if exists portal_comprovantes_internal_select on portal_comprovantes;

create policy portal_comprovantes_cliente_select on portal_comprovantes
  for select using (cliente_id = auth.uid());

create policy portal_comprovantes_cliente_insert on portal_comprovantes
  for insert with check (
    cliente_id = auth.uid()
    and public.is_active_cliente_portal()
  );

create policy portal_comprovantes_cliente_delete on portal_comprovantes
  for delete using (cliente_id = auth.uid());

create policy portal_comprovantes_internal_select on portal_comprovantes
  for select using (public.is_active_user());


-- ---- portal_push_subscriptions ----
drop policy if exists portal_push_cliente_all on portal_push_subscriptions;
drop policy if exists portal_push_internal_select on portal_push_subscriptions;

create policy portal_push_cliente_all on portal_push_subscriptions
  for all using (cliente_id = auth.uid())
  with check (cliente_id = auth.uid() and public.is_active_cliente_portal());

create policy portal_push_internal_select on portal_push_subscriptions
  for select using (public.is_active_user());


-- ============================================================
-- Storage: buckets PRIVADOS pro portal (acesso só via signed URL)
-- ============================================================

-- 1) Documentos (guias enviadas pelas meninas)
insert into storage.buckets (id, name, public, file_size_limit)
values ('portal-documentos', 'portal-documentos', false, 10485760)
on conflict (id) do nothing;

-- 2) Comprovantes (upload feito pelo cliente)
insert into storage.buckets (id, name, public, file_size_limit)
values ('portal-comprovantes', 'portal-comprovantes', false, 10485760)
on conflict (id) do nothing;


-- Policies dos buckets ----------------------------------------

-- portal-documentos:
--   - Upload: usuários internos ativos (as meninas)
--   - Leitura: usuários internos + clientes (via signed URL é o normal,
--     mas deixamos select pra service role e pra debug interno)
--   - Delete: só gerente
drop policy if exists "portal-documentos upload (interno)" on storage.objects;
drop policy if exists "portal-documentos read (interno)" on storage.objects;
drop policy if exists "portal-documentos delete (gerente)" on storage.objects;

create policy "portal-documentos upload (interno)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'portal-documentos' and public.is_active_user());

create policy "portal-documentos read (interno)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'portal-documentos' and public.is_active_user());

create policy "portal-documentos delete (gerente)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'portal-documentos' and public.is_manager());


-- portal-comprovantes:
--   - Upload: cliente do portal (apenas) — pasta deve começar com o id dele
--   - Leitura: cliente vê os próprios; usuário interno vê todos
--   - Delete: cliente pode remover os próprios
drop policy if exists "portal-comprovantes upload (cliente)" on storage.objects;
drop policy if exists "portal-comprovantes read (cliente)" on storage.objects;
drop policy if exists "portal-comprovantes read (interno)" on storage.objects;
drop policy if exists "portal-comprovantes delete (cliente)" on storage.objects;

create policy "portal-comprovantes upload (cliente)"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'portal-comprovantes'
    and public.is_active_cliente_portal()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "portal-comprovantes read (cliente)"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'portal-comprovantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "portal-comprovantes read (interno)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'portal-comprovantes' and public.is_active_user());

create policy "portal-comprovantes delete (cliente)"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'portal-comprovantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- Policy extra: cliente do portal pode ler a PRÓPRIA empresa
-- ============================================================
-- A policy original `empresas_select` só libera pra usuários internos.
-- Adicionamos uma policy paralela (RLS faz OR entre policies) pro
-- cliente conseguir ler dados básicos da empresa dele (razão social,
-- CNPJ, etc) — necessário pro cabeçalho do portal.
drop policy if exists empresas_cliente_portal_select on empresas;
create policy empresas_cliente_portal_select on empresas
  for select using (
    public.is_active_cliente_portal()
    and id = public.cliente_portal_empresa_id()
  );


-- ============================================================
-- Pronto! Próximo passo: Fase 2 (auth do cliente na app).
-- ============================================================
