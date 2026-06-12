
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Colunas de vigência
ALTER TABLE empresa_obrigacoes_habilitadas
  ADD COLUMN IF NOT EXISTS vigente_desde text NULL;
ALTER TABLE empresa_obrigacoes_habilitadas
  ADD COLUMN IF NOT EXISTS habilitada_antes boolean NULL;

-- 2. Varredura de 2026-06-11 passa a valer só de junho/2026 em diante.
--    Antes de junho: estado oposto (= como era antes da varredura).
UPDATE empresa_obrigacoes_habilitadas
SET vigente_desde = '2026-06',
    habilitada_antes = NOT habilitada
WHERE habilitada_por_nome = 'Testes (varredura pastas T:)'
  AND vigente_desde IS NULL;
