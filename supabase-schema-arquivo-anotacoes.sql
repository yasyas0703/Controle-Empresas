-- ============================================================
-- Anotações em arquivos (extratos, documentos)
-- Permite grifar trechos de PDFs e colar comentários.
-- Rodar no SQL Editor do Supabase.
-- ============================================================

create table if not exists arquivo_anotacoes (
  id uuid primary key default gen_random_uuid(),
  -- Identifica o arquivo. Usamos o path no Storage como chave (estável e único).
  arquivo_path text not null,
  -- Contexto pra filtros e checagem de permissão
  contexto text not null check (contexto in ('extrato', 'documento')),
  -- ID da empresa dona do arquivo (pra checagem RLS via can_access_empresa)
  empresa_id uuid not null references empresas(id) on delete cascade,
  -- Tipo da anotação
  tipo text not null check (tipo in ('highlight', 'note', 'underline', 'strikethrough')),
  -- Página do PDF (1-based). Em imagens, sempre 1.
  pagina int not null default 1,
  -- Coordenadas e estilo. Schema flexível pra acomodar diferentes formatos
  -- (highlight tem array de retângulos; note tem ponto + texto, etc).
  conteudo jsonb not null,
  -- Texto livre (comentário do usuário associado à anotação)
  comentario text,
  -- Cor da anotação (hex ou nome). Default amarelo.
  cor text not null default '#FFEB3B',
  criado_por_id uuid references usuarios(id) on delete set null,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_arquivo_anotacoes_path on arquivo_anotacoes(arquivo_path);
create index if not exists idx_arquivo_anotacoes_empresa on arquivo_anotacoes(empresa_id);
create index if not exists idx_arquivo_anotacoes_path_pagina on arquivo_anotacoes(arquivo_path, pagina);

-- Trigger atualizado_em (reusa função de outras tabelas, definida no schema do controle contábil)
drop trigger if exists trg_arquivo_anotacoes_atualizado on arquivo_anotacoes;
create trigger trg_arquivo_anotacoes_atualizado
  before update on arquivo_anotacoes
  for each row execute function set_atualizado_em();

-- RLS
alter table arquivo_anotacoes enable row level security;
drop policy if exists arquivo_anotacoes_select on arquivo_anotacoes;
drop policy if exists arquivo_anotacoes_write on arquivo_anotacoes;
create policy arquivo_anotacoes_select on arquivo_anotacoes
  for select using (public.is_active_user());
create policy arquivo_anotacoes_write on arquivo_anotacoes
  for all using (public.can_access_empresa(empresa_id))
  with check (public.can_access_empresa(empresa_id));
