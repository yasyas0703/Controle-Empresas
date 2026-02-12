'use client';

import React, { useRef, useState } from 'react';
import { X, Upload, FileText } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';

export default function ModalAdicionarDocumento({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (doc: { nome: string; validade: string; arquivoUrl?: string }, file?: File) => void;
}) {
  const [nome, setNome] = useState('');
  const [validade, setValidade] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleRemoveFile = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    setNome('');
    setValidade('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    onClose();
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
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
            <button onClick={handleClose} className="text-white hover:bg-white/20 p-2 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <form
          className="p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ nome: nome.trim(), validade }, file ?? undefined);
            setNome('');
            setValidade('');
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
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

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Arquivo (opcional)</label>
            <div className="relative">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
                id="doc-file-input"
              />
              {!file ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-gray-300 px-4 py-6 text-center hover:border-orange-400 hover:bg-orange-50 transition"
                >
                  <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                  <div className="text-sm font-semibold text-gray-600">Clique para selecionar arquivo</div>
                  <div className="text-xs text-gray-400 mt-1">PDF, DOC, XLS, imagens (máx. 10MB)</div>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                  <FileText size={20} className="text-orange-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 truncate">{file.name}</div>
                    <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="text-red-500 hover:text-red-700 text-xs font-bold"
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
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
