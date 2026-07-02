
ALTER TABLE empresa_emails_cliente DROP CONSTRAINT IF EXISTS empresa_emails_cliente_tipo_check;
ALTER TABLE empresa_emails_cliente ADD CONSTRAINT empresa_emails_cliente_tipo_check
  CHECK (tipo IN ('fiscal', 'cadastro', 'livros_fiscais'));
