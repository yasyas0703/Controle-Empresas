-- ============================================================
-- Habilitação manual de obrigações fiscais por empresa
-- ------------------------------------------------------------
-- Algumas obrigações (ex.: ISS - SERVIÇOS TOMADOS) só têm regra
-- pra cidades específicas. Quando a regra não cobre a cidade da
-- empresa, a célula no checklist aparece como N/A. Esta tabela
-- permite que o responsável fiscal (ou gerente/admin) "force"
-- a habilitação dessa obrigação pra essa empresa, valendo pra
-- todos os meses até alguém desabilitar.
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================

create table if not exists empresa_obrigacoes_habilitadas (
  empresa_id uuid not null references empresas(id) on delete cascade,
  obrigacao text not null,
  -- true  = forçar habilitar (override quando a regra não cobre essa empresa)
  -- false = forçar desabilitar (override pra desligar uma obrigação que tem regra
  --         mas que essa empresa especifica nao faz mais)
  habilitada boolean not null default true,
  habilitada_por_id uuid references usuarios(id) on delete set null,
  habilitada_por_nome text,
  habilitada_em timestamptz not null default now(),
  primary key (empresa_id, obrigacao)
);

-- Idempotente: pra bancos onde a tabela ja existia sem a coluna habilitada
alter table empresa_obrigacoes_habilitadas
  add column if not exists habilitada boolean not null default true;

create index if not exists idx_emp_obrig_hab_empresa
  on empresa_obrigacoes_habilitadas (empresa_id);

alter table empresa_obrigacoes_habilitadas enable row level security;

-- Leitura: qualquer usuário ativo (mesmo padrão do checklist_fiscal)
drop policy if exists emp_obrig_hab_select on empresa_obrigacoes_habilitadas;
create policy emp_obrig_hab_select on empresa_obrigacoes_habilitadas
  for select using (public.is_active_user());

-- Escrita: quem pode acessar a empresa (responsável + gerente + admin),
-- mesma regra do checklist_fiscal.
drop policy if exists emp_obrig_hab_write on empresa_obrigacoes_habilitadas;
create policy emp_obrig_hab_write on empresa_obrigacoes_habilitadas
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));
