// Constantes compartilhadas entre páginas/componentes.
// Adicionar coisas aqui só quando estiverem genuinamente repetidas em
// pelo menos 2 lugares — evitar criar abstrações prematuras.

/**
 * Paleta de cores das tags/badges de departamento por índice.
 * Cada departamento herda uma cor ciclando essa tabela na ordem em
 * que foi cadastrado. Usado nos badges das listagens de empresa,
 * dashboard e vencimentos.
 *
 * - `text`   = cor do label do departamento (PESSOAL/FISCAL/etc).
 * - `bar`    = cor da barra lateral fina (border-left) quando o bloco
 *              é renderizado com fundo neutro. É o sinal de departamento
 *              de menor área — substitui o antigo fundo pintado, que
 *              deixava a tela parecendo um arco-íris.
 * - `bg`/`border` = fundo/borda tingidos. Legado: ainda usados em telas
 *              não migradas (vencimentos). Não usar em bloco novo.
 */
export const DEPT_COLORS: Record<number, { bg: string; text: string; border: string; bar: string }> = {
  0: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', bar: 'border-l-blue-400' },
  1: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', bar: 'border-l-cyan-400' },
  2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', bar: 'border-l-teal-400' },
  3: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', bar: 'border-l-rose-400' },
  4: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bar: 'border-l-amber-400' },
  5: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'border-l-emerald-400' },
  6: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', bar: 'border-l-cyan-400' },
  7: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', bar: 'border-l-pink-400' },
};
