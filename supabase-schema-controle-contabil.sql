-- ============================================================
-- Controle Contábil — Extratos Bancários
-- Rodar no SQL Editor do Supabase (uma vez).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Coluna `tributacao` em empresas (Lucro Real / Presumido / Simples)
-- ------------------------------------------------------------
alter table empresas
  add column if not exists tributacao text
    check (tributacao in ('lucro_real', 'lucro_presumido', 'simples_nacional'));

-- Backfill best-effort a partir de regime_federal
update empresas
set tributacao = case
  when lower(coalesce(regime_federal, '')) like '%real%' then 'lucro_real'
  when lower(coalesce(regime_federal, '')) like '%presumido%' then 'lucro_presumido'
  when lower(coalesce(regime_federal, '')) like '%simples%' then 'simples_nacional'
  else null
end
where tributacao is null;

create index if not exists idx_empresas_tributacao on empresas(tributacao);

-- ------------------------------------------------------------
-- 2. Contas bancárias (uma empresa, N bancos)
-- ------------------------------------------------------------
create table if not exists contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  agencia text,
  conta text,
  ordem int not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_contas_bancarias_empresa on contas_bancarias(empresa_id);
create index if not exists idx_contas_bancarias_ativo on contas_bancarias(empresa_id, ativo);

alter table contas_bancarias enable row level security;
drop policy if exists contas_bancarias_select on contas_bancarias;
drop policy if exists contas_bancarias_write on contas_bancarias;
create policy contas_bancarias_select on contas_bancarias
  for select using (public.is_active_user());
create policy contas_bancarias_write on contas_bancarias
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

-- ------------------------------------------------------------
-- 3. Controle contábil de extratos (status banco × mês)
--   Linha ausente   => branco (sem extrato/sem cobrança)
--   recebido_pendente => laranja (recebeu mas não fez)
--   feito           => verde (conferido / extrato anexado)
-- ------------------------------------------------------------
create table if not exists controle_contabil_extratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  conta_bancaria_id uuid not null references contas_bancarias(id) on delete cascade,
  mes text not null,
  status text not null check (status in ('feito', 'recebido_pendente')),
  marcado_por_id uuid references usuarios(id) on delete set null,
  marcado_por_nome text,
  marcado_em timestamptz not null default now(),
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (conta_bancaria_id, mes)
);

create index if not exists idx_cce_empresa_mes on controle_contabil_extratos(empresa_id, mes);
create index if not exists idx_cce_conta on controle_contabil_extratos(conta_bancaria_id);
create index if not exists idx_cce_mes on controle_contabil_extratos(mes);

alter table controle_contabil_extratos enable row level security;
drop policy if exists cce_select on controle_contabil_extratos;
drop policy if exists cce_write on controle_contabil_extratos;
create policy cce_select on controle_contabil_extratos
  for select using (public.is_active_user());
create policy cce_write on controle_contabil_extratos
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

-- ------------------------------------------------------------
-- 4. Extratos (arquivos) — central que NÃO some quando desmarca
-- ------------------------------------------------------------
create table if not exists extratos_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  conta_bancaria_id uuid not null references contas_bancarias(id) on delete cascade,
  mes text not null,
  arquivo_path text not null,
  arquivo_nome text not null,
  tamanho_bytes bigint,
  uploaded_por_id uuid references usuarios(id) on delete set null,
  uploaded_por_nome text,
  uploaded_em timestamptz not null default now()
);

create index if not exists idx_extratos_empresa on extratos_arquivos(empresa_id);
create index if not exists idx_extratos_conta_mes on extratos_arquivos(conta_bancaria_id, mes);
create index if not exists idx_extratos_empresa_mes on extratos_arquivos(empresa_id, mes);

alter table extratos_arquivos enable row level security;
drop policy if exists extratos_arquivos_select on extratos_arquivos;
drop policy if exists extratos_arquivos_write on extratos_arquivos;
create policy extratos_arquivos_select on extratos_arquivos
  for select using (public.is_active_user());
create policy extratos_arquivos_write on extratos_arquivos
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));

-- ------------------------------------------------------------
-- 5. Trigger atualizado_em
-- ------------------------------------------------------------
create or replace function set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_contas_bancarias_atualizado on contas_bancarias;
create trigger trg_contas_bancarias_atualizado
  before update on contas_bancarias
  for each row execute function set_atualizado_em();

drop trigger if exists trg_cce_atualizado on controle_contabil_extratos;
create trigger trg_cce_atualizado
  before update on controle_contabil_extratos
  for each row execute function set_atualizado_em();
