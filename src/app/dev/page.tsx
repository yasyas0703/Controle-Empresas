'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Shield, Power, Users, RefreshCw, LogOut, Loader2, WifiOff, Monitor } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { supabase } from '@/lib/supabase';

type Sessao = {
  userId: string;
  nome: string;
  email: string;
  criadoEm: string;
  atualizadoEm: string;
  userAgent: string;
  ip: string;
};

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function tempoDecorrido(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function resumirUserAgent(ua: string): string {
  if (!ua) return 'Desconhecido';
  if (/chrome/i.test(ua) && /edg/i.test(ua)) return 'Edge';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Outro';
}

export default function DevPage() {
  const { currentUser, mostrarAlerta, isPrivileged } = useSistema();

  const [manutencao, setManutencao] = useState(false);
  const [loadingManutencao, setLoadingManutencao] = useState(false);
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [loadingSessoes, setLoadingSessoes] = useState(false);
  const [resetandoId, setResetandoId] = useState<string | null>(null);

  const carregarManutencao = useCallback(async () => {
    const res = await fetch('/api/admin/manutencao');
    const json = await res.json();
    setManutencao(!!json.ativo);
  }, []);

  const carregarSessoes = useCallback(async () => {
    setLoadingSessoes(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/sessions', {
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setSessoes(Array.isArray(json) ? json : []);
    } catch {
      setSessoes([]);
    } finally {
      setLoadingSessoes(false);
    }
  }, []);

  useEffect(() => {
    if (!isPrivileged) return;
    carregarManutencao();
    carregarSessoes();
  }, [isPrivileged, carregarManutencao, carregarSessoes]);

  const toggleManutencao = async () => {
    setLoadingManutencao(true);
    try {
      const token = await getToken();
      console.log('[dev] token obtido:', token ? `${token.slice(0, 20)}...` : 'NULL');
      const payload = { ativo: !manutencao };
      console.log('[dev] enviando POST /api/admin/manutencao com:', payload);
      const res = await fetch('/api/admin/manutencao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      console.log('[dev] resposta status:', res.status, 'body:', json);
      if (!res.ok) throw new Error(json.error);
      setManutencao(json.ativo);
      mostrarAlerta(
        json.ativo ? 'Manutenção ativada' : 'Manutenção desativada',
        json.ativo
          ? 'Apenas você tem acesso ao sistema agora.'
          : 'Sistema liberado para todos os usuários.',
        json.ativo ? 'aviso' : 'sucesso'
      );
    } catch (err: any) {
      mostrarAlerta('Erro', err?.message ?? 'Não foi possível alterar modo manutenção.', 'erro');
    } finally {
      setLoadingManutencao(false);
    }
  };

  const resetarSessao = async (userId: string, nome: string) => {
    setResetandoId(userId);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${userId}/sessions`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      mostrarAlerta('Sessão resetada', `${nome} foi desconectado(a) de todos os dispositivos.`, 'sucesso');
      carregarSessoes();
    } catch (err: any) {
      mostrarAlerta('Erro', err?.message ?? 'Não foi possível resetar a sessão.', 'erro');
    } finally {
      setResetandoId(null);
    }
  };

  if (!isPrivileged) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-lg font-bold text-gray-900">Acesso negado</div>
        <div className="mt-2 text-sm text-gray-600">Esta área é restrita.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">Painel de Controle</div>
            <div className="text-sm text-gray-500">Ferramentas exclusivas do sistema</div>
          </div>
        </div>
      </div>

      {/* Modo Manutenção */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <Power size={20} className={manutencao ? 'text-amber-500' : 'text-gray-400'} />
          <div className="text-lg font-bold text-gray-900">Modo Manutenção</div>
        </div>

        <div className={`rounded-xl p-4 mb-4 border ${manutencao ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${manutencao ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className={`text-sm font-semibold ${manutencao ? 'text-amber-700' : 'text-gray-500'}`}>
              {manutencao ? 'Sistema em manutenção — apenas você tem acesso' : 'Sistema funcionando normalmente'}
            </span>
          </div>
          {manutencao && (
            <p className="text-xs text-amber-600 mt-2">
              Outros usuários veem a tela "Sistema em manutenção" e não conseguem acessar.
            </p>
          )}
        </div>

        <button
          onClick={toggleManutencao}
          disabled={loadingManutencao}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition disabled:opacity-50 ${
            manutencao
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-amber-500 hover:bg-amber-600 text-white'
          }`}
        >
          {loadingManutencao ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
          {manutencao ? 'Desativar Manutenção' : 'Ativar Manutenção'}
        </button>
      </div>

      {/* Sessões Ativas */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Monitor size={20} className="text-cyan-600" />
            <div className="text-lg font-bold text-gray-900">
              Sessões Ativas
              {sessoes.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">({sessoes.length})</span>
              )}
            </div>
          </div>
          <button
            onClick={carregarSessoes}
            disabled={loadingSessoes}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition"
            title="Atualizar"
          >
            <RefreshCw size={16} className={loadingSessoes ? 'animate-spin' : ''} />
          </button>
        </div>

        {loadingSessoes ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 size={16} className="animate-spin" />
            Carregando sessões...
          </div>
        ) : sessoes.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <WifiOff size={16} />
            Nenhuma sessão ativa encontrada.
          </div>
        ) : (
          <div className="space-y-3">
            {sessoes.map((s) => {
              const isSelf = s.userId === currentUser?.id;
              return (
                <div
                  key={s.userId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-gray-50 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-semibold text-gray-900 truncate">{s.nome}</span>
                      {isSelf && (
                        <span className="text-[10px] bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded font-bold">você</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 ml-4">{s.email}</div>
                    <div className="flex flex-wrap gap-3 mt-1.5 ml-4 text-xs text-gray-400">
                      <span title="Navegador">{resumirUserAgent(s.userAgent)}</span>
                      {s.ip && <span title="IP">{s.ip}</span>}
                      <span title="Última atividade">{tempoDecorrido(s.atualizadoEm)}</span>
                    </div>
                  </div>

                  {!isSelf && (
                    <button
                      onClick={() => resetarSessao(s.userId, s.nome)}
                      disabled={resetandoId === s.userId}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-semibold text-sm transition disabled:opacity-50 shrink-0"
                      title="Forçar logout"
                    >
                      {resetandoId === s.userId
                        ? <Loader2 size={14} className="animate-spin" />
                        : <LogOut size={14} />
                      }
                      Desconectar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
