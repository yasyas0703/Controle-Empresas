import type { Departamento, Usuario } from '@/app/types';

export type DepartamentoSlug = 'fiscal' | 'pessoal' | 'contabil' | 'cadastro';

export const DEPARTAMENTO_SLUGS: DepartamentoSlug[] = ['fiscal', 'pessoal', 'contabil', 'cadastro'];

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function normalizarNomeDepartamento(nome?: string | null): DepartamentoSlug | null {
  const n = (nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .trim();
  if (!n) return null;
  if (n === 'fiscal') return 'fiscal';
  if (n === 'pessoal' || n === 'departamento pessoal' || n === 'dp' || n === 'rh' || n === 'recursos humanos') return 'pessoal';
  if (n === 'contabil' || n === 'contabilidade') return 'contabil';
  if (n === 'cadastro' || n === 'cadastros') return 'cadastro';
  return null;
}

export function getDepartamentoSlugDoUsuario(
  usuario: Usuario | null | undefined,
  departamentos: Departamento[],
): DepartamentoSlug | null {
  if (!usuario?.departamentoId) return null;
  const dep = departamentos.find((d) => d.id === usuario.departamentoId);
  return normalizarNomeDepartamento(dep?.nome);
}

export function podeVerDepartamento(
  slug: DepartamentoSlug,
  usuario: Usuario | null | undefined,
  departamentos: Departamento[],
): boolean {
  if (!usuario) return false;
  if (usuario.role === 'admin') return true;
  return getDepartamentoSlugDoUsuario(usuario, departamentos) === slug;
}
