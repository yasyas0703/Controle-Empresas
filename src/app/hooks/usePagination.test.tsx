// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from './usePagination';

const items20 = Array.from({ length: 20 }, (_, i) => i);

describe('usePagination', () => {
  it('inicia na página 1 com perPage default 50', () => {
    const { result } = renderHook(() => usePagination(items20, { storageKey: 'test-1' }));
    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(50);
  });

  it('respeita initialPerPage', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-2', initialPerPage: 5 }),
    );
    expect(result.current.perPage).toBe(5);
  });

  it('calcula totalPages corretamente (ceiling)', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-3', initialPerPage: 7 }),
    );
    // 20 items / 7 por página = 3 páginas (7, 7, 6)
    expect(result.current.totalPages).toBe(3);
  });

  it('totalPages mínimo 1 mesmo pra lista vazia', () => {
    const { result } = renderHook(() => usePagination([], { storageKey: 'test-4' }));
    expect(result.current.totalPages).toBe(1);
  });

  it('sliced retorna a fatia correta da página atual', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-5', initialPerPage: 5 }),
    );
    expect(result.current.sliced).toEqual([0, 1, 2, 3, 4]);
    act(() => result.current.setPage(2));
    expect(result.current.sliced).toEqual([5, 6, 7, 8, 9]);
    act(() => result.current.setPage(4));
    expect(result.current.sliced).toEqual([15, 16, 17, 18, 19]);
  });

  it('clampa page quando passa do total (lista encolheu)', () => {
    const { result, rerender } = renderHook(
      ({ items }) => usePagination(items, { storageKey: 'test-6', initialPerPage: 5 }),
      { initialProps: { items: items20 } },
    );
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    // Lista encolhe pra 6 items → totalPages=2 → page deve clampar pra 2
    rerender({ items: items20.slice(0, 6) });
    expect(result.current.page).toBe(2);
    expect(result.current.sliced).toEqual([5]);
  });

  it('goFirst/goPrev/goNext/goLast funcionam', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-7', initialPerPage: 5 }),
    );
    expect(result.current.page).toBe(1);
    act(() => result.current.goLast());
    expect(result.current.page).toBe(4);
    act(() => result.current.goPrev());
    expect(result.current.page).toBe(3);
    act(() => result.current.goFirst());
    expect(result.current.page).toBe(1);
    act(() => result.current.goNext());
    expect(result.current.page).toBe(2);
  });

  it('goPrev não passa de 1', () => {
    const { result } = renderHook(() => usePagination(items20, { storageKey: 'test-8' }));
    act(() => result.current.goPrev());
    expect(result.current.page).toBe(1);
  });

  it('goNext não passa de totalPages', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-9', initialPerPage: 5 }),
    );
    act(() => result.current.goLast());
    act(() => result.current.goNext());
    expect(result.current.page).toBe(4);
  });

  it('isFirst/isLast flags', () => {
    const { result } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-10', initialPerPage: 5 }),
    );
    expect(result.current.isFirst).toBe(true);
    expect(result.current.isLast).toBe(false);
    act(() => result.current.goLast());
    expect(result.current.isFirst).toBe(false);
    expect(result.current.isLast).toBe(true);
  });

  it('persiste perPage no localStorage entre re-renders', () => {
    const { result, unmount } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-persistence', initialPerPage: 10 }),
    );
    act(() => result.current.setPerPage(25));
    expect(result.current.perPage).toBe(25);
    unmount();

    // Re-mount com mesma chave deve recuperar o valor (do localStorage)
    const { result: result2 } = renderHook(() =>
      usePagination(items20, { storageKey: 'test-persistence', initialPerPage: 10 }),
    );
    expect(result2.current.perPage).toBe(25);
  });
});
