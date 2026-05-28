'use client';

import React, { useState } from 'react';
import { X, Settings, RotateCcw } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';
import type { Limiares } from '@/app/types';
import { LIMIARES_DEFAULTS } from '@/app/types';

interface ModalLimiaresProps {
  limiares: Limiares;
  onSave: (limiares: Limiares) => void;
  onClose: () => void;
}

export default function ModalLimiares({ limiares, onSave, onClose }: ModalLimiaresProps) {
  const [form, setForm] = useState<Limiares>({ ...limiares });

  const handleSave = () => {
    const critico = Math.max(1, form.critico);
    const atencao = Math.max(critico + 1, form.atencao);
    const proximo = Math.max(atencao + 1, form.proximo);
    onSave({ critico, atencao, proximo });
    onClose();
  };

  const handleReset = () => {
    setForm({ ...LIMIARES_DEFAULTS });
  };

  return (
    <ModalBase
      isOpen
      onClose={onClose}
      labelledBy="limiares-title"
      dialogClassName="w-full max-w-md bg-[var(--surface-2)] rounded-[var(--radius-md)] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.18)] outline-none max-h-[90vh] overflow-y-auto"
      zIndex={1500}
    >
      <div className="border-b border-[var(--border-subtle)] p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] shrink-0">
              <Settings size={18} />
            </div>
            <div className="min-w-0">
              <h3 id="limiares-title" className="text-base font-bold text-[var(--text-1)]">
                Limiares de Vencimento
              </h3>
              <p className="text-xs text-[var(--text-3)] mt-0.5">Configure os limites de cada nível de alerta.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] p-2 rounded-md transition shrink-0"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-sm text-[var(--text-2)]">
          Itens com menos dias restantes que o limite serão classificados naquela categoria.
        </p>

        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-1)] mb-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
              Crítico (dias)
            </label>
            <input
              type="number"
              min={1}
              max={form.atencao - 1}
              value={form.critico}
              onChange={(e) => setForm((f) => ({ ...f, critico: parseInt(e.target.value) || 1 }))}
              className="ct-input"
            />
            <p className="text-xs text-[var(--text-3)] mt-1">Padrão: {LIMIARES_DEFAULTS.critico} dias</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-1)] mb-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />
              Atenção (dias)
            </label>
            <input
              type="number"
              min={form.critico + 1}
              max={form.proximo - 1}
              value={form.atencao}
              onChange={(e) => setForm((f) => ({ ...f, atencao: parseInt(e.target.value) || (form.critico + 1) }))}
              className="ct-input"
            />
            <p className="text-xs text-[var(--text-3)] mt-1">Padrão: {LIMIARES_DEFAULTS.atencao} dias</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-1)] mb-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--ok)]" />
              Próximo (dias)
            </label>
            <input
              type="number"
              min={form.atencao + 1}
              value={form.proximo}
              onChange={(e) => setForm((f) => ({ ...f, proximo: parseInt(e.target.value) || (form.atencao + 1) }))}
              className="ct-input"
            />
            <p className="text-xs text-[var(--text-3)] mt-1">Padrão: {LIMIARES_DEFAULTS.proximo} dias</p>
          </div>
        </div>

        <div className="rounded-[var(--radius)] bg-[var(--surface-3)] p-4 text-sm text-[var(--text-2)] space-y-1.5">
          <div className="flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--danger)]" /> <strong className="font-semibold text-[var(--text-1)]">Vencido:</strong> dias &lt; 0</div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--danger)]" /> <strong className="font-semibold text-[var(--text-1)]">Crítico:</strong> 0 a {form.critico} dias</div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--warn)]" /> <strong className="font-semibold text-[var(--text-1)]">Atenção:</strong> {form.critico + 1} a {form.atencao} dias</div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--ok)]" /> <strong className="font-semibold text-[var(--text-1)]">Próximo:</strong> {form.atencao + 1} a {form.proximo} dias</div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--ok)]" /> <strong className="font-semibold text-[var(--text-1)]">Em dia:</strong> &gt; {form.proximo} dias</div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleReset} className="ct-btn-secondary">
            <RotateCcw size={16} />
            Restaurar padrão
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="ct-btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} className="ct-btn-primary">
            Salvar
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
