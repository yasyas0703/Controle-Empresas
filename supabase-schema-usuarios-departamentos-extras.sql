-- ============================================================
-- Usuarios — coluna 'departamentos_extras_ids' (acesso a multiplos deps)
-- ------------------------------------------------------------
-- Permite que um usuario seja gerente/atue em mais de um departamento
-- alem do principal. Caso de uso: Bianca eh gerente do Fiscal mas tambem
-- precisa gerenciar o Fiscal - SN (que foi criado como dep separado pras
-- meninas do Simples Nacional).
--
-- Pra todos os filtros de visibilidade (menu, abas do checklist fiscal,
-- permissoes), vale a UNIAO do principal + extras.
--
-- Idempotente: pode rodar mais de uma vez sem dar erro.
-- ============================================================

alter table usuarios
  add column if not exists departamentos_extras_ids uuid[] not null default '{}';

-- Indice GIN pra buscas tipo "todos os usuarios que tem dep X em extras"
create index if not exists idx_usuarios_departamentos_extras
  on usuarios using gin (departamentos_extras_ids);

-- Verificacao:
-- select id, nome, departamento_id, departamentos_extras_ids from usuarios;
