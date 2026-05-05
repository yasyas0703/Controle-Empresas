-- ============================================================
-- LIMPEZA DE LOGS DE AUDITORIA com mais de 90 dias
-- ------------------------------------------------------------
-- Objetivo: reduzir o tamanho do banco no plano free do Supabase.
-- Mantém os logs dos últimos 90 dias (3 meses), apaga o resto.
--
-- Roda no SQL Editor do Supabase (projeto controle-triar).
-- IRREVERSÍVEL — uma vez apagado, não tem como recuperar.
-- Ver quantas linhas serão apagadas antes:
--   select count(*) from logs where em < now() - interval '90 days';
-- ============================================================

-- 1) Conferir quantos logs serao apagados (rode antes de apagar pra confirmar):
-- select count(*) as logs_pra_apagar from logs where em < now() - interval '90 days';
-- select count(*) as logs_que_ficam from logs where em >= now() - interval '90 days';

-- 2) Apagar:
delete from logs where em < now() - interval '90 days';

-- 3) Vacuum pra recuperar espaço fisico em disco
vacuum analyze logs;
