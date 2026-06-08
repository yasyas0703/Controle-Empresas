-- ============================================================================
--  ALERTAS DO AUTO-ENVIO  (rede de segurança — Fase 1)
-- ----------------------------------------------------------------------------
--  Objetivo: nunca deixar uma guia travar em silêncio e descobrir na hora se
--  o watcher parar. Duas coisas:
--   1) watcher_status: o watcher "bate ponto" (heartbeat). Se parar de bater,
--      o cron avisa "o watcher parou — nenhuma guia está sendo processada".
--   2) guias_auto_problemas.alertado_em: marca quando uma pendência já entrou
--      num email de alerta, pra o resumo não re-enviar a mesma todo dia.
--
--  Escritas são todas via SERVICE-ROLE (endpoint /heartbeat e crons), que
--  bypassa RLS. Por isso watcher_status fica com RLS ligada e SEM policies
--  (ninguém lê pelo cliente anônimo; se um dia precisar numa tela, criamos a
--  policy de SELECT com is_staff()).
--
--  Idempotente: pode rodar mais de uma vez sem quebrar.
-- ============================================================================

-- ─── 1. watcher_status (heartbeat do daemon) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.watcher_status (
  id                     text PRIMARY KEY DEFAULT 'singleton',
  ultimo_heartbeat       timestamptz,
  heartbeat_meta         jsonb,
  -- Última vez que avisamos "watcher parado" — pra não repetir o alerta a cada
  -- rodada do cron enquanto ele continua parado.
  heartbeat_alertado_em  timestamptz,
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.watcher_status (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.watcher_status ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito: só service-role mexe (heartbeat endpoint + cron).

-- ─── 2. guias_auto_problemas.alertado_em ───────────────────────────────────
-- Marca quando a pendência já foi incluída num email de alerta (dedup do
-- resumo). NULL = ainda não avisada por email.
ALTER TABLE public.guias_auto_problemas
  ADD COLUMN IF NOT EXISTS alertado_em timestamptz;

-- Índice pra o cron varrer rápido as pendências abertas ainda não avisadas.
CREATE INDEX IF NOT EXISTS idx_guias_auto_problemas_pendentes
  ON public.guias_auto_problemas (resolvido_em, alertado_em);

-- ============================================================================
--  ROLLBACK (se precisar desfazer)
-- ----------------------------------------------------------------------------
--  DROP INDEX IF EXISTS public.idx_guias_auto_problemas_pendentes;
--  ALTER TABLE public.guias_auto_problemas DROP COLUMN IF EXISTS alertado_em;
--  DROP TABLE IF EXISTS public.watcher_status;
-- ============================================================================
