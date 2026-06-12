-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Controle Cadastro — checklist mensal de certidões
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE FAZ:
-- 1. Cria a tabela `checklist_cadastro` (espelho do checklist_fiscal, mas pra
--    certidões: FGTS, Trabalhista, Estadual, Municipal, Federal). Chave única
--    (empresa_id, certidao, mes) — uma célula por empresa × certidão × mês.
-- 2. Adiciona a coluna `tipo` ('fiscal' | 'cadastro') na empresa_emails_cliente,
--    pra separar o e-mail do CADASTRO do e-mail do FISCAL. Os e-mails que já
--    existem viram 'fiscal' (default), preservando o comportamento atual.
-- 3. Cria `certidoes_auto_processadas` e `certidoes_auto_problemas` pro watcher
--    de certidões (idempotência por (caminho_servidor, hash_arquivo)).
--
-- COMO RODAR:
-- 1. Abra https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- 2. Cole este arquivo inteiro e clique em "Run"
-- 3. (Opcional) Pra atualização em tempo real na tela, rode também a seção 5.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Linhas "already exists" são
-- esperadas e não são erro real.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Tabela `checklist_cadastro`
-- ──────────────────────────────────────────────────────────────────────────
-- Uma linha por empresa × certidão × mês. O `mes` é o mês da PASTA do run
-- mensal (ex.: a pasta CERTIDOES\06.2026 alimenta mes='2026-06'), NÃO o mês de
-- emissão do PDF — FGTS/Trabalhista têm validade longa e são reaproveitadas de
-- meses anteriores; a emissão real fica em `emissao_em` só como metadado.
--
-- `certidao` é uma das colunas do checklist:
--   FEDERAL | TRABALHISTA | FGTS | MUNICIPAL | ESTADUAL
--   ESTADUAL_ADM | ESTADUAL_DA  (só pra SP — Administrativa e Dívida Ativa)
--
-- `resultado` é a classificação lida do texto do PDF:
--   Negativa | Positiva | PEN (positiva com efeito de negativa) | null
--   Regra do escritório: só Negativa e PEN são enviadas ao cliente.

CREATE TABLE IF NOT EXISTS checklist_cadastro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  certidao text NOT NULL,           -- FEDERAL | TRABALHISTA | FGTS | MUNICIPAL | ESTADUAL | ESTADUAL_ADM | ESTADUAL_DA
  mes text NOT NULL,                -- 'YYYY-MM' (mês da pasta / run mensal)
  resultado text NULL,              -- Negativa | Positiva | PEN | null
  -- Status manual opcional. Quando null, a cor é derivada da presença de
  -- arquivo (certidão = verde) / relatório (azul) / nada (vermelho).
  status text NULL,                 -- tem | falta | relatorio | null
  -- Certidão (PDF) anexada — presença = "tem guia" (verde).
  arquivo_url text NULL,            -- caminho no Storage (bucket "documentos")
  arquivo_nome text NULL,
  arquivo_hash text NULL,           -- SHA-256 pra dedup do watcher
  -- Relatório (quando não sai certidão, sai só relatório) — presença = azul.
  relatorio_url text NULL,
  relatorio_nome text NULL,
  relatorio_texto text NULL,        -- relatório registrado como texto livre
  observacao text NULL,
  -- Metadados de origem.
  emissao_em text NULL,             -- 'YYYY-MM-DD' data de emissão lida do PDF
  uf text NULL,                     -- UF detectada (estadual): MG, SP, GO, RJ, SC...
  autoridade text NULL,             -- token do watcher: sefazmg, debitsp, federal, fgts...
  fonte text NULL,                  -- watcher | manual
  -- Conclusão / autoria (mesmo padrão do checklist_fiscal).
  concluido boolean NOT NULL DEFAULT false,
  concluido_por_id uuid NULL,
  concluido_por_nome text NULL,
  concluido_em timestamptz NULL,
  -- Históricos (JSONB array — mesma forma do checklist_fiscal).
  arquivo_historico jsonb NOT NULL DEFAULT '[]'::jsonb,
  envios_historico jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_cadastro_empresa_certidao_mes_unique UNIQUE (empresa_id, certidao, mes)
);

-- ALTERs idempotentes (caso a tabela já exista de uma versão anterior).
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS resultado text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS status text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS arquivo_url text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS arquivo_nome text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS arquivo_hash text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS relatorio_url text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS relatorio_nome text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS relatorio_texto text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS observacao text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS emissao_em text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS uf text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS autoridade text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS fonte text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS concluido boolean NOT NULL DEFAULT false;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS concluido_por_id uuid NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS concluido_por_nome text NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS concluido_em timestamptz NULL;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS arquivo_historico jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE checklist_cadastro ADD COLUMN IF NOT EXISTS envios_historico jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Índices pras queries da página (por mês) e do histórico (por empresa+certidão).
CREATE INDEX IF NOT EXISTS idx_checklist_cadastro_mes ON checklist_cadastro (mes);
CREATE INDEX IF NOT EXISTS idx_checklist_cadastro_empresa ON checklist_cadastro (empresa_id);
CREATE INDEX IF NOT EXISTS idx_checklist_cadastro_empresa_certidao ON checklist_cadastro (empresa_id, certidao);

-- RLS: staff (qualquer usuário ativo) lê e escreve. Mesmo padrão dos buckets
-- internos — quem tem auth.uid() na tabela usuarios e está ativo é staff.
-- (A restrição POR DEPARTAMENTO 'cadastro' é feita no client/menu; aqui o gate
--  é "ser staff", igual ao checklist_fiscal que o browser escreve direto.)
ALTER TABLE checklist_cadastro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_cadastro_staff_all ON checklist_cadastro;
CREATE POLICY checklist_cadastro_staff_all ON checklist_cadastro
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo = true)
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. E-mail do CADASTRO separado do FISCAL
-- ──────────────────────────────────────────────────────────────────────────
-- Adiciona `tipo` na tabela de e-mails de cliente. As certidões são enviadas
-- só pros e-mails tipo='cadastro'; as guias fiscais continuam usando 'fiscal'.
-- O DEFAULT 'fiscal' faz toda linha existente virar 'fiscal' automaticamente —
-- nenhum envio fiscal muda de comportamento.

ALTER TABLE empresa_emails_cliente ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'fiscal';

-- Garante que linhas legadas (caso o DEFAULT não tenha pego) fiquem 'fiscal'.
UPDATE empresa_emails_cliente SET tipo = 'fiscal' WHERE tipo IS NULL;

-- Trava os valores possíveis (idempotente — derruba antes de recriar).
ALTER TABLE empresa_emails_cliente DROP CONSTRAINT IF EXISTS empresa_emails_cliente_tipo_check;
ALTER TABLE empresa_emails_cliente ADD CONSTRAINT empresa_emails_cliente_tipo_check
  CHECK (tipo IN ('fiscal', 'cadastro'));

CREATE INDEX IF NOT EXISTS idx_empresa_emails_cliente_empresa_tipo
  ON empresa_emails_cliente (empresa_id, tipo);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Tabela `certidoes_auto_processadas` (watcher de certidões)
-- ──────────────────────────────────────────────────────────────────────────
-- Toda certidão que o watcher tentou processar vira linha aqui. Idempotência:
-- (caminho_servidor, hash_arquivo) é único — mesmo PDF não reprocessa.

CREATE TABLE IF NOT EXISTS certidoes_auto_processadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caminho_servidor text NOT NULL,
  hash_arquivo text NOT NULL,
  empresa_id uuid NULL REFERENCES empresas(id) ON DELETE SET NULL,
  competencia text NULL,           -- YYYY-MM (mês da pasta)
  certidao text NULL,              -- FEDERAL | TRABALHISTA | FGTS | ESTADUAL | ESTADUAL_ADM | ESTADUAL_DA
  resultado text NULL,             -- Negativa | Positiva | PEN
  nome_arquivo text NOT NULL,
  status text NOT NULL,            -- registrado | ja_processado | pendente_correcao | erro
  detalhes jsonb DEFAULT '{}'::jsonb,
  processado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certidoes_auto_processadas_path_hash_unique UNIQUE (caminho_servidor, hash_arquivo)
);

CREATE INDEX IF NOT EXISTS idx_certidoes_auto_processadas_status ON certidoes_auto_processadas (status);
CREATE INDEX IF NOT EXISTS idx_certidoes_auto_processadas_empresa ON certidoes_auto_processadas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_certidoes_auto_processadas_processado_em ON certidoes_auto_processadas (processado_em DESC);

ALTER TABLE certidoes_auto_processadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certidoes_auto_processadas_select_managers ON certidoes_auto_processadas;
CREATE POLICY certidoes_auto_processadas_select_managers ON certidoes_auto_processadas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Tabela `certidoes_auto_problemas` (watcher de certidões)
-- ──────────────────────────────────────────────────────────────────────────
-- Quando o watcher não consegue casar empresa/certidão/resultado, espelha aqui
-- pro admin resolver. Idempotente por (caminho_servidor, hash_arquivo).

CREATE TABLE IF NOT EXISTS certidoes_auto_problemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caminho_servidor text NOT NULL,
  nome_arquivo text NOT NULL,
  hash_arquivo text NOT NULL,
  empresa_id uuid NULL REFERENCES empresas(id) ON DELETE SET NULL,
  empresa_nome_arquivo text NULL,
  tipo_problema text NOT NULL,     -- empresa_nao_encontrada | certidao_desconhecida | resultado_indefinido | nome_fora_padrao | erro
  detalhes jsonb DEFAULT '{}'::jsonb,
  competencia_parseada text NULL,
  certidao_parseada text NULL,
  resultado_parseado text NULL,
  resolvido_em timestamptz NULL,
  resolvido_por_id uuid NULL,
  resolvido_por_nome text NULL,
  resolucao text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certidoes_auto_problemas_path_hash_unique UNIQUE (caminho_servidor, hash_arquivo)
);

CREATE INDEX IF NOT EXISTS idx_certidoes_auto_problemas_resolvido_em ON certidoes_auto_problemas (resolvido_em);
CREATE INDEX IF NOT EXISTS idx_certidoes_auto_problemas_empresa ON certidoes_auto_problemas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_certidoes_auto_problemas_tipo ON certidoes_auto_problemas (tipo_problema);
CREATE INDEX IF NOT EXISTS idx_certidoes_auto_problemas_criado_em ON certidoes_auto_problemas (criado_em DESC);

ALTER TABLE certidoes_auto_problemas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certidoes_auto_problemas_select_managers ON certidoes_auto_problemas;
CREATE POLICY certidoes_auto_problemas_select_managers ON certidoes_auto_problemas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 5. (OPCIONAL) Realtime — atualizar a tela sem F5
-- ──────────────────────────────────────────────────────────────────────────
-- A página Controle Cadastro escuta mudanças em checklist_cadastro via
-- postgres_changes. Pra isso funcionar, a tabela precisa estar na publicação
-- supabase_realtime. Rode o bloco abaixo (idempotente). Se preferir economizar
-- realtime, NÃO rode — a página reconcilia sozinha ao reativar a aba.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'checklist_cadastro'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE checklist_cadastro;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- DEPOIS DE RODAR:
-- - Database → Tables: confira checklist_cadastro, certidoes_auto_processadas,
--   certidoes_auto_problemas.
-- - empresa_emails_cliente deve ter a coluna `tipo` (default 'fiscal').
-- ──────────────────────────────────────────────────────────────────────────
