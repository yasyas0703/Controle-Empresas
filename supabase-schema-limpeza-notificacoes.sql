-- ============================================================
-- LIMPEZA URGENTE: notificacoes (2.5M linhas / 1.5 GB)
-- ------------------------------------------------------------
-- Contexto: em 2026-05-06 descobrimos que a tabela 'notificacoes'
-- tinha 2.546.458 linhas ocupando 1.481 MB no Supabase free
-- (limite 0.5 GB). Causa: useEffect no SistemaContext.tsx tinha
-- state.notificacoes nas dependencias e inseria notif fiscal dentro
-- do efeito — loop infinito de criacao. Já desligado no frontend.
--
-- Esse arquivo tem 4 PARTES:
--   PARTE 1 — Deletar TODAS as notificacoes de vencimento fiscal (criadas pelo loop)
--   PARTE 2 — Aplicar retencao de 30 dias para o resto
--   PARTE 3 — Cron diario de retencao
--   PARTE 4 — Tirar tabelas do publication realtime (economia adicional)
--
-- Onde rodar: SQL Editor do Supabase, projeto sistemadecontroletriar.
-- IRREVERSIVEL. Faca backup mental do que vai apagar.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1 — DELETAR notificacoes de vencimento fiscal (limpa o loop)
-- ════════════════════════════════════════════════════════════
-- Essas eram criadas pelo loop e o usuario nao precisa delas
-- (a pagina /vencimentos-fiscais ja mostra status visualmente).

-- 1.1) Conferir antes (opcional). Selecione e rode:
-- select count(*) as total_fiscal from notificacoes
--   where titulo in ('Vencimento fiscal vencido', 'Vencimento fiscal critico');
-- select count(*) as total_geral from notificacoes;

-- 1.2) Apagar todas as notificacoes de vencimento fiscal:
delete from notificacoes
where titulo in ('Vencimento fiscal vencido', 'Vencimento fiscal critico');


-- ════════════════════════════════════════════════════════════
-- PARTE 2 — Retencao de 30 dias para o resto das notificacoes
-- ════════════════════════════════════════════════════════════
-- Notificacao tem natureza efêmera. Manter mais que 30 dias é luxo.
-- Se quiser retencao menor (7 dias?), troque '30 days' abaixo.

delete from notificacoes
where criado_em < now() - interval '30 days';


-- ════════════════════════════════════════════════════════════
-- ⚠️ VACUUM — RODAR SEPARADAMENTE (selecione SO essa linha e Run)
-- ════════════════════════════════════════════════════════════
-- VACUUM nao roda dentro de transacao (erro 25001). Selecione apenas
-- a linha abaixo e clique Run. Devolve 1+ GB de espaco fisico ao DB.
vacuum full analyze notificacoes;


-- ════════════════════════════════════════════════════════════
-- PARTE 3 — Cron diario de retencao (agenda 1 vez)
-- ════════════════════════════════════════════════════════════
-- Roda todo dia 03:15 UTC (15 min depois do cron de logs, pra nao
-- conflitar). Apaga notificacoes com mais de 30 dias.

create extension if not exists pg_cron;

select cron.unschedule('limpar-notificacoes-antigas')
where exists (select 1 from cron.job where jobname = 'limpar-notificacoes-antigas');

select cron.schedule(
  'limpar-notificacoes-antigas',
  '15 3 * * *',
  $$delete from notificacoes where criado_em < now() - interval '30 days'$$
) as jobid;


-- ════════════════════════════════════════════════════════════
-- PARTE 4 — Tirar tabelas do publication realtime
-- ════════════════════════════════════════════════════════════
-- O frontend agora so escuta 'empresas'. Mas o Supabase ainda envia
-- WAL pras 14 tabelas listadas no publication 'supabase_realtime'.
-- Tirando do publication, o Postgres nem gera as mensagens — economia
-- direta de Realtime Messages mesmo com clientes desconectados.

-- 4.1) Ver quais tabelas estao no publication hoje:
-- select * from pg_publication_tables where pubname = 'supabase_realtime';

-- 4.2) Tirar as que nao sao mais escutadas pelo frontend.
-- Mantemos so 'empresas' (e quaisquer tabelas de outros projetos
-- que voce queira manter). Se aparecer erro "table is not part of
-- the publication", ignore — significa que ja nao esta.

alter publication supabase_realtime drop table notificacoes;
alter publication supabase_realtime drop table logs;
alter publication supabase_realtime drop table lixeira;
alter publication supabase_realtime drop table documentos;
alter publication supabase_realtime drop table observacoes;
alter publication supabase_realtime drop table rets;
alter publication supabase_realtime drop table responsaveis;
alter publication supabase_realtime drop table usuarios;
alter publication supabase_realtime drop table departamentos;
alter publication supabase_realtime drop table servicos;
alter publication supabase_realtime drop table tags;
alter publication supabase_realtime drop table checklist_fiscal;
alter publication supabase_realtime drop table controle_contabil_extratos;
-- 'empresas' fica.


-- ════════════════════════════════════════════════════════════
-- VERIFICACOES (opcional, rode quando quiser conferir)
-- ════════════════════════════════════════════════════════════

-- Tamanho atual de notificacoes:
-- select pg_size_pretty(pg_total_relation_size('notificacoes')) as tamanho;

-- Quantas notificacoes hoje:
-- select count(*) as total, min(criado_em) as mais_antiga from notificacoes;

-- Confirmar cron agendado:
-- select jobid, jobname, schedule, active from cron.job
-- where jobname like 'limpar-%';

-- Confirmar publication enxuto:
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';
