/**
 * Extrai texto de um arquivo PDF no browser carregando pdf.js direto do CDN.
 *
 * Por que não usar `import 'pdfjs-dist'`?
 *   Pdfjs-dist 3.x tem um `require("canvas")` dentro do build que o bundler
 *   tenta resolver (canvas é lib Node — não existe no browser). Mesmo com
 *   aliases, Turbopack 16 não estava ignorando direito. Carregando do CDN em
 *   runtime, o bundler nem vê o pdfjs.
 */

const PDF_LIB_URL = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
const PDF_WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (s: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
    }>;
  };
};

type WindowWithPdfjs = Window & { pdfjsLib?: PdfjsLib };

let cargaPromise: Promise<PdfjsLib> | null = null;

function carregarPdfjs(): Promise<PdfjsLib> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('extrairTextoPdf só funciona no browser'));
  }
  const w = window as WindowWithPdfjs;
  if (w.pdfjsLib) {
    w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return Promise.resolve(w.pdfjsLib);
  }
  if (cargaPromise) return cargaPromise;

  cargaPromise = new Promise<PdfjsLib>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDF_LIB_URL;
    script.async = true;
    script.onload = () => {
      const lib = (window as WindowWithPdfjs).pdfjsLib;
      if (!lib) {
        reject(new Error('pdfjsLib não inicializou após carregar script'));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      resolve(lib);
    };
    script.onerror = () => reject(new Error('Falha ao carregar pdf.js do CDN'));
    document.head.appendChild(script);
  });

  return cargaPromise;
}

export interface TextoExtraido {
  texto: string;          // texto inteiro concatenado
  numPaginas: number;
  paginas: string[];      // texto por página (índice 0 = página 1)
}

export async function extrairTextoPdf(file: File): Promise<TextoExtraido> {
  const pdfjs = await carregarPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
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
