-- ============================================================================
--  RENAME de obrigações: "ICMS-ST/DIFAL" -> "ICMS-ST" e "GIA-ST/DIFAL" -> "GIA-ST"
-- ----------------------------------------------------------------------------
--  Motivo: ST (Substituição Tributária) e DIFAL (Diferencial de Alíquota) são
--  tributos DIFERENTES. O DIFAL já tem obrigação própria ("DIFERENCIAL DE
--  ALIQUOTA"); o "/DIFAL" no nome do ST e do GIA-ST só confundia.
--
--  ⚠️ RODAR COORDENADO COM O DEPLOY DO CÓDIGO que usa os nomes novos.
--     Ordem recomendada: rodar ESTA migração no Supabase, avisar, e então
--     fazer o deploy do código. (Há uma janela curta de ~2 min em que o app
--     ainda mostra os nomes antigos — sem impacto pra cliente.)
--
--  Linhas afetadas (medido em 2026-06-08): empresa_obrigacoes_config 315,
--  checklist_fiscal 461, vencimento_alertas 48, guias_auto_* ~2, e o JSONB
--  vencimentos_fiscais de ~135 empresas. NÃO afeta obrigacao_empresas (é por id)
--  nem a tabela obrigacoes (não usa esses nomes).
--
--  Tudo numa transação — se algo falhar, faz rollback inteiro.
-- ============================================================================
BEGIN;

-- ─── Tabelas com coluna de NOME de obrigação (string) ───────────────────────
UPDATE public.empresa_obrigacoes_config SET obrigacao = 'ICMS-ST' WHERE obrigacao = 'ICMS-ST/DIFAL';
UPDATE public.empresa_obrigacoes_config SET obrigacao = 'GIA-ST'  WHERE obrigacao = 'GIA-ST/DIFAL';

UPDATE public.checklist_fiscal SET obrigacao = 'ICMS-ST' WHERE obrigacao = 'ICMS-ST/DIFAL';
UPDATE public.checklist_fiscal SET obrigacao = 'GIA-ST'  WHERE obrigacao = 'GIA-ST/DIFAL';

UPDATE public.guias_auto_processadas SET obrigacao = 'ICMS-ST' WHERE obrigacao = 'ICMS-ST/DIFAL';
UPDATE public.guias_auto_processadas SET obrigacao = 'GIA-ST'  WHERE obrigacao = 'GIA-ST/DIFAL';

UPDATE public.guias_auto_problemas SET obrigacao_parseada = 'ICMS-ST' WHERE obrigacao_parseada = 'ICMS-ST/DIFAL';
UPDATE public.guias_auto_problemas SET obrigacao_parseada = 'GIA-ST'  WHERE obrigacao_parseada = 'GIA-ST/DIFAL';

UPDATE public.vencimento_alertas SET obrigacao = 'ICMS-ST' WHERE obrigacao = 'ICMS-ST/DIFAL';
UPDATE public.vencimento_alertas SET obrigacao = 'GIA-ST'  WHERE obrigacao = 'GIA-ST/DIFAL';

-- ─── JSONB vencimentos_fiscais em CADA empresa ──────────────────────────────
-- O nome da obrigação fica dentro do array JSON ({"nome":"ICMS-ST/DIFAL",...}).
-- Troca a string exata (com aspas) no texto do JSON e converte de volta.
UPDATE public.empresas
   SET vencimentos_fiscais = replace(vencimentos_fiscais::text, '"ICMS-ST/DIFAL"', '"ICMS-ST"')::jsonb
 WHERE vencimentos_fiscais::text LIKE '%"ICMS-ST/DIFAL"%';

UPDATE public.empresas
   SET vencimentos_fiscais = replace(vencimentos_fiscais::text, '"GIA-ST/DIFAL"', '"GIA-ST"')::jsonb
 WHERE vencimentos_fiscais::text LIKE '%"GIA-ST/DIFAL"%';

COMMIT;

-- ─── Conferência (rode depois; deve dar 0 em tudo) ──────────────────────────
-- SELECT 'config' t, count(*) FROM empresa_obrigacoes_config WHERE obrigacao IN ('ICMS-ST/DIFAL','GIA-ST/DIFAL')
-- UNION ALL SELECT 'checklist', count(*) FROM checklist_fiscal WHERE obrigacao IN ('ICMS-ST/DIFAL','GIA-ST/DIFAL')
-- UNION ALL SELECT 'alertas', count(*) FROM vencimento_alertas WHERE obrigacao IN ('ICMS-ST/DIFAL','GIA-ST/DIFAL')
-- UNION ALL SELECT 'jsonb', count(*) FROM empresas WHERE vencimentos_fiscais::text LIKE '%/DIFAL"%';

-- ─── ROLLBACK (se precisar voltar — rode os UPDATEs invertidos) ──────────────
--  Basta trocar 'ICMS-ST'->'ICMS-ST/DIFAL' e 'GIA-ST'->'GIA-ST/DIFAL' nos mesmos
--  comandos acima. (Cuidado: 'ICMS-ST' é prefixo — use = exato, como acima.)
-- ============================================================================
