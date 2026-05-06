import type { Departamento, Usuario, UUID } from '@/app/types';

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
  // 'fiscal' e 'fiscal - sn' são deps separados no banco, mas pro menu/sidebar
  // ambos contam como "fiscal" — vêem as mesmas abinhas (Painel Fiscal / Checklist Mensal),
  // que internamente isolam o conteúdo de cada dep via FISCAL_SN_DEPT_NOME.
  if (n === 'fiscal' || n === 'fiscal - sn' || n === 'fiscal-sn' || n === 'fiscal sn') return 'fiscal';
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

// Retorna o slug do departamento principal + extras (sem duplicatas).
// Usado em todos os filtros de visibilidade (menu, abas do checklist, etc).
export function getDepartamentoSlugsDoUsuario(
  usuario: Usuario | null | undefined,
  departamentos: Departamento[],
): DepartamentoSlug[] {
  if (!usuario) return [];
  const slugs = new Set<DepartamentoSlug>();
  const principal = getDepartamentoSlugDoUsuario(usuario, departamentos);
  if (principal) slugs.add(principal);
  for (const extraId of usuario.departamentosExtrasIds ?? []) {
    const dep = departamentos.find((d) => d.id === extraId);
    const slug = normalizarNomeDepartamento(dep?.nome);
    if (slug) slugs.add(slug);
  }
  return Array.from(slugs);
}

// Retorna true se o usuario tem acesso ao departamento (principal OU extras).
// Tambem retorna o id do departamento (uuid) — util pra checklist que filtra
// por id especifico (Fiscal vs Fiscal - SN sao deps diferentes mas mesmo slug).
export function getDepartamentoIdsDoUsuario(
  usuario: Usuario | null | undefined,
): UUID[] {
  if (!usuario) return [];
  const ids = new Set<UUID>();
  if (usuario.departamentoId) ids.add(usuario.departamentoId);
  for (const extra of usuario.departamentosExtrasIds ?? []) {
    if (extra) ids.add(extra);
  }
  return Array.from(ids);
}

export function podeVerDepartamento(
  slug: DepartamentoSlug,
  usuario: Usuario | null | undefined,
  departamentos: Departamento[],
): boolean {
  if (!usuario) return false;
  if (usuario.role === 'admin') return true;
  return getDepartamentoSlugsDoUsuario(usuario, departamentos).includes(slug);
}
