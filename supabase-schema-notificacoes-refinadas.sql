-- ============================================================
-- NOTIFICACOES — Trigger refinado + cron de RET
-- ------------------------------------------------------------
-- Contexto: em 2026-05-06, depois do incidente do loop de notif
-- fiscal (1.5 GB / 2.5M linhas), tinhamos um trigger bloqueando
-- TUDO que comeca com 'Vencimento%'. Isso bloqueava tambem
-- eventuais notif de RET (legitimas).
--
-- Esse arquivo:
--   PARTE 1 — Refina o trigger pra bloquear SO 'Vencimento fiscal*'
--   PARTE 2 — Cron diario que cria notif de RET vencido / critico
--             (com deduplicacao por 24h pra nao spammar)
--
-- Onde rodar: SQL Editor do Supabase, projeto sistemadecontroletriar.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1 — Trigger refinado (so bloqueia 'Vencimento fiscal*')
-- ════════════════════════════════════════════════════════════
-- Substitui o trigger anterior. Libera 'Vencimento RET',
-- 'Vencimento documento', e qualquer outro titulo legitimo.

create or replace function bloquear_notif_vencimento()
returns trigger
language plpgsql
as $$
begin
  -- Bloqueia SO notificacoes de vencimento fiscal (geradas pelo loop antigo).
  -- Liberamos 'Vencimento RET', 'Vencimento documento', etc.
  if new.titulo ilike 'Vencimento fiscal%' then
    return null;
  end if;
  return new;
end $$;

-- Trigger ja existe (criado antes), o create or replace function acima
-- ja substitui a logica. Nao precisa recriar o trigger.


-- ════════════════════════════════════════════════════════════
-- PARTE 2 — Cron diario de notif de RET (vencido / critico)
-- ════════════════════════════════════════════════════════════
-- Roda 1x por dia as 03:30 UTC. Cria 1 notificacao por RET que:
--   - esteja vencido (vencimento < hoje), OU
--   - esteja em status critico (<=7 dias pra vencer)
-- E que ainda nao tenha notif do mesmo RET nas ultimas 24h.
--
-- Isso evita spam: cada RET gera no maximo 1 notif por dia.
-- Como o cron de retencao apaga notif > 30 dias, no maximo 30
-- notif por RET ficam guardadas. Se o usuario marcar como lida,
-- continua aparecendo no histórico ate o cron limpar.


create or replace function gerar_notif_rets_proximos_e_vencidos()
returns void
language plpgsql
as $$
declare
  hoje date := now()::date;
begin
  insert into notificacoes (
    titulo, mensagem, tipo, autor_id, autor_nome,
    empresa_id, destinatarios, lida, criado_em
  )
  select
    case
      when r.vencimento < hoje then 'Vencimento RET vencido'
      else 'Vencimento RET critico'
    end as titulo,
    e.codigo || ' - ' || coalesce(e.razao_social, e.apelido, '') || ': RET ' || r.nome ||
      ' com vencimento em ' || to_char(r.vencimento, 'DD/MM/YYYY') ||
      case
        when r.vencimento < hoje
          then ' (' || (hoje - r.vencimento) || ' dia(s) em atraso)'
        when r.vencimento = hoje
          then ' (vence hoje)'
        else ' (vence em ' || (r.vencimento - hoje) || ' dia(s))'
      end as mensagem,
    case when r.vencimento < hoje then 'erro' else 'aviso' end as tipo,
    null as autor_id,
    'Sistema' as autor_nome,
    e.id as empresa_id,
    -- destinatarios: lista de usuarios responsaveis pela empresa,
    -- pra gerentes/usuarios comuns verem suas empresas. Se nao tem
    -- responsavel cadastrado, vai array vazio (so admin ve).
    coalesce(
      (select array_agg(distinct resp.usuario_id)
       from responsaveis resp
       where resp.empresa_id = e.id and resp.usuario_id is not null),
      '{}'::uuid[]
    ) as destinatarios,
    false as lida,
    now() as criado_em
  from rets r
  join empresas e on e.id = r.empresa_id
  where
    r.vencimento <= hoje + interval '7 days'
    and r.vencimento >= hoje - interval '90 days'  -- nao chora por RET de 1 ano atras
    and r.ativo = true
    and (r.ultima_renovacao is null or r.ultima_renovacao < r.vencimento)
    -- nao gera se ja existe notif do mesmo RET nas ultimas 24h
    and not exists (
      select 1 from notificacoes n
      where n.empresa_id = e.id
        and n.titulo like 'Vencimento RET%'
        and n.mensagem like '%' || r.nome || '%'
        and n.criado_em > now() - interval '24 hours'
    );
end $$;


-- Agendar via pg_cron pra rodar diariamente as 03:30 UTC.
create extension if not exists pg_cron;

select cron.unschedule('notif-rets-vencidos-criticos')
where exists (select 1 from cron.job where jobname = 'notif-rets-vencidos-criticos');

select cron.schedule(
  'notif-rets-vencidos-criticos',
  '30 3 * * *',
  $$select gerar_notif_rets_proximos_e_vencidos()$$
) as jobid;


-- ════════════════════════════════════════════════════════════
-- TESTAR AGORA (opcional) — gera as notif de RET de hoje
-- ════════════════════════════════════════════════════════════
-- Selecione e rode esta linha pra rodar o cron na hora,
-- sem esperar 03:30 UTC do proximo dia:
-- select gerar_notif_rets_proximos_e_vencidos();

-- Depois confere o que foi criado:
-- select titulo, mensagem, criado_em from notificacoes
-- where titulo like 'Vencimento RET%' order by criado_em desc limit 20;


-- ════════════════════════════════════════════════════════════
-- DESLIGAR (caso precise, NAO rode normalmente)
-- ════════════════════════════════════════════════════════════
-- select cron.unschedule('notif-rets-vencidos-criticos');
-- drop function if exists gerar_notif_rets_proximos_e_vencidos();
