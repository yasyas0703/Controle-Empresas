-- ============================================================
-- Controle Triar — Tabela de tokens OAuth do Gmail (por usuário)
-- Cole no SQL Editor do Supabase e clique Run.
-- ============================================================

create table if not exists usuario_gmail_tokens (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  email text not null,
  -- refresh_token criptografado AES-256-GCM (iv:authTag:ciphertext em hex)
  refresh_token_enc text not null,
  scope text not null,
  token_type text,
  expiry_date bigint,
  revoked boolean not null default false,
  last_used_at timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (usuario_id)
);

create index if not exists idx_usuario_gmail_tokens_email on usuario_gmail_tokens(email);

-- RLS
alter table usuario_gmail_tokens enable row level security;

drop policy if exists usuario_gmail_tokens_select on usuario_gmail_tokens;
drop policy if exists usuario_gmail_tokens_insert on usuario_gmail_tokens;
drop policy if exists usuario_gmail_tokens_update on usuario_gmail_tokens;
drop policy if exists usuario_gmail_tokens_delete on usuario_gmail_tokens;

-- Cada usuário só vê/gerencia o próprio token. Service role (API) bypassa RLS.
create policy usuario_gmail_tokens_select on usuario_gmail_tokens
  for select using (auth.uid() = usuario_id);
create policy usuario_gmail_tokens_insert on usuario_gmail_tokens
  for insert with check (auth.uid() = usuario_id);
create policy usuario_gmail_tokens_update on usuario_gmail_tokens
  for update using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy usuario_gmail_tokens_delete on usuario_gmail_tokens
  for delete using (auth.uid() = usuario_id);
