'use client';

import { useEffect } from 'react';
import { Clapperboard } from 'lucide-react';
import { useDemoMode, setDemoMode, getDemoMode } from '@/app/utils/demoMode';

/**
 * Controle e aviso do MODO DEMONSTRAÇÃO (gravação de vídeo).
 *  • Lê ?demo=1 / ?demo=0 da URL ao montar.
 *  • Atalho Ctrl + Shift + D liga/desliga.
 *  • Mostra um selo discreto no canto inferior quando ligado (não atrapalha o vídeo).
 */
export default function DemoModeBanner() {
  const on = useDemoMode();

  // Liga/desliga via parâmetro ?demo=1 / ?demo=0 na URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('demo');
    if (v === '1' || v === 'true') setDemoMode(true);
    else if (v === '0' || v === 'false') setDemoMode(false);
  }, []);

  // Atalho de teclado Ctrl + Shift + D.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setDemoMode(!getDemoMode());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!on) return null;

  // Selo discreto no canto inferior esquerdo: lembra que o modo está ativo
  // sem ocupar espaço na tela. Semi-transparente e some no hover (vira botão
  // de desativar) — fácil de ignorar/cortar na gravação.
  return (
    <button
      onClick={() => setDemoMode(false)}
      title="Modo demonstração ativo — clique (ou Ctrl+Shift+D) para desativar"
      className="group fixed bottom-2 left-2 z-[2000] inline-flex items-center gap-1.5 rounded-full bg-violet-600/40 hover:bg-violet-600 text-white/80 hover:text-white text-[10px] font-semibold px-2 py-1 shadow-sm backdrop-blur-sm transition-all opacity-50 hover:opacity-100"
    >
      <Clapperboard size={12} />
      <span className="hidden group-hover:inline">Desativar demo</span>
    </button>
  );
}
