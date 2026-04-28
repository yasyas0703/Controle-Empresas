/**
 * Extrai texto de um arquivo PDF no browser usando pdfjs-dist.
 * Apenas client-side. Usa worker via CDN pra evitar bundle Next.js complicado.
 */

import * as pdfjs from 'pdfjs-dist';

// Worker URL — versão fixa que combina com pdfjs-dist 3.x instalado
const PDF_WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

let workerConfigurado = false;
function garantirWorker() {
  if (workerConfigurado) return;
  if (typeof window === 'undefined') return; // safety
  // pdfjs.GlobalWorkerOptions é o ponto de configuração
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  workerConfigurado = true;
}

export interface TextoExtraido {
  texto: string;          // texto inteiro concatenado
  numPaginas: number;
  paginas: string[];      // texto por página (índice 0 = página 1)
}

export async function extrairTextoPdf(file: File): Promise<TextoExtraido> {
  garantirWorker();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = (pdfjs as unknown as { getDocument: (s: { data: ArrayBuffer }) => { promise: Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
  }> } }).getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const txt = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ');
    paginas.push(txt);
  }

  return {
    texto: paginas.join('\n\n'),
    numPaginas: pdf.numPages,
    paginas,
  };
}
