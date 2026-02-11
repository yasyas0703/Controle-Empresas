'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, RotateCcw, Info, HelpCircle, X } from 'lucide-react';

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
  iconBg: string;
  iconColor: string;
  confirmBg: string;
  confirmHover: string;
  ringColor: string;
}> = {
  danger: {
    icon: Trash2,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    confirmBg: 'bg-red-600',
    confirmHover: 'hover:bg-red-700',
    ringColor: 'ring-red-100',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    confirmBg: 'bg-amber-600',
    confirmHover: 'hover:bg-amber-700',
    ringColor: 'ring-amber-100',
  },
  info: {
    icon: HelpCircle,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    confirmBg: 'bg-blue-600',
    confirmHover: 'hover:bg-blue-700',
    ringColor: 'ring-blue-100',
  },
  restore: {
    icon: RotateCcw,
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    confirmBg: 'bg-emerald-600',
    confirmHover: 'hover:bg-emerald-700',
    ringColor: 'ring-emerald-100',
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
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ animation: 'confirmScaleIn 0.25s cubic-bezier(0.21, 1.02, 0.73, 1)' }}
      >
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition z-10"
        >
          <X size={16} />
        </button>

        <div className="p-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className={`h-16 w-16 rounded-2xl ${cfg.iconBg} flex items-center justify-center ring-8 ${cfg.ringColor}`}>
              <Icon size={28} className={cfg.iconColor} />
            </div>
          </div>

          {/* Title */}
          <div className="text-center">
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl px-4 py-3 bg-gray-100 hover:bg-gray-200 text-sm font-bold text-gray-700 transition"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); }}
            className={`flex-1 rounded-xl px-4 py-3 ${cfg.confirmBg} ${cfg.confirmHover} text-sm font-bold text-white transition shadow-sm`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
