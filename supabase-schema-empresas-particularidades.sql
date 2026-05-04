-- ============================================================
-- Empresas — coluna 'particularidades' (texto longo livre)
-- ------------------------------------------------------------
-- Campo livre para anotar particularidades de cada empresa
-- (ex.: regime especial, tratamento contábil específico,
-- combinados com o cliente, etc.).
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================

alter table public.empresas
  add column if not exists particularidades text;
