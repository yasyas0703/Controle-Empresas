-- ============================================================================
-- Migration: permissão do depto CADASTRO nas empresas + responsáveis (RLS)
-- ============================================================================
-- Contexto: o commit que liberou "Nova Empresa / Importar Planilha" pro depto
-- Cadastro mexeu SÓ no front (botões + checagem no client). O banco (RLS) não
-- sabia disso: usuário comum só LÊ/EDITA empresa onde é responsável, e a tabela
-- `responsaveis` é só-leitura pra ele. Resultado prático ao importar:
--   • as empresas criadas ficavam INVISÍVEIS pro próprio Cadastro (RLS de SELECT)
--     -> "importou mas não aparece";
--   • a dedup do upload, que se baseia na lista visível, deixava passar empresas
--     já existentes (mas invisíveis) -> tentava inserir -> erro/duplicata
--     -> "deu N erros".
--
-- Decisão (Yasmin, 2026-06-19): o Cadastro é data-entry e deve VER e GERENCIAR
-- o cadastro de TODAS as empresas — como um gerente, porém só pros dados
-- cadastrais (NÃO ganha exclusão de empresa nem poderes de admin).
--
-- Como é seguro: RLS soma políticas PERMISSIVAS com OR. Estas políticas só
-- ADICIONAM acesso pro Cadastro; nenhuma regra de admin/gerente/usuário é
-- alterada ou removida. Idempotente — pode rodar de novo sem efeito colateral.
--
-- COMO RODAR: cole tudo no SQL Editor do Supabase e execute uma vez.
-- ============================================================================

-- ── Função: is_cadastro() ───────────────────────────────────────────────────
-- true se o auth.uid() atual está ativo e pertence ao depto "Cadastro"
-- (departamento principal OU um dos extras). SECURITY DEFINER pra não depender
-- da RLS das tabelas usuarios/departamentos.
--
-- O teste do array de extras usa to_jsonb(...) ? d.id::text, que funciona
-- independente da coluna `departamentos_extras_ids` ser uuid[], text[] ou jsonb.
CREATE OR REPLACE FUNCTION public.is_cadastro()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM usuarios u
    JOIN departamentos d
      ON d.id = u.departamento_id
      OR to_jsonb(u.departamentos_extras_ids) ? d.id::text
    WHERE u.id = auth.uid()
      AND u.ativo = true
      AND btrim(lower(d.nome)) = 'cadastro'
  );
$$;

-- ── empresas: Cadastro pode LER, INSERIR e ATUALIZAR (NÃO apaga) ─────────────
DROP POLICY IF EXISTS empresas_cadastro_select ON empresas;
CREATE POLICY empresas_cadastro_select ON empresas
  FOR SELECT TO authenticated
  USING (is_cadastro());

DROP POLICY IF EXISTS empresas_cadastro_insert ON empresas;
CREATE POLICY empresas_cadastro_insert ON empresas
  FOR INSERT TO authenticated
  WITH CHECK (is_cadastro());

DROP POLICY IF EXISTS empresas_cadastro_update ON empresas;
CREATE POLICY empresas_cadastro_update ON empresas
  FOR UPDATE TO authenticated
  USING (is_cadastro())
  WITH CHECK (is_cadastro());

-- ── responsaveis: Cadastro pode LER, INSERIR e ATUALIZAR os vínculos ─────────
-- (o import grava responsável via upsert = insert/update; não precisa DELETE)
DROP POLICY IF EXISTS responsaveis_cadastro_select ON responsaveis;
CREATE POLICY responsaveis_cadastro_select ON responsaveis
  FOR SELECT TO authenticated
  USING (is_cadastro());

DROP POLICY IF EXISTS responsaveis_cadastro_insert ON responsaveis;
CREATE POLICY responsaveis_cadastro_insert ON responsaveis
  FOR INSERT TO authenticated
  WITH CHECK (is_cadastro());

DROP POLICY IF EXISTS responsaveis_cadastro_update ON responsaveis;
CREATE POLICY responsaveis_cadastro_update ON responsaveis
  FOR UPDATE TO authenticated
  USING (is_cadastro())
  WITH CHECK (is_cadastro());

-- ── Conferência rápida (opcional) ───────────────────────────────────────────
-- Rode logado como um usuário do Cadastro pra ver se enxerga todas as empresas:
--   SELECT count(*) FROM empresas;
-- Deve bater com o total real (ex.: 416+), não só as que ele é responsável.
