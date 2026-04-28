'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// PageClient usa pdfjs-dist (extração de texto de PDF), que só funciona no
// browser. Carregamos dinamicamente com SSR desabilitado pra evitar erro
// "Module not found: canvas" no build do Next.
const PageClient = dynamic(() => import('./PageClient'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl bg-white px-6 py-4 shadow-lg dark:bg-gray-800">
        <Loader2 size={20} className="animate-spin text-cyan-600" />
        <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
          Carregando processador de guias...
        </span>
      </div>
    </div>
  ),
});

export default function Page() {
  return <PageClient />;
}
