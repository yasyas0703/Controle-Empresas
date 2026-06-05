-- ============================================================================
--  RLS do PORTAL DO CLIENTE  (corrige IDOR ALTO da auditoria 2026-06-05)
-- ============================================================================
--  PROBLEMA: as tabelas do portal (clientes_portal, portal_documentos,
--  portal_acessos, portal_push_subscriptions) estavam SEM RLS. Como o portal
--  consulta direto pelo cliente anônimo (supabasePortal) com `.eq('empresa_id', X)`,
--  um cliente malicioso podia trocar o X e LER guia/dados de OUTRA empresa.
--
--  COMO ISSO FUNCIONA SEM QUEBRAR NADA:
--   - As ESCRITAS do portal (marcar pago, visualizar, baixar, push) passam por
--     rotas /api/portal/* com SERVICE-ROLE, que BYPASSA RLS — continuam iguais.
--   - O STAFF (telas internas) lê essas tabelas com o cliente anônimo dele;
--     liberamos via is_staff() (qualquer usuário cadastrado em `usuarios`).
--   - O CLIENTE do portal passa a ver SÓ a(s) empresa(s) dele.
--
--  ⚠️ ANTES DE RODAR: confirme que os nomes de coluna abaixo batem com o seu banco.
--     Verificados no código (2026-06-05): clientes_portal(auth_user_id, empresa_id, ativo),
--     portal_documentos(empresa_id), portal_acessos(cliente_id), portal_push_subscriptions(cliente_id).
--     Rode a query de checagem (Passo 0) primeiro.
--
--  ⚠️ DEPOIS DE RODAR: TESTE OS DOIS MUNDOS (checklist no fim do arquivo):
--     (a) Login no PORTAL como cliente → ver guias, marcar pago, perfil, histórico.
--     (b) STAFF → tela de checklist mostrando atividade do portal + gerenciar clientes.
--     Se algo sumir/quebrar, rode a seção ROLLBACK no fim.
-- ============================================================================

-- ─── Passo 0: checagem (rode SÓ isto primeiro, confira as colunas) ──────────
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_name IN ('clientes_portal','portal_documentos','portal_acessos','portal_push_subscriptions')
--   AND column_name IN ('auth_user_id','empresa_id','ativo','cliente_id')
-- ORDER BY table_name, column_name;

-- ─── Função: is_staff() — true se o auth.uid() atual é um usuário interno ────
-- SECURITY DEFINER pra não depender da RLS da própria tabela usuarios.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid());
$$;

-- ─── clientes_portal ────────────────────────────────────────────────────────
ALTER TABLE public.clientes_portal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cp_select ON public.clientes_portal;
CREATE POLICY cp_select ON public.clientes_portal
  FOR SELECT
  USING (is_staff() OR auth_user_id = auth.uid());

DROP POLICY IF EXISTS cp_update ON public.clientes_portal;
CREATE POLICY cp_update ON public.clientes_portal
  FOR UPDATE
  USING (is_staff() OR auth_user_id = auth.uid())
  WITH CHECK (is_staff() OR auth_user_id = auth.uid());

-- ─── portal_documentos ──────────────────────────────────────────────────────
ALTER TABLE public.portal_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pd_select ON public.portal_documentos;
CREATE POLICY pd_select ON public.portal_documentos
  FOR SELECT
  USING (
    is_staff()
    OR empresa_id IN (
      SELECT empresa_id FROM public.clientes_portal
      WHERE auth_user_id = auth.uid() AND ativo
    )
  );

-- ─── portal_acessos (cliente loga seu próprio acesso pelo client) ───────────
ALTER TABLE public.portal_acessos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pa_select ON public.portal_acessos;
CREATE POLICY pa_select ON public.portal_acessos
  FOR SELECT
  USING (
    is_staff()
    OR cliente_id IN (SELECT id FROM public.clientes_portal WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS pa_insert ON public.portal_acessos;
CREATE POLICY pa_insert ON public.portal_acessos
  FOR INSERT
  WITH CHECK (
    cliente_id IN (SELECT id FROM public.clientes_portal WHERE auth_user_id = auth.uid())
  );

-- ─── portal_push_subscriptions (escrita real é via API service-role) ────────
ALTER TABLE public.portal_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pps_select ON public.portal_push_subscriptions;
CREATE POLICY pps_select ON public.portal_push_subscriptions
  FOR SELECT
  USING (
    is_staff()
    OR cliente_id IN (SELECT id FROM public.clientes_portal WHERE auth_user_id = auth.uid())
  );

-- ============================================================================
--  CHECKLIST DE TESTE (faça DEPOIS de rodar — não pule)
--   PORTAL (logada como um cliente de teste):
--     [ ] login entra e mostra as guias da empresa dele
--     [ ] NÃO consegue ver guia de outra empresa (tente trocar o id na URL)
--     [ ] marcar como pago / visualizar / baixar funciona
--     [ ] aba perfil salva nome/telefone
--     [ ] aba histórico mostra os acessos
--   STAFF (logada como admin/gerente/responsável):
--     [ ] checklist mostra "visualizou/baixou/pago" (atividade do portal)
--     [ ] tela /clientes-portal lista e gerencia clientes normalmente
--     [ ] envio de guia (portal recebe o documento) funciona
-- ============================================================================

-- ============================================================================
--  ROLLBACK (se algo quebrar, rode tudo abaixo pra voltar ao estado anterior)
-- ----------------------------------------------------------------------------
--  ALTER TABLE public.clientes_portal           DISABLE ROW LEVEL SECURITY;
--  ALTER TABLE public.portal_documentos         DISABLE ROW LEVEL SECURITY;
--  ALTER TABLE public.portal_acessos            DISABLE ROW LEVEL SECURITY;
--  ALTER TABLE public.portal_push_subscriptions DISABLE ROW LEVEL SECURITY;
--  DROP POLICY IF EXISTS cp_select  ON public.clientes_portal;
--  DROP POLICY IF EXISTS cp_update  ON public.clientes_portal;
--  DROP POLICY IF EXISTS pd_select  ON public.portal_documentos;
--  DROP POLICY IF EXISTS pa_select  ON public.portal_acessos;
--  DROP POLICY IF EXISTS pa_insert  ON public.portal_acessos;
--  DROP POLICY IF EXISTS pps_select ON public.portal_push_subscriptions;
--  DROP FUNCTION IF EXISTS public.is_staff();
-- ============================================================================
