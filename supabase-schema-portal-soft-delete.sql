-- ============================================================
-- Portal do Cliente — Soft-delete em portal_documentos
-- Cole no SQL Editor do Supabase e clique "Run".
-- ============================================================
--
-- Problema: hoje, quando a menina remove ou substitui um anexo
-- no checklist, perdemos o histórico do cliente (visualizou /
-- baixou / marcou pago). Pior: a linha de portal_documentos
-- continuava ativa, então o cliente ainda via a guia removida.
--
-- Solução: cada envio vira uma linha SEPARADA em portal_documentos.
-- Em remoções/substituições marcamos a linha antiga com
-- `removido_em`, ao invés de atualizar/zerar. Cliente filtra
-- automaticamente pelas linhas ativas (via RLS). Menina vê todas.
-- ============================================================

-- 1. Nova coluna (idempotente)
alter table portal_documentos
  add column if not exists removido_em timestamptz;

alter table portal_documentos
  add column if not exists removido_por_usuario_id uuid references usuarios(id) on delete set null;

create index if not exists idx_portal_documentos_removido_em on portal_documentos (removido_em);
create index if not exists idx_portal_documentos_checklist_ativo
  on portal_documentos (checklist_fiscal_id)
  where removido_em is null;


-- 2. RLS — cliente só vê ativos (removido_em is null)
-- A regra de update do cliente também filtra ativos pra que
-- ele não consiga "ressuscitar" linhas removidas via marcar-pago.
drop policy if exists portal_documentos_cliente_select on portal_documentos;
create policy portal_documentos_cliente_select on portal_documentos
  for select using (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
    and removido_em is null
  );

drop policy if exists portal_documentos_cliente_update on portal_documentos;
create policy portal_documentos_cliente_update on portal_documentos
  for update using (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
    and removido_em is null
  )
  with check (
    public.is_active_cliente_portal()
    and empresa_id = public.cliente_portal_empresa_id()
    and removido_em is null
  );

-- Internal continua vendo tudo (não muda).


-- ============================================================
-- Pronto! Próximo passo: ajustes nas rotas e UI.
-- ============================================================
