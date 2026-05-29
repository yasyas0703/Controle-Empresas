-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Tabelas e segurança do envio automático de guias
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE FAZ:
-- 1. Garante que as tabelas `guias_auto_processadas` e `guias_auto_problemas`
--    existem com índices e RLS corretos (idempotente — pode rodar quantas
--    vezes quiser).
-- 2. Ativa RLS no Storage do bucket `portal-documentos` — pra impedir que
--    um cliente do portal baixe PDFs de OUTRA empresa direto pelo SDK
--    do Supabase, contornando os endpoints `/api/portal/*`.
--
-- COMO RODAR:
-- 1. Abra https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- 2. Cole este arquivo inteiro
-- 3. Clique em "Run"
-- 4. Confira que não deu erro (algumas linhas podem dizer "policy already
--    exists" — isso é esperado, não é erro real)
--
-- POR QUÊ É IMPORTANTE:
-- - Sem essas tabelas, o /api/checklist-fiscal/auto-enviar não consegue
--   gravar problemas/processadas, e o painel /vencimentos-fiscais/auto-problemas
--   fica vazio mesmo com erros acontecendo.
-- - Sem RLS no bucket portal-documentos, qualquer cliente do portal que
--   descobrir o path de um PDF pode baixar — mesmo de empresa que não é dele.
--   Os endpoints /api/portal/* validam acesso, mas o SDK do Supabase
--   contorna eles se for usado direto.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Tabela `guias_auto_processadas`
-- ──────────────────────────────────────────────────────────────────────────
-- Toda guia que o watcher tentou processar — sucesso ou não — vira linha
-- aqui. Idempotência: (caminho_servidor, hash_arquivo) é único, então
-- mesmo PDF não dispara reenvio.

CREATE TABLE IF NOT EXISTS guias_auto_processadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caminho_servidor text NOT NULL,
  hash_arquivo text NOT NULL,
  empresa_id uuid NULL REFERENCES empresas(id) ON DELETE SET NULL,
  competencia text NULL,           -- YYYY-MM
  obrigacao text NULL,
  nome_arquivo text NOT NULL,
  status text NOT NULL,            -- enviado | ja_processado | pendente_correcao | pendente_aprovacao_* | duplicado_periodo | interno_marcado_feito | erro
  detalhes jsonb DEFAULT '{}'::jsonb,
  processado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guias_auto_processadas_path_hash_unique UNIQUE (caminho_servidor, hash_arquivo)
);

-- Garante colunas em tabelas que já existiam (de versão anterior do schema).
-- CREATE TABLE IF NOT EXISTS NÃO adiciona colunas se a tabela já existe —
-- precisamos do ALTER pra fazer o script realmente idempotente em ambientes
-- que rodaram a versão antiga.
ALTER TABLE guias_auto_processadas ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now();
ALTER TABLE guias_auto_processadas ADD COLUMN IF NOT EXISTS processado_em timestamptz NOT NULL DEFAULT now();
ALTER TABLE guias_auto_processadas ADD COLUMN IF NOT EXISTS detalhes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE guias_auto_processadas ADD COLUMN IF NOT EXISTS competencia text NULL;
ALTER TABLE guias_auto_processadas ADD COLUMN IF NOT EXISTS obrigacao text NULL;

-- Índices pras queries do painel
CREATE INDEX IF NOT EXISTS idx_guias_auto_processadas_status ON guias_auto_processadas (status);
CREATE INDEX IF NOT EXISTS idx_guias_auto_processadas_empresa ON guias_auto_processadas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_guias_auto_processadas_processado_em ON guias_auto_processadas (processado_em DESC);

-- RLS: service-role bypassa, mas ativamos pra ninguém com anon-key conseguir ler
ALTER TABLE guias_auto_processadas ENABLE ROW LEVEL SECURITY;

-- Política: só admin/gerente lê (via API com Bearer). Reads diretos do client
-- bloqueados — só passa pelo endpoint /api/admin/guias-auto/* (que usa service-role).
DROP POLICY IF EXISTS guias_auto_processadas_select_managers ON guias_auto_processadas;
CREATE POLICY guias_auto_processadas_select_managers ON guias_auto_processadas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo = true
        AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Tabela `guias_auto_problemas`
-- ──────────────────────────────────────────────────────────────────────────
-- Quando processadas registra status=pendente_correcao, espelhamos aqui com
-- detalhes do problema pro admin resolver. Idempotente pelo mesmo par
-- (caminho, hash) — re-aparece se o arquivo mudar.

CREATE TABLE IF NOT EXISTS guias_auto_problemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caminho_servidor text NOT NULL,
  nome_arquivo text NOT NULL,
  hash_arquivo text NOT NULL,
  empresa_id uuid NULL REFERENCES empresas(id) ON DELETE SET NULL,
  empresa_nome_pasta text NULL,
  tipo_problema text NOT NULL,    -- empresa_nao_encontrada | obrigacao_desconhecida | nome_fora_padrao | obrigacao_nao_configurada | obrigacao_inativa | validacao_falhou | competencia_antiga | gmail_nao_conectado | sem_emails | erro_envio
  detalhes jsonb DEFAULT '{}'::jsonb,
  competencia_parseada text NULL,
  obrigacao_parseada text NULL,
  resolvido_em timestamptz NULL,
  resolvido_por_id uuid NULL,
  resolvido_por_nome text NULL,
  resolucao text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guias_auto_problemas_path_hash_unique UNIQUE (caminho_servidor, hash_arquivo)
);

-- Garante colunas em tabelas que já existiam (de versão anterior do schema).
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now();
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS detalhes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS competencia_parseada text NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS obrigacao_parseada text NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS resolvido_em timestamptz NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS resolvido_por_id uuid NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS resolvido_por_nome text NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS resolucao text NULL;
ALTER TABLE guias_auto_problemas ADD COLUMN IF NOT EXISTS empresa_nome_pasta text NULL;

CREATE INDEX IF NOT EXISTS idx_guias_auto_problemas_resolvido_em ON guias_auto_problemas (resolvido_em);
CREATE INDEX IF NOT EXISTS idx_guias_auto_problemas_empresa ON guias_auto_problemas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_guias_auto_problemas_tipo ON guias_auto_problemas (tipo_problema);
CREATE INDEX IF NOT EXISTS idx_guias_auto_problemas_criado_em ON guias_auto_problemas (criado_em DESC);

ALTER TABLE guias_auto_problemas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guias_auto_problemas_select_managers ON guias_auto_problemas;
CREATE POLICY guias_auto_problemas_select_managers ON guias_auto_problemas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo = true
        AND u.role IN ('admin', 'gerente')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. RLS no Storage: bucket `portal-documentos`
-- ──────────────────────────────────────────────────────────────────────────
-- ⚠️ CRÍTICO: sem isso, qualquer cliente do portal que descobrir um path
-- pode baixar PDFs de outras empresas via SDK direto, contornando os
-- endpoints /api/portal/* que validam empresa.
--
-- Path convention do bucket: `{empresa_id}/{uuid}-{nome_arquivo}.pdf`
-- → o primeiro segmento do path é o empresa_id (UUID).
--
-- Política: cliente_portal só baixa se o primeiro segmento bater com
-- a empresa_id que ele está vinculado.

-- Bloqueia tudo por default, depois libera o que é permitido
DROP POLICY IF EXISTS "portal_documentos_select_owner" ON storage.objects;
CREATE POLICY "portal_documentos_select_owner" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'portal-documentos'
    AND EXISTS (
      SELECT 1 FROM clientes_portal cp
      WHERE cp.auth_user_id = auth.uid()
        AND cp.ativo = true
        -- O primeiro segmento do path é o empresa_id (UUID)
        AND cp.empresa_id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- Service-role (usado por /api/portal/* e auto-enviar) bypassa RLS — não precisa policy.

-- Bloqueia INSERT/UPDATE/DELETE pra todos os authenticated (só service-role faz).
-- Se já existir alguma policy de write, derruba.
DROP POLICY IF EXISTS "portal_documentos_no_write_authenticated" ON storage.objects;
-- Não criamos policy de INSERT pra authenticated — RLS default deny garante bloqueio.

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS no Storage: bucket `documentos` (interno staff)
-- ──────────────────────────────────────────────────────────────────────────
-- Bucket usado pra histórico interno — só staff lê. Aqui authenticated
-- da empresa de contabilidade (todos os usuários com cookie triar-staff)
-- têm acesso. Cliente do portal NÃO deveria ler — só staff.
--
-- A política olha pra tabela usuarios — se auth.uid() está lá, é staff.

DROP POLICY IF EXISTS "documentos_select_staff" ON storage.objects;
CREATE POLICY "documentos_select_staff" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentos'
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo = true
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- DEPOIS DE RODAR:
-- - Confira no Supabase Studio → Database → Tables que as 2 tabelas existem
-- - Confira no Storage → portal-documentos → Policies que a política aparece
-- - Teste fazer uma busca direto na tabela (deve dar 0 linhas se você não é admin)
-- ──────────────────────────────────────────────────────────────────────────
