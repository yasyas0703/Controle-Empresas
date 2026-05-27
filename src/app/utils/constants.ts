// Constantes compartilhadas entre páginas/componentes.
// Adicionar coisas aqui só quando estiverem genuinamente repetidas em
// pelo menos 2 lugares — evitar criar abstrações prematuras.

/**
 * Paleta de cores das tags/badges de departamento por índice.
 * Cada departamento herda uma cor ciclando essa tabela na ordem em
 * que foi cadastrado. Usado nos badges das listagens de empresa,
 * dashboard e vencimentos.
 */
export const DEPT_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  1: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  3: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  4: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  5: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  6: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  7: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};
