'use client';

import { useEffect } from 'react';
import { Clapperboard, X } from 'lucide-react';
import { useDemoMode, setDemoMode, getDemoMode } from '@/app/utils/demoMode';

/**
 * Controle e aviso do MODO DEMONSTRAÇÃO (gravação de vídeo).
 *  • Lê ?demo=1 / ?demo=0 da URL ao montar.
 *  • Atalho Ctrl + Shift + D liga/desliga.
 *  • Mostra uma faixa fixa no topo quando ligado, com botão "Desativar".
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

  return (
    <div className="fixed top-0 left-0 right-0 z-[2000] bg-violet-600 text-white text-xs sm:text-sm font-semibold shadow-md">
      <div className="flex items-center justify-center gap-3 px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5">
          <Clapperboard size={15} />
          Modo demonstração ativo — nomes, CNPJs e contatos ocultados
        </span>
        <button
          onClick={() => setDemoMode(false)}
          className="inline-flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 px-2 py-0.5 transition"
        >
          <X size={13} /> Desativar
        </button>
      </div>
    </div>
  );
}
