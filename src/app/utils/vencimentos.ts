import type { HistoricoVencimentoItem, UUID, VencimentoFiscal } from '@/app/types';
import { VENCIMENTOS_FISCAIS_NOMES } from '@/app/types';
import { isoNow } from '@/app/utils/date';
import { proximoVencimento } from '@/app/utils/regrasVencimentosFiscais';

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

/**
 * Garante que a empresa tenha um item para cada nome fixo de vencimento fiscal.
 * Mantém os já existentes (casando por `nome`) e anexa os que faltam com vencimento vazio.
 */
export function garantirVencimentosFiscais(existentes?: VencimentoFiscal[] | null): VencimentoFiscal[] {
  const atuais = Array.isArray(existentes) ? existentes : [];
  const porNome = new Map(atuais.map((v) => [v.nome, v]));
  return VENCIMENTOS_FISCAIS_NOMES.map((nome) => {
    const atual = porNome.get(nome);
    if (atual) {
      return {
        ...atual,
        nome,
        tagVencimento: limparTagVencimento(atual.tagVencimento),
        historicoVencimento: normalizarHistoricoVencimento(atual.historicoVencimento),
      };
    }
    return { id: newId(), nome, vencimento: '', historicoVencimento: [] };
  });
}

/**
 * Mesma coisa que `garantirVencimentosFiscais`, mas aplica as regras automáticas
 * de UF/cidade × imposto preenchendo o `vencimento` de itens que estão vazios e
 * onde existe regra. Itens que o usuário preencheu na mão são mantidos.
 *
 * @param estado UF da empresa (ex.: 'MG'). Pode ser undefined.
 * @param cidade Cidade da empresa — usada para regras municipais (ISS).
 * @param referencia Data base para o cálculo (default = hoje). Útil pra testes.
 */
export function garantirVencimentosFiscaisComRegras(
  existentes: VencimentoFiscal[] | null | undefined,
  estado: string | null | undefined,
  cidade?: string | null,
  referencia: Date = new Date(),
): VencimentoFiscal[] {
  const base = garantirVencimentosFiscais(existentes);
  return base.map((item) => {
    if (item.vencimento) return item; // usuário já preencheu manualmente
    const sugerido = proximoVencimento(item.nome, estado, referencia, cidade);
    if (!sugerido) return item;
    return { ...item, vencimento: sugerido };
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
