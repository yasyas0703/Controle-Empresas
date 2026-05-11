'use client';

import { useEffect, useState } from 'react';
import { Bell, X, Smartphone } from 'lucide-react';
import { supabasePortal } from '@/lib/supabasePortal';

// Banner discreto que pede permissão de push notification.
// Aparece só se: navegador suporta push + permissão = 'default' (nunca decidiu)
// + não foi dispensado nesta sessão.

const DISMISS_KEY = 'portal-push-dismissed-v1';
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectarIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua);
}

function estaInstalado(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari não usa display-mode; usa navigator.standalone
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return false;
}

export default function PushPrompt() {
  const [estado, setEstado] = useState<
    | 'loading'
    | 'inviavel'
    | 'pendente'
    | 'ios-precisa-instalar'
    | 'dispensado'
  >('loading');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    // Suporte do browser
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setEstado('inviavel');
      return;
    }

    // VAPID configurado?
    if (!VAPID_PUBLIC) {
      setEstado('inviavel');
      return;
    }

    // Já dispensado nesta sessão
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY)) {
      setEstado('dispensado');
      return;
    }

    // Já concedido ou negado, não mostra
    if (Notification.permission !== 'default') {
      setEstado('dispensado');
      // Se concedido, garante que a subscription está registrada
      if (Notification.permission === 'granted') {
        void garantirSubscription().catch(() => {});
      }
      return;
    }

    // iOS precisa do app "Adicionado à tela inicial" pra push funcionar
    if (detectarIOS() && !estaInstalado()) {
      setEstado('ios-precisa-instalar');
      return;
    }

    setEstado('pendente');
  }, []);

  async function garantirSubscription() {
    const reg = await navigator.serviceWorker.register('/portal-sw.js', { scope: '/portal/' });
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }

    const { data: session } = await supabasePortal.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await fetch('/api/portal/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      }),
    });
  }

  async function aceitar() {
    setEnviando(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await garantirSubscription();
      }
    } catch (err) {
      console.error('[PushPrompt] erro ao ativar push:', err);
    } finally {
      setEnviando(false);
      setEstado('dispensado');
    }
  }

  function dispensar() {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
    setEstado('dispensado');
  }

  if (estado === 'loading' || estado === 'inviavel' || estado === 'dispensado') return null;

  if (estado === 'ios-precisa-instalar') {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
        <div className="flex items-start gap-3">
          <Smartphone size={18} className="mt-0.5 shrink-0 text-blue-600" />
          <div className="flex-1">
            <p className="font-medium text-blue-900 dark:text-blue-200">
              Adicione o portal à tela inicial pra receber avisos
            </p>
            <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
              No Safari, toque em <strong>Compartilhar</strong> (ícone de seta) → <strong>Adicionar à Tela de Início</strong>. Depois abra pelo ícone novo e ative as notificações.
            </p>
          </div>
          <button
            onClick={dispensar}
            className="rounded p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
            aria-label="Dispensar"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="flex items-start gap-3">
        <Bell size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <p className="font-medium text-emerald-900 dark:text-emerald-200">
            Quer receber avisos quando chegar uma guia nova?
          </p>
          <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
            A gente te avisa direto no celular — sem precisar abrir email.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={aceitar}
              disabled={enviando}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {enviando ? 'Ativando...' : 'Ativar notificações'}
            </button>
            <button
              onClick={dispensar}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
