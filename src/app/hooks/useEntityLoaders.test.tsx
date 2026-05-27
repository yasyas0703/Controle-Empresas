// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock do SistemaContext. O hook só lê `departamentos` e `usuarios` do
// contexto, então passamos um stub minimo via mock factory.
const mockSistemaState = {
  departamentos: [
    { id: 'dep-1', nome: 'Fiscal' },
    { id: 'dep-2', nome: 'Pessoal' },
    { id: 'dep-3', nome: 'Contábil' },
  ],
  usuarios: [
    { id: 'user-1', nome: 'Yasmin' },
    { id: 'user-2', nome: 'João' },
  ],
};

vi.mock('@/app/context/SistemaContext', () => ({
  useSistema: () => mockSistemaState,
}));

import { useEntityLoaders } from './useEntityLoaders';

describe('useEntityLoaders', () => {
  beforeEach(() => {
    // Reseta arrays pra estado base entre testes (caso algum teste mute)
    mockSistemaState.departamentos = [
      { id: 'dep-1', nome: 'Fiscal' },
      { id: 'dep-2', nome: 'Pessoal' },
      { id: 'dep-3', nome: 'Contábil' },
    ];
    mockSistemaState.usuarios = [
      { id: 'user-1', nome: 'Yasmin' },
      { id: 'user-2', nome: 'João' },
    ];
  });

  describe('getDepName', () => {
    it('retorna nome do departamento existente', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getDepName('dep-1')).toBe('Fiscal');
      expect(result.current.getDepName('dep-2')).toBe('Pessoal');
    });

    it('retorna string vazia se id não existe', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getDepName('não-existe')).toBe('');
    });

    it('retorna string vazia pra id vazio', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getDepName('')).toBe('');
    });
  });

  describe('getDepIndex', () => {
    it('retorna índice (0-based) do departamento', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getDepIndex('dep-1')).toBe(0);
      expect(result.current.getDepIndex('dep-3')).toBe(2);
    });

    it('retorna -1 se id não existe', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getDepIndex('não-existe')).toBe(-1);
    });
  });

  describe('getUserName', () => {
    it('retorna nome do usuário existente', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getUserName('user-1')).toBe('Yasmin');
    });

    it('retorna string vazia pra null', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getUserName(null)).toBe('');
    });

    it('retorna string vazia se id não existe', () => {
      const { result } = renderHook(() => useEntityLoaders());
      expect(result.current.getUserName('não-existe')).toBe('');
    });
  });

  describe('estabilidade de referência (useCallback)', () => {
    it('referências das funções não mudam entre re-renders se deps não mudam', () => {
      const { result, rerender } = renderHook(() => useEntityLoaders());
      const firstGetDepName = result.current.getDepName;
      const firstGetUserName = result.current.getUserName;
      rerender();
      expect(result.current.getDepName).toBe(firstGetDepName);
      expect(result.current.getUserName).toBe(firstGetUserName);
    });
  });
});
