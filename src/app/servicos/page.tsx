'use client';

import React, { useState } from 'react';
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
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="text-lg font-bold text-[var(--text-1)] tracking-tight">Serviços</div>
        <div className="mt-2 text-sm text-[var(--text-2)]">Apenas gerentes têm acesso a esta área.</div>
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
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 sm:p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <Briefcase size={20} />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] tracking-tight">Serviços</div>
            <div className="text-xs sm:text-sm text-[var(--text-2)]">Cadastre serviços e vincule às empresas.</div>
          </div>
        </div>

        <div className="mt-5 rounded-[var(--radius)] bg-[var(--surface-3)] border border-[var(--border)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-3">Criar serviço</div>
          <div className="flex flex-col sm:flex-row gap-2">
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
              className="ct-input flex-1"
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
          Lista (<span className="ct-num text-[var(--text-1)]">{servicos.length}</span>)
        </div>
        <div className="space-y-2">
          {servicos.map((s) => {
            const count = usageCount(s.nome);
            const isExpanded = expandedId === s.id;
            const vinculadas = isExpanded ? getEmpresasVinculadas(s.nome) : [];
            const naoVinculadas = isExpanded ? getEmpresasNaoVinculadas(s.nome) : [];

            return (
              <div
                key={s.id}
                className="rounded-[var(--radius)] bg-[var(--surface-3)] border border-[var(--border)] overflow-hidden transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="p-3 flex items-center justify-between">
                  <button
                    className="flex items-center gap-3 flex-1 text-left"
                    onClick={() => { setExpandedId(isExpanded ? null : s.id); setSearchEmpresa(''); }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[var(--text-1)]">{s.nome}</div>
                      <div className="text-xs text-[var(--text-3)]">
                        {count === 0
                          ? 'Nenhuma empresa vinculada'
                          : count === 1
                            ? '1 empresa vinculada'
                            : (<><span className="ct-num">{count}</span> empresas vinculadas</>)}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-[var(--text-3)]" /> : <ChevronDown size={16} className="text-[var(--text-3)]" />}
                  </button>

                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="ml-3 rounded-md p-2 text-[var(--text-3)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--border)] p-4 space-y-4 bg-[var(--surface-2)]">
                    {/* Empresas vinculadas */}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2 flex items-center gap-2">
                        <Link2 size={12} />
                        Vinculadas (<span className="ct-num text-[var(--text-1)]">{vinculadas.length}</span>)
                      </div>
                      {vinculadas.length === 0 ? (
                        <div className="text-sm text-[var(--text-3)] py-2">Nenhuma empresa vinculada a este serviço.</div>
                      ) : (
                        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                          {vinculadas.map((e) => (
                            <div
                              key={e.id}
                              className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 ct-num rounded-sm bg-[var(--surface-3)] text-[var(--text-1)] px-1.5 py-0.5 text-[10px] font-semibold border border-[var(--border)]">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-[var(--text-1)] truncate">{e.razao_social || e.apelido || '—'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-[var(--text-3)] mt-0.5 ct-num">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => desvincularServico(e.id, s.nome)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40 transition-colors"
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
                      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2 flex items-center gap-2">
                        <Building2 size={12} />
                        Vincular empresas
                      </div>
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" size={14} />
                        <input
                          value={searchEmpresa}
                          onChange={(e) => setSearchEmpresa(e.target.value)}
                          placeholder="Buscar empresa por código, CNPJ ou razão social..."
                          className="ct-input pl-9 text-sm"
                        />
                      </div>
                      {naoVinculadas.length === 0 ? (
                        <div className="text-sm text-[var(--text-3)] py-2">
                          {searchEmpresa.trim() ? 'Nenhuma empresa encontrada.' : 'Todas as empresas já estão vinculadas.'}
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                          {naoVinculadas.map((e) => (
                            <div
                              key={e.id}
                              className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 hover:border-[var(--border-strong)] transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 ct-num rounded-sm bg-[var(--surface-3)] text-[var(--text-1)] px-1.5 py-0.5 text-[10px] font-semibold border border-[var(--border)]">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-[var(--text-1)] truncate">{e.razao_social || e.apelido || '—'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-[var(--text-3)] mt-0.5 ct-num">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => vincularServico(e.id, s.nome)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand-strong)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--brand-soft)] hover:border-[var(--brand)] transition-colors"
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
