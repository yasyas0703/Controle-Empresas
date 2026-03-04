export function comparePtBr(a: string | null | undefined, b: string | null | undefined): number {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();

  if (!left && right) return 1;
  if (left && !right) return -1;

  return left.localeCompare(right, 'pt-BR', {
    sensitivity: 'base',
    numeric: true,
  });
}

export function sortByPtBr<T>(
  items: readonly T[],
  getLabel: (item: T) => string | null | undefined
): T[] {
  return [...items].sort((a, b) => comparePtBr(getLabel(a), getLabel(b)));
}

export function sortStringsPtBr(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value)).sort(comparePtBr);
}

export function sortResponsaveisByNome<
  T extends { dep: string | null | undefined; user: string | null | undefined }
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byUser = comparePtBr(a.user, b.user);
    if (byUser !== 0) return byUser;
    return comparePtBr(a.dep, b.dep);
  });
}
