'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState, useEffect } from 'react';
import { LogOut, Shield, User, LayoutDashboard, CalendarDays, Building2, Users, Layers, BarChart3, ClipboardList, Briefcase, AlertTriangle, Trash2, Bell, CheckCircle, XCircle, Info, ChevronLeft, ChevronRight, HardDrive, Menu, X, Terminal, WrenchIcon, Loader2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil } from '@/app/utils/date';
import { supabase } from '@/lib/supabase';
import AutoBackup from '@/app/components/AutoBackup';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vencimentos', label: 'Vencimentos', icon: AlertTriangle, badge: true },
  { href: '/calendario', label: 'Calendário', icon: CalendarDays },
  { href: '/dev', label: 'Controle', icon: Terminal, ghostOnly: true },
  { href: '/empresas', label: 'Empresas', icon: Building2 },
  { href: '/servicos', label: 'Serviços', icon: Briefcase },
  { href: '/usuarios', label: 'Usuários', icon: Users },
  { href: '/departamentos', label: 'Departamentos', icon: Layers },
  { href: '/analises', label: 'Análises', icon: BarChart3 },
  { href: '/historico', label: 'Histórico', icon: ClipboardList },
  { href: '/lixeira', label: 'Lixeira', icon: Trash2 },
  { href: '/backup', label: 'Backup', icon: HardDrive },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentUser, canManage, canAdmin, isGhost, isPrivileged, logout, login, mostrarAlerta, empresas, notificacoes, marcarNotificacaoLida, marcarTodasLidas, limparNotificacoes, lixeira, loading, authReady } = useSistema();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manutencao, setManutencao] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // isGhost e isPrivileged vêm do contexto (validados no servidor)

  useEffect(() => {
    const check = () => {
      fetch('/api/admin/manutencao')
        .then((r) => r.json())
        .then((d) => setManutencao(!!d.ativo))
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const vencidosCount = useMemo(() => {
    let count = 0;
    for (const e of empresas) {
      for (const d of e.documentos) {
        const dias = daysUntil(d.validade);
        if (dias !== null && dias < 0) count++;
      }
      for (const r of e.rets) {
        const dias = daysUntil(r.vencimento);
        if (dias !== null && dias < 0) count++;
      }
    }
    return count;
  }, [empresas]);

  const notifsNaoLidas = (notificacoes ?? []).filter((n) => !n.lida).length;
  const lixeiraCount = (lixeira ?? []).length;

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      mostrarAlerta('Campo obrigatório', 'Digite o email da sua conta.', 'aviso');
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setForgotSent(true);
    } catch (err: any) {
      mostrarAlerta('Erro', err?.message || 'Não foi possível enviar o email de recuperação.', 'erro');
    } finally {
      setForgotLoading(false);
    }
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

  const navItems = nav.filter((i: any) => {
    if (i.ghostOnly) return isGhost;
    if (i.href === '/usuarios' || i.href === '/backup' || i.href === '/historico') return canAdmin;
    if (['/departamentos', '/servicos', '/lixeira'].includes(i.href)) return canManage;
    return true;
  });

  const notifPanel = (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-cyan-50 to-teal-50">
        <div className="font-bold text-gray-900 text-sm">Notificações</div>
        <div className="flex items-center gap-2">
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
      <div className="fixed top-0 left-0 right-0 z-50 md:hidden bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
          >
            <Menu size={22} />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <Image src="/triar.png" alt="Triar" width={32} height={32} priority className="w-8 h-8 object-contain" />
            </div>
            <span className="text-sm font-bold text-gray-900">Controle de Empresas</span>
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="p-2 rounded-lg hover:bg-gray-100 relative"
            >
              <Bell size={20} className={notifsNaoLidas > 0 ? 'text-cyan-600' : 'text-gray-400'} />
              {notifsNaoLidas > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center px-0.5">
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
        className={`fixed top-0 left-0 h-full z-[70] bg-white border-r border-gray-200 shadow-lg flex flex-col transition-transform duration-300 ease-in-out w-72 md:hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-10 h-10 rounded-xl overflow-hidden">
              <Image src="/triar.png" alt="Logo Triar" width={40} height={40} priority className="w-10 h-10 object-contain" />
            </div>
            <div className="leading-tight">
              <span className="block text-[10px] font-bold text-gray-400 tracking-widest uppercase">Controle de</span>
              <span className="block text-lg font-extrabold text-gray-900 leading-none">Empresas</span>
            </div>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {navItems.map((i) => {
            const active = pathname === i.href;
            const Icon = i.icon;
            const showBadge = (i as any).badge && vencidosCount > 0;
            const showLixeiraBadge = i.href === '/lixeira' && lixeiraCount > 0;
            const isVenc = i.href === '/vencimentos' && vencidosCount > 0;
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all
                  ${active
                    ? isVenc ? 'text-red-700 bg-red-50' : 'text-cyan-700 bg-cyan-50'
                    : isVenc ? 'text-red-500 hover:bg-red-50 hover:text-red-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                <Icon size={18} className="shrink-0" />
                <span className="flex-1">{i.label}</span>
                {showBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-black px-1 animate-pulse">
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
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase leading-none shrink-0 ${
                canAdmin ? 'bg-red-100 text-red-700' : canManage ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'
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
        className={`fixed top-0 left-0 h-full z-40 bg-white border-r border-gray-200 shadow-lg flex-col transition-all duration-200 ease-in-out hidden md:flex ${
          sidebarOpen ? 'w-64' : 'w-[72px]'
        }`}
      >
        {/* Logo + Nome */}
        <div className={`flex items-center border-b border-gray-100 py-5 ${sidebarOpen ? 'px-4 gap-4' : 'justify-center px-0'}`}>
          <Link href="/dashboard" className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0">
              <Image src="/triar.png" alt="Logo Triar" width={64} height={64} priority className="w-16 h-16 object-contain" />
            </div>
            {sidebarOpen && (
              <div className="leading-tight min-w-0 overflow-hidden">
                <span className="block text-xs font-bold text-gray-400 tracking-widest uppercase whitespace-nowrap">Controle de</span>
                <span className="block text-2xl font-extrabold text-gray-900 tracking-tight leading-none whitespace-nowrap">Empresas</span>
              </div>
            )}
          </Link>
        </div>

        {/* Itens de navegação */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {navItems.map((i) => {
            const active = pathname === i.href;
            const Icon = i.icon;
            const showBadge = (i as any).badge && vencidosCount > 0;
            const showLixeiraBadge = i.href === '/lixeira' && lixeiraCount > 0;
            const isVenc = i.href === '/vencimentos' && vencidosCount > 0;
            return (
              <Link
                key={i.href}
                href={i.href}
                title={!sidebarOpen ? i.label : undefined}
                className={`flex items-center rounded-lg px-2.5 py-2 text-sm font-semibold transition-all relative
                  ${sidebarOpen ? 'gap-3' : 'justify-center gap-0'}
                  ${active
                    ? isVenc ? 'text-red-700 bg-red-50' : 'text-cyan-700 bg-cyan-50'
                    : isVenc ? 'text-red-500 hover:bg-red-50 hover:text-red-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                <Icon size={18} className="shrink-0" />
                {sidebarOpen && <span className="truncate flex-1">{i.label}</span>}
                {showBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-black px-1 animate-pulse">
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
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase leading-none shrink-0 ${
                canAdmin ? 'bg-red-100 text-red-700' : canManage ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'
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

            {/* Notificações (desktop) */}
            <div className="relative">
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                className="flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 transition relative"
                title="Notificações"
              >
                <Bell size={16} className={notifsNaoLidas > 0 ? 'text-cyan-600' : 'text-gray-400'} />
                {notifsNaoLidas > 0 && (
                  <span
                    className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[8px] font-black px-0.5"
                    style={{ animation: 'notifPulse 2s infinite' }}
                  >
                    {notifsNaoLidas > 9 ? '9+' : notifsNaoLidas}
                  </span>
                )}
              </button>

              {showNotifs && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                  <div className="absolute left-full bottom-0 ml-2 z-50 w-[360px] max-h-[480px]">
                    {notifPanel}
                  </div>
                </>
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
        <div className="md:hidden fixed inset-0 z-[80]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNotifs(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] z-[81]">
            {notifPanel}
          </div>
        </div>
      )}

      {/* ── Conteúdo principal ── */}
      <div
        className={`flex-1 min-h-screen transition-all duration-200 ease-in-out pt-14 md:pt-0 ${sidebarOpen ? 'md:ml-64' : 'md:ml-[72px]'}`}
      >
        <main className="px-3 py-3 sm:px-4 sm:py-4 md:py-6">{children}</main>
      </div>

      <AutoBackup />

      {/* ── Modal de login ── */}
      {showLogin && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4" onMouseDown={(e) => e.currentTarget === e.target && setShowLogin(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-600 to-teal-600 p-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <Image src="/triar.png" alt="Triar" width={36} height={36} />
                </div>
                <div>
                  <div className="text-lg font-bold text-white">
                    {showForgot ? 'Recuperar Senha' : 'Entrar no Sistema'}
                  </div>
                  <div className="text-xs text-cyan-200 mt-0.5">Controle de Empresas</div>
                </div>
              </div>
            </div>

            {showForgot ? (
              <div className="p-6 space-y-4">
                {forgotSent ? (
                  <>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                      <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm mb-1">
                        <CheckCircle size={16} />
                        Email enviado!
                      </div>
                      <p className="text-xs text-emerald-600">
                        Enviamos um link de recuperação para <strong>{forgotEmail}</strong>. Verifique sua caixa de entrada e spam.
                      </p>
                    </div>
                    <button
                      onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(''); }}
                      className="w-full rounded-xl bg-gray-100 text-gray-700 px-4 py-3 font-semibold hover:bg-gray-200 transition"
                    >
                      Voltar ao Login
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">
                      Digite o email da sua conta. Enviaremos um link para você criar uma nova senha.
                    </p>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                      <input
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
                        placeholder="email@empresa.com"
                        onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()}
                      />
                    </div>
                    <button
                      onClick={handleForgotPassword}
                      disabled={forgotLoading}
                      className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-lg transition disabled:opacity-50"
                    >
                      {forgotLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          Enviando...
                        </span>
                      ) : (
                        'Enviar Link de Recuperação'
                      )}
                    </button>
                    <button
                      onClick={() => { setShowForgot(false); setForgotEmail(''); }}
                      className="w-full text-sm text-gray-500 hover:text-gray-700 font-semibold transition"
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
                    className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Senha</label>
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="w-full rounded-xl bg-gray-50 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-cyan-400 focus:bg-white transition"
                    placeholder="Senha"
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>
                <button
                  onClick={handleLogin}
                  className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white px-4 py-3 font-bold hover:from-cyan-700 hover:to-teal-700 shadow-lg transition"
                >
                  Entrar
                </button>
                <button
                  onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                  className="w-full text-sm text-cyan-600 hover:text-cyan-700 font-semibold transition"
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
