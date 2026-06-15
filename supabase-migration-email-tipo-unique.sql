-- ═══════════════════════════════════════════════════════════════════════════
-- Migration (SÓ SE PRECISAR): permitir o mesmo e-mail como Fiscal E Cadastro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUANDO RODAR: depois do deploy da correção no app, tente cadastrar o mesmo
-- e-mail como "Cadastro" (já existindo como "Fiscal"). Se ainda bloquear, MAS
-- com um erro do BANCO ("duplicate key" / "violates unique constraint"), é
-- porque existe um índice/constraint UNIQUE antigo em (empresa_id, email) sem
-- considerar o tipo. Este script encontra e remove esse índice/constraint.
--
-- Se a correção do app já resolveu (cadastrou normal), NÃO precisa rodar.
-- IDEMPOTENTE: se não existir nada pra remover, não faz nada.
--
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record;
BEGIN
  -- 1) Constraints UNIQUE que contêm 'email' mas NÃO contêm 'tipo'
  --    (qualquer trava que bloqueie o mesmo e-mail independente do tipo).
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'empresa_emails_cliente' AND con.contype = 'u'
      AND EXISTS (SELECT 1 FROM unnest(con.conkey) ck JOIN pg_attribute a
                    ON a.attrelid = con.conrelid AND a.attnum = ck WHERE a.attname = 'email')
      AND NOT EXISTS (SELECT 1 FROM unnest(con.conkey) ck JOIN pg_attribute a
                    ON a.attrelid = con.conrelid AND a.attnum = ck WHERE a.attname = 'tipo')
  LOOP
    EXECUTE format('ALTER TABLE empresa_emails_cliente DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Constraint removida: %', r.conname;
  END LOOP;

  -- 2) Índices UNIQUE que contêm 'email' mas NÃO contêm 'tipo'.
  FOR r IN
    SELECT i.relname AS idxname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'empresa_emails_cliente' AND x.indisunique AND NOT x.indisprimary
      AND EXISTS (SELECT 1 FROM unnest(x.indkey) ik JOIN pg_attribute a
                    ON a.attrelid = x.indrelid AND a.attnum = ik WHERE a.attname = 'email')
      AND NOT EXISTS (SELECT 1 FROM unnest(x.indkey) ik JOIN pg_attribute a
                    ON a.attrelid = x.indrelid AND a.attnum = ik WHERE a.attname = 'tipo')
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.idxname);
    RAISE NOTICE 'Índice removido: %', r.idxname;
  END LOOP;
END $$;

-- Novo unique CORRETO: mesmo e-mail pode existir em tipos diferentes (Fiscal e
-- Cadastro), mas não duplicado dentro do mesmo tipo. Idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS empresa_emails_cliente_empresa_email_tipo_uq
  ON empresa_emails_cliente (empresa_id, email, tipo);
