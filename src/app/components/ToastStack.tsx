'use client';

import React from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';

const typeConfig = {
  sucesso: { icon: CheckCircle, bg: 'bg-[var(--ok-soft)]', iconColor: 'text-[var(--ok)]', bar: 'bg-[var(--ok)]' },
  aviso: { icon: AlertTriangle, bg: 'bg-[var(--warn-soft)]', iconColor: 'text-[var(--warn)]', bar: 'bg-[var(--warn)]' },
  erro: { icon: XCircle, bg: 'bg-[var(--danger-soft)]', iconColor: 'text-[var(--danger)]', bar: 'bg-[var(--danger)]' },
  info: { icon: Info, bg: 'bg-[var(--brand-soft)]', iconColor: 'text-[var(--brand)]', bar: 'bg-[var(--brand)]' },
};

export default function ToastStack() {
  const { alerts, dismissAlert } = useSistema();

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
      {alerts.map((a) => {
        const cfg = typeConfig[a.type as keyof typeof typeConfig] ?? typeConfig.info;
        const Icon = cfg.icon;
        return (
          <div
            key={a.id}
            className={`w-[380px] rounded-[var(--radius-md)] border border-[var(--border)] ${cfg.bg} overflow-hidden`}
            style={{ boxShadow: 'var(--shadow-pop)', animation: 'toastSlideIn 0.4s cubic-bezier(0.21, 1.02, 0.73, 1)' }}
          >
            <div className={`h-0.5 ${cfg.bar}`} style={{ animation: 'toastShrink 5s linear forwards' }} />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-[var(--text-1)] tracking-tight">{a.title}</div>
                  <div className="text-xs text-[var(--text-2)] mt-0.5 leading-relaxed">{a.message}</div>
                </div>
                <button
                  onClick={() => dismissAlert(a.id)}
                  className="rounded-md p-1 text-[var(--text-3)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)] transition shrink-0"
                  aria-label="Fechar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
