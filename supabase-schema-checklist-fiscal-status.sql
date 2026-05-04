-- ============================================================
-- Checklist Fiscal — coluna 'status' para suportar 3 estados
-- ------------------------------------------------------------
-- null            = pendente (sem marcação)
-- 'feito'         = verde (obrigação cumprida)
-- 'sem_obrigacao' = vermelho (empresa não tem essa obrigação no mês)
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================

alter table public.checklist_fiscal
  add column if not exists status text;

-- Backfill: linhas com concluido=true viram status='feito' (não sobrescreve já preenchidos)
update public.checklist_fiscal
  set status = 'feito'
  where concluido = true and status is null;

-- Constraint de domínio
alter table public.checklist_fiscal
  drop constraint if exists checklist_fiscal_status_check;

alter table public.checklist_fiscal
  add constraint checklist_fiscal_status_check
  check (status is null or status in ('feito', 'sem_obrigacao'));
