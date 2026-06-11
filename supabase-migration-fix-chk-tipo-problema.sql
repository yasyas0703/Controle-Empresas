-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: conserta o CHECK constraint que silenciava os alertas de guia
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O PROBLEMA (descoberto em 2026-06-11):
-- A tabela `guias_auto_problemas` tem um CHECK constraint antigo
-- (`chk_tipo_problema`) criado quando os tipos eram outros
-- (empresa_nao_encontrada, obrigacao_desconhecida, erro_envio...).
-- O código atual grava tipos NOVOS (pdf_ilegivel, competencia_futura,
-- empresa_match_fraco, validacao_falhou...) que o constraint REJEITA.
--
-- Consequência: TODO `registrarProblema` falhava em silêncio →
--   - o painel /vencimentos-fiscais/auto-problemas ficava vazio,
--   - o alerta no topo do app contava 0,
--   - NENHUMA notificação no sino era criada.
-- Foi por isso que as 2 guias de hoje (CSLL competência futura + DARF REINF
-- ilegível) foram pra _PENDENTES sem nenhum aviso no sistema.
--
-- O QUE FAZ:
-- 1. Derruba o constraint. A lista de tipos é controlada pelo código
--    (src/lib/alertasAutoEnvio.ts) e já mudou uma vez sem ninguém lembrar do
--    CHECK — manter a lista duplicada no banco só recria esta falha silenciosa
--    no futuro.
-- 2. Repesca os problemas perdidos: toda linha de `guias_auto_processadas`
--    com status 'pendente_correcao' que não tem espelho em
--    `guias_auto_problemas` vira problema aberto no painel.
--
-- COMO RODAR:
-- 1. Abra https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- 2. Cole este arquivo inteiro e clique em "Run"
--
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Derruba o CHECK antigo
ALTER TABLE guias_auto_problemas DROP CONSTRAINT IF EXISTS chk_tipo_problema;

-- 2. Backfill: pendente_correcao sem espelho no painel vira problema aberto
INSERT INTO guias_auto_problemas (
  caminho_servidor, nome_arquivo, hash_arquivo, empresa_id, empresa_nome_pasta,
  tipo_problema, detalhes, competencia_parseada, obrigacao_parseada, criado_em
)
SELECT
  p.caminho_servidor,
  p.nome_arquivo,
  p.hash_arquivo,
  p.empresa_id,
  NULL,
  COALESCE(p.detalhes->>'tipoProblema', 'erro'),
  COALESCE(p.detalhes, '{}'::jsonb),
  p.competencia,
  p.obrigacao,
  p.processado_em
FROM guias_auto_processadas p
WHERE p.status = 'pendente_correcao'
  AND NOT EXISTS (
    SELECT 1 FROM guias_auto_problemas g
    WHERE g.caminho_servidor = p.caminho_servidor
      AND g.hash_arquivo = p.hash_arquivo
  )
ON CONFLICT (caminho_servidor, hash_arquivo) DO NOTHING;

-- DEPOIS DE RODAR:
-- - Confira: SELECT tipo_problema, nome_arquivo FROM guias_auto_problemas WHERE resolvido_em IS NULL;
--   → deve listar as guias que estavam em _PENDENTES sem aviso (2 em 2026-06-11).
-- - O alerta no topo do app e o painel Auto-problemas voltam a contar essas guias.
