-- ============================================================
-- Controle Contábil — Patch v2: status "sem_movimento"
-- Rodar no SQL Editor do Supabase (após o schema-controle-contabil.sql).
-- ============================================================

-- Atualiza check pra aceitar 'sem_movimento' (S/M = conferido, sem movimento bancário no mês)
alter table controle_contabil_extratos
  drop constraint if exists controle_contabil_extratos_status_check;

alter table controle_contabil_extratos
  add constraint controle_contabil_extratos_status_check
  check (status in ('feito', 'recebido_pendente', 'sem_movimento'));
