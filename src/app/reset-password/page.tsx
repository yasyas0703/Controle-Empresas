'use client';

import React, { useState, useEffect } from 'react';
import { KeyRound, CheckCircle, XCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    // O Supabase detecta o token do link de recovery automaticamente via URL hash
    // e cria uma sessão. Precisamos esperar isso acontecer.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Também verificar se já há sessão (caso o evento já tenha disparado)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        // Dar um tempo para o Supabase processar o hash da URL
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s) {
              setSessionReady(true);
            } else {
              setNoSession(true);
            }
          });
        }, 2000);
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async () => {
    setError('');

    if (!senha.trim()) {
      setError('Digite a nova senha.');
      return;
    }
    if (senha.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (senha !== confirmar) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: senha });
      if (updateError) throw updateError;
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível alterar a senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Link expirado ou inválido
  if (noSession) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-red-600 p-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <XCircle size={28} className="text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold text-white">Link expirado</div>
                  <div className="text-xs text-red-100 mt-0.5">Este link de recuperação não é mais válido</div>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                O link de recuperação de senha expirou ou já foi utilizado. Solicite um novo link na tela de login.
              </p>
              <Link
                href="/dashboard"
                className="block w-full text-center rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-lg transition"
              >
                Voltar ao Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Senha alterada com sucesso
  if (success) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <CheckCircle size={28} className="text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold text-white">Senha alterada!</div>
                  <div className="text-xs text-emerald-100 mt-0.5">Sua nova senha foi salva com sucesso</div>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Sua senha foi alterada com sucesso. Você já pode usar a nova senha para acessar o sistema.
              </p>
              <Link
                href="/dashboard"
                className="block w-full text-center rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-lg transition"
              >
                Ir para o Sistema
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Aguardando sessão
  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto mb-4 rounded-2xl bg-cyan-50 flex items-center justify-center overflow-hidden shadow-sm ring-1 ring-cyan-100">
            <Image src="/triar.png" alt="Triar" width={48} height={48} priority />
          </div>
          <div className="text-sm text-gray-500 animate-pulse">Verificando link...</div>
        </div>
      </div>
    );
  }

  // Formulário de troca de senha
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-cyan-600 to-teal-600 p-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                <KeyRound size={24} className="text-white" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Nova Senha</div>
                <div className="text-xs text-cyan-200 mt-0.5">Defina sua nova senha de acesso</div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Nova senha</label>
              <div className="relative">
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full rounded-xl bg-gray-50 px-4 py-3 pr-12 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmar senha</label>
              <input
                type={showSenha ? 'text' : 'password'}
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
                placeholder="Repita a nova senha"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-red-700 font-semibold">
                  <XCircle size={16} className="shrink-0" />
                  {error}
                </div>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-lg transition disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  Alterando...
                </span>
              ) : (
                'Alterar Senha'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
