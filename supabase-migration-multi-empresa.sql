-- ============================================================================
-- Migration: Portal do Cliente — Multi-empresa por email
-- Data: 2026-05-12
-- ============================================================================
-- Objetivo:
--   Antes: clientes_portal.id == auth.users.id (1:1). Mesmo email NUNCA pode
--   ter acesso a 2 empresas, e email já usado em `usuarios` (ex: yasmin@triar)
--   não pode virar cliente do portal pra teste.
--
--   Depois: clientes_portal.id é UUID independente. Coluna nova
--   `auth_user_id` referencia auth.users(id). Um mesmo auth_user pode ter
--   N rows em clientes_portal (uma por empresa). Login pergunta qual empresa.
--
-- IMPORTANTE:
--   - Rode em ambiente de teste primeiro.
--   - Antes de rodar, confira no Supabase Studio o trigger atual
--     `public.handle_new_auth_user` — esta migration substitui ele. Se você
--     personalizou algo nele, mescle.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Adiciona coluna auth_user_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes_portal
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- Backfill: nas linhas existentes, id sempre foi == auth.users.id
UPDATE public.clientes_portal SET auth_user_id = id WHERE auth_user_id IS NULL;

ALTER TABLE public.clientes_portal
  ALTER COLUMN auth_user_id SET NOT NULL;

-- FK pra auth.users
ALTER TABLE public.clientes_portal
  DROP CONSTRAINT IF EXISTS clientes_portal_auth_user_id_fkey;
ALTER TABLE public.clientes_portal
  ADD CONSTRAINT clientes_portal_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2) Solta o FK antigo de clientes_portal.id -> auth.users.id
--    (o nome padrão criado pelo Supabase é clientes_portal_id_fkey)
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes_portal
  DROP CONSTRAINT IF EXISTS clientes_portal_id_fkey;

-- ---------------------------------------------------------------------------
-- 3) Default pra id (linhas novas geram UUID novo, não copiam auth.users.id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes_portal
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ---------------------------------------------------------------------------
-- 4) Substitui o índice de unicidade
--    Antes: 1 cliente ativo por empresa
--    Agora: 1 (auth_user, empresa) ativo — mesma pessoa não pode ser cadastrada
--    duas vezes na mesma empresa, mas várias pessoas podem ter acesso à mesma
--    empresa e a mesma pessoa pode acessar várias empresas.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_clientes_portal_empresa_ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_portal_empresa_user_ativo
  ON public.clientes_portal (empresa_id, auth_user_id)
  WHERE ativo = true;

-- Índice de busca por auth_user_id (usado no login)
CREATE INDEX IF NOT EXISTS idx_clientes_portal_auth_user_ativo
  ON public.clientes_portal (auth_user_id) WHERE ativo = true;

-- ---------------------------------------------------------------------------
-- 5) Atualiza funções helper de RLS
-- ---------------------------------------------------------------------------

-- Função plural: retorna todas as empresas que o auth user tem acesso
CREATE OR REPLACE FUNCTION public.cliente_portal_empresa_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id
  FROM public.clientes_portal
  WHERE auth_user_id = auth.uid() AND ativo = true;
$$;

GRANT EXECUTE ON FUNCTION public.cliente_portal_empresa_ids() TO authenticated, anon;

-- Função singular (legado): mantém assinatura mas agora retorna a primeira
-- empresa do user. Policies que dependem disso devem migrar pra IN (ids()).
CREATE OR REPLACE FUNCTION public.cliente_portal_empresa_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id
  FROM public.clientes_portal
  WHERE auth_user_id = auth.uid() AND ativo = true
  ORDER BY criado_em ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.cliente_portal_empresa_id() TO authenticated, anon;

-- is_active_cliente_portal: usa auth_user_id agora
CREATE OR REPLACE FUNCTION public.is_active_cliente_portal()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clientes_portal
    WHERE auth_user_id = auth.uid() AND ativo = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_cliente_portal() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6) Atualiza policies que usavam cliente_portal_empresa_id() e que precisam
--    cobrir múltiplas empresas. Recria com IN (cliente_portal_empresa_ids()).
--
-- ATENÇÃO: ajuste os nomes das policies se você os customizou. Os nomes abaixo
-- são os padrões criados pelo schema original. Se já não existirem com esse
-- nome, o DROP IF EXISTS apenas pula — nesse caso, abra Supabase Studio →
-- Authentication → Policies e ajuste manualmente a tabela `empresas`,
-- `portal_documentos`, etc., trocando `= cliente_portal_empresa_id()` por
-- `IN (SELECT cliente_portal_empresa_ids())`.
-- ---------------------------------------------------------------------------

-- Policy de empresas: cliente vê dados da empresa dele
DROP POLICY IF EXISTS empresas_cliente_portal_select ON public.empresas;
CREATE POLICY empresas_cliente_portal_select ON public.empresas
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.cliente_portal_empresa_ids()));

-- Policy de portal_documentos: cliente vê só os da empresa dele
DROP POLICY IF EXISTS portal_documentos_cliente_select ON public.portal_documentos;
CREATE POLICY portal_documentos_cliente_select ON public.portal_documentos
  FOR SELECT
  TO authenticated
  USING (empresa_id IN (SELECT public.cliente_portal_empresa_ids()));

-- ---------------------------------------------------------------------------
-- 7) Atualiza o trigger handle_new_auth_user
--    Antes: ao criar user com tipo=cliente_portal, inseria com id=NEW.id.
--    Agora: insere com id = default (uuid novo) e auth_user_id = NEW.id.
--
-- ATENÇÃO: este CREATE OR REPLACE substitui qualquer customização que você
-- tenha feito no trigger. Confira antes de aplicar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tipo TEXT;
  v_empresa_id UUID;
  v_nome_contato TEXT;
BEGIN
  v_tipo := NEW.raw_user_meta_data->>'tipo';

  IF v_tipo = 'cliente_portal' THEN
    v_empresa_id := NULLIF(NEW.raw_user_meta_data->>'empresa_id', '')::UUID;
    v_nome_contato := NEW.raw_user_meta_data->>'nome_contato';

    IF v_empresa_id IS NOT NULL THEN
      INSERT INTO public.clientes_portal
        (auth_user_id, empresa_id, email, nome_contato, ativo)
      VALUES
        (NEW.id, v_empresa_id, lower(NEW.email), v_nome_contato, true)
      ON CONFLICT (empresa_id, auth_user_id) WHERE ativo = true DO NOTHING;
    END IF;
  ELSE
    -- Usuário interno do escritório: cria linha em public.usuarios
    INSERT INTO public.usuarios (id, email, role, ativo)
    VALUES (NEW.id, lower(NEW.email), 'usuario', true)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICAÇÕES (rode após o COMMIT pra confirmar)
-- ============================================================================
-- SELECT id, auth_user_id, email, empresa_id, ativo FROM public.clientes_portal LIMIT 10;
-- SELECT id = auth_user_id AS legado_ok, count(*)
--   FROM public.clientes_portal GROUP BY 1;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'clientes_portal';
