-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Lote de Livros Fiscais (agrupar e enviar os livros juntos)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE FAZ:
-- Cria as 2 tabelas que o auto-envio usa pra AGRUPAR os livros fiscais de uma
-- empresa/competência e mandar todos JUNTOS num e-mail só (em vez de 1 por vez).
--   - lotes_livros_fiscais        → o lote, 1 por (empresa, competência)
--   - lotes_livros_fiscais_itens  → cada PDF de livro estagiado no lote
--
-- COMO RODAR:
-- 1. Abra https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- 2. Cole este arquivo inteiro e clique em "Run"
-- 3. É idempotente — pode rodar de novo sem medo.
--
-- POR QUÊ:
-- Os livros (entrada, saída, apuração ICMS/IPI, ISS) são VÁRIOS arquivos de UMA
-- obrigação ("LIVROS FISCAIS"). Sem o lote, o guard de duplicado mandava só o 1º
-- e barrava o resto. Com o lote, o sistema segura os livros até o lote fechar
-- (quando chegam os 5 tipos conhecidos OU passa o tempo de debounce sem chegar
-- arquivo novo) e aí manda todos juntos + marca a tarefa 1 vez.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Tabela `lotes_livros_fiscais` — o lote por (empresa, competência)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lotes_livros_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia text NOT NULL,                          -- YYYY-MM
  obrigacao text NOT NULL DEFAULT 'LIVROS FISCAIS',
  status text NOT NULL DEFAULT 'aberto',              -- aberto | enviado | enviado_parcial | erro
  tipos_recebidos text[] NOT NULL DEFAULT '{}',       -- entradas|saidas|apuracao_icms|apuracao_ipi|iss|outro
  qtd_itens int NOT NULL DEFAULT 0,
  ultimo_item_em timestamptz NOT NULL DEFAULT now(),  -- base do debounce
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz NULL,
  checklist_id uuid NULL,
  detalhes jsonb DEFAULT '{}'::jsonb,                 -- gmail_message_id, destinatarios, tipos_ausentes, parcial
  -- 1 lote por empresa+competência+obrigação: a chave da idempotência do lote.
  CONSTRAINT lotes_livros_fiscais_emp_comp_unique UNIQUE (empresa_id, competencia, obrigacao)
);

CREATE INDEX IF NOT EXISTS idx_lotes_livros_status ON lotes_livros_fiscais (status);
-- Query de fechamento: lotes abertos ordenados por quando chegou o último item.
CREATE INDEX IF NOT EXISTS idx_lotes_livros_maduros ON lotes_livros_fiscais (status, ultimo_item_em);
CREATE INDEX IF NOT EXISTS idx_lotes_livros_empresa ON lotes_livros_fiscais (empresa_id);

ALTER TABLE lotes_livros_fiscais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lotes_livros_fiscais_select_managers ON lotes_livros_fiscais;
CREATE POLICY lotes_livros_fiscais_select_managers ON lotes_livros_fiscais
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Tabela `lotes_livros_fiscais_itens` — cada livro estagiado no lote
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lotes_livros_fiscais_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES lotes_livros_fiscais(id) ON DELETE CASCADE,
  hash_arquivo text NOT NULL,
  tipo_livro text NULL,            -- entradas|saidas|apuracao_icms|apuracao_ipi|iss|outro
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,      -- path no bucket `documentos`
  caminho_servidor text NULL,
  adicionado_em timestamptz NOT NULL DEFAULT now(),
  -- não estagiar o MESMO arquivo 2x no mesmo lote (idempotência por hash).
  -- (NÃO pôr unique em tipo_livro: 2 livros do mesmo tipo podem coexistir.)
  CONSTRAINT lotes_livros_itens_lote_hash_unique UNIQUE (lote_id, hash_arquivo)
);

CREATE INDEX IF NOT EXISTS idx_lotes_livros_itens_lote ON lotes_livros_fiscais_itens (lote_id);

ALTER TABLE lotes_livros_fiscais_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lotes_livros_itens_select_managers ON lotes_livros_fiscais_itens;
CREATE POLICY lotes_livros_itens_select_managers ON lotes_livros_fiscais_itens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- DEPOIS DE RODAR: confira em Database → Tables que as 2 tabelas existem.
-- ──────────────────────────────────────────────────────────────────────────
