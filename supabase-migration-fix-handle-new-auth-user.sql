-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: conserta o trigger que quebrava TODA criação de usuário novo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O PROBLEMA (descoberto em 2026-06-26):
-- O trigger `on_auth_user_created` (função `handle_new_auth_user`) roda em
-- `auth.users` toda vez que um usuário novo é criado via
-- `admin.auth.admin.createUser()`. Para usuários internos (não-portal), ele
-- insere uma linha placeholder em `public.usuarios` com
-- `(id, email, role, ativo)` — mas omite `nome`, que é NOT NULL sem default.
--
-- Consequência: TODA chamada de criação de usuário (rota
-- /api/admin/users, POST) falhava com "Database error creating new user"
-- (GoTrue retorna esse erro genérico quando o INSERT dispara um trigger que
-- falha). Confirmado reproduzindo com um e-mail novo qualquer — não era
-- specific a duplicado.
--
-- O QUE FAZ:
-- Recria a função incluindo um valor placeholder pra `nome` (o prefixo do
-- email, ou o `nome` vindo de raw_user_meta_data se existir). A linha do
-- `usuarios` é só um placeholder mesmo — o handler em
-- src/app/api/admin/users/route.ts faz um `.upsert()` logo depois com o
-- nome/role/departamento reais, então o ON CONFLICT (id) DO NOTHING do
-- trigger nunca chega a sobrescrever nada visível pro usuário final.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_tipo TEXT;
  v_empresa_id UUID;
  v_nome_contato TEXT;
BEGIN
  v_tipo := NEW.raw_user_meta_data->>'tipo';

  IF v_tipo = 'cliente_portal' THEN
    v_empresa_id := NULLIF(NEW.raw_user_meta_data->>'empresa_id', '')::UUID;
    v_nome_contato := NEW.raw_user_meta_data->>'nome_contato';

    IF v_empresa_id IS NOT NULL THEN
      INSERT INTO public.clientes_portal
        (auth_user_id, empresa_id, email, nome_contato, ativo)
      VALUES
        (NEW.id, v_empresa_id, lower(NEW.email), v_nome_contato, true)
      ON CONFLICT (empresa_id, auth_user_id) WHERE ativo = true DO NOTHING;
    END IF;
  ELSE
    -- Usuário interno do escritório: cria linha em public.usuarios.
    -- `nome` é NOT NULL sem default — usa o que vier em raw_user_meta_data
    -- ou cai pro prefixo do email como placeholder (será sobrescrito pelo
    -- upsert da API logo após a criação do auth user).
    INSERT INTO public.usuarios (id, email, nome, role, ativo)
    VALUES (
      NEW.id,
      lower(NEW.email),
      COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
      'usuario',
      true
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
