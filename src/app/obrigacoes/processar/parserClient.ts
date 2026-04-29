/**
 * Helpers client-only do processador de guias.
 * Separado pra ser carregado dinamicamente (evita SSR + bundle pesado).
 */

import { extrairTextoPdf } from '@/app/utils/extrairTextoPdf';
import { reconhecerGuia, type ResultadoReconhecimento } from '@/app/utils/reconhecerGuia';
import type { Empresa, Obrigacao } from '@/app/types';

export interface ItemProcessamento {
  id: string;
  file: File;
  status: 'pendente' | 'processando' | 'pronto' | 'erro' | 'importado' | 'ignorado';
  erro?: string;
  texto?: string;
  numPaginas?: number;
  resultado?: ResultadoReconhecimento;
  // sobrescritas manuais do usuário
  empresaIdManual?: string | null;
  obrigacaoIdManual?: string | null;
  competenciaManual?: string | null;
  // pós-importação
  arquivoPath?: string;
  emailEnviado?: boolean;
  emailEnviando?: boolean;
  emailErro?: string;
  tarefaConcluida?: boolean;
}

export async function processarPdfArquivo(
  item: ItemProcessamento,
  empresas: Empresa[],
  obrigacoes: Obrigacao[]
): Promise<ItemProcessamento> {
  try {
    const extraido = await extrairTextoPdf(item.file);
    const resultado = reconhecerGuia(extraido.texto, empresas, obrigacoes);
    return {
      ...item,
      status: 'pronto',
      texto: extraido.texto,
      numPaginas: extraido.numPaginas,
      resultado,
    };
  } catch (err) {
    return {
      ...item,
      status: 'erro',
      erro: err instanceof Error ? err.message : 'Erro ao extrair texto do PDF.',
    };
  }
}
