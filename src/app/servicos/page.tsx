'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Briefcase } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';

export default function ServicosPage() {
  const { canManage, servicos, criarServico, removerServico, mostrarAlerta, empresas } = useSistema();
  const [nome, setNome] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Serviços</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  // Count how many empresas use each serviço
  const usageCount = (servicoNome: string) =>
    empresas.filter((e) => e.servicos.includes(servicoNome)).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-50 p-2">
            <Briefcase className="text-teal-600" size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">Serviços</div>
            <div className="text-sm text-gray-500">Cadastre serviços para vincular às empresas</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-teal-50 p-5">
          <div className="font-bold text-teal-900">Criar Serviço</div>
          <div className="mt-4 flex gap-3">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!nome.trim()) return;
                  if (servicos.some((s) => s.nome.toLowerCase() === nome.trim().toLowerCase())) {
                    mostrarAlerta('Duplicado', 'Já existe um serviço com esse nome.', 'aviso');
                    return;
                  }
                  criarServico(nome.trim());
                  setNome('');
                  mostrarAlerta('Serviço criado', 'Serviço criado com sucesso.', 'sucesso');
                }
              }}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-teal-400"
              placeholder="Nome do serviço"
            />
            <button
              onClick={() => {
                if (!nome.trim()) {
                  mostrarAlerta('Campo obrigatório', 'Informe o nome do serviço.', 'aviso');
                  return;
                }
                if (servicos.some((s) => s.nome.toLowerCase() === nome.trim().toLowerCase())) {
                  mostrarAlerta('Duplicado', 'Já existe um serviço com esse nome.', 'aviso');
                  return;
                }
                criarServico(nome.trim());
                setNome('');
                mostrarAlerta('Serviço criado', 'Serviço criado com sucesso.', 'sucesso');
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 text-white px-4 py-3 font-bold hover:from-teal-700 hover:to-emerald-600 shadow-md transition"
            >
              <Plus size={18} />
              Criar
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Lista ({servicos.length})</div>
        <div className="mt-4 space-y-3">
          {servicos.map((s) => {
            const count = usageCount(s.nome);
            return (
              <div key={s.id} className="rounded-2xl bg-gray-50 p-4 flex items-center justify-between hover:shadow-sm transition">
                <div>
                  <div className="font-semibold text-gray-900">{s.nome}</div>
                  <div className="text-xs text-gray-500">
                    {count === 0
                      ? 'Nenhuma empresa vinculada'
                      : count === 1
                        ? '1 empresa vinculada'
                        : `${count} empresas vinculadas`}
                  </div>
                </div>
                <button
                  onClick={() => setConfirmDeleteId(s.id)}
                  className="rounded-xl bg-white p-2 hover:bg-red-50 transition shadow-sm"
                  title="Excluir"
                >
                  <Trash2 className="text-red-500" size={18} />
                </button>
              </div>
            );
          })}
          {servicos.length === 0 && (
            <div className="text-sm text-gray-500">Nenhum serviço cadastrado. Crie serviços acima para usá-los nas empresas.</div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!confirmDeleteId}
        title="Remover serviço"
        message="Tem certeza que deseja remover este serviço? Ele será desvinculado de todas as empresas."
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteId) removerServico(confirmDeleteId); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
