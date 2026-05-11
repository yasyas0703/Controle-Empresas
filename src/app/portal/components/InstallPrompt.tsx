'use client';

import { useEffect, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';

// Tipo do evento beforeinstallprompt (não está nos types padrão do TS)
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'portal-install-dismissed-v1';

function detectarIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function jaInstalado(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return false;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [estado, setEstado] = useState<'hidden' | 'android' | 'ios' | 'instalado'>('hidden');
  const [mostrarInstrucoesIOS, setMostrarInstrucoesIOS] = useState(false);

  useEffect(() => {
    if (jaInstalado()) {
      setEstado('instalado');
      return;
    }

    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY)) {
      // Dispensado nesta sessão, mas ainda escutamos o evento (pode aparecer botão se Chrome disparar)
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setEstado('android');
    };

    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari não dispara beforeinstallprompt — detecta manualmente
    if (detectarIOS()) {
      setEstado('ios');
    }

    // Detecta instalação concluída em tempo real
    const installedHandler = () => setEstado('instalado');
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  async function instalarAndroid() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setEstado('instalado');
    }
    setDeferredPrompt(null);
  }

  function dispensar() {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
    setEstado('hidden');
  }

  if (estado === 'hidden' || estado === 'instalado') return null;

  // iOS — só mostra instruções (não tem instalador automático)
  if (estado === 'ios') {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
        <div className="flex items-start gap-3">
          <Share2 size={18} className="mt-0.5 shrink-0 text-blue-600" />
          <div className="flex-1">
            <p className="font-medium text-blue-900 dark:text-blue-200">Instalar como app no iPhone</p>
            {mostrarInstrucoesIOS ? (
              <ol className="mt-2 ml-4 list-decimal space-y-1 text-xs text-blue-800 dark:text-blue-300">
                <li>Toque no botão <strong>Compartilhar</strong> (ícone de seta pra cima) na barra do Safari.</li>
                <li>Role e toque em <strong>Adicionar à Tela de Início</strong>.</li>
                <li>Confirme em <strong>Adicionar</strong>.</li>
                <li>Feche o Safari e abra o app pelo novo ícone na tela inicial.</li>
              </ol>
            ) : (
              <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                Pra receber notificações, é preciso adicionar à tela inicial pelo Safari.
              </p>
            )}
            <button
              onClick={() => setMostrarInstrucoesIOS((v) => !v)}
              className="mt-2 text-xs font-medium text-blue-700 underline dark:text-blue-300"
            >
              {mostrarInstrucoesIOS ? 'Ocultar passo a passo' : 'Ver como instalar'}
            </button>
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

  // Android / Chrome desktop com beforeinstallprompt disponível
  return (
    <div className="mx-4 mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex items-start gap-3">
        <Download size={18} className="mt-0.5 shrink-0 text-indigo-600" />
        <div className="flex-1">
          <p className="font-medium text-indigo-900 dark:text-indigo-200">
            Instalar o app no celular
          </p>
          <p className="mt-0.5 text-xs text-indigo-800 dark:text-indigo-300">
            Acesse o portal direto da tela inicial e receba avisos sem abrir o navegador.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={instalarAndroid}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Instalar app
            </button>
            <button
              onClick={dispensar}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
