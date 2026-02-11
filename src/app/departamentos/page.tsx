'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';

export default function DepartamentosPage() {
  const { canManage, departamentos, criarDepartamento, removerDepartamento, mostrarAlerta } = useSistema();
  const [nome, setNome] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Departamentos</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-2xl font-bold text-gray-900">Departamentos</div>
        <div className="text-sm text-gray-500">Cadastre departamentos e use para vincular usuários/responsáveis</div>

        <div className="mt-6 rounded-2xl bg-cyan-50 p-5">
          <div className="font-bold text-cyan-900">Criar Departamento</div>
          <div className="mt-4 flex gap-3">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400"
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
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition"
            >
              <Plus size={18} />
              Criar
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Lista ({departamentos.length})</div>
        <div className="mt-4 space-y-3">
          {departamentos.map((d) => (
            <div key={d.id} className="rounded-2xl bg-gray-50 p-4 flex items-center justify-between hover:shadow-sm transition">
              <div className="font-semibold text-gray-900">{d.nome}</div>
              <button
                onClick={() => setConfirmDeleteId(d.id)}
                className="rounded-xl bg-white p-2 hover:bg-red-50 transition shadow-sm"
                title="Excluir"
              >
                <Trash2 className="text-red-500" size={18} />
              </button>
            </div>
          ))}
          {departamentos.length === 0 && <div className="text-sm text-gray-500">Sem departamentos.</div>}
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
