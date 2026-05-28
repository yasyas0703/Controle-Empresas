'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, RotateCcw, HelpCircle, X } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info' | 'restore';

interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

const variantConfig: Record<ConfirmVariant, {
  icon: typeof Trash2;
  chipBg: string;
  chipText: string;
  confirmClass: string;
}> = {
  danger: {
    icon: Trash2,
    chipBg: 'bg-[var(--danger-soft)]',
    chipText: 'text-[var(--danger)]',
    confirmClass:
      'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2.5 text-sm font-semibold text-white bg-[var(--danger)] border border-[var(--danger)] hover:brightness-[0.92] transition',
  },
  warning: {
    icon: AlertTriangle,
    chipBg: 'bg-[var(--warn-soft)]',
    chipText: 'text-[var(--warn)]',
    confirmClass:
      'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2.5 text-sm font-semibold text-white bg-[var(--warn)] border border-[var(--warn)] hover:brightness-[0.92] transition',
  },
  info: {
    icon: HelpCircle,
    chipBg: 'bg-[var(--brand-soft)]',
    chipText: 'text-[var(--brand-strong)]',
    confirmClass: 'ct-btn-primary',
  },
  restore: {
    icon: RotateCcw,
    chipBg: 'bg-[var(--ok-soft)]',
    chipText: 'text-[var(--ok)]',
    confirmClass:
      'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2.5 text-sm font-semibold text-white bg-[var(--ok)] border border-[var(--ok)] hover:brightness-[0.92] transition',
  },
};

export default function ConfirmModal({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger',
}: ConfirmModalProps) {
  if (!open) return null;

  const cfg = variantConfig[variant];
  const Icon = cfg.icon;

  return createPortal(
    <div
      className="fixed inset-0 z-[5000] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ animation: 'confirmFadeIn 0.2s ease-out' }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      <div
        className="relative w-full max-w-md bg-[var(--surface-2)] rounded-[var(--radius-md)] border border-[var(--border)] overflow-hidden"
        style={{ boxShadow: 'var(--shadow-pop)', animation: 'confirmScaleIn 0.25s cubic-bezier(0.21, 1.02, 0.73, 1)' }}
      >
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 rounded-md p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition z-10"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>

        <div className="p-5 sm:p-6">
          <div className="flex justify-center mb-4">
            <div className={`h-12 w-12 rounded-md ${cfg.chipBg} ${cfg.chipText} flex items-center justify-center`}>
              <Icon size={22} />
            </div>
          </div>

          <div className="text-center">
            <h3 className="text-base font-bold text-[var(--text-1)] tracking-tight">{title}</h3>
            <p className="text-sm text-[var(--text-2)] mt-2 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-5 sm:pb-6 flex gap-2">
          <button onClick={onCancel} className="ct-btn-secondary flex-1">
            {cancelText}
          </button>
          <button onClick={() => { onConfirm(); }} className={`${cfg.confirmClass} flex-1`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
