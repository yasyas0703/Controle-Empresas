'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Layers } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';

export default function DepartamentosPage() {
  const { canManage, departamentos, criarDepartamento, removerDepartamento, mostrarAlerta } = useSistema();
  const [nome, setNome] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="text-lg font-bold text-[var(--text-1)] tracking-tight">Departamentos</div>
        <div className="mt-2 text-sm text-[var(--text-2)]">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">Departamentos</div>
            <div className="text-xs sm:text-sm text-[var(--text-2)]">Cadastre departamentos e use para vincular usuários/responsáveis.</div>
          </div>
        </div>

        <div className="mt-5 rounded-[var(--radius)] bg-[var(--surface-3)] border border-[var(--border)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-3">Criar departamento</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="ct-input flex-1"
              placeholder="Nome do departamento"
            />
            <button
              onClick={() => {
                if (!nome.trim()) {
                  mostrarAlerta('Campo obrigatório', 'Informe o nome do departamento.', 'aviso');
                  return;
                }
                criarDepartamento(nome.trim());
                setNome('');
                mostrarAlerta('Departamento criado', 'Departamento criado com sucesso.', 'sucesso');
              }}
              className="ct-btn-primary"
            >
              <Plus size={16} />
              Criar
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-3">
          Lista (<span className="ct-num text-[var(--text-1)]">{departamentos.length}</span>)
        </div>
        <div className="space-y-2">
          {departamentos.map((d) => (
            <div
              key={d.id}
              className="rounded-[var(--radius)] bg-[var(--surface-3)] border border-[var(--border)] p-3 flex items-center justify-between transition-colors hover:border-[var(--border-strong)]"
            >
              <div className="font-semibold text-[var(--text-1)]">{d.nome}</div>
              <button
                onClick={() => setConfirmDeleteId(d.id)}
                className="rounded-md p-2 text-[var(--text-3)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors"
                title="Excluir"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {departamentos.length === 0 && (
            <div className="text-sm text-[var(--text-3)] py-4 text-center">Sem departamentos cadastrados.</div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!confirmDeleteId}
        title="Remover departamento"
        message="Tem certeza que deseja remover este departamento? Usuários e responsáveis vinculados serão desassociados."
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteId) removerDepartamento(confirmDeleteId); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
