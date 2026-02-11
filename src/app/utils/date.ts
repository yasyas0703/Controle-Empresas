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
