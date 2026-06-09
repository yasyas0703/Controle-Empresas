'use client';

// Hook compartilhado pras lookups mais repetidas em páginas de listagem:
// "qual é o nome desse departamento/usuário pelo id?". Antes estava
// declarado idêntico em empresas/, dashboard/, vencimentos/ — qualquer
// mudança (ex: tratar usuário desativado de forma diferente) exigia
// editar 3 arquivos.
//
// Como cada função depende de arrays do SistemaContext, virou hook em
// vez de função normal. Bônus: useCallback evita recriar as funções a
// cada render (perf em listagens grandes).

import { useCallback } from 'react';
import { useSistema } from '@/app/context/SistemaContext';

export function useEntityLoaders() {
  const { departamentos, usuarios } = useSistema();

  const getDepName = useCallback(
    (dId: string): string => departamentos.find((d) => d.id === dId)?.nome ?? '',
    [departamentos],
  );

  const getDepIndex = useCallback(
    (dId: string): number => departamentos.findIndex((d) => d.id === dId),
    [departamentos],
  );

  const getUserName = useCallback(
    (uId: string | null): string => {
      if (!uId) return '';
      return usuarios.find((u) => u.id === uId)?.nome ?? '';
    },
    [usuarios],
  );

  const getUserEmail = useCallback(
    (uId: string | null): string => {
      if (!uId) return '';
      return usuarios.find((u) => u.id === uId)?.email ?? '';
    },
    [usuarios],
  );

  return { getDepName, getDepIndex, getUserName, getUserEmail };
}
