'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// PDF viewer (pdfjs-dist) só funciona no browser. Carregamos dinamicamente
// com SSR desabilitado pra evitar erro "Module not found: canvas".
const ModalVisualizadorArquivoCore = dynamic(
  () => import('./ModalVisualizadorArquivoCore'),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40">
        <div className="rounded-xl bg-white px-6 py-4 shadow-lg flex items-center gap-3 text-gray-700">
          <Loader2 size={20} className="animate-spin text-cyan-600" />
          <span className="text-sm font-bold">Carregando visualizador...</span>
        </div>
      </div>
    ),
  }
);

export default ModalVisualizadorArquivoCore;
