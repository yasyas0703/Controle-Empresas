'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Plus, Pencil, Check, X, Trash2, Power, PowerOff, Loader2 } from 'lucide-react';
import ModalBase from './ModalBase';
import ConfirmModal from './ConfirmModal';
import { useSistema } from '@/app/context/SistemaContext';
import {
  createContaBancaria,
  deleteContaBancaria,
  fetchContasBancarias,
  updateContaBancaria,
} from '@/lib/db';
import type { ContaBancaria, Empresa, UUID } from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  empresa: Empresa;
  onChange?: () => void;
}

interface FormState {
  nome: string;
  agencia: string;
  conta: string;
}

const EMPTY_FORM: FormState = { nome: '', agencia: '', conta: '' };

export default function ModalGerenciarBancos({ isOpen, onClose, empresa, onChange }: Props) {
  const { mostrarAlerta } = useSistema();
  const [bancos, setBancos] = useState<ContaBancaria[]>([]);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<UUID | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<ContaBancaria | null>(null);

  // mostrarAlerta vem do contexto e não é estável (recriado a cada render).
  // Sem ref, o useEffect abaixo entrava em loop infinito quando o modal abria
  // — por isso a tela "Adicionar Bancos" ficava carregando para sempre.
  const mostrarAlertaRef = useRef(mostrarAlerta);
  useEffect(() => {
    mostrarAlertaRef.current = mostrarAlerta;
  }, [mostrarAlerta]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelado = false;
    setLoading(true);
    fetchContasBancarias()
      .then((todas) => {
        if (cancelado) return;
        setBancos(todas.filter((b) => b.empresaId === empresa.id));
      })
      .catch((err) => {
        console.error(err);
        mostrarAlertaRef.current('Erro', 'Não foi possível carregar os bancos.', 'erro');
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [isOpen, empresa.id]);

  const bancosOrdenados = useMemo(
    () => [...bancos].sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, 'pt-BR')),
    [bancos]
  );

  async function handleAdd() {
    const nome = form.nome.trim();
    if (!nome) {
      mostrarAlerta('Atenção', 'O nome do banco é obrigatório.', 'aviso');
      return;
    }
    setSalvando(true);
    try {
      const novo = await createContaBancaria({
        empresaId: empresa.id,
        nome,
        agencia: form.agencia.trim() || undefined,
        conta: form.conta.trim() || undefined,
        ordem: bancos.length,
      });
      setBancos((prev) => [...prev, novo]);
      setForm(EMPTY_FORM);
      mostrarAlerta('Banco adicionado', `${novo.nome} foi cadastrado.`, 'sucesso');
      onChange?.();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível adicionar o banco.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  function startEdit(banco: ContaBancaria) {
    setEditId(banco.id);
    setEditForm({
      nome: banco.nome,
      agencia: banco.agencia ?? '',
      conta: banco.conta ?? '',
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditForm(EMPTY_FORM);
  }

  async function saveEdit(banco: ContaBancaria) {
    const nome = editForm.nome.trim();
    if (!nome) {
      mostrarAlerta('Atenção', 'O nome do banco é obrigatório.', 'aviso');
      return;
    }
    setSalvando(true);
    try {
      const atualizado = await updateContaBancaria(banco.id, {
        nome,
        agencia: editForm.agencia.trim() || undefined,
        conta: editForm.conta.trim() || undefined,
      });
      setBancos((prev) => prev.map((b) => (b.id === banco.id ? atualizado : b)));
      cancelEdit();
      onChange?.();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar as alterações.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function toggleAtivo(banco: ContaBancaria) {
    try {
      const atualizado = await updateContaBancaria(banco.id, { ativo: !banco.ativo });
      setBancos((prev) => prev.map((b) => (b.id === banco.id ? atualizado : b)));
      onChange?.();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível alterar o status do banco.', 'erro');
    }
  }

  async function handleDelete(banco: ContaBancaria) {
    try {
      await deleteContaBancaria(banco.id);
      setBancos((prev) => prev.filter((b) => b.id !== banco.id));
      mostrarAlerta('Banco removido', `${banco.nome} foi excluído.`, 'sucesso');
      setConfirmDelete(null);
      onChange?.();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível excluir. Pode haver conferências/extratos vinculados.', 'erro');
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <ModalBase
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="modal-bancos-titulo"
        dialogClassName="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white p-5 rounded-t-2xl flex items-start gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <Banknote size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="modal-bancos-titulo" className="text-lg font-bold">Bancos da empresa</h2>
            <p className="text-xs text-white/85 truncate">
              {empresa.codigo} · {empresa.razao_social ?? empresa.apelido ?? 'Sem nome'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-white/20 transition"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {/* Form de adição */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mb-5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Adicionar banco</h3>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                placeholder="Nome do banco *"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="sm:col-span-5 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Agência"
                value={form.agencia}
                onChange={(e) => setForm({ ...form, agencia: e.target.value })}
                className="sm:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Conta"
                value={form.conta}
                onChange={(e) => setForm({ ...form, conta: e.target.value })}
                className="sm:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <button
                onClick={handleAdd}
                disabled={salvando || !form.nome.trim()}
                className="sm:col-span-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {salvando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Adicionar
              </button>
            </div>
          </div>

          {/* Lista */}
          {loading ? (
            <div className="py-10 flex items-center justify-center text-gray-400 text-sm">
              <Loader2 size={20} className="animate-spin mr-2" /> Carregando bancos...
            </div>
          ) : bancosOrdenados.length === 0 ? (
            <div className="py-12 text-center">
              <Banknote size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Nenhum banco cadastrado ainda.</p>
              <p className="text-xs text-gray-400 mt-1">Adicione acima para começar a controlar extratos.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {bancosOrdenados.map((banco) => {
                const editando = editId === banco.id;
                return (
                  <li
                    key={banco.id}
                    className={`rounded-xl border ${banco.ativo ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'} p-3`}
                  >
                    {editando ? (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={editForm.nome}
                          onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })}
                          className="sm:col-span-5 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          placeholder="Nome do banco"
                        />
                        <input
                          type="text"
                          value={editForm.agencia}
                          onChange={(e) => setEditForm({ ...editForm, agencia: e.target.value })}
                          className="sm:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          placeholder="Agência"
                        />
                        <input
                          type="text"
                          value={editForm.conta}
                          onChange={(e) => setEditForm({ ...editForm, conta: e.target.value })}
                          className="sm:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          placeholder="Conta"
                        />
                        <div className="sm:col-span-2 flex gap-1 justify-end">
                          <button
                            onClick={() => saveEdit(banco)}
                            disabled={salvando}
                            className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white p-2 transition disabled:opacity-50"
                            title="Salvar"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 transition"
                            title="Cancelar"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                            <Banknote size={14} className="text-cyan-600 shrink-0" />
                            <span className="truncate">{banco.nome}</span>
                            {!banco.ativo && (
                              <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                                inativo
                              </span>
                            )}
                          </div>
                          {(banco.agencia || banco.conta) && (
                            <div className="text-xs text-gray-500 mt-0.5 ml-5">
                              {banco.agencia && <>Ag.: <span className="font-mono">{banco.agencia}</span></>}
                              {banco.agencia && banco.conta && ' · '}
                              {banco.conta && <>Cc.: <span className="font-mono">{banco.conta}</span></>}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => startEdit(banco)}
                            className="rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 p-2 transition"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleAtivo(banco)}
                            className={`rounded-lg p-2 transition ${
                              banco.ativo
                                ? 'bg-amber-100 hover:bg-amber-200 text-amber-700'
                                : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700'
                            }`}
                            title={banco.ativo ? 'Desativar' : 'Ativar'}
                          >
                            {banco.ativo ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(banco)}
                            className="rounded-lg bg-red-100 hover:bg-red-200 text-red-700 p-2 transition"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
        title="Excluir banco?"
        message={
          confirmDelete
            ? `O banco "${confirmDelete.nome}" será removido junto com TODAS as conferências mensais e extratos vinculados a ele. Esta ação não pode ser desfeita.`
            : ''
        }
        confirmText="Excluir"
        variant="danger"
      />
    </>
  );
}
