-- ============================================================================
--  HARDENING do cp_update — clientes_portal  (auditoria 2026-06-11)
-- ----------------------------------------------------------------------------
--  PROBLEMA: a policy cp_update (em supabase-migration-rls-portal.sql) só checa
--  `auth_user_id = auth.uid()` no USING/WITH CHECK — ou seja, o cliente do
--  portal pode dar UPDATE em QUALQUER coluna da PRÓPRIA linha, inclusive trocar
--  `empresa_id` pelo de outra empresa. A partir daí todo o RLS downstream
--  (pd_select, storage de portal-documentos, rotas /api/portal/*) passa a
--  liberar os documentos da OUTRA empresa. Escalada de privilégio — precondição:
--  conhecer o UUID da empresa-alvo (não enumerável, mas o furo é real).
--
--  CORREÇÃO: restringir, no nível de COLUNA, o que o cliente (role authenticated)
--  pode atualizar. As ÚNICAS escritas diretas do cliente hoje são:
--    - nome_contato, telefone   (src/app/portal/perfil/page.tsx)
--    - ultimo_login_em          (src/app/portal/PortalContext.tsx)
--  Tudo o mais (empresa_id, auth_user_id, ativo, id, email...) fica fora do
--  GRANT → tentativa de UPDATE nessas colunas vira "permission denied" (42501).
--
--  POR QUE GRANT DE COLUNA E NÃO TRIGGER/POLICY:
--   - Column privileges valem SÓ pros roles anon/authenticated. O service_role
--     (rotas /api/portal/* e /api/clientes-portal/*, criação/relink de cliente)
--     tem GRANT ALL e NÃO é afetado — staff e fluxos server-side seguem mexendo
--     em tudo.
--   - WITH CHECK não consegue comparar OLD vs NEW (não existe OLD em policy),
--     então não dá pra "proibir mudar empresa_id" só com policy. GRANT de coluna
--     é o mecanismo certo e à prova de bypass.
--
--  ⚠️ Rode DEPOIS de supabase-migration-rls-portal.sql (precisa do RLS ligado).
-- ============================================================================

REVOKE UPDATE ON public.clientes_portal FROM authenticated;
REVOKE UPDATE ON public.clientes_portal FROM anon;

GRANT UPDATE (nome_contato, telefone, ultimo_login_em)
  ON public.clientes_portal TO authenticated;

-- Defesa em profundidade: o cliente NUNCA cria nem apaga a própria linha
-- (isso é só service-role em /api/clientes-portal/*). A RLS já bloqueia (não há
-- policy FOR INSERT/DELETE em clientes_portal), mas revogar o privilégio fecha a
-- superfície de uma vez — não afeta service_role (GRANT ALL próprio).
REVOKE INSERT, DELETE ON public.clientes_portal FROM authenticated;
REVOKE INSERT, DELETE ON public.clientes_portal FROM anon;

-- NOTA: o REVOKE atinge SÓ estes privilégios — o SELECT table-level do
-- authenticated (default do Supabase) fica intacto, e é ele que mantém o
-- RETURNING do PostgREST funcionando no .update() do perfil. Re-run é seguro:
-- REVOKE de privilégio ausente e GRANT de privilégio já concedido são no-op.

-- ─── Checagem (rode depois; deve listar SÓ as 3 colunas pra 'authenticated') ──
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'clientes_portal' AND grantee = 'authenticated'
--   AND privilege_type = 'UPDATE'
-- ORDER BY column_name;

-- ─── CHECKLIST DE TESTE (faça DEPOIS de rodar) ───────────────────────────────
--   CLIENTE (logada no portal):
--     [ ] aba Perfil salva nome/telefone normalmente
--     [ ] login não dá erro no console (ultimo_login_em atualiza)
--     [ ] PATCH direto via PostgREST trocando empresa_id → "permission denied"
--   STAFF:
--     [ ] criar/gerenciar cliente em /clientes-portal segue normal (service-role)
--     [ ] reenviar senha / desativar cliente seguem normais

-- ============================================================================
--  ROLLBACK (volta ao estado permissivo anterior — cliente atualiza tudo)
-- ----------------------------------------------------------------------------
--  GRANT UPDATE, INSERT, DELETE ON public.clientes_portal TO authenticated;
-- ============================================================================
