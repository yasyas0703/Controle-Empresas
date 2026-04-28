'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Download, Eye, FileText, Filter, Folder, Loader2, Search, Trash2, X,
} from 'lucide-react';
import ModalBase from './ModalBase';
import ConfirmModal from './ConfirmModal';
import ModalVisualizadorArquivo from './ModalVisualizadorArquivo';
import { useSistema } from '@/app/context/SistemaContext';
import {
  deleteExtrato,
  fetchContasBancarias,
  fetchExtratosByEmpresa,
  getExtratoSignedUrl,
} from '@/lib/db';
import type { ContaBancaria, Empresa, ExtratoArquivo } from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  empresa: Empresa;
  onChange?: () => void;
  zIndex?: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDataHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function mesLabel(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  if (!y || !m) return mes;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

export default function ModalCentralExtratos({ isOpen, onClose, empresa, onChange, zIndex }: Props) {
  const { mostrarAlerta } = useSistema();
  const [bancos, setBancos] = useState<ContaBancaria[]>([]);
  const [extratos, setExtratos] = useState<ExtratoArquivo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtroBanco, setFiltroBanco] = useState<string>('');
  const [filtroAno, setFiltroAno] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<ExtratoArquivo | null>(null);
  const [visualizando, setVisualizando] = useState<ExtratoArquivo | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelado = false;
    setLoading(true);
    Promise.all([
      fetchContasBancarias(),
      fetchExtratosByEmpresa(empresa.id),
    ])
      .then(([todasContas, todosExtratos]) => {
        if (cancelado) return;
        setBancos(todasContas.filter((b) => b.empresaId === empresa.id));
        setExtratos(todosExtratos);
      })
      .catch((err) => {
        console.error(err);
        mostrarAlerta('Erro', 'Não foi possível carregar os extratos.', 'erro');
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [isOpen, empresa.id, mostrarAlerta]);

  const bancosMap = useMemo(() => {
    const map = new Map<string, ContaBancaria>();
    for (const b of bancos) map.set(b.id, b);
    return map;
  }, [bancos]);

  const anosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const e of extratos) {
      const ano = e.mes.split('-')[0];
      if (ano) set.add(ano);
    }
    return Array.from(set).sort().reverse();
  }, [extratos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return extratos.filter((e) => {
      if (filtroBanco && e.contaBancariaId !== filtroBanco) return false;
      if (filtroAno && !e.mes.startsWith(filtroAno + '-')) return false;
      if (q) {
        const banco = bancosMap.get(e.contaBancariaId)?.nome ?? '';
        const hay = `${e.arquivoNome} ${banco} ${e.mes} ${e.uploadedPorNome ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [extratos, busca, filtroBanco, filtroAno, bancosMap]);

  // Agrupa por mês desc, depois por banco
  const agrupados = useMemo(() => {
    const map = new Map<string, ExtratoArquivo[]>();
    for (const e of filtrados) {
      const lista = map.get(e.mes) ?? [];
      lista.push(e);
      map.set(e.mes, lista);
    }
    const meses = Array.from(map.keys()).sort().reverse();
    return meses.map((mes) => ({
      mes,
      itens: (map.get(mes) ?? []).sort((a, b) =>
        (bancosMap.get(a.contaBancariaId)?.nome ?? '').localeCompare(bancosMap.get(b.contaBancariaId)?.nome ?? '', 'pt-BR')
      ),
    }));
  }, [filtrados, bancosMap]);

  async function baixarExtrato(extrato: ExtratoArquivo) {
    try {
      const url = await getExtratoSignedUrl(extrato.arquivoPath);
      const a = document.createElement('a');
      a.href = url;
      a.download = extrato.arquivoNome;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível gerar o link de download.', 'erro');
    }
  }

  async function removerExtrato(extrato: ExtratoArquivo) {
    try {
      await deleteExtrato(extrato.id);
      setExtratos((prev) => prev.filter((e) => e.id !== extrato.id));
      mostrarAlerta('Extrato removido', `${extrato.arquivoNome} foi excluído.`, 'sucesso');
      setConfirmDelete(null);
      onChange?.();
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover o extrato.', 'erro');
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <ModalBase
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="modal-extratos-titulo"
        dialogClassName="w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
        zIndex={zIndex}
      >
        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white p-5 rounded-t-2xl flex items-start gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <Folder size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="modal-extratos-titulo" className="text-lg font-bold">Central de Extratos</h2>
            <p className="text-xs text-white/85 truncate">
              {empresa.codigo} · {empresa.razao_social ?? empresa.apelido ?? 'Sem nome'}
            </p>
            <p className="text-xs text-white/75 mt-0.5">
              {extratos.length} extrato{extratos.length === 1 ? '' : 's'} no total
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/20 transition" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-4">
            <div className="sm:col-span-5 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por arquivo, banco, mês..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <select
              value={filtroBanco}
              onChange={(e) => setFiltroBanco(e.target.value)}
              className="sm:col-span-4 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Todos os bancos</option>
              {bancos.map((b) => (
                <option key={b.id} value={b.id}>{b.nome}</option>
              ))}
            </select>
            <select
              value={filtroAno}
              onChange={(e) => setFiltroAno(e.target.value)}
              className="sm:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Todos os anos</option>
              {anosDisponiveis.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Lista */}
          {loading ? (
            <div className="py-10 flex items-center justify-center text-gray-400 text-sm">
              <Loader2 size={20} className="animate-spin mr-2" /> Carregando...
            </div>
          ) : agrupados.length === 0 ? (
            <div className="py-12 text-center">
              <Folder size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">
                {extratos.length === 0
                  ? 'Nenhum extrato foi anexado para esta empresa ainda.'
                  : 'Nenhum extrato encontrado com esses filtros.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {agrupados.map(({ mes, itens }) => (
                <div key={mes}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 capitalize">
                      {mesLabel(mes)}
                    </h3>
                    <span className="text-[10px] font-bold text-gray-400">{itens.length} arquivo{itens.length === 1 ? '' : 's'}</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <ul className="space-y-1.5">
                    {itens.map((ex) => {
                      const banco = bancosMap.get(ex.contaBancariaId);
                      return (
                        <li key={ex.id} className="rounded-lg border border-gray-200 bg-white p-2.5 flex items-center gap-3">
                          <FileText size={18} className="text-cyan-600 shrink-0" />
                          <button
                            onClick={() => setVisualizando(ex)}
                            className="flex-1 text-left min-w-0 hover:underline"
                            title="Visualizar"
                          >
                            <div className="text-sm font-medium text-gray-900 truncate">{ex.arquivoNome}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              <span className="font-semibold text-cyan-700">{banco?.nome ?? 'Banco removido'}</span>
                              {ex.uploadedPorNome ? ` · por ${ex.uploadedPorNome}` : ''}
                              {` · ${formatDataHora(ex.uploadedEm)}`}
                              {ex.tamanhoBytes ? ` · ${formatBytes(ex.tamanhoBytes)}` : ''}
                            </div>
                          </button>
                          <button
                            onClick={() => setVisualizando(ex)}
                            className="rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 p-1.5 transition shrink-0"
                            title="Visualizar pelo sistema"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => baixarExtrato(ex)}
                            className="rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 p-1.5 transition shrink-0"
                            title="Baixar"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(ex)}
                            className="rounded-lg bg-red-50 hover:bg-red-100 text-red-600 p-1.5 transition shrink-0"
                            title="Excluir extrato"
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {(busca || filtroBanco || filtroAno) && (
            <button
              onClick={() => { setBusca(''); setFiltroBanco(''); setFiltroAno(''); }}
              className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-gray-700"
            >
              <Filter size={12} /> Limpar filtros
            </button>
          )}
        </div>
      </ModalBase>

      <ConfirmModal
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removerExtrato(confirmDelete)}
        title="Excluir extrato?"
        message={
          confirmDelete
            ? `O arquivo "${confirmDelete.arquivoNome}" será removido permanentemente. Esta ação não pode ser desfeita.`
            : ''
        }
        confirmText="Excluir"
        variant="danger"
      />

      {visualizando && (
        <ModalVisualizadorArquivo
          isOpen
          onClose={() => setVisualizando(null)}
          arquivoPath={visualizando.arquivoPath}
          arquivoNome={visualizando.arquivoNome}
          arquivoId={visualizando.id}
          empresaId={empresa.id}
          contexto="extrato"
          uploadedPorNome={visualizando.uploadedPorNome}
          uploadedEm={visualizando.uploadedEm}
        />
      )}
    </>
  );
}
