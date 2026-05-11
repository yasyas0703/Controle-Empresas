

alter table checklist_fiscal
  add column if not exists envios_historico jsonb not null default '[]'::jsonb;
