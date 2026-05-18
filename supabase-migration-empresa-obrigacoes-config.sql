-- ============================================================================
-- Migration: Configuração de obrigações por empresa
-- Data: 2026-05-18
-- ============================================================================
-- Objetivo:
--   Permitir que admin/gerente desative obrigações fiscais que uma empresa
--   específica NÃO tem (ex: empresa só de serviços não tem IPI). A obrigação
--   desativada some da aba "Envio de Guias" e do Painel Fiscal de risco.
--
--   Default: tudo ativo. Só são gravadas linhas para obrigações desativadas
--   (ou que tenham configuração explícita). Aplicação interpreta "sem linha
--   = ativa".
--
-- Como rodar:
--   No Supabase Studio → SQL Editor → cole este arquivo inteiro → Run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.empresa_obrigacoes_config (
  empresa_id        UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  obrigacao         TEXT NOT NULL,
  ativa             BOOLEAN NOT NULL DEFAULT TRUE,
  motivo            TEXT,
  alterada_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alterada_por_id   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  alterada_por_nome TEXT,
  PRIMARY KEY (empresa_id, obrigacao)
);

CREATE INDEX IF NOT EXISTS empresa_obrigacoes_config_empresa_idx
  ON public.empresa_obrigacoes_config (empresa_id);

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.empresa_obrigacoes_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário ativo do sistema lê (a aba Envio precisa pra filtrar)
DROP POLICY IF EXISTS empresa_obrigacoes_config_select ON public.empresa_obrigacoes_config;
CREATE POLICY empresa_obrigacoes_config_select
  ON public.empresa_obrigacoes_config
  FOR SELECT
  USING (public.is_active_user());

-- Escrita: só admin/gerente
DROP POLICY IF EXISTS empresa_obrigacoes_config_insert ON public.empresa_obrigacoes_config;
CREATE POLICY empresa_obrigacoes_config_insert
  ON public.empresa_obrigacoes_config
  FOR INSERT
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS empresa_obrigacoes_config_update ON public.empresa_obrigacoes_config;
CREATE POLICY empresa_obrigacoes_config_update
  ON public.empresa_obrigacoes_config
  FOR UPDATE
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS empresa_obrigacoes_config_delete ON public.empresa_obrigacoes_config;
CREATE POLICY empresa_obrigacoes_config_delete
  ON public.empresa_obrigacoes_config
  FOR DELETE
  USING (public.is_manager());

COMMIT;

-- ============================================================================
-- Verificação (rode após o COMMIT pra conferir):
--   SELECT * FROM public.empresa_obrigacoes_config LIMIT 5;
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.empresa_obrigacoes_config'::regclass;
-- ============================================================================
