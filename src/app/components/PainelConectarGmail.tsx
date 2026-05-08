'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Link2, Unlink, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSistema } from '@/app/context/SistemaContext';

interface GmailStatus {
  connected: boolean;
  email?: string;
  conectado_em?: string;
  ultimo_uso?: string | null;
}

interface PainelConectarGmailProps {
  /**
   * Caminho relativo (ex: '/vencimentos-fiscais/checklist') pra onde o Google
   * deve redirecionar após o consent. Sem isso, cai em /obrigacoes.
   */
  returnTo: string;
  /** Esconde o painel inteiro quando já está conectado. Default: false. */
  ocultarQuandoConectado?: boolean;
  /** Variante visual compacta (uma linha só) — útil pra header de página. */
  compacto?: boolean;
}

/**
 * Painel de conexão Gmail OAuth reutilizável. Funciona em qualquer página onde
 * o usuário precise enviar emails da própria conta Gmail.
 *
 * Lê status ao montar, exibe botão "Conectar Gmail" ou "Desconectar" conforme
 * o estado, e mostra alertas de sucesso/erro retornados pelo callback OAuth
 * (via query string `?gmail=connected|error`).
 */
export default function PainelConectarGmail({
  returnTo,
  ocultarQuandoConectado = false,
  compacto = false,
}: PainelConectarGmailProps) {
  const { mostrarAlerta } = useSistema();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDesconectar, setConfirmDesconectar] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setStatus({ connected: false }); return; }
      const res = await fetch('/api/auth/google/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setStatus(json);
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Detecta retorno do callback OAuth e mostra alerta
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('gmail');
    if (!result) return;
    if (result === 'connected') {
      const email = params.get('email');
      mostrarAlerta(
        'Gmail conectado',
        email ? `Conta ${email} conectada com sucesso. Você já pode enviar anexos por email.` : 'Conta conectada com sucesso.',
        'sucesso',
      );
      carregar();
    } else if (result === 'error') {
      const reason = params.get('reason') || 'erro desconhecido';
      mostrarAlerta('Erro ao conectar Gmail', `Motivo: ${reason}. Tente novamente.`, 'aviso');
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [carregar, mostrarAlerta]);

  const conectar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        mostrarAlerta('Sessão expirada', 'Faça login novamente.', 'aviso');
        return;
      }
      const res = await fetch('/api/auth/google/connect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ returnTo }),
      });
      const json = await res.json();
      if (!res.ok || !json.authUrl) {
        mostrarAlerta('Erro', json.error || 'Não foi possível iniciar a conexão com o Google.', 'aviso');
        return;
      }
      window.location.href = json.authUrl;
    } catch (err) {
      mostrarAlerta('Erro', err instanceof Error ? err.message : 'Erro inesperado', 'aviso');
    } finally {
      setLoading(false);
    }
  }, [mostrarAlerta, returnTo]);

  const desconectar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/auth/google/status', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        mostrarAlerta('Erro', json.error || 'Falha ao desconectar.', 'aviso');
        return;
      }
      setStatus({ connected: false });
      mostrarAlerta('Gmail desconectado', 'Você precisará autorizar novamente para enviar anexos.', 'sucesso');
    } finally {
      setLoading(false);
      setConfirmDesconectar(false);
    }
  }, [mostrarAlerta]);

  if (status === null) return null;
  if (ocultarQuandoConectado && status.connected) return null;

  if (compacto) {
    return (
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${status.connected ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-300'}`}>
        {status.connected ? (
          <>
            <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            <span className="text-emerald-800 truncate">
              Gmail conectado: <span className="font-semibold">{status.email}</span>
            </span>
            <button
              onClick={() => setConfirmDesconectar(true)}
              disabled={loading}
              className="ml-auto text-[10px] text-emerald-700 hover:text-emerald-900 underline shrink-0"
            >
              Desconectar
            </button>
          </>
        ) : (
          <>
            <Mail size={14} className="text-amber-600 shrink-0" />
            <span className="text-amber-800 flex-1">
              Gmail não conectado — você não conseguirá enviar anexos por email.
            </span>
            <button
              onClick={conectar}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50 shrink-0"
            >
              <Link2 size={11} /> {loading ? 'Conectando…' : 'Conectar agora'}
            </button>
          </>
        )}
        {confirmDesconectar && (
          <ConfirmDesconectarModal
            onCancelar={() => setConfirmDesconectar(false)}
            onConfirmar={desconectar}
            loading={loading}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl p-4 shadow-sm border ${status.connected ? 'bg-white border-gray-100' : 'bg-amber-50 border-amber-300'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${status.connected ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'}`}>
          <Mail size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${status.connected ? 'text-gray-900' : 'text-amber-900'}`}>
            {status.connected ? 'Gmail conectado' : 'Conecte seu Gmail antes de enviar anexos'}
          </div>
          <div className={`text-xs ${status.connected ? 'text-gray-500' : 'text-amber-800'} truncate`}>
            {status.connected
              ? `Anexos serão enviados da conta ${status.email}.`
              : 'Sem essa conexão, você não consegue enviar arquivos do checklist por email pro cliente.'}
          </div>
        </div>
        {status.connected ? (
          <button
            onClick={() => setConfirmDesconectar(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Unlink size={14} /> Desconectar
          </button>
        ) : (
          <button
            onClick={conectar}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <Link2 size={14} /> {loading ? 'Conectando…' : 'Conectar Gmail'}
          </button>
        )}
      </div>
      {confirmDesconectar && (
        <ConfirmDesconectarModal
          onCancelar={() => setConfirmDesconectar(false)}
          onConfirmar={desconectar}
          loading={loading}
        />
      )}
    </div>
  );
}

function ConfirmDesconectarModal({
  onCancelar,
  onConfirmar,
  loading,
}: {
  onCancelar: () => void;
  onConfirmar: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => e.currentTarget === e.target && !loading && onCancelar()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-rose-500 to-red-500 px-5 py-4">
          <div className="text-white text-sm font-bold">Desconectar Gmail?</div>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-700">
            Você precisará reautorizar o Gmail para enviar anexos novamente. Envios já feitos continuam no histórico.
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelar}
              disabled={loading}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirmar}
              disabled={loading}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Desconectando…' : 'Sim, desconectar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
