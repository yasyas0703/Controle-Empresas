'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Tag as TagIcon, ChevronDown, ChevronUp, Search, Link2, Unlink, Building2, Pencil, Check, X } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';
import type { Tag, TagCor, UUID } from '@/app/types';

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  red: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  green: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  cyan: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
};

const COLOR_DOT: Record<string, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  emerald: 'bg-emerald-500',
  cyan: 'bg-cyan-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
};

const ALL_COLORS: TagCor[] = ['red', 'orange', 'amber', 'green', 'emerald', 'cyan', 'blue', 'violet', 'purple', 'pink', 'rose', 'slate'];

export default function TagsPage() {
  const { canManage, tags, criarTag, atualizarTag, removerTag, mostrarAlerta, empresas, atualizarEmpresa } = useSistema();
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState<TagCor>('blue');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchEmpresa, setSearchEmpresa] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editCor, setEditCor] = useState<TagCor>('blue');

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Tags</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  const usageCount = (tagNome: string) =>
    empresas.filter((e) => e.tags.includes(tagNome)).length;

  const getEmpresasVinculadas = (tagNome: string) =>
    empresas.filter((e) => e.tags.includes(tagNome));

  const getEmpresasNaoVinculadas = (tagNome: string) => {
    const q = searchEmpresa.trim().toLowerCase();
    return empresas
      .filter((e) => !e.tags.includes(tagNome))
      .filter((e) => {
        if (!q) return true;
        const hay = [e.codigo, e.cnpj, e.razao_social, e.apelido].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 20);
  };

  const vincularTag = async (empresaId: string, tagNome: string) => {
    const empresa = empresas.find((e) => e.id === empresaId);
    if (!empresa) return;
    if (empresa.tags.includes(tagNome)) return;
    await atualizarEmpresa(empresaId, { tags: [...empresa.tags, tagNome] });
    mostrarAlerta('Vinculada', `Tag vinculada à empresa ${empresa.codigo}.`, 'sucesso');
  };

  const desvincularTag = async (empresaId: string, tagNome: string) => {
    const empresa = empresas.find((e) => e.id === empresaId);
    if (!empresa) return;
    await atualizarEmpresa(empresaId, { tags: empresa.tags.filter((t) => t !== tagNome) });
    mostrarAlerta('Desvinculada', `Tag removida da empresa ${empresa.codigo}.`, 'sucesso');
  };

  const handleCriar = () => {
    if (!nome.trim()) {
      mostrarAlerta('Campo obrigatório', 'Informe o nome da tag.', 'aviso');
      return;
    }
    if (tags.some((t) => t.nome.toLowerCase() === nome.trim().toLowerCase())) {
      mostrarAlerta('Duplicada', 'Já existe uma tag com esse nome.', 'aviso');
      return;
    }
    criarTag(nome.trim(), cor);
    setNome('');
    setCor('blue');
    mostrarAlerta('Tag criada', 'Tag criada com sucesso.', 'sucesso');
  };

  const startEditing = (tag: Tag) => {
    setEditingId(tag.id);
    setEditNome(tag.nome);
    setEditCor(tag.cor);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditNome('');
    setEditCor('blue');
  };

  const saveEditing = () => {
    if (!editingId) return;
    if (!editNome.trim()) {
      mostrarAlerta('Campo obrigatório', 'Informe o nome da tag.', 'aviso');
      return;
    }
    const currentTag = tags.find((t) => t.id === editingId);
    if (!currentTag) return;

    // Check duplicates (excluding current tag)
    if (tags.some((t) => t.id !== editingId && t.nome.toLowerCase() === editNome.trim().toLowerCase())) {
      mostrarAlerta('Duplicada', 'Já existe uma tag com esse nome.', 'aviso');
      return;
    }

    const patch: { nome?: string; cor?: TagCor } = {};
    if (editNome.trim() !== currentTag.nome) patch.nome = editNome.trim();
    if (editCor !== currentTag.cor) patch.cor = editCor;

    if (Object.keys(patch).length === 0) {
      cancelEditing();
      return;
    }

    // If nome changed, update all empresas that reference the old name
    if (patch.nome) {
      const oldNome = currentTag.nome;
      const newNome = patch.nome;
      empresas.forEach((e) => {
        if (e.tags.includes(oldNome)) {
          atualizarEmpresa(e.id, { tags: e.tags.map((t) => (t === oldNome ? newNome : t)) });
        }
      });
    }

    atualizarTag(editingId, patch);
    mostrarAlerta('Tag atualizada', 'Tag atualizada com sucesso.', 'sucesso');
    cancelEditing();
  };

  const getColorStyle = (tagCor: string) => TAG_COLORS[tagCor] || TAG_COLORS.slate;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-50 p-2">
            <TagIcon className="text-violet-600" size={24} />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-gray-900">Tags</div>
            <div className="text-xs sm:text-sm text-gray-500">Cadastre tags com cores e vincule às empresas</div>
          </div>
        </div>

        <div className="mt-4 sm:mt-6 rounded-2xl bg-violet-50 p-4 sm:p-5">
          <div className="font-bold text-violet-900">Criar Tag</div>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCriar();
                }
              }}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-violet-400"
              placeholder="Nome da tag"
            />
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2">
              {ALL_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCor(c)}
                  className={`w-6 h-6 rounded-full ${COLOR_DOT[c]} transition-all ${
                    cor === c ? 'ring-2 ring-offset-2 ring-violet-500 scale-110' : 'hover:scale-110'
                  }`}
                  title={c}
                />
              ))}
            </div>
            <button
              onClick={handleCriar}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 text-white px-4 py-3 font-bold hover:from-violet-700 hover:to-purple-600 shadow-md transition"
            >
              <Plus size={18} />
              Criar
            </button>
          </div>
          {nome.trim() && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-violet-700">Prévia:</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getColorStyle(cor).bg} ${getColorStyle(cor).text} ${getColorStyle(cor).border}`}>
                {nome.trim()}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Lista ({tags.length})</div>
        <div className="mt-4 space-y-3">
          {tags.map((tag) => {
            const count = usageCount(tag.nome);
            const isExpanded = expandedId === tag.id;
            const isEditing = editingId === tag.id;
            const vinculadas = isExpanded ? getEmpresasVinculadas(tag.nome) : [];
            const naoVinculadas = isExpanded ? getEmpresasNaoVinculadas(tag.nome) : [];
            const style = getColorStyle(tag.cor);

            return (
              <div key={tag.id} className="rounded-2xl bg-gray-50 overflow-hidden hover:shadow-sm transition">
                <div className="p-4 flex items-center justify-between">
                  {isEditing ? (
                    <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                      <input
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEditing(); }
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="flex-1 rounded-xl bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400 border"
                        placeholder="Nome da tag"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        {ALL_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditCor(c)}
                            className={`w-5 h-5 rounded-full ${COLOR_DOT[c]} transition-all ${
                              editCor === c ? 'ring-2 ring-offset-1 ring-violet-500 scale-110' : 'hover:scale-110'
                            }`}
                            title={c}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEditing}
                          className="rounded-xl bg-green-50 p-2 hover:bg-green-100 transition shadow-sm"
                          title="Salvar"
                        >
                          <Check className="text-green-600" size={16} />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="rounded-xl bg-gray-100 p-2 hover:bg-gray-200 transition shadow-sm"
                          title="Cancelar"
                        >
                          <X className="text-gray-500" size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-3 flex-1 text-left"
                      onClick={() => { setExpandedId(isExpanded ? null : tag.id); setSearchEmpresa(''); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}>
                            {tag.nome}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {count === 0
                            ? 'Nenhuma empresa vinculada'
                            : count === 1
                              ? '1 empresa vinculada'
                              : `${count} empresas vinculadas`}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                    </button>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-2 ml-3">
                      <button
                        onClick={() => startEditing(tag)}
                        className="rounded-xl bg-white p-2 hover:bg-violet-50 transition shadow-sm"
                        title="Editar"
                      >
                        <Pencil className="text-violet-500" size={18} />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(tag.id)}
                        className="rounded-xl bg-white p-2 hover:bg-red-50 transition shadow-sm"
                        title="Excluir"
                      >
                        <Trash2 className="text-red-500" size={18} />
                      </button>
                    </div>
                  )}
                </div>

                {isExpanded && !isEditing && (
                  <div className="border-t border-gray-200 p-4 space-y-4">
                    {/* Empresas vinculadas */}
                    <div>
                      <div className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Link2 size={14} className="text-violet-600" />
                        Empresas vinculadas ({vinculadas.length})
                      </div>
                      {vinculadas.length === 0 ? (
                        <div className="text-sm text-gray-500 py-2">Nenhuma empresa vinculada a esta tag.</div>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {vinculadas.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-white border border-violet-100 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 rounded-md bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-bold">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-gray-900 truncate">{e.razao_social || e.apelido || '-'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-gray-500 mt-0.5">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => desvincularTag(e.id, tag.nome)}
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
                          className="w-full rounded-xl bg-white border pl-9 pr-4 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400 transition"
                        />
                      </div>
                      {naoVinculadas.length === 0 ? (
                        <div className="text-sm text-gray-500 py-2">
                          {searchEmpresa.trim() ? 'Nenhuma empresa encontrada.' : 'Todas as empresas já estão vinculadas.'}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {naoVinculadas.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-white border px-3 py-2 hover:border-violet-200 transition">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 rounded-md bg-gray-100 text-gray-600 px-1.5 py-0.5 text-[10px] font-bold">{e.codigo}</span>
                                  <span className="text-sm font-semibold text-gray-900 truncate">{e.razao_social || e.apelido || '-'}</span>
                                </div>
                                {e.cnpj && <div className="text-xs text-gray-500 mt-0.5">{e.cnpj}</div>}
                              </div>
                              <button
                                onClick={() => vincularTag(e.id, tag.nome)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-violet-50 text-violet-700 px-2 py-1.5 text-xs font-bold hover:bg-violet-100 transition"
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
          {tags.length === 0 && (
            <div className="text-sm text-gray-500">Nenhuma tag cadastrada. Crie tags acima para usá-las nas empresas.</div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!confirmDeleteId}
        title="Remover tag"
        message="Tem certeza que deseja remover esta tag? Ela será desvinculada de todas as empresas."
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteId) removerTag(confirmDeleteId); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
