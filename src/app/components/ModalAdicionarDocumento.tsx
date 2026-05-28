'use client';

import React, { useRef, useState } from 'react';
import { X, Upload, FileText, Globe, Building2, Lock, Users } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';
import { useSistema } from '@/app/context/SistemaContext';
import { useFileDropZone } from '@/app/hooks/useFileDropZone';
import type { Departamento, Usuario, UUID, Visibilidade } from '@/app/types';

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;





export default function ModalAdicionarDocumento({
  isOpen,
  onClose,
  onSubmit,
  departamentos,
  usuarios = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (doc: { nome: string; validade: string; arquivoUrl?: string; departamentosIds: UUID[]; visibilidade: Visibilidade; usuariosPermitidos: UUID[] }, file?: File) => Promise<boolean> | boolean | void;
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

  const handleFileChange = (nextFile: File | null) => {
    if (!nextFile) {
      handleRemoveFile();
      return;
    }

    if (nextFile.size > MAX_DOCUMENT_SIZE) {
      mostrarAlerta('Arquivo muito grande', 'O arquivo deve ter no maximo 10MB.', 'aviso');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setFile(nextFile);
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
  const { currentUser, mostrarAlerta } = useSistema();
  const activeUsers = usuarios.filter((u) => u.ativo);

  const { isDragging, dragHandlers } = useFileDropZone({
    onFile: (f) => handleFileChange(f),
  });

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      labelledBy="doc-title"
      dialogClassName="w-full max-w-lg bg-[var(--surface-2)] rounded-[var(--radius-md)] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.18)] outline-none max-h-[90vh] overflow-y-auto"
      zIndex={1400}
    >
      <div>
        <div className="border-b border-[var(--border-subtle)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] shrink-0">
                <Upload size={18} />
              </div>
              <div className="min-w-0">
                <h3 id="doc-title" className="text-base font-bold text-[var(--text-1)]">
                  Adicionar Documento
                </h3>
                <p className="text-xs text-[var(--text-3)] mt-0.5">Anexe um arquivo e defina a visibilidade.</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] p-2 rounded-md transition shrink-0"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const departamentosIds = visibilidade === 'departamento' ? selectedDepts : [];
            const usuariosPermitidos = visibilidade === 'usuarios' ? selectedUsers : [];

            if (!file) {
              mostrarAlerta('Arquivo obrigatorio', 'Envie um arquivo antes de adicionar o documento.', 'aviso');
              return;
            }
            if (visibilidade === 'usuarios' && usuariosPermitidos.length === 0) {
              mostrarAlerta('Usuario obrigatorio', 'Selecione pelo menos um usuario.', 'aviso');
              return;
            }

            const ok = await Promise.resolve(onSubmit(
              {
                nome: nome.trim(),
                validade,
                departamentosIds,
                visibilidade,
                usuariosPermitidos,
              },
              file
            ));
            if (ok === false) return;
            resetForm();
            onClose();
          }}
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Nome do documento <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="ct-input"
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
              className="ct-input"
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
                  onClick={() => {
                    setVisibilidade(opt.value);
                    if (opt.value !== 'departamento') setSelectedDepts([]);
                    if (opt.value !== 'usuarios') setSelectedUsers([]);
                  }}
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
          {visibilidade === 'departamento' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Departamentos responsáveis
              </label>
              <p className="text-xs text-gray-500 mb-2">
                {visibilidade === 'departamento'
                  ? 'Se marcar departamentos, apenas eles veem. Se deixar vazio, todos os departamentos podem ver.'
                  : 'Selecione quais departamentos devem acompanhar este documento. Se nenhum for selecionado, todos verão o vencimento.'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {departamentos.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2.5 cursor-pointer transition ${
                      selectedDepts.includes(d.id)
                        ? 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand-strong)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface-3)]'
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
              <div className="hidden rounded-lg bg-purple-50 border border-purple-200 px-3 py-2 mb-2 text-xs text-purple-700 font-semibold">
                {currentUser?.nome ?? 'Você'} — incluído automaticamente
              </div>
              {activeUsers.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">Nenhum usuário ativo encontrado.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                  {activeUsers.map((u) => (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 rounded-[var(--radius)] border px-3 py-2.5 cursor-pointer transition ${
                        selectedUsers.includes(u.id)
                          ? 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand-strong)]'
                          : 'bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface-3)]'
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
                <div className="text-xs text-[var(--brand-strong)] font-semibold mt-1.5">
                  {selectedUsers.length} usuário(s) selecionado(s)
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Arquivo <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="hidden"
                id="doc-file-input"
              />
              {!file ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  {...dragHandlers}
                  className={`w-full rounded-[var(--radius)] border-2 border-dashed px-4 py-6 text-center transition ${
                    isDragging
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                      : 'border-[var(--border)] hover:border-[var(--brand)] hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <Upload size={24} className={`mx-auto mb-2 ${isDragging ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'}`} />
                  <div className="text-sm font-semibold text-[var(--text-2)]">
                    {isDragging ? 'Solte o arquivo aqui' : 'Clique para selecionar ou arraste o arquivo aqui'}
                  </div>
                  <div className="text-xs text-[var(--text-3)] mt-1">PDF, DOC, XLS, imagens, TXT (max. 10MB)</div>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-3)] px-4 py-3">
                  <FileText size={20} className="text-[var(--brand)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--text-1)] truncate">{file.name}</div>
                    <div className="text-xs text-[var(--text-3)]">{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="text-[var(--danger)] hover:opacity-80 text-xs font-bold"
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleClose} className="ct-btn-ghost flex-1">
              Cancelar
            </button>
            <button
              type="submit"
              className="ct-btn-primary flex-1"
              disabled={!nome.trim() || !file || (visibilidade === 'usuarios' && selectedUsers.length === 0)}
            >
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  );
}
