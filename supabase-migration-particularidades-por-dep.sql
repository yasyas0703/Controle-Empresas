-- Particularidades por departamento (Fiscal, Pessoal, Contábil, Cadastro).
-- Cada setor tem a sua: usuário comum vê/edita só a do seu setor;
-- admin e gerente veem todas. Fiscal e Fiscal-SN compartilham o bucket "fiscal".
--
-- O texto único antigo (coluna `particularidades`) era preenchido só pelo
-- Fiscal, então é migrado para a chave "fiscal". A coluna antiga é MANTIDA
-- intacta (retrocompatibilidade / rollback). O app já trata o texto antigo
-- como "fiscal" em memória mesmo antes desta migration — aqui só persistimos.
--
-- Rodar no SQL Editor do Supabase.

alter table empresas
  add column if not exists particularidades_por_dep jsonb not null default '{}'::jsonb;

-- Backfill: move o texto único existente para o bucket do fiscal, sem
-- sobrescrever caso já exista algo preenchido em particularidades_por_dep.
update empresas
  set particularidades_por_dep = jsonb_build_object('fiscal', particularidades)
  where particularidades is not null
    and btrim(particularidades) <> ''
    and (particularidades_por_dep is null or particularidades_por_dep = '{}'::jsonb);
