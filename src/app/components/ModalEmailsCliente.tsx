'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Check, Loader2, Mail, Pencil, Plus, Power, PowerOff, Star, Trash2, X,
} from 'lucide-react';
import ModalBase from './ModalBase';
import ConfirmModal from './ConfirmModal';
import { useSistema } from '@/app/context/SistemaContext';
import {
  createEmpresaEmailCliente,
  deleteEmpresaEmailCliente,
  fetchEmpresaEmailsCliente,
  updateEmpresaEmailCliente,
} from '@/lib/db';
import type { Empresa, EmpresaEmailCliente, UUID } from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  empresa: Empresa;
  zIndex?: number;
}

interface FormState {
  email: string;
  rotulo: string;
  principal: boolean;
}

const EMPTY_FORM: FormState = { email: '', rotulo: '', principal: false };

function isEmailValido(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function ModalEmailsCliente({ isOpen, onClose, empresa, zIndex }: Props) {
  const { mostrarAlerta, canManage } = useSistema();
  const [emails, setEmails] = useState<EmpresaEmailCliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<UUID | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<EmpresaEmailCliente | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelado = false;
    setLoading(true);
    fetchEmpresaEmailsCliente(empresa.id)
      .then((lista) => { if (!cancelado) setEmails(lista); })
      .catch((err) => {
        console.error(err);
        mostrarAlerta('Erro', 'Não foi possível carregar os e-mails.', 'erro');
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [isOpen, empresa.id, mostrarAlerta]);

  const ordenados = useMemo(
    () => [...emails].sort((a, b) => {
      if (a.principal !== b.principal) return a.principal ? -1 : 1;
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      return a.email.localeCompare(b.email);
    }),
    [emails]
  );

  async function handleAdd() {
    const email = form.email.trim().toLowerCase();
    if (!isEmailValido(email)) {
      mostrarAlerta('Atenção', 'E-mail inválido.', 'aviso');
      return;
    }
    if (emails.some((e) => e.email.toLowerCase() === email)) {
      mostrarAlerta('Atenção', 'Este e-mail já está cadastrado.', 'aviso');
      return;
    }
    setSalvando(true);
    try {
      const novo = await createEmpresaEmailCliente({
        empresaId: empresa.id,
        email,
        rotulo: form.rotulo.trim() || undefined,
        principal: form.principal,
      });
      // Se marcou como principal, despromove os outros localmente (o banco aceita múltiplos
      // mas convencionalmente só queremos 1 principal).
      let nova = [...emails, novo];
      if (form.principal) {
        nova = nova.map((e) => (e.id === novo.id ? e : { ...e, principal: false }));
        // Persiste a despromoção dos outros
        await Promise.all(
          emails.filter((e) => e.principal).map((e) =>
            updateEmpresaEmailCliente(e.id, { principal: false }).catch(console.error)
          )
        );
      }
      setEmails(nova);
      setForm(EMPTY_FORM);
      mostrarAlerta('E-mail adicionado', email, 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao adicionar.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  function startEdit(e: EmpresaEmailCliente) {
    setEditId(e.id);
    setEditForm({
      email: e.email,
      rotulo: e.rotulo ?? '',
      principal: e.principal,
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditForm(EMPTY_FORM);
  }

  async function saveEdit(item: EmpresaEmailCliente) {
    const email = editForm.email.trim().toLowerCase();
    if (!isEmailValido(email)) {
      mostrarAlerta('Atenção', 'E-mail inválido.', 'aviso');
      return;
    }
    setSalvando(true);
    try {
      const atualizado = await updateEmpresaEmailCliente(item.id, {
        email,
        rotulo: editForm.rotulo.trim() || undefined,
        principal: editForm.principal,
      });
      let nova = emails.map((e) => (e.id === item.id ? atualizado : e));
      if (editForm.principal && !item.principal) {
        // Despromove os outros
        nova = nova.map((e) => (e.id === item.id ? e : { ...e, principal: false }));
        await Promise.all(
          emails
            .filter((e) => e.id !== item.id && e.principal)
            .map((e) => updateEmpresaEmailCliente(e.id, { principal: false }).catch(console.error))
        );
      }
      setEmails(nova);
      cancelEdit();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Falha ao salvar.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function toggleAtivo(item: EmpresaEmailCliente) {
    try {
      const atualizado = await updateEmpresaEmailCliente(item.id, { ativo: !item.ativo });
      setEmails((prev) => prev.map((e) => (e.id === item.id ? atualizado : e)));
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível alterar o status.', 'erro');
    }
  }

  async function handleDelete(item: EmpresaEmailCliente) {
    try {
      await deleteEmpresaEmailCliente(item.id);
      setEmails((prev) => prev.filter((e) => e.id !== item.id));
      mostrarAlerta('E-mail removido', item.email, 'sucesso');
      setConfirmDelete(null);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover.', 'erro');
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <ModalBase
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="modal-emails-cliente-titulo"
        dialogClassName="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
        zIndex={zIndex}
      >
        <div className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white p-5 rounded-t-2xl flex items-start gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <Mail size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="modal-emails-cliente-titulo" className="text-lg font-bold">E-mails do cliente</h2>
            <p className="text-xs text-white/85 truncate">
              {empresa.codigo} · {empresa.razao_social ?? empresa.apelido ?? 'Sem nome'}
            </p>
            <p className="text-[11px] text-white/75 mt-0.5">
              Destinatários para envio automático de guias e notificações.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/20 transition" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {!canManage && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Você não tem permissão para editar. Apenas admins/gerentes podem cadastrar e-mails.
            </div>
          )}

          {/* Form de adição */}
          {canManage && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mb-5">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Adicionar e-mail</h3>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="email"
                  placeholder="email@cliente.com.br *"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="sm:col-span-6 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Rótulo (opcional, ex.: Financeiro)"
                  value={form.rotulo}
                  onChange={(e) => setForm({ ...form, rotulo: e.target.value })}
                  className="sm:col-span-4 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleAdd}
                  disabled={salvando || !form.email.trim()}
                  className="sm:col-span-2 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {salvando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Adicionar
                </button>
              </div>
              <label className="mt-2 inline-flex items-center gap-2 cursor-pointer text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={form.principal}
                  onChange={(e) => setForm({ ...form, principal: e.target.checked })}
                  className="h-4 w-4 accent-indigo-600 cursor-pointer"
                />
                <Star size={13} className="text-amber-500" />
                <span>Marcar como <strong>principal</strong> (será o destinatário primário)</span>
              </label>
            </div>
          )}

          {/* Lista */}
          {loading ? (
            <div className="py-10 flex items-center justify-center text-gray-400 text-sm">
              <Loader2 size={20} className="animate-spin mr-2" /> Carregando...
            </div>
          ) : ordenados.length === 0 ? (
            <div className="py-12 text-center">
              <Mail size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Nenhum e-mail cadastrado ainda.</p>
              {canManage && <p className="text-xs text-gray-400 mt-1">Adicione acima.</p>}
            </div>
          ) : (
            <ul className="space-y-2">
              {ordenados.map((item) => {
                const editando = editId === item.id;
                return (
                  <li
                    key={item.id}
                    className={`rounded-xl border ${item.ativo ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'} p-3`}
                  >
                    {editando ? (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="sm:col-span-6 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          value={editForm.rotulo}
                          onChange={(e) => setEditForm({ ...editForm, rotulo: e.target.value })}
                          placeholder="Rótulo"
                          className="sm:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <label className="sm:col-span-2 inline-flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editForm.principal}
                            onChange={(e) => setEditForm({ ...editForm, principal: e.target.checked })}
                            className="h-3.5 w-3.5 accent-indigo-600"
                          />
                          <Star size={11} className="text-amber-500" /> Principal
                        </label>
                        <div className="sm:col-span-1 flex gap-1 justify-end">
                          <button
                            onClick={() => saveEdit(item)}
                            disabled={salvando}
                            className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white p-2 transition disabled:opacity-50"
                            title="Salvar"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 transition"
                            title="Cancelar"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Mail size={14} className="text-indigo-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-sm text-gray-900 flex items-center gap-2 flex-wrap">
                            <span className="truncate">{item.email}</span>
                            {item.principal && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
                                <Star size={10} /> PRINCIPAL
                              </span>
                            )}
                            {!item.ativo && (
                              <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                                inativo
                              </span>
                            )}
                          </div>
                          {item.rotulo && (
                            <div className="text-xs text-gray-500 mt-0.5">{item.rotulo}</div>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => startEdit(item)}
                              className="rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 p-2 transition"
                              title="Editar"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => toggleAtivo(item)}
                              className={`rounded-lg p-2 transition ${
                                item.ativo
                                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-700'
                                  : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700'
                              }`}
                              title={item.ativo ? 'Desativar' : 'Ativar'}
                            >
                              {item.ativo ? <PowerOff size={13} /> : <Power size={13} />}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(item)}
                              className="rounded-lg bg-red-100 hover:bg-red-200 text-red-700 p-2 transition"
                              title="Excluir"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ModalBase>

      <ConfirmModal
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Remover e-mail?"
        message={
          confirmDelete
            ? `O e-mail "${confirmDelete.email}" será removido da lista de destinatários.`
            : ''
        }
        confirmText="Remover"
        variant="danger"
      />
    </>
  );
}
