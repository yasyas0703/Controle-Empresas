-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: histórico de vencimento + tag em RETs e Documentos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE FAZ: cria as colunas que a "Linha do tempo" do Histórico do Vencimento
-- usa pra RET e Documento:
--   tag_vencimento        text  — tag livre (ex.: "Renovação solicitada")
--   historico_vencimento  jsonb — eventos da timeline ("Vencimento atualizado
--                                 para X / Antes: Y", renovações, etc.)
--
-- POR QUE: o app (src/lib/db.ts → buildRetRow / updateEmpresa) grava essas
-- colunas, MAS tem um fallback: se a coluna não existir (Postgres 42703), ele
-- RE-TENTA o insert SEM o histórico (buildRetRow(..., false)) — salvando o RET
-- mas DESCARTANDO a linha do tempo em silêncio. Sintoma: o vencimento muda (some
-- dos vencidos), mas "não aparece nada no histórico". Esta migration cria as
-- colunas e destrava o registro. Combina com o fix do skipHistorico em
-- src/app/context/SistemaContext.tsx (que voltou a gerar o evento pro developer).
--
-- COMO RODAR: Supabase → SQL Editor → cole este arquivo → Run.
-- IDEMPOTENTE: pode rodar quantas vezes quiser (ADD COLUMN IF NOT EXISTS).
--
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE rets       ADD COLUMN IF NOT EXISTS tag_vencimento       text  NULL;
ALTER TABLE rets       ADD COLUMN IF NOT EXISTS historico_vencimento jsonb NULL DEFAULT '[]'::jsonb;

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tag_vencimento       text  NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS historico_vencimento jsonb NULL DEFAULT '[]'::jsonb;

-- ─── Verificação (opcional) ──────────────────────────────────────────────────
-- Confirme que as colunas existem agora:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'rets' AND column_name IN ('tag_vencimento','historico_vencimento');
