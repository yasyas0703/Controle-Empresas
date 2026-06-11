-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: vigência por mês na habilitação de obrigações do checklist
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO (2026-06-11):
-- A varredura de pastas do T: desabilitou em massa as obrigações que as
-- empresas não têm (6.061 overrides em `empresa_obrigacoes_habilitadas`).
-- Só que o override era GLOBAL — valia pra todos os meses — e a visão de
-- MAIO mudou junto (células sumiram do grid). Pedido da Yasmin: as
-- alterações valem SÓ de JUNHO/2026 em diante; maio volta como estava.
--
-- O QUE FAZ:
-- 1. Adiciona à tabela `empresa_obrigacoes_habilitadas`:
--    - vigente_desde (text YYYY-MM): quando preenchida, `habilitada` só vale
--      desse mês em diante;
--    - habilitada_antes (boolean): o que vale pra meses ANTERIORES à
--      vigência (null = cai na regra automática por UF/cidade).
-- 2. Marca TODAS as linhas gravadas pela varredura (identificadas pelo
--    habilitada_por_nome) com vigente_desde = '2026-06' e
--    habilitada_antes = NOT habilitada. Funciona porque a varredura só
--    gravou DELTAS: toda linha dela inverteu o estado efetivo anterior —
--    logo o estado de maio é exatamente o oposto do valor atual.
--
-- Overrides manuais (botões X / + Habilitar do checklist) continuam globais
-- (vigente_desde NULL) e, ao clicar de novo, ZERAM a vigência da linha —
-- decisão humana vale pra todos os meses.
--
-- ⚠️ Precisa do deploy do código junto (db.ts/checklist page com
-- overrideHabilitadaNoMes). Sem o deploy, o app ignora as colunas novas e
-- maio continua com a visão de junho até o deploy sair.
--
-- COMO RODAR:
-- 1. Abra https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- 2. Cole este arquivo inteiro e clique em "Run"
--
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

-- DEPOIS DE RODAR (e do deploy):
-- - Checklist de MAIO/2026: grid idêntico ao que era antes da varredura.
-- - Checklist de JUNHO/2026 em diante: só as obrigações com evidência na
--   pasta da empresa no T:.
-- - Conferência rápida:
--   SELECT vigente_desde, count(*) FROM empresa_obrigacoes_habilitadas GROUP BY 1;
--   → ~6.2 mil linhas com '2026-06', o resto NULL (overrides manuais antigos).
