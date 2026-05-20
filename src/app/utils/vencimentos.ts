import type { HistoricoVencimentoItem, Tributacao, UUID, VencimentoFiscal } from '@/app/types';
import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES } from '@/app/types';
import { isoNow } from '@/app/utils/date';
import { proximoVencimento } from '@/app/utils/regrasVencimentosFiscais';

// União das obrigações de regime normal + SN. Empresa só vê na aba "Envio
// de Guias" as que estão ativas pra ela em empresa_obrigacoes_config
// (preenchido pelo script de descoberta). As inativas são filtradas na UI.
const TODOS_NOMES_FISCAIS: readonly string[] = [
  ...VENCIMENTOS_FISCAIS_NOMES,
  ...VENCIMENTOS_FISCAIS_SN_NOMES.filter((n) => !(VENCIMENTOS_FISCAIS_NOMES as readonly string[]).includes(n)),
];

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
 * Escolhe a lista de obrigações relevantes baseado no regime tributário:
 *   - simples_nacional → só obrigações SN (DAS, SINTEGRA, DESTDA etc)
 *   - lucro_real / lucro_presumido → só obrigações do regime federal
 *   - null/undefined → união (default conservador, mostra tudo)
 */
function nomesPorTributacao(tributacao?: Tributacao | null): readonly string[] {
  if (tributacao === 'simples_nacional') return VENCIMENTOS_FISCAIS_SN_NOMES;
  if (tributacao === 'lucro_real' || tributacao === 'lucro_presumido') return VENCIMENTOS_FISCAIS_NOMES;
  return TODOS_NOMES_FISCAIS;
}

/**
 * Garante que a empresa tenha um item para cada nome fixo de vencimento fiscal.
 * Mantém os já existentes (casando por `nome`) e anexa os que faltam com vencimento vazio.
 *
 * @param tributacao Se fornecida, filtra a lista pra mostrar só obrigações
 * relevantes ao regime (SN ou normal). Se omitida, retorna a união completa.
 */
export function garantirVencimentosFiscais(
  existentes?: VencimentoFiscal[] | null,
  tributacao?: Tributacao | null,
): VencimentoFiscal[] {
  const atuais = Array.isArray(existentes) ? existentes : [];
  const porNome = new Map(atuais.map((v) => [v.nome, v]));
  const nomesRelevantes = nomesPorTributacao(tributacao);
  return nomesRelevantes.map((nome) => {
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
 * @param tributacao Filtra a lista pelo regime (SN ou normal). Omita pra retornar união.
 */
export function garantirVencimentosFiscaisComRegras(
  existentes: VencimentoFiscal[] | null | undefined,
  estado: string | null | undefined,
  cidade?: string | null,
  referencia: Date = new Date(),
  tributacao?: Tributacao | null,
): VencimentoFiscal[] {
  const base = garantirVencimentosFiscais(existentes, tributacao);
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
