-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: e-mail dedicado "Livros Fiscais" em empresa_emails_cliente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ: os livros fiscais precisam ir para um e-mail DIFERENTE do que recebe
-- as guias. Antes, tanto guia quanto livro usavam tipo='fiscal'. Este novo valor
-- 'livros_fiscais' separa o destinatário: a obrigação LIVROS FISCAIS passa a
-- enviar SÓ pros e-mails desse tipo (sem fallback pro 'fiscal').
--
-- O que muda no banco: apenas o CHECK de valores permitidos da coluna `tipo`.
-- O índice unique empresa_emails_cliente_empresa_email_tipo_uq já considera
-- `tipo`, então o mesmo e-mail pode coexistir como fiscal/cadastro/livros_fiscais.
--
-- IDEMPOTENTE: derruba o CHECK antigo antes de recriar.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE empresa_emails_cliente DROP CONSTRAINT IF EXISTS empresa_emails_cliente_tipo_check;
ALTER TABLE empresa_emails_cliente ADD CONSTRAINT empresa_emails_cliente_tipo_check
  CHECK (tipo IN ('fiscal', 'cadastro', 'livros_fiscais'));
