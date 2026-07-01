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
  fetchEmpresaObrigacoesConfig,
  updateEmpresaEmailCliente,
} from '@/lib/db';
import type { Empresa, EmpresaEmailCliente, EmpresaEmailTipo, UUID } from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  empresa: Empresa;
  zIndex?: number;
}

interface FormState {
  email: string;
  rotulo: string;
  tipo: EmpresaEmailTipo;
  principal: boolean;
}

const EMPTY_FORM: FormState = { email: '', rotulo: '', tipo: 'fiscal', principal: false };

const TIPO_LABEL: Record<EmpresaEmailTipo, string> = { fiscal: 'Fiscal', cadastro: 'Cadastro', livros_fiscais: 'Livros Fiscais' };

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
  // A opção de e-mail "Livros Fiscais" só existe pra empresas que têm a obrigação
  // LIVROS FISCAIS ativa (senão não faz sentido cadastrar destinatário pra ela).
  const [temLivrosFiscais, setTemLivrosFiscais] = useState(false);

  const tiposDisponiveis = useMemo<EmpresaEmailTipo[]>(
    () => (temLivrosFiscais ? ['fiscal', 'cadastro', 'livros_fiscais'] : ['fiscal', 'cadastro']),
    [temLivrosFiscais]
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelado = false;
    setLoading(true);
    Promise.all([
      fetchEmpresaEmailsCliente(empresa.id),
      fetchEmpresaObrigacoesConfig(empresa.id).catch(() => []),
    ])
      .then(([lista, configs]) => {
        if (cancelado) return;
        setEmails(lista);
        setTemLivrosFiscais(configs.some((c) => c.obrigacao === 'LIVROS FISCAIS' && c.ativa));
      })
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
    // Duplicado é por (e-mail + TIPO): o mesmo e-mail pode ser Fiscal E Cadastro
    // (recebe guias e certidões). Só bloqueia se já existir no MESMO tipo.
    if (emails.some((e) => e.email.toLowerCase() === email && e.tipo === form.tipo)) {
      mostrarAlerta('Atenção', `Este e-mail já está cadastrado como ${TIPO_LABEL[form.tipo]}.`, 'aviso');
      return;
    }
    setSalvando(true);
    try {
      const novo = await createEmpresaEmailCliente({
        empresaId: empresa.id,
        email,
        rotulo: form.rotulo.trim() || undefined,
        tipo: form.tipo,
        principal: form.principal,
      });
      // Se marcou como principal, despromove os outros DO MESMO TIPO (cada tipo —
      // fiscal/cadastro — tem o seu próprio principal).
      let nova = [...emails, novo];
      if (form.principal) {
        nova = nova.map((e) => (e.id === novo.id || e.tipo !== novo.tipo ? e : { ...e, principal: false }));
        await Promise.all(
          emails.filter((e) => e.principal && e.tipo === novo.tipo).map((e) =>
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
      tipo: e.tipo,
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
        tipo: editForm.tipo,
        principal: editForm.principal,
      });
      let nova = emails.map((e) => (e.id === item.id ? atualizado : e));
      if (editForm.principal) {
        // Despromove os outros DO MESMO TIPO (principal é por tipo).
        nova = nova.map((e) => (e.id === item.id || e.tipo !== atualizado.tipo ? e : { ...e, principal: false }));
        await Promise.all(
          emails
            .filter((e) => e.id !== item.id && e.principal && e.tipo === atualizado.tipo)
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
        dialogClassName="w-full max-w-2xl rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.18)] max-h-[90vh] overflow-y-auto"
        zIndex={zIndex}
      >
        <div className="border-b border-[var(--border-subtle)] p-5 flex items-start gap-3">
          <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] shrink-0">
            <Mail size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="modal-emails-cliente-titulo" className="text-base font-bold text-[var(--text-1)]">E-mails do cliente</h2>
            <p className="text-xs text-[var(--text-2)] truncate mt-0.5">
              {empresa.codigo} · {empresa.razao_social ?? empresa.apelido ?? 'Sem nome'}
            </p>
            <p className="text-[11px] text-[var(--text-3)] mt-0.5">
              Destinatários para envio automático de guias e notificações.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition shrink-0"
            aria-label="Fechar"
          >
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
            <div className="bg-[var(--surface-3)] rounded-[var(--radius)] p-4 border border-[var(--border)] mb-5">
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-3">Adicionar e-mail</h3>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="email"
                  placeholder="email@cliente.com.br *"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="ct-input sm:col-span-6"
                />
                <input
                  type="text"
                  placeholder="Rótulo (opcional, ex.: Financeiro)"
                  value={form.rotulo}
                  onChange={(e) => setForm({ ...form, rotulo: e.target.value })}
                  className="ct-input sm:col-span-4"
                />
                <button
                  onClick={handleAdd}
                  disabled={salvando || !form.email.trim()}
                  className="ct-btn-primary sm:col-span-2"
                >
                  {salvando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Adicionar
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-[var(--text-2)]">
                  <span className="font-semibold">Tipo:</span>
                  <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden">
                    {tiposDisponiveis.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm({ ...form, tipo: t })}
                        className={`px-3 py-1 text-xs font-semibold transition-colors ${
                          form.tipo === t ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'
                        }`}
                      >
                        {TIPO_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-[var(--text-2)]">
                  <input
                    type="checkbox"
                    checked={form.principal}
                    onChange={(e) => setForm({ ...form, principal: e.target.checked })}
                    className="h-4 w-4 accent-[var(--brand)] cursor-pointer"
                  />
                  <Star size={13} className="text-[var(--warn)]" />
                  <span>Marcar como <strong className="font-semibold text-[var(--text-1)]">principal</strong> (do tipo)</span>
                </label>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-3)]">
                <strong>Fiscal</strong> recebe as guias. <strong>Cadastro</strong> recebe as certidões (Controle Cadastro).
                {temLivrosFiscais && <> <strong>Livros Fiscais</strong> recebe só os livros — e-mail separado das guias.</>}
              </p>
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
                          className="ct-input sm:col-span-4"
                        />
                        <input
                          type="text"
                          value={editForm.rotulo}
                          onChange={(e) => setEditForm({ ...editForm, rotulo: e.target.value })}
                          placeholder="Rótulo"
                          className="ct-input sm:col-span-3"
                        />
                        <select
                          value={editForm.tipo}
                          onChange={(e) => setEditForm({ ...editForm, tipo: e.target.value as EmpresaEmailTipo })}
                          className="ct-input sm:col-span-2"
                        >
                          {/* Mostra 'Livros Fiscais' se a empresa tem a obrigação OU se este
                              e-mail já é desse tipo (não some ao editar um legado). */}
                          {(temLivrosFiscais ? tiposDisponiveis : Array.from(new Set([...tiposDisponiveis, editForm.tipo]))).map((t) => (
                            <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                          ))}
                        </select>
                        <label className="sm:col-span-2 inline-flex items-center gap-1 text-[11px] text-[var(--text-2)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editForm.principal}
                            onChange={(e) => setEditForm({ ...editForm, principal: e.target.checked })}
                            className="h-3.5 w-3.5 accent-[var(--brand)]"
                          />
                          <Star size={11} className="text-[var(--warn)]" /> Princ.
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
                        <Mail size={14} className="text-[var(--brand)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="ct-num text-sm text-gray-900 flex items-center gap-2 flex-wrap">
                            <span className="truncate">{item.email}</span>
                            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                              item.tipo === 'cadastro' ? 'bg-sky-100 text-sky-700'
                                : item.tipo === 'livros_fiscais' ? 'bg-amber-100 text-amber-700'
                                : 'bg-violet-100 text-violet-700'
                            }`}>
                              {TIPO_LABEL[item.tipo]}
                            </span>
                            {item.principal && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-[var(--warn-soft)] text-[var(--warn)] rounded px-1.5 py-0.5">
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
