-- ============================================================
-- Empresas — sincroniza coluna 'tributacao' com 'regime_federal'
-- ------------------------------------------------------------
-- regime_federal é o source of truth (vem do cadastro/dashboard).
-- Esse script atualiza a coluna 'tributacao' para refletir
-- o regime_federal atual de cada empresa.
--
-- Mapping:
--   'Lucro Real'        -> 'lucro_real'
--   'Lucro Presumido'   -> 'lucro_presumido'
--   'Simples Nacional'  -> 'simples_nacional'
--   'MEI'               -> 'simples_nacional' (MEI é sub-regime do SN)
--   outros / null       -> null
--
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================

update public.empresas
   set tributacao = 'lucro_real'
 where regime_federal = 'Lucro Real'
   and tributacao is distinct from 'lucro_real';

update public.empresas
   set tributacao = 'lucro_presumido'
 where regime_federal = 'Lucro Presumido'
   and tributacao is distinct from 'lucro_presumido';

update public.empresas
   set tributacao = 'simples_nacional'
 where regime_federal in ('Simples Nacional', 'MEI')
   and tributacao is distinct from 'simples_nacional';

update public.empresas
   set tributacao = null
 where (regime_federal is null
        or regime_federal not in ('Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'MEI'))
   and tributacao is not null;
