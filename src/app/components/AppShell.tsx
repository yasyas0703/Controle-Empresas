'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { LogOut, Shield, User, LayoutDashboard, CalendarDays, Building2, Users, Layers, BarChart3, ClipboardList, Briefcase, AlertTriangle, Trash2, Bell, CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { daysUntil } from '@/app/utils/date';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vencimentos', label: 'Vencimentos', icon: AlertTriangle, badge: true },
  { href: '/calendario', label: 'Calendário', icon: CalendarDays },
  { href: '/empresas', label: 'Empresas', icon: Building2 },
  { href: '/servicos', label: 'Serviços', icon: Briefcase },
  { href: '/usuarios', label: 'Usuários', icon: Users },
  { href: '/departamentos', label: 'Departamentos', icon: Layers },
  { href: '/analises', label: 'Análises', icon: BarChart3 },
  { href: '/historico', label: 'Histórico', icon: ClipboardList },
  { href: '/lixeira', label: 'Lixeira', icon: Trash2 },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentUser, canManage, logout, login, mostrarAlerta, empresas, notificacoes, marcarNotificacaoLida, marcarTodasLidas, limparNotificacoes, lixeira, loading, authReady } = useSistema();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);

  // Só mostra login quando auth terminou de carregar e não há usuário
  React.useEffect(() => {
    if (authReady && !currentUser) setShowLogin(true);
    if (currentUser) setShowLogin(false);
  }, [authReady, currentUser]);

  // Count expired items for badge
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
  const [senha, setSenha] = useState('');

  const notifsNaoLidas = (notificacoes ?? []).filter((n) => !n.lida).length;
  const lixeiraCount = (lixeira ?? []).length;

  const handleLogin = async () => {
    const ok = await login(email, senha);
    if (!ok) {
      mostrarAlerta('Login inválido', 'Verifique email/senha e tente novamente.', 'erro');
      return;
    }
    setShowLogin(false);
  };

  // Enquanto verifica sessão, mostra loading
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

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-50 bg-white shadow-lg border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-cyan-400 to-blue-600 p-[2px] rounded-2xl shadow-xl">
              <div className="w-14 h-14 md:w-20 md:h-20 rounded-[14px] overflow-hidden bg-white/90 backdrop-blur flex items-center justify-center transition-transform duration-200 hover:scale-[1.02]">
                <Image
                  src="/triar.png"
                  alt="Logo Triar"
                  width={64}
                  height={64}
                  priority
                  className="w-10 h-10 md:w-16 md:h-16 object-contain"
                />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="leading-[1.05] tracking-tight">
                <span className="block text-base md:text-lg font-bold text-gray-700 whitespace-nowrap">
                  Controle de
                </span>
                <span className="block -mt-0.5 text-xl md:text-2xl font-extrabold text-gray-900 whitespace-nowrap">
                  Empresas
                </span>
              </h1>
              <p className="text-gray-600 text-sm leading-snug hidden sm:block">
                Gestão Empresarial
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentUser ? (
              <div className="flex items-center gap-2">
                {/* Notification Bell */}
                <div className="relative">
                  <button
                    onClick={() => setShowNotifs(!showNotifs)}
                    className="relative rounded-xl p-2.5 bg-gray-50 hover:bg-gray-100 transition"
                    title="Notificações"
                  >
                    <Bell size={18} className={notifsNaoLidas > 0 ? 'text-cyan-600' : 'text-gray-500'} />
                    {notifsNaoLidas > 0 && (
                      <span
                        className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-black px-1"
                        style={{ animation: 'notifPulse 2s infinite' }}
                      >
                        {notifsNaoLidas > 9 ? '9+' : notifsNaoLidas}
                      </span>
                    )}
                  </button>

                  {/* Dropdown */}
                  {showNotifs && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                      <div className="absolute right-0 top-12 z-50 w-[calc(100vw-2rem)] sm:w-[400px] max-h-[480px] overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-cyan-50 to-teal-50">
                          <div className="font-bold text-gray-900 text-sm">Notificações</div>
                          <div className="flex items-center gap-2">
                            {notifsNaoLidas > 0 && (
                              <button onClick={marcarTodasLidas} className="text-[11px] text-cyan-600 hover:text-cyan-700 font-bold">
                                Marcar todas como lidas
                              </button>
                            )}
                            {(notificacoes ?? []).length > 0 && (
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
                    </>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-2 rounded-xl px-3 py-2 bg-gray-50">
                  {canManage ? <Shield size={15} className="text-amber-500" /> : <User size={15} className="text-gray-400" />}
                  <div className="text-sm font-semibold text-gray-700">{currentUser.nome}</div>
                  <span className="text-[10px] bg-cyan-100 text-cyan-700 font-bold px-1.5 py-0.5 rounded-md uppercase">
                    {currentUser.role === 'gerente' ? 'Admin' : 'User'}
                  </span>
                </div>
                <button
                  onClick={() => { logout(); setShowLogin(true); }}
                  className="rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm text-gray-600 flex items-center gap-2 font-semibold transition"
                  title="Sair"
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="rounded-xl px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-sm text-white font-semibold transition"
              >
                Entrar
              </button>
            )}
          </div>
        </div>

        <nav className="mx-auto max-w-7xl px-2 sm:px-4 pb-2 flex gap-1 overflow-x-auto border-t border-gray-100 pt-2 scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {nav
            .filter((i) => (canManage ? true : !['/usuarios', '/departamentos', '/servicos', '/historico', '/lixeira'].includes(i.href)))
            .map((i) => {
              const active = pathname === i.href;
              const Icon = i.icon;
              const showBadge = (i as any).badge && vencidosCount > 0;
              const showLixeiraBadge = i.href === '/lixeira' && lixeiraCount > 0;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={
                    'whitespace-nowrap rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 sm:gap-2 relative ' +
                    (active
                      ? i.href === '/vencimentos' && vencidosCount > 0
                        ? 'text-red-700 bg-red-50 border-b-2 border-red-600'
                        : 'text-cyan-700 bg-cyan-50 border-b-2 border-cyan-600'
                      : i.href === '/vencimentos' && vencidosCount > 0
                        ? 'text-red-500 hover:bg-red-50 hover:text-red-700 font-bold'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700')
                  }
                >
                  <Icon size={16} />
                  {i.label}
                  {showBadge && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-red-600 text-white text-[10px] font-black px-1.5 animate-pulse">
                      {vencidosCount}
                    </span>
                  )}
                  {showLixeiraBadge && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gray-500 text-white text-[10px] font-bold px-1">
                      {lixeiraCount}
                    </span>
                  )}
                </Link>
              );
            })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-2 sm:px-4 py-4 sm:py-6">{children}</main>

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
                  <div className="text-lg font-bold text-white">Entrar no Sistema</div>
                  <div className="text-xs text-cyan-200 mt-0.5">Controle de Empresas</div>
                </div>
              </div>
            </div>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
