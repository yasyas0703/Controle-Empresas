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
  -- 1) Constraints UNIQUE cobrindo exatamente (empresa_id, email).
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'empresa_emails_cliente' AND con.contype = 'u'
      AND (SELECT array_agg(a.attname ORDER BY a.attname)
             FROM unnest(con.conkey) ck
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ck)
          = ARRAY['email','empresa_id']
  LOOP
    EXECUTE format('ALTER TABLE empresa_emails_cliente DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Constraint removida: %', r.conname;
  END LOOP;

  -- 2) Índices UNIQUE cobrindo (empresa_id, email) sem o tipo.
  FOR r IN
    SELECT i.relname AS idxname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'empresa_emails_cliente' AND x.indisunique AND NOT x.indisprimary
      AND (SELECT array_agg(a.attname ORDER BY a.attname)
             FROM unnest(x.indkey) ik
             JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = ik)
          = ARRAY['email','empresa_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.idxname);
    RAISE NOTICE 'Índice removido: %', r.idxname;
  END LOOP;
END $$;
