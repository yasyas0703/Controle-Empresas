-- ============================================================
-- Cliente desde + Empresas Desligadas
-- Rodar no SQL Editor do Supabase.
-- ============================================================

-- Quando o cliente entrou (data)
alter table empresas
  add column if not exists cliente_desde date;

-- Data de desligamento (se preenchido, a empresa está desligada)
alter table empresas
  add column if not exists desligada_em date;

create index if not exists idx_empresas_cliente_desde on empresas(cliente_desde);
create index if not exists idx_empresas_desligada_em on empresas(desligada_em);
