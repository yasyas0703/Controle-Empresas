export function isoNow(): string {
  return new Date().toISOString();
}

export function toISODate(input: Date | string): string {
  const d = typeof input === 'string' ? parseISODate(input) : input;
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  // Parse as local date to avoid UTC timezone shift (e.g. "2026-02-09" becoming Feb 8 in UTC-3)
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function daysUntil(dateStr?: string): number | null {
  const d = parseISODate(dateStr);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function isWithinDays(dateStr: string | undefined, days: number): boolean {
  const remaining = daysUntil(dateStr);
  return remaining !== null && remaining >= 0 && remaining <= days;
}

export function formatBR(dateStr?: string): string {
  const d = parseISODate(dateStr);
  if (!d) return '-';
  return d.toLocaleDateString('pt-BR');
}

// "15/06/2026 13:18" — data + HORA (local). Aceita ISO datetime completo
// (ex.: enviadoEm/abertoEm). NÃO usar parseISODate (que split('-') e quebra
// num ISO com hora) — usa Date direto.
export function formatDateTimeBR(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// "mar/2031" — usado quando a data exata importa menos que o mês/ano
// (ex: badge de próximo vencimento no card de empresa, que antes mostrava
// "Vence em 412d" — informação sem valor pra um vencimento distante).
export function formatMesAno(dateStr?: string): string {
  const d = parseISODate(dateStr);
  if (!d) return '-';
  return `${MESES_ABREV[d.getMonth()]}/${d.getFullYear()}`;
}

/**
 * Verifica se um RET foi renovado: a data de renovação é >= a data de vencimento.
 * Quando renovado, o RET não deve ser considerado "vencido".
 */
export function isRetRenovado(vencimento?: string, ultimaRenovacao?: string): boolean {
  const venc = parseISODate(vencimento);
  const renov = parseISODate(ultimaRenovacao);
  if (!venc || !renov) return false;
  venc.setHours(0, 0, 0, 0);
  renov.setHours(0, 0, 0, 0);
  return renov.getTime() >= venc.getTime();
}
