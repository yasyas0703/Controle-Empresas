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
      dialogClassName="w-full max-w-md bg-white rounded-2xl shadow-2xl outline-none max-h-[90vh] overflow-y-auto"
      zIndex={1500}
    >
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-5 rounded-t-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Settings className="text-white" size={22} />
            <h3 id="limiares-title" className="text-lg font-bold text-white">
              Limiares de Vencimento
            </h3>
          </div>
          <button onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-lg transition">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-sm text-gray-600">
          Configure os limites de dias para cada nível de alerta. Itens com menos dias restantes que o limite serão classificados naquela categoria.
        </p>

        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-red-700 mb-2">
              <span className="h-3 w-3 rounded-full bg-orange-500" />
              Crítico (dias)
            </label>
            <input
              type="number"
              min={1}
              max={form.atencao - 1}
              value={form.critico}
              onChange={(e) => setForm((f) => ({ ...f, critico: parseInt(e.target.value) || 1 }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-violet-400"
            />
            <p className="text-xs text-gray-500 mt-1">Padrão: {LIMIARES_DEFAULTS.critico} dias</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-amber-700 mb-2">
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              Atenção (dias)
            </label>
            <input
              type="number"
              min={form.critico + 1}
              max={form.proximo - 1}
              value={form.atencao}
              onChange={(e) => setForm((f) => ({ ...f, atencao: parseInt(e.target.value) || (form.critico + 1) }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-violet-400"
            />
            <p className="text-xs text-gray-500 mt-1">Padrão: {LIMIARES_DEFAULTS.atencao} dias</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-green-700 mb-2">
              <span className="h-3 w-3 rounded-full bg-green-500" />
              Próximo (dias)
            </label>
            <input
              type="number"
              min={form.atencao + 1}
              value={form.proximo}
              onChange={(e) => setForm((f) => ({ ...f, proximo: parseInt(e.target.value) || (form.atencao + 1) }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-violet-400"
            />
            <p className="text-xs text-gray-500 mt-1">Padrão: {LIMIARES_DEFAULTS.proximo} dias</p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" /> <strong>Vencido:</strong> dias &lt; 0</div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-500" /> <strong>Crítico:</strong> 0 a {form.critico} dias</div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> <strong>Atenção:</strong> {form.critico + 1} a {form.atencao} dias</div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-green-500" /> <strong>Próximo:</strong> {form.atencao + 1} a {form.proximo} dias</div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> <strong>Em dia:</strong> &gt; {form.proximo} dias</div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 text-gray-600 px-4 py-2.5 font-bold hover:bg-gray-50 transition"
          >
            <RotateCcw size={16} />
            Restaurar padrão
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-4 py-2.5 text-gray-700 font-bold hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white px-5 py-2.5 font-bold hover:from-violet-600 hover:to-purple-700 shadow-md transition"
          >
            Salvar
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
