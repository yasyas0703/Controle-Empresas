'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, KeyRound, Loader2, Mail, Power, Search, Smartphone, UserPlus, XCircle } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { supabase } from '@/lib/supabase';

type Cliente = {
  id: string;
  empresa_id: string;
  email: string;
  nome_contato: string | null;
  telefone: string | null;
  ativo: boolean;
  ultimo_login_em: string | null;
  criado_em: string;
};

type Filtro = 'todos' | 'com-acesso' | 'sem-acesso' | 'inativos';

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ClientesPortalPage() {
  const { empresas, canManage, mostrarAlerta } = useSistema();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [criarTarget, setCriarTarget] = useState<{ empresaId: string; emailInicial: string } | null>(null);
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  // Carrega clientes_portal
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCarregando(true);
      const { data } = await supabase
        .from('clientes_portal')
        .select('id, empresa_id, email, nome_contato, telefone, ativo, ultimo_login_em, criado_em')
        .order('criado_em', { ascending: false });
      if (cancelled) return;
      setClientes((data ?? []) as Cliente[]);
      setCarregando(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientesPorEmpresa = useMemo(() => {
    const map = new Map<string, Cliente>();
    // Pega o mais recente ativo (ou o mais recente em geral) por empresa
    const ordenados = [...clientes].sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      return b.criado_em.localeCompare(a.criado_em);
    });
    for (const c of ordenados) {
      if (!map.has(c.empresa_id)) map.set(c.empresa_id, c);
    }
    return map;
  }, [clientes]);

  const empresasFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase();
    return empresas
      .filter((e) => {
        const cliente = clientesPorEmpresa.get(e.id);
        if (filtro === 'com-acesso' && !(cliente && cliente.ativo)) return false;
        if (filtro === 'sem-acesso' && cliente) return false;
        if (filtro === 'inativos' && (!cliente || cliente.ativo)) return false;
        if (buscaLower) {
          const haystack = `${e.codigo} ${e.razao_social ?? ''} ${e.apelido ?? ''} ${e.cnpj ?? ''} ${cliente?.email ?? ''}`.toLowerCase();
          if (!haystack.includes(buscaLower)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.razao_social ?? a.codigo ?? '').localeCompare(b.razao_social ?? b.codigo ?? ''));
  }, [empresas, clientesPorEmpresa, busca, filtro]);

  const contadores = useMemo(() => {
    const totalEmpresas = empresas.length;
    let comAcesso = 0;
    let semAcesso = 0;
    let inativos = 0;
    for (const e of empresas) {
      const c = clientesPorEmpresa.get(e.id);
      if (!c) semAcesso++;
      else if (c.ativo) comAcesso++;
      else inativos++;
    }
    return { totalEmpresas, comAcesso, semAcesso, inativos };
  }, [empresas, clientesPorEmpresa]);

  async function reenviarSenha(clienteId: string) {
    if (acaoEmCurso) return;
    if (!confirm('Gerar uma nova senha e reenviar pro email do cliente?')) return;
    setAcaoEmCurso(clienteId);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/clientes-portal/${clienteId}/reenviar-senha`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarAlerta('Erro', json.error || 'Falha ao reenviar.', 'erro');
        return;
      }
      if (!json.email_enviado) {
        mostrarAlerta(
          'Email não enviado',
          `Senha gerada mas não conseguimos enviar por email (${json.email_erro || 'erro desconhecido'}). Senha: ${json.senha_provisoria}`,
          'aviso',
        );
      } else {
        mostrarAlerta('Senha reenviada', 'Nova senha provisória enviada pro email do cliente.', 'sucesso');
      }
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function toggleAtivo(clienteId: string, ativarPara: boolean) {
    if (acaoEmCurso) return;
    const msg = ativarPara ? 'Reativar acesso desse cliente?' : 'Desativar acesso? O cliente perde acesso imediatamente.';
    if (!confirm(msg)) return;
    setAcaoEmCurso(clienteId);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/clientes-portal/${clienteId}/toggle-ativo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ativo: ativarPara }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarAlerta('Erro', json.error || 'Falha ao atualizar.', 'erro');
        return;
      }
      setClientes((prev) => prev.map((c) => (c.id === clienteId ? { ...c, ativo: ativarPara } : c)));
      mostrarAlerta('Atualizado', ativarPara ? 'Acesso reativado.' : 'Acesso desativado.', 'sucesso');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <p className="text-base font-medium text-slate-700">Acesso restrito</p>
        <p className="mt-1 text-sm text-slate-500">Apenas gerentes e admins podem gerenciar acessos do portal.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <Smartphone size={24} className="text-emerald-600" />
          Clientes do Portal
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Cadastre e gerencie acessos dos clientes ao portal — eles recebem login por email e podem baixar guias direto.
        </p>
      </div>

      {/* Cards de contagem */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card cor="slate" valor={contadores.totalEmpresas} label="Empresas" />
        <Card cor="emerald" valor={contadores.comAcesso} label="Com acesso" />
        <Card cor="amber" valor={contadores.semAcesso} label="Sem acesso" />
        <Card cor="red" valor={contadores.inativos} label="Inativos" />
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, código, CNPJ ou email..."
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        <FiltroBtn ativo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</FiltroBtn>
        <FiltroBtn ativo={filtro === 'sem-acesso'} onClick={() => setFiltro('sem-acesso')}>Sem acesso</FiltroBtn>
        <FiltroBtn ativo={filtro === 'com-acesso'} onClick={() => setFiltro('com-acesso')}>Com acesso</FiltroBtn>
        <FiltroBtn ativo={filtro === 'inativos'} onClick={() => setFiltro('inativos')}>Inativos</FiltroBtn>
      </div>

      {/* Tabela */}
      {carregando ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : empresasFiltradas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm text-slate-500">Nenhuma empresa nesse filtro.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Email do acesso</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Último login</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {empresasFiltradas.map((e) => {
                const cliente = clientesPorEmpresa.get(e.id);
                const emailSugerido = e.email || '';
                return (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {e.apelido || e.razao_social || e.codigo}
                      </div>
                      <div className="text-[11px] text-slate-500">{e.codigo} {e.cnpj ? `· ${e.cnpj}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {cliente?.email ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {!cliente ? (
                        <Badge cor="slate">Sem acesso</Badge>
                      ) : cliente.ativo ? (
                        <Badge cor="emerald">Ativo</Badge>
                      ) : (
                        <Badge cor="red">Inativo</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {cliente ? fmtDataHora(cliente.ultimo_login_em) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {!cliente && (
                          <button
                            onClick={() => setCriarTarget({ empresaId: e.id, emailInicial: emailSugerido })}
                            disabled={!!acaoEmCurso}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <UserPlus size={12} /> Criar acesso
                          </button>
                        )}
                        {cliente && cliente.ativo && (
                          <>
                            <button
                              onClick={() => void reenviarSenha(cliente.id)}
                              disabled={!!acaoEmCurso}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="Reenviar senha"
                            >
                              {acaoEmCurso === cliente.id ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                              Reenviar senha
                            </button>
                            <button
                              onClick={() => void toggleAtivo(cliente.id, false)}
                              disabled={!!acaoEmCurso}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-slate-900 dark:text-red-300"
                              title="Desativar"
                            >
                              <Power size={12} /> Desativar
                            </button>
                          </>
                        )}
                        {cliente && !cliente.ativo && (
                          <button
                            onClick={() => void toggleAtivo(cliente.id, true)}
                            disabled={!!acaoEmCurso}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900 dark:bg-slate-900 dark:text-emerald-300"
                          >
                            <CheckCircle2 size={12} /> Reativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {criarTarget && (
        <ModalCriarAcesso
          empresaId={criarTarget.empresaId}
          emailInicial={criarTarget.emailInicial}
          empresaNome={empresas.find((e) => e.id === criarTarget.empresaId)?.razao_social || ''}
          onClose={() => setCriarTarget(null)}
          onSuccess={(novo) => {
            setClientes((prev) => [novo, ...prev]);
            setCriarTarget(null);
          }}
        />
      )}
    </div>
  );
}

function Card({ cor, valor, label }: { cor: 'slate' | 'emerald' | 'amber' | 'red'; valor: number; label: string }) {
  const cls = {
    slate: 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  }[cor];
  return (
    <div className={`rounded-lg px-3 py-3 ${cls}`}>
      <div className="text-2xl font-bold">{valor}</div>
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function FiltroBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
        ativo
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ cor, children }: { cor: 'slate' | 'emerald' | 'red'; children: React.ReactNode }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  }[cor];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function ModalCriarAcesso({
  empresaId,
  empresaNome,
  emailInicial,
  onClose,
  onSuccess,
}: {
  empresaId: string;
  empresaNome: string;
  emailInicial: string;
  onClose: () => void;
  onSuccess: (cliente: Cliente) => void;
}) {
  const { mostrarAlerta } = useSistema();
  const [email, setEmail] = useState(emailInicial);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ senha?: string; aviso?: string } | null>(null);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      mostrarAlerta('Email obrigatório', 'Digite o email do cliente.', 'aviso');
      return;
    }
    setEnviando(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/clientes-portal/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          empresa_id: empresaId,
          email: email.trim(),
          nome_contato: nome.trim() || null,
          telefone: telefone.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarAlerta('Erro', json.error || 'Falha ao criar acesso.', 'erro');
        return;
      }
      if (!json.email_enviado) {
        setResultado({
          senha: json.senha_provisoria,
          aviso: `Acesso criado, mas não conseguimos enviar email automaticamente (${json.email_erro || 'erro desconhecido'}). Copie a senha abaixo e mande pro cliente manualmente.`,
        });
      } else {
        mostrarAlerta('Acesso criado', 'Email enviado pro cliente com senha provisória.', 'sucesso');
        onSuccess({
          id: json.cliente.id,
          empresa_id: empresaId,
          email: email.trim().toLowerCase(),
          nome_contato: nome.trim() || null,
          telefone: telefone.trim() || null,
          ativo: true,
          ultimo_login_em: null,
          criado_em: new Date().toISOString(),
        });
      }
    } finally {
      setEnviando(false);
    }
  }

  function copiarSenha() {
    if (resultado?.senha) {
      void navigator.clipboard.writeText(resultado.senha);
      mostrarAlerta('Copiado', 'Senha copiada pra área de transferência.', 'sucesso');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => e.currentTarget === e.target && !enviando && onClose()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-4 rounded-t-2xl text-white">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Novo acesso · Portal</div>
            <div className="text-sm font-bold">{empresaNome || empresaId}</div>
          </div>
          <button onClick={onClose} disabled={enviando} className="rounded-lg bg-white/20 p-1.5 hover:bg-white/30">
            <XCircle size={18} />
          </button>
        </div>

        {resultado ? (
          <div className="p-5 space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {resultado.aviso}
            </div>
            <div className="rounded-md bg-slate-100 p-3 text-center font-mono text-lg dark:bg-slate-800">
              {resultado.senha}
            </div>
            <button
              onClick={copiarSenha}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Copy size={14} /> Copiar senha
            </button>
            <button
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={submeter} className="p-5 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Email do cliente *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="cliente@empresa.com"
                disabled={enviando}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Nome do contato</span>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="Opcional — usado no email de boas-vindas"
                disabled={enviando}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Telefone</span>
              <input
                type="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="Opcional"
                disabled={enviando}
              />
            </label>

            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
              <Mail size={12} className="mr-1 inline" />
              Vamos gerar uma senha provisória e enviar pelo SEU Gmail (precisa estar conectado em Obrigações).
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={enviando}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {enviando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Criar e enviar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
