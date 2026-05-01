-- ============================================================
-- Índices nas FKs que apontam para usuarios.id
-- ------------------------------------------------------------
-- Motivo: ao deletar um usuário, o Postgres precisa visitar cada
-- tabela filha para aplicar ON DELETE SET NULL/CASCADE. Sem índice
-- na coluna FK, isso vira um seq scan por tabela e estoura o
-- statement_timeout (erro 57014).
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================

create index if not exists idx_responsaveis_usuario
  on public.responsaveis(usuario_id);

create index if not exists idx_observacoes_autor
  on public.observacoes(autor_id);

create index if not exists idx_logs_user
  on public.logs(user_id);

create index if not exists idx_logs_deleted_by
  on public.logs(deleted_by_id);

create index if not exists idx_lixeira_excluido_por
  on public.lixeira(excluido_por_id);

create index if not exists idx_notificacoes_autor
  on public.notificacoes(autor_id);

create index if not exists idx_documentos_criado_por
  on public.documentos(criado_por_id);

create index if not exists idx_checklist_fiscal_concluido_por
  on public.checklist_fiscal(concluido_por_id);

create index if not exists idx_tarefas_concluida_por
  on public.obrigacao_tarefas(concluida_por_id);

create index if not exists idx_obrigacao_envios_enviado_por
  on public.obrigacao_envios(enviado_por_id);

create index if not exists idx_usuario_gmail_tokens_usuario
  on public.usuario_gmail_tokens(usuario_id);

create index if not exists idx_cce_marcado_por
  on public.controle_contabil_extratos(marcado_por_id);

create index if not exists idx_extratos_arquivos_uploaded_por
  on public.extratos_arquivos(uploaded_por_id);

create index if not exists idx_arquivo_anotacoes_criado_por
  on public.arquivo_anotacoes(criado_por_id);
