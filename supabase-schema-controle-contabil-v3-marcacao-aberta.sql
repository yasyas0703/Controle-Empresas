-- ============================================================
-- Controle Contábil — Patch v3: marcação aberta para o time
-- ------------------------------------------------------------
-- Antes: só o RESPONSÁVEL da empresa (ou gerente) podia marcar
--        check, anexar extrato, etc. — usava can_access_empresa().
-- Depois: qualquer usuário ATIVO pode marcar/anexar/desmarcar.
--        A traçabilidade continua intacta (marcado_por_id /
--        marcado_por_nome / uploaded_por_id / uploaded_por_nome
--        gravam quem fez a ação, então o time sabe quem cobriu
--        quem).
--
-- Motivo: quando um colega falta, o time precisa conseguir
-- conferir o banco da empresa dele sem ficar travado pela RLS.
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- Rode DEPOIS do schema-controle-contabil.sql (v1) e do v2.
-- ============================================================

-- 1) controle_contabil_extratos (status verde/laranja/sem mov.)
drop policy if exists cce_write on controle_contabil_extratos;
create policy cce_write on controle_contabil_extratos
  for all using (public.is_active_user())
  with check (public.is_active_user());

-- 2) extratos_arquivos (anexos PDF/OFX/etc.)
drop policy if exists extratos_arquivos_write on extratos_arquivos;
create policy extratos_arquivos_write on extratos_arquivos
  for all using (public.is_active_user())
  with check (public.is_active_user());

-- OBS: contas_bancarias (gerenciar bancos) FICA como estava —
-- só o responsável da empresa pode adicionar/editar/excluir
-- banco. Aqui só liberamos a MARCAÇÃO/ANEXO mês a mês.
