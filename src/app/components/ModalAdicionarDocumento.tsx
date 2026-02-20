'use client';

import React, { useRef, useState } from 'react';
import { X, Upload, FileText, Globe, Building2, Lock, Users } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';
import { useSistema } from '@/app/context/SistemaContext';
import type { Departamento, Usuario, UUID, Visibilidade } from '@/app/types';

export default function ModalAdicionarDocumento({
  isOpen,
  onClose,
  onSubmit,
  departamentos,
  usuarios = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (doc: { nome: string; validade: string; arquivoUrl?: string; departamentosIds: UUID[]; visibilidade: Visibilidade; usuariosPermitidos: UUID[] }, file?: File) => void;
  departamentos: Departamento[];
  usuarios?: Usuario[];
}) {
  const [nome, setNome] = useState('');
  const [validade, setValidade] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selectedDepts, setSelectedDepts] = useState<UUID[]>([]);
  const [visibilidade, setVisibilidade] = useState<Visibilidade>('publico');
  const [selectedUsers, setSelectedUsers] = useState<UUID[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleDept = (id: UUID) => {
    setSelectedDepts((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleUser = (id: UUID) => {
    setSelectedUsers((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  };

  const handleRemoveFile = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const resetForm = () => {
    setNome('');
    setValidade('');
    setFile(null);
    setSelectedDepts([]);
    setVisibilidade('publico');
    setSelectedUsers([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const visOptions: { value: Visibilidade; label: string; desc: string; icon: React.ReactNode; color: string; border: string; bg: string }[] = [
    { value: 'publico', label: 'Público', desc: 'Todos os usuários podem ver', icon: <Globe size={16} />, color: 'text-green-700', border: 'border-green-300', bg: 'bg-green-50' },
    { value: 'departamento', label: 'Departamento', desc: 'Apenas departamentos selecionados', icon: <Building2 size={16} />, color: 'text-blue-700', border: 'border-blue-300', bg: 'bg-blue-50' },
    { value: 'usuarios', label: 'Por Usuários', desc: 'Apenas os usuários selecionados podem ver', icon: <Users size={16} />, color: 'text-purple-700', border: 'border-purple-300', bg: 'bg-purple-50' },
    { value: 'confidencial', label: 'Confidencial', desc: 'Somente você pode ver', icon: <Lock size={16} />, color: 'text-red-700', border: 'border-red-300', bg: 'bg-red-50' },
  ];

  // Usuários ativos para o seletor (sem o usuário logado — ele é incluído automaticamente)
  const { currentUserId, currentUser } = useSistema();
  const activeUsers = usuarios.filter((u) => u.ativo && u.id !== currentUserId);

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      labelledBy="doc-title"
      dialogClassName="w-full max-w-lg bg-white rounded-2xl shadow-2xl outline-none max-h-[90vh] overflow-y-auto"
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
            onSubmit(
              {
                nome: nome.trim(),
                validade,
                departamentosIds: selectedDepts,
                visibilidade,
                usuariosPermitidos: visibilidade === 'usuarios' ? selectedUsers : [],
              },
              file ?? undefined
            );
            resetForm();
            onClose();
          }}
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Nome do documento <span className="text-red-500">*</span>
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-xl border px-4 py-3"
              placeholder="Ex.: Certidão, Alvará, Procuração..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Validade <span className="text-xs text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className="w-full rounded-xl border px-4 py-3"
            />
          </div>

          {/* Visibilidade */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Visibilidade</label>
            <div className="grid grid-cols-2 gap-2">
              {visOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVisibilidade(opt.value)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 transition text-center ${
                    visibilidade === opt.value
                      ? `${opt.bg} ${opt.border} ${opt.color}`
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {opt.icon}
                  <span className="text-xs font-bold">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              {visOptions.find((o) => o.value === visibilidade)?.desc}
            </p>
          </div>

          {/* Departamentos responsáveis — visível para público e departamento */}
          {(visibilidade === 'publico' || visibilidade === 'departamento') && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Departamentos responsáveis
              </label>
              <p className="text-xs text-gray-500 mb-2">
                {visibilidade === 'departamento'
                  ? 'Apenas usuários dos departamentos selecionados poderão ver este documento.'
                  : 'Selecione quais departamentos devem acompanhar este documento. Se nenhum for selecionado, todos verão o vencimento.'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {departamentos.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                      selectedDepts.includes(d.id)
                        ? 'bg-orange-50 border-orange-300'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={() => toggleDept(d.id)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm font-semibold text-gray-800">{d.nome}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Seletor de usuários — visível quando visibilidade = 'usuarios' */}
          {visibilidade === 'usuarios' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Selecione os usuários que podem ver
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Apenas os usuários marcados abaixo terão acesso a este documento.
              </p>
              <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2 mb-2 text-xs text-purple-700 font-semibold">
                {currentUser?.nome ?? 'Você'} — incluído automaticamente
              </div>
              {activeUsers.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">Nenhum usuário ativo encontrado.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                  {activeUsers.map((u) => (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                        selectedUsers.includes(u.id)
                          ? 'bg-purple-50 border-purple-300'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(u.id)}
                        onChange={() => toggleUser(u.id)}
                        className="h-4 w-4 rounded"
                      />
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-gray-800 block truncate">{u.nome}</span>
                        <span className="text-xs text-gray-500">{u.email}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {selectedUsers.length > 0 && (
                <div className="text-xs text-purple-600 font-semibold mt-1.5">
                  {selectedUsers.length} usuário(s) selecionado(s)
                </div>
              )}
            </div>
          )}

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
                  <div className="text-xs text-gray-400 mt-1">PDF, DOC, XLS, imagens, TXT (max. 10MB)</div>
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
              className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!nome.trim() || (visibilidade === 'usuarios' && selectedUsers.length === 0)}
            >
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  );
}
