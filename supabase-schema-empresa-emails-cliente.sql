-- ============================================================
-- Lista de e-mails de destinatários do cliente (uso em obrigações)
-- Cada empresa pode ter vários e-mails (financeiro@, fiscal@, etc)
-- Cadastro restrito a admin/manager.
-- ============================================================

create table if not exists empresa_emails_cliente (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  email text not null,
  rotulo text,                 -- ex: "Financeiro", "Sócio", "Contato"
  principal boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, email)
);

create index if not exists idx_empresa_emails_empresa on empresa_emails_cliente (empresa_id);
create index if not exists idx_empresa_emails_ativo on empresa_emails_cliente (empresa_id, ativo);

-- Trigger reusa função set_atualizado_em (definida no schema do controle contábil)
drop trigger if exists trg_empresa_emails_atualizado on empresa_emails_cliente;
create trigger trg_empresa_emails_atualizado
  before update on empresa_emails_cliente
  for each row execute function set_atualizado_em();

alter table empresa_emails_cliente enable row level security;

-- Leitura: qualquer usuário ativo (precisa pra preview de envio)
drop policy if exists empresa_emails_select on empresa_emails_cliente;
create policy empresa_emails_select on empresa_emails_cliente
  for select using (public.is_active_user());

-- Escrita: só admin/manager
drop policy if exists empresa_emails_write on empresa_emails_cliente;
create policy empresa_emails_write on empresa_emails_cliente
  for all using (public.is_manager())
  with check (public.is_manager());
