'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Briefcase, ChevronDown, ChevronUp, Search, Link2, Unlink, Building2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';

export default function ServicosPage() {
  const { canManage, servicos, criarServico, removerServico, mostrarAlerta, empresas, atualizarEmpresa } = useSistema();
  const [nome, setNome] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchEmpresa, setSearchEmpresa] = useState('');

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Serviços</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  // Count how many empresas use each serviço
  const usageCount = (servicoNome: string) =>
    empresas.filter((e) => e.servicos.includes(servicoNome)).length;

  const getEmpresasVinculadas = (servicoNome: string) =>
    empresas.filter((e) => e.servicos.includes(servicoNome));

  const getEmpresasNaoVinculadas = (servicoNome: string) => {
    const q = searchEmpresa.trim().toLowerCase();
    return empresas
      .filter((e) => !e.servicos.includes(servicoNome))
      .filter((e) => {
        if (!q) return true;
        const hay = [e.codigo, e.cnpj, e.razao_social, e.apelido].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 20);
  };

  const vincularServico = async (empresaId: string, servicoNome: string) => {
    const empresa = empresas.find((e) => e.id === empresaId);
    if (!empresa) return;
    if (empresa.servicos.includes(servicoNome)) return;
    await atualizarEmpresa(empresaId, { servicos: [...empresa.servicos, servicoNome] });
    mostrarAlerta('Vinculado', `Serviço vinculado à empresa ${empresa.codigo}.`, 'sucesso');
  };

  const desvincularServico = async (empresaId: string, servicoNome: string) => {
    const empresa = empresas.find((e) => e.id === empresaId);
    if (!empresa) return;
    await atualizarEmpresa(empresaId, { servicos: empresa.servicos.filter((s) => s !== servicoNome) });
    mostrarAlerta('Desvinculado', `Serviço removido da empresa ${empresa.codigo}.`, 'sucesso');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-50 p-2">
            <Briefcase className="text-teal-600" size={24} />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-gray-900">Serviços</div>
            <div className="text-xs sm:text-sm text-gray-500">Cadastre serviços e vincule às empresas</div>
          </div>
        </div>

        <div className="mt-4 sm:mt-6 rounded-2xl bg-teal-50 p-4 sm:p-5">
          <div className="font-bold text-teal-900">Criar Serviço</div>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
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

      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Lista ({servicos.length})</div>
        <div className="mt-4 space-y-3">
          {servicos.map((s) => {
            const count = usageCount(s.nome);
            const isExpanded = expandedId === s.id;
            const vinculadas = isExpanded ? getEmpresasVinculadas(s.nome) : [];
            const naoVinculadas = isExpanded ? getEmpresasNaoVinculadas(s.nome) : [];

            return (
              <div key={s.id} className="rounded-2xl bg-gray-50 overflow-hidden hover:shadow-sm transition">
                <div className="p-4 flex items-center justify-between">
                  <button
                    className="flex items-center gap-3 flex-1 text-left"
                    onClick={() => { setExpandedId(isExpanded ? null : s.id); setSearchEmpresa(''); }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900">{s.nome}</div>
                      <div className="text-xs text-gray-500">
                        {count === 0
                          ? 'Nenhuma empresa vinculada'
                          : count === 1
                            ? '1 empresa vinculada'
                            : `${count} empresas vinculadas`}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </button>

                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="ml-3 rounded-xl bg-white p-2 hover:bg-red-50 transition shadow-sm"
                    title="Excluir"
                  >
                    <Trash2 className="text-red-500" size={18} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 p-4 space-y-4">
                    {/* Empresas vinculadas */}
                    <div>
                      <div className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Link2 size={14} className="text-teal-600" />
                        Empresas vinculadas ({vinculadas.length})
                      </div>
                      {vinculadas.length === 0 ? (
                        <div className="text-sm text-gray-500 py-2">Nenhuma empresa vinculada a este serviço.</div>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {vinculadas.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-white border border-teal-100 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 rounded-md bg-teal-100 text-teal-700 px-1.5 py-0.5 text-[10px] font-bold">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-gray-900 truncate">{e.razao_social || e.apelido || '-'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-gray-500 mt-0.5">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => desvincularServico(e.id, s.nome)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-red-50 text-red-600 px-2 py-1.5 text-xs font-bold hover:bg-red-100 transition"
                                title="Desvincular"
                              >
                                <Unlink size={12} />
                                Desvincular
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Vincular novas empresas */}
                    <div>
                      <div className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Building2 size={14} className="text-cyan-600" />
                        Vincular empresas
                      </div>
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                        <input
                          value={searchEmpresa}
                          onChange={(e) => setSearchEmpresa(e.target.value)}
                          placeholder="Buscar empresa por código, CNPJ ou razão social..."
                          className="w-full rounded-xl bg-white border pl-9 pr-4 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-teal-400 transition"
                        />
                      </div>
                      {naoVinculadas.length === 0 ? (
                        <div className="text-sm text-gray-500 py-2">
                          {searchEmpresa.trim() ? 'Nenhuma empresa encontrada.' : 'Todas as empresas já estão vinculadas.'}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {naoVinculadas.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-white border px-3 py-2 hover:border-teal-200 transition">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 rounded-md bg-gray-100 text-gray-600 px-1.5 py-0.5 text-[10px] font-bold">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-gray-900 truncate">{e.razao_social || e.apelido || '-'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-gray-500 mt-0.5">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => vincularServico(e.id, s.nome)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-teal-50 text-teal-700 px-2 py-1.5 text-xs font-bold hover:bg-teal-100 transition"
                                title="Vincular"
                              >
                                <Link2 size={12} />
                                Vincular
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
