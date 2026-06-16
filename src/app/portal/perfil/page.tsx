'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, Save, ShieldCheck, User } from 'lucide-react';
import { usePortal } from '@/app/portal/PortalContext';
import { supabasePortal } from '@/lib/supabasePortal';
import PortalHeader from '@/app/portal/components/PortalHeader';

export default function PerfilPage() {
  const router = useRouter();
  const { cliente, empresa, acessos, authReady, reload } = usePortal();

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [perfilMsg, setPerfilMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [senhaMsg, setSenhaMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    if (authReady && !cliente && acessos.length === 0) router.replace('/portal/login');
  }, [authReady, cliente, acessos.length, router]);

  useEffect(() => {
    if (cliente) {
      setNome(cliente.nomeContato ?? '');
      setTelefone(cliente.telefone ?? '');
    }
  }, [cliente]);

  async function salvarPerfil(e: FormEvent) {
    e.preventDefault();
    if (!cliente) return;
    setSalvandoPerfil(true);
    setPerfilMsg(null);
    const { error } = await supabasePortal
      .from('clientes_portal')
      .update({
        nome_contato: nome.trim() || null,
        telefone: telefone.trim() || null,
      })
      .eq('id', cliente.id);
    setSalvandoPerfil(false);
    if (error) {
      console.error('[portal/perfil] falha ao salvar contato:', error.message);
      setPerfilMsg({ tipo: 'erro', texto: 'Não foi possível salvar seus dados agora. Tente de novo em instantes.' });
      return;
    }
    setPerfilMsg({ tipo: 'ok', texto: 'Dados atualizados.' });
    await reload();
  }

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    setSenhaMsg(null);
    if (!cliente) return;
    if (novaSenha.length < 8) {
      setSenhaMsg({ tipo: 'erro', texto: 'A nova senha precisa ter no mínimo 8 caracteres.' });
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setSenhaMsg({ tipo: 'erro', texto: 'As senhas não coincidem.' });
      return;
    }

    setSalvandoSenha(true);

    // Confirma a senha atual antes de trocar (re-autenticando)
    const { error: reauthErr } = await supabasePortal.auth.signInWithPassword({
      email: cliente.email,
      password: senhaAtual,
    });
    if (reauthErr) {
      setSalvandoSenha(false);
      setSenhaMsg({ tipo: 'erro', texto: 'Senha atual incorreta.' });
      return;
    }

    const { error } = await supabasePortal.auth.updateUser({ password: novaSenha });
    setSalvandoSenha(false);
    if (error) {
      console.error('[portal/perfil] falha ao trocar senha:', error.message);
      setSenhaMsg({ tipo: 'erro', texto: 'Não foi possível alterar a senha agora. Confira a senha e tente novamente.' });
      return;
    }
    setSenhaMsg({ tipo: 'ok', texto: 'Senha alterada com sucesso.' });
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!cliente) return null;

  return (
    <>
      <PortalHeader backHref="/portal" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-xl font-semibold">Meu cadastro</h1>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          Gerencie seus dados de contato e altere sua senha.
        </p>

        {/* Dados da empresa (read-only) */}
        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Empresa</h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Field label="Razão social" valor={empresa?.razaoSocial ?? '—'} />
            <Field label="Apelido" valor={empresa?.apelido ?? '—'} />
            <Field label="CNPJ" valor={empresa?.cnpj ?? '—'} />
          </dl>
        </section>

        {/* Dados de contato (editáveis) */}
        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <User size={16} /> Seu contato
          </h2>
          <form onSubmit={salvarPerfil} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Email do acesso</span>
              <input
                type="email"
                value={cliente.email}
                disabled
                className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Nome do contato</span>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="Seu nome ou da pessoa responsável"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Telefone</span>
              <input
                type="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="(00) 00000-0000"
              />
            </label>

            {perfilMsg && (
              <div className={`sm:col-span-2 rounded-md px-3 py-2 text-xs ${perfilMsg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
                {perfilMsg.texto}
              </div>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={salvandoPerfil}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {salvandoPerfil ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
              </button>
            </div>
          </form>
        </section>

        {/* Trocar senha */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <ShieldCheck size={16} /> Trocar senha
          </h2>
          <form onSubmit={trocarSenha} className="grid grid-cols-1 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Senha atual</span>
              <div className="relative">
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm dark:border-slate-700 dark:bg-slate-950"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                  tabIndex={-1}
                  aria-label={showSenha ? 'Esconder senha' : 'Mostrar senha'}
                >
                  {showSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600 dark:text-slate-300">Nova senha</span>
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  autoComplete="new-password"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600 dark:text-slate-300">Confirmar nova senha</span>
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  autoComplete="new-password"
                />
              </label>
            </div>

            <p className="text-xs text-slate-500">Mínimo de 8 caracteres.</p>

            {senhaMsg && (
              <div className={`rounded-md px-3 py-2 text-xs ${senhaMsg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
                {senhaMsg.texto}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={salvandoSenha}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {salvandoSenha ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Trocar senha
              </button>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}

function Field({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">{valor}</p>
    </div>
  );
}
