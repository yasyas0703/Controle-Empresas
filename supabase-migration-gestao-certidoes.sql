-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Gestão de Certidões — campos de validade e identificação
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE FAZ: adiciona ao `checklist_cadastro` os campos que a aba "Gestão de
-- Certidões" usa pra controlar VENCIMENTO e identificar cada certidão:
--   validade_em          'YYYY-MM-DD' — data de vencimento da certidão
--   numero_certidao      nº da certidão/certificação (CNDT, CRF-FGTS, SP...)
--   orgao_emissor        Receita Federal/PGFN, SEF-MG, SEFAZ-SP, PGE-SP, Caixa, TST...
--   codigo_autenticidade código de controle/autenticidade
--   link_validacao       site onde se valida a certidão
--
-- COMO RODAR: Supabase → SQL Editor → cole este arquivo → Run.
-- IDEMPOTENTE: pode rodar quantas vezes quiser.
-- Pré-requisito: supabase-migration-checklist-cadastro.sql já rodada.
--
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS validade_em text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS numero_certidao text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS orgao_emissor text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS codigo_autenticidade text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS link_validacao text NULL;

-- Índice pro painel de vencimentos (ordena/filtra por validade).
CREATE INDEX IF NOT EXISTS idx_checklist_cadastro_validade ON checklist_cadastro (validade_em);

-- DEPOIS DE RODAR: avise pra rodar o backfill
--   npx tsx scripts/backfill-gestao-certidoes.ts --apply
-- que re-lê os PDFs já carregados e preenche os campos novos.
