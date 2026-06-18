import type { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { arquivarLogsAntigos } from '@/lib/logsArquivo';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// Dias após os quais o diff detalhado (o "antes → depois" de cada campo) sai do
// banco. O RESUMO de cada ação (quem / o quê / quando / mensagem) fica PRA
// SEMPRE no banco; o diff NÃO é apagado e sim ARQUIVADO no Storage (ver
// @/lib/logsArquivo) — então nada se perde, só deixa de pesar nos 500MB do banco.
export const DIAS_RETENCAO_DIFF = 30;

export interface CompactarLogsResult {
  dry: boolean;
  /** Quantas linhas tiveram o diff arquivado+zerado (modo real). */
  compactados?: number;
  /** Quantas linhas foram gravadas no arquivo do Storage (modo real). */
  arquivados?: number;
  /** Quantas linhas seriam compactadas (modo dry). */
  elegiveis?: number;
  /** Data de corte usada (logs com `em` anterior a isto entram). */
  corteIso: string;
}

/**
 * Arquiva no Storage e zera o `diff` de logs com mais de DIAS_RETENCAO_DIFF dias,
 * mantendo a linha (resumo) no banco. Idempotente. Lança em caso de erro — quem
 * chama decide se é fatal (endpoint) ou best-effort (piggyback no cron).
 */
export async function compactarLogsAntigos(
  admin: SupabaseAdmin,
  opts: { dry?: boolean; maxBatches?: number } = {},
): Promise<CompactarLogsResult> {
  const dry = !!opts.dry;
  const corte = new Date();
  corte.setDate(corte.getDate() - DIAS_RETENCAO_DIFF);
  const corteIso = corte.toISOString();

  if (dry) {
    const { count, error } = await admin
      .from('logs')
      .select('id', { count: 'exact', head: true })
      .lt('em', corteIso)
      .not('diff', 'is', null);
    if (error) throw error;
    return { dry: true, elegiveis: count ?? 0, corteIso };
  }

  const { arquivados, compactados } = await arquivarLogsAntigos(admin, {
    corteIso,
    maxBatches: opts.maxBatches,
  });
  return { dry: false, compactados, arquivados, corteIso };
}
