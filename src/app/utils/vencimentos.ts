import type { HistoricoVencimentoItem, UUID } from '@/app/types';
import { isoNow } from '@/app/utils/date';

function newId(): UUID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function getEventTime(value?: string): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function limparTagVencimento(value?: string | null): string | undefined {
  const cleaned = String(value ?? '').trim();
  return cleaned || undefined;
}

export function normalizarHistoricoVencimento(historico?: HistoricoVencimentoItem[] | null): HistoricoVencimentoItem[] {
  if (!Array.isArray(historico)) return [];

  return historico
    .map((item) => ({
      id: item?.id || newId(),
      titulo: String(item?.titulo ?? '').trim(),
      descricao: String(item?.descricao ?? '').trim() || undefined,
      dataEvento: String(item?.dataEvento ?? '').trim() || undefined,
      autorId: item?.autorId ?? null,
      autorNome: String(item?.autorNome ?? '').trim() || undefined,
      criadoEm: String(item?.criadoEm ?? '').trim() || isoNow(),
    }))
    .filter((item) => item.titulo)
    .sort((a, b) => {
      const aTime = getEventTime(a.dataEvento || a.criadoEm);
      const bTime = getEventTime(b.dataEvento || b.criadoEm);
      return bTime - aTime;
    });
}

export function criarHistoricoVencimentoItem({
  titulo,
  descricao,
  dataEvento,
  autorId,
  autorNome,
}: {
  titulo: string;
  descricao?: string;
  dataEvento?: string;
  autorId?: UUID | null;
  autorNome?: string;
}): HistoricoVencimentoItem {
  return {
    id: newId(),
    titulo: titulo.trim(),
    descricao: descricao?.trim() || undefined,
    dataEvento: dataEvento?.trim() || undefined,
    autorId: autorId ?? null,
    autorNome: autorNome?.trim() || undefined,
    criadoEm: isoNow(),
  };
}
