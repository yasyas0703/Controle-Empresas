'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Registra o service worker e cuida do ciclo de auto-update.
// Quando uma versão nova é detectada e ativada, recarrega a página automaticamente.

export default function SWAutoUpdate() {
  const [atualizando, setAtualizando] = useState(false);
  const recarregouRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;
    let intervalId: number | null = null;

    // Quando o SW que controla a página muda, recarrega.
    // (acontece depois do skipWaiting + clients.claim do novo SW)
    const onControllerChange = () => {
      if (recarregouRef.current) return;
      recarregouRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    (async () => {
      try {
        reg = await navigator.serviceWorker.register('/portal-sw.js', { scope: '/portal/' });

        // Quando um SW novo entra em "installing", mostra "atualizando..."
        const watchUpdate = (registration: ServiceWorkerRegistration) => {
          const sw = registration.installing;
          if (!sw) return;
          setAtualizando(true);
          sw.addEventListener('statechange', () => {
            if (sw.state === 'activated' || sw.state === 'redundant') {
              setAtualizando(false);
            }
          });
        };

        // Caso já tenha algo em installing nesse momento
        if (reg.installing) watchUpdate(reg);

        // Escuta novas atualizações
        reg.addEventListener('updatefound', () => {
          if (reg) watchUpdate(reg);
        });

        // Periodicamente checa por updates (a cada 15 min enquanto o app está aberto)
        intervalId = window.setInterval(() => {
          reg?.update().catch(() => {});
        }, 15 * 60 * 1000);

        // E checa também sempre que o app volta a ficar visível (ex.: usuário volta da home pro PWA)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') {
            reg?.update().catch(() => {});
          }
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
          document.removeEventListener('visibilitychange', onVisibility);
        };
      } catch (err) {
        console.warn('[SWAutoUpdate] falha ao registrar SW:', err);
      }
    })();

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  if (!atualizando) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-slate-700/90">
      <span className="inline-flex items-center gap-2">
        <RefreshCw size={12} className="animate-spin" />
        Atualizando para a versão mais recente...
      </span>
    </div>
  );
}
