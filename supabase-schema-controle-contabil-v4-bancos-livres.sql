-- =================================================================
-- Controle Contábil v4 — libera gerência de bancos para qualquer
-- usuário ativo (alinhando com cce_write/extratos_arquivos_write).
--
-- Antes: contas_bancarias_write usava can_access_empresa(empresa_id),
-- bloqueando silenciosamente DELETE/UPDATE/INSERT quando o usuário
-- logado não era responsável pela empresa nem gerente. Resultado: a
-- UI executava a ação sem erro, mas a linha continuava no banco e
-- reaparecia no próximo refetch/realtime.
--
-- Depois: qualquer usuário ativo pode criar/alterar/excluir bancos,
-- igual ao que já vale para os marcadores de extrato e arquivos.
-- =================================================================

drop policy if exists contas_bancarias_write on contas_bancarias;

create policy contas_bancarias_write on contas_bancarias
  for all using (public.is_active_user())
  with check (public.is_active_user());
