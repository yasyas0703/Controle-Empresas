'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';

export default function ModalAdicionarDocumento({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (doc: { nome: string; validade: string }) => void;
}) {
  const [nome, setNome] = useState('');
  const [validade, setValidade] = useState('');

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="doc-title"
      dialogClassName="w-full max-w-lg bg-white rounded-2xl shadow-2xl outline-none"
      zIndex={1400}
    >
      <div className="rounded-2xl">
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h3 id="doc-title" className="text-lg font-bold text-white">
              Adicionar Documento
            </h3>
            <button onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <form
          className="p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ nome: nome.trim(), validade });
            setNome('');
            setValidade('');
            onClose();
          }}
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Nome do documento</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-xl border px-4 py-3"
              placeholder="Ex.: Certidão, Alvará, Procuração..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Validade</label>
            <input
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className="w-full rounded-xl border px-4 py-3"
              required
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border px-4 py-3 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 py-3 font-semibold"
              disabled={!nome.trim() || !validade}
            >
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  );
}
