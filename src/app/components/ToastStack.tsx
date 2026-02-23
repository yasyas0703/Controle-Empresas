'use client';

import React from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';

const typeConfig = {
  sucesso: { icon: CheckCircle, bg: 'bg-emerald-50', border: 'border-emerald-300', iconColor: 'text-emerald-500', titleColor: 'text-emerald-800', bar: 'bg-emerald-500' },
  aviso: { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-300', iconColor: 'text-amber-500', titleColor: 'text-amber-800', bar: 'bg-amber-500' },
  erro: { icon: XCircle, bg: 'bg-red-50', border: 'border-red-300', iconColor: 'text-red-500', titleColor: 'text-red-800', bar: 'bg-red-500' },
  info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-300', iconColor: 'text-blue-500', titleColor: 'text-blue-800', bar: 'bg-blue-500' },
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
            className={`w-[380px] rounded-xl border ${cfg.bg} ${cfg.border} shadow-2xl overflow-hidden`}
            style={{ animation: 'toastSlideIn 0.4s cubic-bezier(0.21, 1.02, 0.73, 1)' }}
          >
            <div className={`h-1 ${cfg.bar}`} style={{ animation: 'toastShrink 5s linear forwards' }} />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-sm ${cfg.titleColor}`}>{a.title}</div>
                  <div className="text-xs text-gray-600 mt-0.5 leading-relaxed">{a.message}</div>
                </div>
                <button
                  onClick={() => dismissAlert(a.id)}
                  className="rounded-lg p-1 text-gray-400 hover:bg-white/50 hover:text-gray-600 transition shrink-0"
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
