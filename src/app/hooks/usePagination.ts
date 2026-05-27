'use client';

// Hook compartilhado pra paginação client-side. Antes estava duplicado
// em empresas/page.tsx e vencimentos/page.tsx — 7 linhas de cálculo
// (totalPages, pageClamped, slice) + 4 handlers de botão x 2 páginas.
//
// O reset-pra-página-1 quando filtros mudam fica no chamador (cada
// página define quais filtros disparam isso), porque isso varia
// demais pra encapsular sem virar abstração complicada.

import { useMemo, useState, useCallback } from 'react';
import { useLocalStorageState } from '@/app/hooks/useLocalStorageState';

interface UsePaginationOptions {
  /**
   * Chave do localStorage pra persistir `perPage` entre sessões. Cada
   * página tem a sua (ex: 'triar-empresas-per-page'). Sem isso, o user
   * teria que reescolher "50 por página" toda vez.
   */
  storageKey: string;
  /** Quantidade inicial por página (default 50). */
  initialPerPage?: number;
}

export function usePagination<T>(items: T[], opts: UsePaginationOptions) {
  const { storageKey, initialPerPage = 50 } = opts;
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useLocalStorageState<number>(storageKey, initialPerPage);

  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  // Clampa `page` ao limite atual — evita exibir página vazia se a lista
  // encolheu (ex: depois de aplicar filtro que reduz drasticamente).
  const pageClamped = Math.min(page, totalPages);

  const sliced = useMemo(() => {
    const start = (pageClamped - 1) * perPage;
    return items.slice(start, start + perPage);
  }, [items, pageClamped, perPage]);

  const goFirst = useCallback(() => setPage(1), []);
  const goPrev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const goNext = useCallback(() => setPage((p) => Math.min(totalPages, p + 1)), [totalPages]);
  const goLast = useCallback(() => setPage(totalPages), [totalPages]);

  return {
    page: pageClamped,
    perPage,
    setPage,
    setPerPage,
    totalPages,
    sliced,
    goFirst,
    goPrev,
    goNext,
    goLast,
    isFirst: pageClamped <= 1,
    isLast: pageClamped >= totalPages,
  };
}
