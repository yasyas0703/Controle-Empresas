-- ============================================================
-- Migração: histórico de envios de anexos do checklist mensal
-- ============================================================
-- Adiciona coluna `envios_historico` em `checklist_fiscal` para
-- registrar cada tentativa de envio do anexo por email (Gmail OAuth
-- da usuária logada) ao(s) e-mail(s) cadastrado(s) da empresa.
--
-- Estrutura de cada item (JSONB):
-- {
--   "id": "uuid",
--   "enviado_em": "2026-05-08T14:32:00.000Z",
--   "enviado_por_id": "uuid",
--   "enviado_por_nome": "Yasmin",
--   "remetente_email": "yasmin@triarcontabilidade.com.br",
--   "destinatarios": ["financeiro@cliente.com", "socio@cliente.com"],
--   "arquivo_nome": "ICMS_2026-04.pdf",
--   "sucesso": true,
--   "erro": null
-- }
--
-- A coluna fica ao lado de `arquivo_historico` (eventos de
-- anexar/substituir/remover), com semântica diferente:
--   arquivo_historico → o que aconteceu com o anexo
--   envios_historico  → o que aconteceu com o envio por email
-- ============================================================

alter table checklist_fiscal
  add column if not exists envios_historico jsonb not null default '[]'::jsonb;
