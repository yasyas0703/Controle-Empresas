-- ============================================================
-- LIMPEZA DE LOGS DE AUDITORIA — RETENÇÃO 3 DIAS
-- ------------------------------------------------------------
-- Contexto: em 2026-05-06 o banco do controle-triar passou dos limites
-- do plano free (DB 1.5GB / 0.5GB). Logs era o maior ofensor.
-- Decisão: guardar só os últimos 3 dias.
--
-- Esse arquivo tem 3 partes:
--   PARTE 1 — Limpeza retroativa (rode UMA VEZ agora pra liberar espaço)
--   PARTE 2 — Auto-purge diário via pg_cron (rode UMA VEZ pra agendar)
--   PARTE 3 — Verificações úteis (opcional, pra conferir depois)
--
-- Onde rodar: SQL Editor do Supabase, projeto controle-triar.
-- IRREVERSÍVEL — não tem como recuperar logs apagados.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1 — LIMPEZA RETROATIVA (rodar UMA VEZ agora)
-- ════════════════════════════════════════════════════════════
-- IMPORTANTE: o passo 1.3 (VACUUM) precisa ser rodado SEPARADAMENTE
-- — selecione só a linha do vacuum e dê Run. O Supabase SQL Editor
-- envolve tudo em transação, e VACUUM não roda em transação.

-- 1.1) Conferir antes (opcional, mas recomendado).
--      Selecione e rode estas 3 linhas pra ver o tamanho:
-- select count(*) as logs_pra_apagar from logs where em < now() - interval '3 days';
-- select count(*) as logs_que_ficam  from logs where em >= now() - interval '3 days';
-- select pg_size_pretty(pg_total_relation_size('logs')) as tamanho_atual;

-- 1.2) Apagar tudo com mais de 3 dias (inclui soft-deletados — limpa de vez).
--      Pode rodar essa linha junto ou sozinha — funciona dos dois jeitos:
delete from logs where em < now() - interval '3 days';

-- 1.3) Recuperar o espaço físico em disco.
--      ⚠️ SELECIONE APENAS A LINHA ABAIXO E DÊ RUN — sozinha, sem mais nada.
--      VACUUM não pode rodar dentro de transação (erro 25001).
--      VACUUM FULL trava a tabela enquanto roda (segundos só, logs já foi
--      esvaziada no passo 1.2) e devolve espaço de verdade ao Supabase.
--      Alternativa sem travar: "vacuum analyze logs;" (devolve menos espaço).
vacuum full analyze logs;


-- ════════════════════════════════════════════════════════════
-- PARTE 2 — AUTO-PURGE DIÁRIO (rodar UMA VEZ pra agendar)
-- ════════════════════════════════════════════════════════════
-- Usa a extensão pg_cron (já vem habilitada no Supabase plano free).
-- Roda todo dia às 03:00 UTC (00:00 horário de Brasília) e apaga
-- logs com mais de 3 dias.

-- 2.1) Habilitar a extensão (idempotente — se já existe, não faz nada):
create extension if not exists pg_cron;

-- 2.2) Remover job antigo se existir (evita duplicar agendamento):
select cron.unschedule('limpar-logs-antigos')
where exists (select 1 from cron.job where jobname = 'limpar-logs-antigos');

-- 2.3) Agendar nova rotina diária:
select cron.schedule(
  'limpar-logs-antigos',
  '0 3 * * *',  -- todo dia às 03:00 UTC
  $$delete from logs where em < now() - interval '3 days'$$
);


-- ════════════════════════════════════════════════════════════
-- PARTE 3 — VERIFICAÇÕES (opcional, rode quando quiser conferir)
-- ════════════════════════════════════════════════════════════

-- 3.1) Confirmar que o cron está agendado:
-- select jobid, jobname, schedule, command, active from cron.job where jobname = 'limpar-logs-antigos';

-- 3.2) Ver as últimas execuções do cron (com sucesso/erro):
-- select * from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname = 'limpar-logs-antigos')
-- order by start_time desc limit 10;

-- 3.3) Tamanho atual da tabela logs:
-- select pg_size_pretty(pg_total_relation_size('logs')) as tamanho;

-- 3.4) Quantos logs hoje:
-- select count(*) as total, min(em) as mais_antigo, max(em) as mais_recente from logs;

-- ════════════════════════════════════════════════════════════
-- DESLIGAR O AUTO-PURGE (caso precise, NÃO rode normalmente)
-- ════════════════════════════════════════════════════════════
-- select cron.unschedule('limpar-logs-antigos');
