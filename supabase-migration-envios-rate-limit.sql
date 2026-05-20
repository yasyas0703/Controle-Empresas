-- ============================================================================
-- Migration: Rate limit de envios de email (Envio de Guias)
-- Data: 2026-05-20
-- ============================================================================
-- Objetivo:
--   Evitar que um usuário (ou um script malicioso/buggy) dispare 500 emails em
--   1 minuto, o que pode bloquear a conta Gmail do escritório inteiro pelo
--   abuso. O servidor passa a contar quantos envios cada usuário fez nos
--   últimos 60s antes de mandar o próximo.
--
--   Limite definido no código: 30 envios/minuto por usuário. Suficiente pra
--   uso normal (envio em lote do mês ~400 empresas em 15 min), bloqueia abuso.
--
-- Como rodar:
--   No Supabase Studio → SQL Editor → cole este arquivo inteiro → Run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.envios_rate_limit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pra busca rápida na contagem dos últimos 60s por usuário
CREATE INDEX IF NOT EXISTS idx_envios_rate_limit_user_time
  ON public.envios_rate_limit (usuario_id, criado_em DESC);

-- Cleanup: deleta linhas com mais de 10 minutos (rate window é 60s, mas
-- mantemos buffer pra debug). Rodar via pg_cron periodicamente ou ignorar
-- (cresce lentamente — ~30 linhas/min × 100 min = 3000 linhas, irrelevante).
-- Exemplo manual: DELETE FROM envios_rate_limit WHERE criado_em < NOW() - INTERVAL '10 minutes';

-- RLS: admin pode ver tudo, usuário só vê o próprio.
ALTER TABLE public.envios_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limit_select_own_or_admin" ON public.envios_rate_limit;
CREATE POLICY "rate_limit_select_own_or_admin"
  ON public.envios_rate_limit
  FOR SELECT
  USING (
    usuario_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'gerente')
    )
  );

-- Insert é feito SOMENTE pelo service-role (server-side). RLS bloqueia anon.
DROP POLICY IF EXISTS "rate_limit_no_client_insert" ON public.envios_rate_limit;
CREATE POLICY "rate_limit_no_client_insert"
  ON public.envios_rate_limit
  FOR INSERT
  WITH CHECK (false);

COMMIT;
