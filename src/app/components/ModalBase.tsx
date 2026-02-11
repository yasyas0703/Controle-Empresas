'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function ModalBase({
  isOpen,
  onClose,
  labelledBy,
  children,
  dialogClassName,
  zIndex = 1000,
}: {
  isOpen: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
  dialogClassName?: string;
  zIndex?: number;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className={(dialogClassName ?? 'w-full max-w-2xl rounded-2xl bg-white shadow-2xl') + ' relative'}>
        {children}
      </div>
    </div>,
    document.body
  );
}
