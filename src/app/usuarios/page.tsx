'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, CheckCircle2, XCircle, X, Shield, User } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import ConfirmModal from '@/app/components/ConfirmModal';
import type { Usuario } from '@/app/types';

export default function UsuariosPage() {
  const { canManage, usuarios, departamentos, criarUsuario, atualizarUsuario, toggleUsuarioAtivo, removerUsuario, mostrarAlerta } = useSistema();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<'gerente' | 'usuario'>('usuario');
  const [depId, setDepId] = useState<string>('');

  const [editUser, setEditUser] = useState<Usuario | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSenha, setEditSenha] = useState('');
  const [editRole, setEditRole] = useState<'gerente' | 'usuario'>('usuario');
  const [editDepId, setEditDepId] = useState<string>('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  const deps = useMemo(() => departamentos, [departamentos]);

  const openEditModal = (u: Usuario) => {
    setEditUser(u);
    setEditNome(u.nome);
    setEditEmail(u.email);
    setEditSenha('');
    setEditRole(u.role);
    setEditDepId(u.departamentoId || '');
  };

  const handleEditSave = () => {
    if (!editUser) return;
    if (!editNome.trim() || !editEmail.trim()) {
      mostrarAlerta('Campos obrigatórios', 'Nome e email são obrigatórios.', 'aviso');
      return;
    }
    const patch: Partial<Usuario> = {
      nome: editNome.trim(),
      email: editEmail.trim(),
      role: editRole,
      departamentoId: editDepId || null,
    };
    if (editSenha.trim()) {
      patch.senha = editSenha.trim();
    }
    atualizarUsuario(editUser.id, patch);
    setEditUser(null);
    mostrarAlerta('Usuário atualizado', `${editNome.trim()} foi atualizado com sucesso.`, 'sucesso');
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Usuários</div>
        <div className="mt-2 text-sm text-gray-600">Apenas gerentes têm acesso a esta área.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-2xl font-bold text-gray-900">Gerenciar Usuários</div>
        <div className="text-sm text-gray-500">Crie usuários, defina gerente/usuário e vincule ao departamento</div>

        <div className="mt-6 rounded-2xl bg-cyan-50 p-5">
          <div className="font-bold text-cyan-900">Criar Novo Usuário</div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome">
              <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400" placeholder="Nome do usuário" />
            </Field>
            <Field label="Senha">
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400" placeholder="Senha" />
            </Field>
            <Field label="Email (login)">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl bg-white px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400" placeholder="email@empresa.com" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tipo">
                <select value={role} onChange={(e) => setRole(e.target.value as any)} className="w-full rounded-xl bg-white px-4 py-3 text-gray-900">
                  <option value="usuario">Usuário</option>
                  <option value="gerente">Administrador</option>
                </select>
              </Field>
              <Field label="Departamento">
                <select value={depId} onChange={(e) => setDepId(e.target.value)} className="w-full rounded-xl bg-white px-4 py-3 text-gray-900">
                  <option value="">Selecione...</option>
                  {deps.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <button
            onClick={() => {
              if (!nome.trim() || !email.trim() || !senha.trim()) {
                mostrarAlerta('Campos obrigatórios', 'Nome, email e senha são obrigatórios.', 'aviso');
                return;
              }
              criarUsuario({
                nome: nome.trim(),
                email: email.trim(),
                senha,
                role,
                departamentoId: depId || null,
                ativo: true,
              });
              setNome('');
              setEmail('');
              setSenha('');
              setRole('usuario');
              setDepId('');
              mostrarAlerta('Usuário criado', 'Usuário criado com sucesso.', 'sucesso');
            }}
            className="mt-4 inline-flex items-center gap-2 w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md justify-center"
          >
            <Plus size={18} />
            Criar Usuário
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Usuários Cadastrados ({usuarios.length})</div>

        <div className="mt-4 space-y-3">
          {usuarios.map((u) => (
            <div key={u.id} className="rounded-2xl bg-gray-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:shadow-sm transition-shadow">
              <div className="min-w-0 flex items-center gap-3">
                <div className={'h-10 w-10 rounded-xl flex items-center justify-center ' + (u.role === 'gerente' ? 'bg-cyan-100' : 'bg-gray-200')}>
                  {u.role === 'gerente' ? <Shield size={18} className="text-cyan-600" /> : <User size={18} className="text-gray-500" />}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-gray-900 truncate">{u.nome}</div>
                  <div className="text-sm text-gray-500 truncate">{u.email}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {u.role === 'gerente' ? 'Administrador' : 'Usuário'}
                    {u.departamentoId ? ` · ${deps.find((d) => d.id === u.departamentoId)?.nome ?? ''}` : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className={"rounded-full px-3 py-1 text-xs font-bold " + (u.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500')}>
                  {u.ativo ? 'Ativo' : 'Inativo'}
                </span>

                <button
                  onClick={() => toggleUsuarioAtivo(u.id)}
                  className="rounded-xl bg-white p-2 hover:bg-gray-100 transition shadow-sm"
                  title={u.ativo ? 'Desativar' : 'Ativar'}
                >
                  {u.ativo ? <XCircle className="text-amber-500" size={18} /> : <CheckCircle2 className="text-emerald-500" size={18} />}
                </button>

                <button
                  onClick={() => openEditModal(u)}
                  className="rounded-xl bg-white p-2 hover:bg-teal-50 transition shadow-sm"
                  title="Editar"
                >
                  <Pencil className="text-teal-600" size={18} />
                </button>

                <button
                  onClick={() => setConfirmDeleteUserId(u.id)}
                  className="rounded-xl bg-white p-2 hover:bg-red-50 transition shadow-sm"
                  title="Excluir"
                >
                  <Trash2 className="text-red-500" size={18} />
                </button>
              </div>
            </div>
          ))}

          {usuarios.length === 0 && <div className="text-sm text-gray-500">Sem usuários.</div>}
        </div>
      </div>

      {/* Modal de Edição */}
      {editUser && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" onMouseDown={(e) => e.currentTarget === e.target && setEditUser(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-600 to-teal-500 p-5 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-white">Editar Usuário</div>
                <div className="text-sm text-cyan-100">{editUser.email}</div>
              </div>
              <button onClick={() => setEditUser(null)} className="text-white/80 hover:text-white">
                <X size={22} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <Field label="Nome">
                <input value={editNome} onChange={(e) => setEditNome(e.target.value)} className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white" />
              </Field>

              <Field label="Email (login)">
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white" />
              </Field>

              <Field label="Nova Senha (deixe vazio para manter)">
                <input type="password" value={editSenha} onChange={(e) => setEditSenha(e.target.value)} className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white" placeholder="Nova senha" />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Tipo">
                  <select value={editRole} onChange={(e) => setEditRole(e.target.value as any)} className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900">
                    <option value="usuario">Usuário</option>
                    <option value="gerente">Administrador</option>
                  </select>
                </Field>
                <Field label="Departamento">
                  <select value={editDepId} onChange={(e) => setEditDepId(e.target.value)} className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900">
                    <option value="">Nenhum</option>
                    {deps.map((d) => (
                      <option key={d.id} value={d.id}>{d.nome}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditUser(null)}
                  className="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-200 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEditSave}
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md"
                >
                  Salvar Alterações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDeleteUserId}
        title="Remover usuário"
        message="Tem certeza que deseja remover este usuário? Esta ação não pode ser desfeita."
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { if (confirmDeleteUserId) removerUsuario(confirmDeleteUserId); setConfirmDeleteUserId(null); }}
        onCancel={() => setConfirmDeleteUserId(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">{label}</label>
      {children}
    </div>
  );
}
