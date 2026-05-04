'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote, Calendar, Check, Download, Eye, FileText, Loader2, MinusCircle, Paperclip,
  Trash2, Upload, X, AlertCircle, CheckCircle2,
} from 'lucide-react';
import ModalBase from './ModalBase';
import ConfirmModal from './ConfirmModal';
import ModalVisualizadorArquivo from './ModalVisualizadorArquivo';
import { useSistema } from '@/app/context/SistemaContext';
import {
  deleteControleContabilStatus,
  deleteExtrato,
  fetchExtratosByContaMes,
  getExtratoSignedUrl,
  upsertControleContabilStatus,
  uploadExtrato,
} from '@/lib/db';
import type {
  ContaBancaria,
  ControleContabilExtrato,
  ControleContabilStatus,
  Empresa,
  ExtratoArquivo,
} from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  empresa: Empresa;
  banco: ContaBancaria;
  mes: string;                    // 'YYYY-MM'
  mesLabel: string;               // ex: 'Março 2026'
  statusAtual: ControleContabilExtrato | null;
  onChange: (status: ControleContabilExtrato | null, extratosCount: number) => void;
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

export default function ModalConferenciaCelula({
  isOpen, onClose, empresa, banco, mes, mesLabel, statusAtual, onChange,
}: Props) {
  const { mostrarAlerta, currentUser, currentUserId } = useSistema();
  const [status, setStatus] = useState<ControleContabilExtrato | null>(statusAtual);
  const [extratos, setExtratos] = useState<ExtratoArquivo[]>([]);
  const [observacao, setObservacao] = useState(statusAtual?.observacao ?? '');
  const [loading, setLoading] = useState(false);
  const [salvandoStatus, setSalvandoStatus] = useState<ControleContabilStatus | 'limpar' | null>(null);
  const [uploadando, setUploadando] = useState(false);
  const [confirmDeleteExtrato, setConfirmDeleteExtrato] = useState<ExtratoArquivo | null>(null);
  const [visualizando, setVisualizando] = useState<ExtratoArquivo | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // mostrarAlerta vem do contexto e não é estável — usa ref pra não re-disparar o efeito
  const mostrarAlertaRef = useRef(mostrarAlerta);
  useEffect(() => { mostrarAlertaRef.current = mostrarAlerta; }, [mostrarAlerta]);

  // Sincroniza prop -> state local quando abre ou quando o pai atualiza statusAtual
  useEffect(() => {
    if (!isOpen) return;
    setStatus(statusAtual);
    setObservacao(statusAtual?.observacao ?? '');
  }, [isOpen, statusAtual]);

  // Carrega extratos somente quando abre / muda banco / muda mes (NÃO depende de statusAtual)
  useEffect(() => {
    if (!isOpen) return;
    let cancelado = false;
    setLoading(true);
    fetchExtratosByContaMes(banco.id, mes)
      .then((lista) => { if (!cancelado) setExtratos(lista); })
      .catch((err) => {
        console.error(err);
        if (!cancelado) mostrarAlertaRef.current('Erro', 'Não foi possível carregar os extratos.', 'erro');
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [isOpen, banco.id, mes]);

  async function aplicarStatus(novo: ControleContabilStatus) {
    setSalvandoStatus(novo);
    try {
      const persistido = await upsertControleContabilStatus({
        empresaId: empresa.id,
        contaBancariaId: banco.id,
        mes,
        status: novo,
        marcadoPorId: currentUserId,
        marcadoPorNome: currentUser?.nome,
        observacao: observacao.trim() || null,
      });
      setStatus(persistido);
      onChange(persistido, extratos.length);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      // Detectar erro de check constraint do sem_movimento
      if (novo === 'sem_movimento' && /check.*status/i.test(msg)) {
        mostrarAlerta(
          'Falta rodar o SQL',
          'O status "sem movimento" ainda não foi habilitado no banco. Rode o arquivo supabase-schema-controle-contabil-v2.sql no Supabase.',
          'erro'
        );
      } else {
        mostrarAlerta('Erro', msg || 'Não foi possível salvar a marcação.', 'erro');
      }
    } finally {
      setSalvandoStatus(null);
    }
  }

  async function limparStatus() {
    setSalvandoStatus('limpar');
    try {
      await deleteControleContabilStatus(banco.id, mes);
      setStatus(null);
      onChange(null, extratos.length);
      mostrarAlerta('Marcação removida', 'A célula voltou ao estado branco.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível limpar a marcação.', 'erro');
    } finally {
      setSalvandoStatus(null);
    }
  }

  async function salvarObservacao() {
    if (!status) return; // só salva se já tem status
    try {
      const persistido = await upsertControleContabilStatus({
        empresaId: empresa.id,
        contaBancariaId: banco.id,
        mes,
        status: status.status,
        marcadoPorId: currentUserId,
        marcadoPorNome: currentUser?.nome,
        observacao: observacao.trim() || null,
      });
      setStatus(persistido);
      onChange(persistido, extratos.length);
      mostrarAlerta('Salvo', 'Observação atualizada.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar a observação.', 'erro');
    }
  }

  async function handleUpload(file: File) {
    setUploadando(true);
    try {
      const novo = await uploadExtrato({
        empresaId: empresa.id,
        contaBancariaId: banco.id,
        mes,
        file,
        uploadedPorId: currentUserId,
        uploadedPorNome: currentUser?.nome,
      });
      const novaLista = [novo, ...extratos];
      setExtratos(novaLista);
      // Auto-marca verde se ainda não estava
      let statusAtualizado = status;
      if (!status || status.status !== 'feito') {
        statusAtualizado = await upsertControleContabilStatus({
          empresaId: empresa.id,
          contaBancariaId: banco.id,
          mes,
          status: 'feito',
          marcadoPorId: currentUserId,
          marcadoPorNome: currentUser?.nome,
          observacao: observacao.trim() || null,
        });
        setStatus(statusAtualizado);
      }
      onChange(statusAtualizado, novaLista.length);
      mostrarAlerta('Extrato anexado', `${novo.arquivoNome} foi adicionado.`, 'sucesso');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Falha no upload.';
      mostrarAlerta('Erro', msg, 'erro');
    } finally {
      setUploadando(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
      const novaLista = extratos.filter((e) => e.id !== extrato.id);
      setExtratos(novaLista);
      onChange(status, novaLista.length);
      mostrarAlerta('Extrato removido', `${extrato.arquivoNome} foi excluído.`, 'sucesso');
      setConfirmDeleteExtrato(null);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover o extrato.', 'erro');
      setConfirmDeleteExtrato(null);
    }
  }

  const corHeader =
    status?.status === 'feito'
      ? 'from-emerald-500 to-teal-600'
      : status?.status === 'recebido_pendente'
        ? 'from-orange-500 to-amber-600'
        : status?.status === 'sem_movimento'
          ? 'from-slate-400 to-slate-600'
          : 'from-slate-500 to-slate-700';

  return (
    <>
      <ModalBase
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="modal-celula-titulo"
        dialogClassName="w-full max-w-lg rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className={`bg-gradient-to-r ${corHeader} text-white p-5 rounded-t-2xl flex items-start gap-3`}>
          <div className="p-2 bg-white/20 rounded-xl"><Banknote size={22} /></div>
          <div className="flex-1 min-w-0">
            <h2 id="modal-celula-titulo" className="text-base font-bold flex items-center gap-2">
              <span className="truncate">{banco.nome}</span>
            </h2>
            <p className="text-xs text-white/85 truncate">
              {empresa.codigo} · {empresa.razao_social ?? empresa.apelido ?? ''}
            </p>
            <p className="text-xs text-white/85 mt-1 flex items-center gap-1">
              <Calendar size={12} />
              <span className="capitalize">{mesLabel}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/20 transition" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status atual */}
          {status && (
            <div className={`rounded-xl border p-3 flex items-start gap-3 ${
              status.status === 'feito'
                ? 'bg-emerald-50 border-emerald-200'
                : status.status === 'recebido_pendente'
                  ? 'bg-orange-50 border-orange-200'
                  : 'bg-slate-50 border-slate-200'
            }`}>
              {status.status === 'feito'
                ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                : status.status === 'recebido_pendente'
                  ? <AlertCircle size={20} className="text-orange-600 shrink-0 mt-0.5" />
                  : <MinusCircle size={20} className="text-slate-500 shrink-0 mt-0.5" />
              }
              <div className="flex-1 text-sm">
                <div className={`font-bold ${
                  status.status === 'feito' ? 'text-emerald-800' :
                  status.status === 'recebido_pendente' ? 'text-orange-800' : 'text-slate-700'
                }`}>
                  {status.status === 'feito' ? 'Lançado'
                    : status.status === 'recebido_pendente' ? 'Recebido (pendente)'
                    : 'Sem movimento'}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {status.marcadoPorNome ? `Por ${status.marcadoPorNome}` : 'Sem responsável'}
                  {status.marcadoEm && ` · ${formatDataHora(status.marcadoEm)}`}
                </div>
              </div>
            </div>
          )}

          {/* Botões de status */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Marcar como</h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => aplicarStatus('feito')}
                disabled={salvandoStatus !== null}
                className={`rounded-xl px-2 py-3 text-xs font-bold flex flex-col items-center justify-center gap-1 transition disabled:opacity-50 ${
                  status?.status === 'feito'
                    ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-300'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {salvandoStatus === 'feito' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Lançado
              </button>
              <button
                onClick={() => aplicarStatus('recebido_pendente')}
                disabled={salvandoStatus !== null}
                className={`rounded-xl px-2 py-3 text-xs font-bold flex flex-col items-center justify-center gap-1 transition disabled:opacity-50 ${
                  status?.status === 'recebido_pendente'
                    ? 'bg-orange-500 text-white shadow ring-2 ring-orange-300'
                    : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                }`}
              >
                {salvandoStatus === 'recebido_pendente' ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}
                Recebido
              </button>
              <button
                onClick={() => aplicarStatus('sem_movimento')}
                disabled={salvandoStatus !== null}
                className={`rounded-xl px-2 py-3 text-xs font-bold flex flex-col items-center justify-center gap-1 transition disabled:opacity-50 ${
                  status?.status === 'sem_movimento'
                    ? 'bg-slate-500 text-white shadow ring-2 ring-slate-300'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title="Conferido, mas sem movimento bancário no mês"
              >
                {salvandoStatus === 'sem_movimento' ? <Loader2 size={16} className="animate-spin" /> : <MinusCircle size={16} />}
                Sem mov.
              </button>
            </div>
            {status && (
              <button
                onClick={limparStatus}
                disabled={salvandoStatus !== null}
                className="mt-2 w-full rounded-lg px-3 py-2.5 text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {salvandoStatus === 'limpar' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                {salvandoStatus === 'limpar' ? 'Limpando...' : 'Desmarcar (voltar para branco)'}
              </button>
            )}
          </div>

          {/* Observação */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Observação</h3>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              onBlur={salvarObservacao}
              placeholder="Anote algo sobre essa conferência (opcional)..."
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
            />
            {!status && observacao.trim() && (
              <p className="text-[11px] text-gray-400 mt-1">A observação será salva quando você marcar a célula.</p>
            )}
          </div>

          {/* Extratos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Extratos anexados {extratos.length > 0 && <span className="text-cyan-700">({extratos.length})</span>}
              </h3>
              <label className={`inline-flex items-center gap-1 text-xs font-bold rounded-lg px-2.5 py-1.5 cursor-pointer transition ${
                uploadando
                  ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
              }`}>
                {uploadando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Anexar
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.ofx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
                  className="hidden"
                  disabled={uploadando}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
              </label>
            </div>

            {loading ? (
              <div className="py-4 flex items-center justify-center text-gray-400 text-xs">
                <Loader2 size={14} className="animate-spin mr-2" /> Carregando...
              </div>
            ) : extratos.length === 0 ? (
              <div className="py-5 px-3 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <Paperclip size={18} className="mx-auto text-gray-400 mb-1" />
                <p className="text-xs text-gray-500">Nenhum extrato anexado neste mês.</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Ao anexar, a célula é marcada como feita automaticamente.</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {extratos.map((ex) => (
                  <li key={ex.id} className="rounded-lg border border-gray-200 bg-white p-2.5 flex items-center gap-2">
                    <FileText size={16} className="text-cyan-600 shrink-0" />
                    <button
                      onClick={() => setVisualizando(ex)}
                      className="flex-1 text-left min-w-0 hover:underline"
                      title="Visualizar"
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">{ex.arquivoNome}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {ex.uploadedPorNome ? `por ${ex.uploadedPorNome} · ` : ''}{formatDataHora(ex.uploadedEm)}
                        {ex.tamanhoBytes ? ` · ${formatBytes(ex.tamanhoBytes)}` : ''}
                      </div>
                    </button>
                    <button
                      onClick={() => setVisualizando(ex)}
                      className="rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 p-1.5 transition shrink-0"
                      title="Visualizar pelo sistema"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      onClick={() => baixarExtrato(ex)}
                      className="rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 p-1.5 transition shrink-0"
                      title="Baixar"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteExtrato(ex)}
                      className="rounded-lg bg-red-50 hover:bg-red-100 text-red-600 p-1.5 transition shrink-0"
                      title="Excluir extrato"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {extratos.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-1.5">
                Os extratos não somem ao desmarcar — ficam disponíveis na Central de Extratos da empresa.
              </p>
            )}
          </div>
        </div>
      </ModalBase>

      <ConfirmModal
        open={!!confirmDeleteExtrato}
        onCancel={() => setConfirmDeleteExtrato(null)}
        onConfirm={() => confirmDeleteExtrato && removerExtrato(confirmDeleteExtrato)}
        title="Excluir extrato?"
        message={
          confirmDeleteExtrato
            ? `O arquivo "${confirmDeleteExtrato.arquivoNome}" será removido permanentemente. Esta ação não pode ser desfeita.`
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
