'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Send, XCircle } from 'lucide-react';
import ModalBase from './ModalBase';

interface Props {
  isOpen: boolean;
  enviadoEm: string | null;
  enviadoPorNome: string | null;
  destinatariosAnteriores: string[];
  onClose: () => void;
  /** Chamado quando a usuária confirma. Recebe o motivo digitado (≥10 chars). */
  onConfirmar: (motivo: string) => void | Promise<void>;
}

/**
 * Modal pedido obrigatório quando a usuária tenta reenviar uma guia que já
 * foi enviada com sucesso antes. Força ela a justificar o reenvio (auditoria).
 * O motivo fica salvo no evento de histórico junto com o novo arquivo.
 */
export default function ModalMotivoReenvio({
  isOpen, enviadoEm, enviadoPorNome, destinatariosAnteriores, onClose, onConfirmar,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const dataFmt = enviadoEm
    ? new Date(enviadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '?';
  const valido = motivo.trim().length >= 10;

  async function confirmar() {
    if (!valido || enviando) return;
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim());
      setMotivo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalBase isOpen={isOpen} onClose={enviando ? () => undefined : onClose} dialogClassName="max-w-md">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={20} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-amber-900 dark:text-amber-100">
                Reenviar guia
              </div>
              <div className="text-xs text-amber-800 dark:text-amber-200 truncate">
                Esta guia já foi enviada antes
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={enviando}
            className="text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg p-1 transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <XCircle size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-1">
            <div>
              <span className="font-semibold">Último envio:</span> {dataFmt}
              {enviadoPorNome && <> · por <span className="font-medium">{enviadoPorNome}</span></>}
            </div>
            {destinatariosAnteriores.length > 0 && (
              <div>
                <span className="font-semibold">Foi enviada para:</span>{' '}
                <span className="text-slate-600 dark:text-slate-400">{destinatariosAnteriores.join(', ')}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Motivo do reenvio <span className="text-red-600">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: cliente não recebeu, guia anterior estava com valor errado, atualização do código de receita..."
              rows={4}
              autoFocus
              disabled={enviando}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:opacity-60 text-slate-900 dark:text-slate-100"
            />
            <div className="mt-1 flex items-center justify-between text-[10px]">
              <span className={`${motivo.trim().length >= 10 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {motivo.trim().length}/10 mín.
              </span>
              <span className="text-slate-500 dark:text-slate-400 italic">
                Fica no histórico pra auditoria
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-lg p-2.5">
            ℹ️ O envio anterior <strong>não é apagado</strong> — fica preservado no histórico junto com o motivo deste reenvio.
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void confirmar()}
            disabled={!valido || enviando}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 transition disabled:opacity-50"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {enviando ? 'Reenviando…' : 'Confirmar e reenviar'}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
