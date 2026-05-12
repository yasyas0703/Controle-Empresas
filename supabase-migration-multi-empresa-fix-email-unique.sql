-- ============================================================================
-- HOTFIX: dropa constraint UNIQUE em clientes_portal.email
-- Data: 2026-05-12
-- ============================================================================
-- A migration anterior (supabase-migration-multi-empresa.sql) esqueceu de
-- remover o UNIQUE constraint em email que o schema original tinha (porque
-- antes era 1 email = 1 user = 1 linha em clientes_portal).
--
-- Agora que permitimos N linhas com o mesmo email (mesma pessoa em N
-- empresas), esse UNIQUE bloqueia o INSERT da 2ª linha com erro:
--   duplicate key value violates unique constraint "clientes_portal_email_key"
--
-- A unicidade que ainda queremos manter já existe via:
--   uq_clientes_portal_empresa_user_ativo (empresa_id, auth_user_id) WHERE ativo
-- ============================================================================

BEGIN;

-- Dropa o constraint UNIQUE em email. Usa nome padrão do Postgres
-- (gerado automaticamente quando você marca a coluna como UNIQUE).
ALTER TABLE public.clientes_portal
  DROP CONSTRAINT IF EXISTS clientes_portal_email_key;

-- Dropa também índice de mesmo nome se existir (alguns schemas usam só índice
-- em vez de constraint).
DROP INDEX IF EXISTS public.clientes_portal_email_key;

COMMIT;

-- VERIFICAÇÃO: rode pra conferir que não sobrou nenhum índice UNIQUE em email
-- isolado (deve aparecer SÓ uq_clientes_portal_empresa_user_ativo)
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'clientes_portal' AND indexdef LIKE '%email%';
