-- ============================================================
-- Migração: anexo de guia/comprovante no checklist fiscal mensal
-- ============================================================
-- Adiciona campos opcionais em `checklist_fiscal` para que o usuário
-- consiga subir o comprovante/guia direto na célula do checklist
-- (sem precisar abrir os Vencimentos Fiscais da empresa).
--
-- arquivo_url:        caminho no Storage (bucket "documentos")
-- arquivo_nome:       nome original do arquivo, pra exibir na UI
-- arquivo_historico:  lista de eventos (anexar/substituir/remover) com
--                     autor + data, pra auditoria. Mesmo formato dos
--                     historicos de vencimento e RET.
-- ============================================================

alter table checklist_fiscal
  add column if not exists arquivo_url text,
  add column if not exists arquivo_nome text,
  add column if not exists arquivo_historico jsonb not null default '[]'::jsonb;
