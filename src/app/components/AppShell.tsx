'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { LogOut, Shield, User, LayoutDashboard, CalendarDays, Building2, Users, Layers, BarChart3, ClipboardList, Briefcase, AlertTriangle, Archive, Trash2, Bell, CheckCircle, XCircle, Info, ChevronLeft, ChevronRight, HardDrive, Menu, X, Terminal, WrenchIcon, Loader2, Tag, Grid3x3, ListChecks, FileStack, Eye, EyeOff, Smartphone, Sparkles, Download } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil, isRetRenovado } from '@/app/utils/date';
import { getDepartamentoSlugDoUsuario, getDepartamentoSlugsDoUsuario, type DepartamentoSlug } from '@/app/utils/departamento';
import AutoBackup from '@/app/components/AutoBackup';
import BotaoTarefas from '@/app/components/BotaoTarefas';
import ThemeToggle from '@/app/components/ThemeToggle';
import AlertaGuiasPendentes from '@/app/components/AlertaGuiasPendentes';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: boolean;
  ghostOnly?: boolean;
  emailOnly?: string | string[];
  department?: DepartamentoSlug;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

const nav: NavItem[] = [
  // "/hoje" não é estático aqui — é injetado dinamicamente abaixo em
  // navItems, com posição que varia conforme o perfil do usuário:
  //   • Fiscal/SN (não admin): aparece como PRIMEIRO item (acima de Dashboard)
  //   • Admin/privileged: aparece logo DEPOIS do Dashboard
  //   • Outros departamentos: NÃO aparece
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vencimentos', label: 'Vencimentos', icon: AlertTriangle, badge: true },
  { href: '/vencimentos-fiscais', label: 'Painel Fiscal', icon: Grid3x3, department: 'fiscal' },
  { href: '/vencimentos-fiscais/checklist', label: 'Checklist Mensal', icon: ListChecks, department: 'fiscal' },
  { href: '/vencimentos-pessoal', label: 'Vencimentos Pessoal', icon: Grid3x3, department: 'pessoal' },
  { href: '/vencimentos-pessoal/controle', label: 'Controle Pessoal', icon: ListChecks, department: 'pessoal' },
  { href: '/vencimentos-contabil/controle', label: 'Controle Contábil', icon: ListChecks, department: 'contabil' },
  { href: '/vencimentos-cadastro', label: 'Vencimentos Cadastro', icon: Grid3x3, department: 'cadastro' },
  { href: '/vencimentos-cadastro/controle', label: 'Controle Cadastro', icon: ListChecks, department: 'cadastro' },
  { href: '/calendario', label: 'Calendário', icon: CalendarDays },
  { href: '/aplicativos', label: 'Aplicativos', icon: Download },
  { href: '/dev', label: 'Controle', icon: Terminal, ghostOnly: true },
  { href: '/obrigacoes', label: 'Obrigações', icon: FileStack, emailOnly: ['admin@triarcontabilidade.com.br', 'yasmin@triarcontabilidade.com.br'] },
  { href: '/empresas', label: 'Empresas', icon: Building2 },
  { href: '/servicos', label: 'Serviços', icon: Briefcase },
  { href: '/tags', label: 'Tags', icon: Tag },
  { href: '/usuarios', label: 'Usuários', icon: Users },
  { href: '/clientes-portal', label: 'Clientes do Portal', icon: Smartphone, emailOnly: 'admin@triarcontabilidade.com.br' },
  { href: '/departamentos', label: 'Departamentos', icon: Layers },
  { href: '/analises', label: 'Análises', icon: BarChart3 },
  { href: '/historico', label: 'Histórico', icon: ClipboardList },
  { href: '/empresas-desligadas', label: 'Empresas Desligadas', icon: Archive },
  { href: '/lixeira', label: 'Lixeira', icon: Trash2 },
  { href: '/backup', label: 'Backup', icon: HardDrive },
];

const BROWSER_NOTIF_SESSION_KEY = 'controle-triar-browser-notifs-shown-v1';
const FISCAL_NOTIF_TITLE_PREFIX = 'Vencimento fiscal ';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Portal do cliente roda em rotas /portal/* com auth/layout próprios — não embrulhar com a shell interna.
  // Raiz "/" também não usa AppShell — deve ficar 100% invisível pra quem chega ali.
  if (pathname === '/' || pathname?.startsWith('/portal')) {
    return <>{children}</>;
  }

  return <AppShellInner>{children}</AppShellInner>;
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentUser, canManage, canAdmin, isGhost, isPrivileged, logout, login, mostrarAlerta, empresas, notificacoes, marcarNotificacaoLida, marcarTodasLidas, limparNotificacoes, lixeira, authReady, departamentos, manutencao } = useSistema();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotResetLoading, setForgotResetLoading] = useState(false);
  const [forgotResetDone, setForgotResetDone] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [browserNotifPermission, setBrowserNotifPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  const notifPanelMobileRef = useRef<HTMLDivElement>(null);
  const notifPanelDesktopRef = useRef<HTMLDivElement>(null);
  const notifBellMobileRef = useRef<HTMLButtonElement>(null);
  const notifBellDesktopRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showNotifs) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        notifPanelMobileRef.current?.contains(target) ||
        notifPanelDesktopRef.current?.contains(target) ||
        notifBellMobileRef.current?.contains(target) ||
        notifBellDesktopRef.current?.contains(target)
      ) {
        return;
      }
      setShowNotifs(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showNotifs]);

  // isGhost e isPrivileged vêm do contexto (validados no servidor)
  // A flag de manutenção agora vem do SistemaContext (lida direto do Supabase,
  // visibility-gated) — não pollamos mais /api/admin/manutencao a cada 5s.

  // Persiste estado da sidebar (desktop only)
  useEffect(() => {
    const stored = localStorage.getItem('sidebar-open');
    if (stored !== null) setSidebarOpen(stored === 'true');
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      localStorage.setItem('sidebar-open', String(!v));
      return !v;
    });
  };

  // Fechar menu mobile ao navegar
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (authReady && !currentUser) setShowLogin(true);
    if (currentUser) setShowLogin(false);
  }, [authReady, currentUser]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotifPermission('unsupported');
      return;
    }

    setBrowserNotifPermission(Notification.permission);
  }, []);

  // Contador do badge do menu "Vencimentos" — só RETs e documentos vencidos.
  // Vencimentos fiscais (ICMS, SPED etc) NÃO entram aqui — eles têm a aba
  // própria Painel Fiscal / Checklist Mensal e seus próprios indicadores.
  const vencidosCount = useMemo(() => {
    let count = 0;
    for (const e of empresas) {
      for (const d of e.documentos) {
        const dias = daysUntil(d.validade);
        if (dias !== null && dias < 0) count++;
      }
      for (const r of e.rets) {
        // RET inativo não conta como vencido (substituído por outro RET).
        if (r.ativo === false) continue;
        if (isRetRenovado(r.vencimento, r.ultimaRenovacao)) continue;
        const dias = daysUntil(r.vencimento);
        if (dias !== null && dias < 0) count++;
      }
    }
    return count;
  }, [empresas]);

  const notifsNaoLidas = (notificacoes ?? []).filter((n) => !n.lida).length;
  const fiscalUnreadNotifs = useMemo(
    () => (notificacoes ?? []).filter((n) => !n.lida && n.titulo.startsWith(FISCAL_NOTIF_TITLE_PREFIX)),
    [notificacoes]
  );
  const lixeiraCount = (lixeira ?? []).length;

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      mostrarAlerta('Campo obrigatório', 'Digite o email da sua conta.', 'aviso');
      return;
    }
    setForgotLoading(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || 'Erro ao enviar código.');
      }
      setForgotSent(true);
    } catch (err: unknown) {
      mostrarAlerta('Erro', getErrorMessage(err, 'Não foi possível enviar o código de recuperação.'), 'erro');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setForgotError('');
    if (!forgotCode.trim()) {
      setForgotError('Digite o código recebido por email.');
      return;
    }
    if (!forgotNewPassword.trim() || forgotNewPassword.length < 8) {
      setForgotError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('As senhas não coincidem.');
      return;
    }
    setForgotResetLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim(),
          code: forgotCode.trim(),
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setForgotError(data.message || 'Código inválido ou expirado.');
        return;
      }
      setForgotResetDone(true);
    } catch {
      setForgotError('Erro ao redefinir senha. Tente novamente.');
    } finally {
      setForgotResetLoading(false);
    }
  };

  const resetForgotState = () => {
    setShowForgot(false);
    setForgotSent(false);
    setForgotEmail('');
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotResetDone(false);
    setForgotError('');
  };

  const handleLogin = async () => {
    const result = await login(email, senha);
    if (result === 'rate_limited') {
      mostrarAlerta('Muitas tentativas', 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.', 'aviso');
      return;
    }
    if (!result) {
      mostrarAlerta('Login inválido', 'Verifique email/senha e tente novamente.', 'erro');
      return;
    }
    setShowLogin(false);
  };

  // Tela de manutenção — bloqueia quem está logado mas não é privilegiado
  // (usuários não logados ainda veem o login para que o ghost possa entrar)
  const ativarNotificacoesNavegador = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      mostrarAlerta('Navegador sem suporte', 'Esse navegador nao suporta notificacoes do sistema.', 'aviso');
      return;
    }

    try {
      const permissao = await Notification.requestPermission();
      setBrowserNotifPermission(permissao);
      if (permissao === 'granted') {
        mostrarAlerta('Alertas ativados', 'As notificacoes do navegador foram habilitadas.', 'sucesso');
      } else if (permissao === 'denied') {
        mostrarAlerta('Permissao negada', 'O navegador bloqueou as notificacoes. Voce pode liberar isso nas configuracoes do site.', 'aviso');
      }
    } catch (error: unknown) {
      mostrarAlerta('Falha ao ativar alertas', getErrorMessage(error, 'Nao foi possivel solicitar a permissao do navegador.'), 'erro');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || browserNotifPermission !== 'granted' || fiscalUnreadNotifs.length === 0) return;

    const unreadIds = new Set(fiscalUnreadNotifs.map((n) => n.id));
    let shownIds = new Set<string>();

    try {
      const raw = window.sessionStorage.getItem(BROWSER_NOTIF_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          shownIds = new Set(parsed.filter((id): id is string => typeof id === 'string' && unreadIds.has(id)));
        }
      }
    } catch {
      shownIds = new Set<string>();
    }

    const pendentes = fiscalUnreadNotifs.filter((n) => !shownIds.has(n.id));
    if (pendentes.length === 0) {
      window.sessionStorage.setItem(BROWSER_NOTIF_SESSION_KEY, JSON.stringify(Array.from(shownIds)));
      return;
    }

    const abrirPainel = () => {
      window.focus();
      setShowNotifs(true);
    };

    const itensParaExibir = pendentes.slice(0, 3);
    for (const notificacao of itensParaExibir) {
      const alerta = new Notification(notificacao.titulo, {
        body: notificacao.mensagem,
        icon: '/triar.png',
        badge: '/triar.png',
        tag: notificacao.id,
        requireInteraction: true,
      });
      alerta.onclick = () => {
        abrirPainel();
        alerta.close();
      };
    }

    if (pendentes.length > itensParaExibir.length) {
      const resumo = new Notification('Lembrete de vencimentos fiscais', {
        body: `Voce tem ${pendentes.length} alerta(s) fiscal(is) pendentes. Abra o sininho para revisar.`,
        icon: '/triar.png',
        badge: '/triar.png',
        tag: 'fiscal-alert-summary',
        requireInteraction: true,
      });
      resumo.onclick = () => {
        abrirPainel();
        resumo.close();
      };
    }

    for (const notificacao of pendentes) shownIds.add(notificacao.id);
    window.sessionStorage.setItem(BROWSER_NOTIF_SESSION_KEY, JSON.stringify(Array.from(shownIds)));
  }, [browserNotifPermission, fiscalUnreadNotifs]);

  if (manutencao && authReady && currentUser && !isPrivileged) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 mx-auto mb-6 rounded-2xl bg-amber-100 flex items-center justify-center">
            <WrenchIcon size={32} className="text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sistema em Manutenção</h1>
          <p className="text-gray-500 text-sm">
            O sistema está temporariamente indisponível para manutenção. Por favor, tente novamente em breve.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto mb-4 rounded-2xl bg-cyan-50 flex items-center justify-center overflow-hidden shadow-sm ring-1 ring-cyan-100">
            <Image src="/triar.png" alt="Triar" width={48} height={48} priority />
          </div>
          <div className="text-sm text-gray-500 animate-pulse">Carregando...</div>
        </div>
      </div>
    );
  }

  const userDepartamentoSlug = getDepartamentoSlugDoUsuario(currentUser, departamentos);
  const userDepartamentoSlugs = getDepartamentoSlugsDoUsuario(currentUser, departamentos);
  const ehFiscalOuSn = userDepartamentoSlugs.includes('fiscal');
  const navItems = nav.filter((i) => {
    if (i.emailOnly) {
      const userEmail = currentUser?.email?.toLowerCase();
      if (!userEmail) return false;
      const allowed = Array.isArray(i.emailOnly) ? i.emailOnly : [i.emailOnly];
      return allowed.some((e) => e.toLowerCase() === userEmail);
    }
    if (i.ghostOnly) return isGhost;
    if (i.href === '/usuarios' || i.href === '/backup' || i.href === '/historico') return canAdmin;
    if (['/departamentos', '/servicos', '/tags', '/lixeira', '/clientes-portal'].includes(i.href)) return canManage;
    // Aba "Empresas" (cadastro/importacao): so admin, gerentes e usuarios do
    // departamento cadastro. Os demais usam o dashboard pra consultar.
    if (i.href === '/empresas') {
      if (canAdmin || isPrivileged || canManage) return true;
      return userDepartamentoSlugs.includes('cadastro');
    }
    // Aba "Vencimentos" geral: usuarios e gerentes do contabil nao precisam
    // (eles tem o "Controle Contabil" especifico). Admin/privileged ve.
    if (i.href === '/vencimentos') {
      if (canAdmin || isPrivileged) return true;
      return !userDepartamentoSlugs.includes('contabil');
    }
    if (i.department) {
      if (canAdmin || isPrivileged) return true;
      return userDepartamentoSlugs.includes(i.department);
    }
    return true;
  });

  // Injeta "Hoje" dinamicamente:
  //   • Fiscal/SN (não admin): PRIMEIRO item (acima de Dashboard)
  //   • Admin/privileged: logo DEPOIS do Dashboard
  //   • Outros (pessoal/contabil/cadastro): não vê "Hoje"
  //
  // ⚠️ Aba SUSPENSA temporariamente — não aparece pra ninguém.
  //    Pra religar, troca MOSTRAR_ABA_HOJE pra true.
  const MOSTRAR_ABA_HOJE = false;
  const podeVerHoje = MOSTRAR_ABA_HOJE && (canAdmin || isPrivileged || ehFiscalOuSn);
  if (podeVerHoje) {
    const hojeItem: NavItem = { href: '/hoje', label: 'Hoje', icon: Sparkles };
    if (ehFiscalOuSn && !canAdmin && !isPrivileged) {
      navItems.unshift(hojeItem);
    } else {
      const dashIdx = navItems.findIndex((i) => i.href === '/dashboard');
      if (dashIdx >= 0) navItems.splice(dashIdx + 1, 0, hojeItem);
      else navItems.unshift(hojeItem);
    }
  }

  // Usado em outros pontos da pagina (notificacoes etc) que ja consumiam o
  // singular. Mantemos a variavel pra nao quebrar referencias abaixo.
  void userDepartamentoSlug;

  const notifPanel = (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-cyan-50 to-teal-50">
        <div className="font-bold text-gray-900 text-sm">Notificações</div>
        <div className="flex items-center gap-2">
          {browserNotifPermission === 'default' && fiscalUnreadNotifs.length > 0 && (
            <button onClick={ativarNotificacoesNavegador} className="text-[11px] text-violet-600 hover:text-violet-700 font-bold">
              Ativar alertas do navegador
            </button>
          )}
          {browserNotifPermission === 'granted' && fiscalUnreadNotifs.length > 0 && (
            <span className="text-[11px] text-emerald-600 font-bold">Alertas do navegador ativos</span>
          )}
          {notifsNaoLidas > 0 && (
            <button onClick={marcarTodasLidas} className="text-[11px] text-cyan-600 hover:text-cyan-700 font-bold">
              Marcar todas como lidas
            </button>
          )}
          {(notificacoes ?? []).length > 0 && notifsNaoLidas === 0 && (
            <button onClick={limparNotificacoes} className="text-[11px] text-gray-400 hover:text-red-500 font-bold">
              Limpar
            </button>
          )}
        </div>
      </div>
      <div className="overflow-y-auto max-h-[400px]">
        {(notificacoes ?? []).length === 0 ? (
          <div className="p-8 text-center">
            <Bell size={32} className="text-gray-200 mx-auto mb-2" />
            <div className="text-sm text-gray-400">Nenhuma notificação</div>
          </div>
        ) : (
          (notificacoes ?? []).slice(0, 30).map((n) => {
            const NotifIcon = n.tipo === 'sucesso' ? CheckCircle : n.tipo === 'erro' ? XCircle : n.tipo === 'aviso' ? AlertTriangle : Info;
            const iconColor = n.tipo === 'sucesso' ? 'text-emerald-500' : n.tipo === 'erro' ? 'text-red-500' : n.tipo === 'aviso' ? 'text-amber-500' : 'text-blue-500';
            const dt = new Date(n.criadoEm);
            const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const dateStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            return (
              <div
                key={n.id}
                onClick={() => { if (!n.lida) marcarNotificacaoLida(n.id); }}
                className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition ${!n.lida ? 'bg-cyan-50/40' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <NotifIcon size={16} className={`${iconColor} mt-0.5 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${!n.lida ? 'text-gray-900' : 'text-gray-600'}`}>{n.titulo}</span>
                      {!n.lida && <span className="h-2 w-2 rounded-full bg-cyan-500 shrink-0" />}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.mensagem}</div>
                    <div className="text-[10px] text-gray-400 mt-1">{dateStr} às {timeStr}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* ── Mobile Top Bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 md:hidden bg-white border-b border-gray-200 shadow-sm max-w-full">
        <div className="flex items-center justify-between gap-2 px-2 py-2 min-w-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-700 shrink-0"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0 flex-1 justify-center">
            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
              <Image src="/triar.png" alt="Triar" width={32} height={32} priority className="w-8 h-8 object-contain" />
            </div>
            {/* Texto some em telas muito estreitas pra não empurrar os ícones pra fora */}
            <span className="text-sm font-bold text-gray-900 truncate hidden xs:inline">Controle de Empresas</span>
          </Link>
          <div className="flex items-center gap-0.5 shrink-0">
            {currentUser && <BotaoTarefas variant="mobile-bar" />}
            <ThemeToggle variant="mobile" />
            <button
              ref={notifBellMobileRef}
              onClick={() => setShowNotifs(!showNotifs)}
              className="p-2 rounded-lg hover:bg-gray-100 relative"
              aria-label="Notificações"
            >
              <Bell size={20} className={notifsNaoLidas > 0 ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'} />
              {notifsNaoLidas > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5">
                  {notifsNaoLidas > 9 ? '9+' : notifsNaoLidas}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile Sidebar Overlay ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}
      <aside
        className={`fixed top-0 left-0 h-full z-[70] bg-[var(--surface-2)] border-r border-[var(--border)] flex flex-col transition-transform duration-300 ease-in-out w-72 md:hidden ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-10 h-10 rounded-md overflow-hidden">
              <Image src="/triar.png" alt="Logo Triar" width={40} height={40} priority className="w-10 h-10 object-contain" />
            </div>
            <div className="leading-tight">
              <span className="block text-[10px] font-semibold text-[var(--text-3)] tracking-widest uppercase">Controle de</span>
              <span className="block text-lg font-bold text-[var(--text-1)] leading-none tracking-tight">Empresas</span>
            </div>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={20} />
          </button>
        </div>

        {currentUser && <BotaoTarefas variant="mobile-menu" onClick={() => setMobileMenuOpen(false)} />}

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {navItems.map((i) => {
            const active = pathname === i.href;
            const Icon = i.icon;
            const showBadge = i.badge && vencidosCount > 0;
            const showLixeiraBadge = i.href === '/lixeira' && lixeiraCount > 0;
            const isVenc = i.href === '/vencimentos' && vencidosCount > 0;
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors
                  ${active
                    ? isVenc ? 'text-[var(--danger)]' : 'text-[var(--brand)]'
                    : isVenc ? 'text-[var(--danger)] hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm ${isVenc ? 'bg-[var(--danger)]' : 'bg-[var(--brand)]'}`}
                  />
                )}
                <Icon size={18} className="shrink-0" />
                <span className="flex-1">{i.label}</span>
                {showBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-bold px-1 animate-pulse">
                    {vencidosCount}
                  </span>
                )}
                {showLixeiraBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gray-500 text-white text-[9px] font-bold px-1">
                    {lixeiraCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-100 p-2 space-y-1">
          {currentUser && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
              {canAdmin
                ? <Shield size={13} className="text-red-500 shrink-0" />
                : canManage
                  ? <Shield size={13} className="text-amber-500 shrink-0" />
                  : <User size={13} className="text-gray-400 shrink-0" />}
              <span className="text-xs font-semibold text-gray-700 truncate flex-1">{currentUser.nome}</span>
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase leading-none shrink-0 ${canAdmin ? 'bg-red-100 text-red-700' : canManage ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'
                }`}>
                {currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'gerente' ? 'Gerente' : 'User'}
              </span>
            </div>
          )}
          {currentUser ? (
            <button
              onClick={() => { logout(); setShowLogin(true); setMobileMenuOpen(false); }}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition"
            >
              <LogOut size={16} />
              Sair
            </button>
          ) : (
            <button
              onClick={() => { setShowLogin(true); setMobileMenuOpen(false); }}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-cyan-600 hover:bg-cyan-50 transition"
            >
              <User size={16} />
              Entrar
            </button>
          )}
        </div>
      </aside>

      {/* ── Desktop Sidebar ── */}
      <aside
        className={`fixed top-0 left-0 h-full z-40 bg-[var(--surface-2)] border-r border-[var(--border)] flex-col transition-all duration-200 ease-in-out hidden md:flex ${sidebarOpen ? 'w-64' : 'w-[72px]'
          }`}
      >
        {/* Logo + Nome */}
        <div className={`flex items-center border-b border-gray-100 py-5 ${sidebarOpen ? 'px-4 gap-4' : 'justify-center px-0'}`}>
          <Link href="/dashboard" className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-md overflow-hidden shrink-0">
              <Image src="/triar.png" alt="Logo Triar" width={64} height={64} priority className="w-16 h-16 object-contain" />
            </div>
            {sidebarOpen && (
              <div className="leading-tight min-w-0 overflow-hidden">
                <span className="block text-xs font-semibold text-[var(--text-3)] tracking-widest uppercase whitespace-nowrap">Controle de</span>
                <span className="block text-2xl font-bold text-[var(--text-1)] tracking-tight leading-none whitespace-nowrap">Empresas</span>
              </div>
            )}
          </Link>
        </div>

        {currentUser && (
          <BotaoTarefas variant={sidebarOpen ? 'sidebar-expanded' : 'sidebar-collapsed'} />
        )}

        {/* Itens de navegação */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {navItems.map((i) => {
            const active = pathname === i.href;
            const Icon = i.icon;
            const showBadge = i.badge && vencidosCount > 0;
            const showLixeiraBadge = i.href === '/lixeira' && lixeiraCount > 0;
            const isVenc = i.href === '/vencimentos' && vencidosCount > 0;
            return (
              <Link
                key={i.href}
                href={i.href}
                title={!sidebarOpen ? i.label : undefined}
                className={`flex items-center rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors relative
                  ${sidebarOpen ? 'gap-3' : 'justify-center gap-0'}
                  ${active
                    ? isVenc ? 'text-[var(--danger)]' : 'text-[var(--brand)]'
                    : isVenc ? 'text-[var(--danger)] hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm ${isVenc ? 'bg-[var(--danger)]' : 'bg-[var(--brand)]'}`}
                  />
                )}
                <Icon size={18} className="shrink-0" />
                {sidebarOpen && <span className="truncate flex-1">{i.label}</span>}
                {showBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-bold px-1 animate-pulse">
                    {vencidosCount}
                  </span>
                )}
                {showLixeiraBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gray-500 text-white text-[9px] font-bold px-1">
                    {lixeiraCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé: usuário + notif + toggle + logout */}
        <div className="border-t border-gray-100 p-1.5 space-y-1">
          {currentUser && sidebarOpen && (
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 bg-gray-50">
              {canAdmin
                ? <Shield size={13} className="text-red-500 shrink-0" />
                : canManage
                  ? <Shield size={13} className="text-amber-500 shrink-0" />
                  : <User size={13} className="text-gray-400 shrink-0" />}
              <span className="text-xs font-semibold text-gray-700 truncate flex-1">{currentUser.nome}</span>
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase leading-none shrink-0 ${canAdmin ? 'bg-red-100 text-red-700' : canManage ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'
                }`}>
                {currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'gerente' ? 'Gerente' : 'User'}
              </span>
            </div>
          )}

          <div className={`flex items-center gap-0.5 ${!sidebarOpen ? 'flex-col' : ''}`}>
            <button
              onClick={toggleSidebar}
              className="flex-1 flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 text-gray-500 transition"
              title={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
            >
              {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>

            <ThemeToggle variant="sidebar" />

            {/* Notificações (desktop) */}
            <div className="relative">
              <button
                ref={notifBellDesktopRef}
                onClick={() => setShowNotifs(!showNotifs)}
                className="flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 transition relative"
                title="Notificações"
              >
                <Bell size={16} className={notifsNaoLidas > 0 ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'} />
                {notifsNaoLidas > 0 && (
                  <span
                    className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[8px] font-bold px-0.5"
                    style={{ animation: 'notifPulse 2s infinite' }}
                  >
                    {notifsNaoLidas > 9 ? '9+' : notifsNaoLidas}
                  </span>
                )}
              </button>

              {showNotifs && (
                <div ref={notifPanelDesktopRef} className="absolute left-full bottom-0 ml-2 z-50 w-[360px] max-h-[480px]">
                  {notifPanel}
                </div>
              )}
            </div>

            {currentUser ? (
              <button
                onClick={() => { logout(); setShowLogin(true); }}
                className="flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 text-gray-500 transition"
                title="Sair"
              >
                <LogOut size={16} />
              </button>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 text-cyan-600 transition"
                title="Entrar"
              >
                <User size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Mobile Notification Panel ── */}
      {showNotifs && (
        <div className="md:hidden fixed inset-0 z-[80] pointer-events-none">
          <div className="absolute inset-0 bg-black/50" />
          <div ref={notifPanelMobileRef} className="absolute top-14 right-2 left-2 max-h-[calc(100vh-72px)] z-[81] pointer-events-auto">
            {notifPanel}
          </div>
        </div>
      )}

      {/* ── Conteúdo principal ── */}
      <div
        className={`flex-1 min-w-0 min-h-screen transition-all duration-200 ease-in-out pt-14 md:pt-0 ${sidebarOpen ? 'md:ml-64' : 'md:ml-[72px]'}`}
      >
        <main className="px-3 py-3 sm:px-4 sm:py-4 md:py-6 min-w-0 max-w-full">
          <AlertaGuiasPendentes />
          {children}
        </main>
      </div>

      <AutoBackup />

      {/* ── Modal de login ── */}
      {showLogin && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4" onMouseDown={(e) => e.currentTarget === e.target && setShowLogin(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            <div className="border-b border-[var(--border-subtle)] p-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-[var(--radius)] bg-[var(--surface-3)] flex items-center justify-center">
                  <Image src="/triar.png" alt="Triar" width={36} height={36} />
                </div>
                <div>
                  <div className="text-lg font-bold text-[var(--text-1)]">
                    {showForgot ? 'Recuperar Senha' : 'Entrar no Sistema'}
                  </div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">Controle de Empresas</div>
                </div>
              </div>
            </div>

            {showForgot ? (
              <div className="p-6 space-y-4">
                {forgotResetDone ? (
                  <>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                      <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm mb-1">
                        <CheckCircle size={16} />
                        Senha alterada!
                      </div>
                      <p className="text-xs text-emerald-600">
                        Sua senha foi redefinida com sucesso. Faça login com a nova senha.
                      </p>
                    </div>
                    <button
                      onClick={resetForgotState}
                      className="ct-btn-primary w-full"
                    >
                      Ir para o Login
                    </button>
                  </>
                ) : forgotSent ? (
                  <>
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                      <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm mb-1">
                        <CheckCircle size={16} />
                        Código enviado!
                      </div>
                      <p className="text-xs text-blue-600">
                        Enviamos um código de 8 dígitos para <strong>{forgotEmail}</strong>. Verifique sua caixa de entrada e spam.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Código de verificação</label>
                      <input
                        value={forgotCode}
                        onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        className="ct-input ct-num text-center text-2xl tracking-[0.25em]"
                        placeholder="00000000"
                        maxLength={8}
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Nova senha</label>
                      <input
                        type="password"
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        className="ct-input"
                        placeholder="Mínimo 8 caracteres"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmar senha</label>
                      <input
                        type="password"
                        value={forgotConfirmPassword}
                        onChange={(e) => setForgotConfirmPassword(e.target.value)}
                        className="ct-input"
                        placeholder="Repita a nova senha"
                        onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                      />
                    </div>
                    {forgotError && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-red-700 font-semibold">
                          <XCircle size={16} className="shrink-0" />
                          {forgotError}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={handleResetPassword}
                      disabled={forgotResetLoading}
                      className="ct-btn-primary w-full"
                    >
                      {forgotResetLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          Redefinindo...
                        </span>
                      ) : (
                        'Redefinir Senha'
                      )}
                    </button>
                    <button
                      onClick={resetForgotState}
                      className="ct-btn-ghost w-full"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">
                      Digite o email da sua conta. Enviaremos um código de 8 dígitos para você redefinir sua senha.
                    </p>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                      <input
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="ct-input"
                        placeholder="email@empresa.com"
                        onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()}
                      />
                    </div>
                    <button
                      onClick={handleForgotPassword}
                      disabled={forgotLoading}
                      className="ct-btn-primary w-full"
                    >
                      {forgotLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          Enviando...
                        </span>
                      ) : (
                        'Enviar Código'
                      )}
                    </button>
                    <button
                      onClick={resetForgotState}
                      className="ct-btn-ghost w-full"
                    >
                      Voltar ao Login
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ct-input"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Senha</label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="ct-input pr-12"
                      placeholder="Senha"
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)] p-1"
                      aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      tabIndex={-1}
                    >
                      {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleLogin}
                  className="ct-btn-primary w-full"
                >
                  Entrar
                </button>
                <button
                  onClick={() => { resetForgotState(); setShowForgot(true); setForgotEmail(email); }}
                  className="ct-btn-ghost w-full text-[var(--brand)] hover:text-[var(--brand-strong)]"
                >
                  Esqueci minha senha
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


