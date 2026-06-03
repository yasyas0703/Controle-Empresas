'use client';

import React from 'react';
import { Download, AppWindow, Tag, Eraser, MonitorDown } from 'lucide-react';

// Apps disponíveis pra download. URLs apontam pro bucket público "downloads"
// no Supabase Storage — qualquer um logado no sistema pode baixar.
// Pra adicionar um app novo: cole o arquivo no bucket e acrescente aqui.
const APPS: {
  nome: string;
  descricao: string;
  url: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    nome: 'TagFix',
    descricao: 'Automação para ajuste de tags.',
    url: 'https://kamaxhrqdqbczvwgrfgf.supabase.co/storage/v1/object/public/downloads/TagFix.exe',
    icon: Tag,
  },
  {
    nome: 'Limpa26BR',
    descricao: 'Automação de limpeza.',
    url: 'https://kamaxhrqdqbczvwgrfgf.supabase.co/storage/v1/object/public/downloads/Limpa26BR.exe',
    icon: Eraser,
  },
];

function nomeArquivo(url: string): string {
  try {
    return decodeURIComponent(url.split('/').pop() || '');
  } catch {
    return url.split('/').pop() || '';
  }
}

export default function AplicativosPage() {
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3 sm:p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <AppWindow size={20} />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-1)] tracking-tight">Aplicativos</div>
            <div className="text-sm text-[var(--text-2)]">
              Ferramentas e automações pra baixar e usar no seu computador.
            </div>
          </div>
        </div>
      </div>

      {/* Grade de apps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {APPS.map((app) => {
          const Icon = app.icon;
          return (
            <div
              key={app.nome}
              className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] p-5 flex flex-col"
            >
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-md bg-[var(--brand-soft)] text-[var(--brand-strong)] flex items-center justify-center shrink-0">
                  <Icon size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-[var(--text-1)] leading-tight">{app.nome}</h2>
                  <p className="text-sm text-[var(--text-2)] mt-1">{app.descricao}</p>
                  <p className="text-[11px] text-[var(--text-3)] ct-num mt-2">{nomeArquivo(app.url)}</p>
                </div>
              </div>

              <a
                href={app.url}
                download
                className="ct-btn-primary mt-5 w-full"
              >
                <Download size={16} />
                Baixar
              </a>
            </div>
          );
        })}
      </div>

      {/* Aviso discreto */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-3)]">
        <MonitorDown size={14} className="shrink-0 mt-0.5" />
        <span>
          Arquivos executáveis (.exe) pra Windows. Se o navegador avisar, é só confirmar o download —
          são ferramentas internas da Triar.
        </span>
      </div>
    </div>
  );
}
