-- ============================================================
-- Seed: Obrigação DARF-2372 - CSLL - MENSAL
-- Rodar no SQL Editor do Supabase. Idempotente (não duplica se rodar 2x).
-- ============================================================

insert into obrigacoes (
  nome,
  codigo,
  departamento,
  esfera,
  frequencia,
  tipo_data_legal,
  dia_data_legal,
  tipo_data_meta,
  dia_data_meta,
  competencia_offset,
  pontuacao,
  notificar_cliente,
  gera_multa,
  auto_concluir,
  palavras_chave,
  template_email_assunto,
  template_email_corpo,
  descricao,
  ativo
) values (
  'DARF-2372 - CSLL - MENSAL',
  'DARF-2372',
  'contabil',
  'federal',
  'mensal',
  'dia_corrido', 31,           -- data legal: dia 31, dia corrido (DARF de CSLL vence no último dia útil do mês seguinte)
  'dia_corrido', 24,           -- data meta: 7 dias antes da legal (interno)
  -1,                          -- competência: mês anterior ao mês de geração
  1,                           -- pontuação
  true,                        -- notificar cliente
  true,                        -- gera multa
  true,                        -- auto concluir
  -- palavras-chave usadas pra reconhecer o PDF da guia automaticamente:
  array['DARF', 'CSLL', '2372', 'Contribuição Social sobre o Lucro Líquido']::text[],
  -- template de e-mail (variáveis: {{empresa}}, {{competencia}}, {{vencimento}}, {{valor}})
  'Guia DARF CSLL — competência {{competencia}}',
  E'Olá,\n\nSegue em anexo a guia DARF da CSLL referente à competência {{competencia}}, com vencimento em {{vencimento}}.\n\n{{empresa}}\nValor: {{valor}}\n\nFavor efetuar o pagamento até a data de vencimento para evitar multa e juros.\n\nQualquer dúvida, estamos à disposição.\n\nAtenciosamente,\nEquipe Triar Contabilidade',
  'DARF mensal da Contribuição Social sobre o Lucro Líquido (CSLL) - código de receita 2372.',
  true
)
on conflict do nothing;
