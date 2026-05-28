'use client';

import { useState } from 'react';
import { AlertTriangle, Info, Loader2, Send, X } from 'lucide-react';
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
    <ModalBase
      isOpen={isOpen}
      onClose={enviando ? () => undefined : onClose}
      dialogClassName="w-full max-w-md rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden"
    >
      <div style={{ boxShadow: 'var(--shadow-pop)' }}>
        <div className="border-b border-[var(--border-subtle)] bg-[var(--warn-soft)] px-5 py-4 flex items-center justify-between gap-3 border-l-4 border-l-[var(--warn)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[var(--surface-2)] border border-[var(--warn)]/30 text-[var(--warn)] shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold text-[var(--text-1)] tracking-tight">Reenviar guia</div>
              <div className="text-xs text-[var(--text-2)]">Esta guia já foi enviada antes.</div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-md p-2 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition disabled:opacity-50 shrink-0"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="text-xs text-[var(--text-2)] bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius)] p-3 space-y-1">
            <div>
              <span className="font-semibold text-[var(--text-1)]">Último envio:</span>{' '}
              <span className="ct-num">{dataFmt}</span>
              {enviadoPorNome && <> · por <span className="font-semibold text-[var(--text-1)]">{enviadoPorNome}</span></>}
            </div>
            {destinatariosAnteriores.length > 0 && (
              <div>
                <span className="font-semibold text-[var(--text-1)]">Foi enviada para:</span>{' '}
                <span className="text-[var(--text-2)] ct-num">{destinatariosAnteriores.join(', ')}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              Motivo do reenvio <span className="text-[var(--danger)]">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: cliente não recebeu, guia anterior estava com valor errado, atualização do código de receita..."
              rows={4}
              autoFocus
              disabled={enviando}
              className="ct-input text-sm disabled:opacity-60 resize-y"
            />
            <div className="mt-1 flex items-center justify-between text-[10px]">
              <span className={valido ? 'text-[var(--ok)] font-semibold' : 'text-[var(--text-3)]'}>
                <span className="ct-num">{motivo.trim().length}</span>/10 mín.
              </span>
              <span className="text-[var(--text-3)] italic">
                Fica no histórico pra auditoria.
              </span>
            </div>
          </div>

          <div className="text-[11px] text-[var(--text-2)] bg-[var(--brand-soft)] border-l-4 border-[var(--brand)] rounded-[var(--radius)] p-3 flex items-start gap-2">
            <Info size={14} className="text-[var(--brand)] shrink-0 mt-0.5" />
            <span>
              O envio anterior <strong className="font-semibold text-[var(--text-1)]">não é apagado</strong> — fica preservado no histórico junto com o motivo deste reenvio.
            </span>
          </div>
        </div>

        <div className="px-5 py-3 bg-[var(--surface-1)] border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={enviando} className="ct-btn-ghost">
            Cancelar
          </button>
          <button onClick={() => void confirmar()} disabled={!valido || enviando} className="ct-btn-primary">
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {enviando ? 'Reenviando…' : 'Confirmar e reenviar'}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
