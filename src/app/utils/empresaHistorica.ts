import type { Empresa } from '@/app/types';

/**
 * Empresa "histórica" = registro de auditoria, não cliente ativo.
 * Não deve aparecer no dashboard, alertas, vencimentos, etc.
 *
 * Identificadores:
 *  1. `desligada_em` preenchido — cliente formal desligado.
 *  2. tag `arquivada` — código reciclado importado pelo extrato contábil.
 *  3. tag `desligada-historica` — empresa não encontrada importada pra registro.
 *  4. código sintético `<num>-A<digit?>` — fallback pra empresas que vieram
 *     de imports antigos sem a tag.
 *  5. apelido começando com `[ARQ]` — convenção do importador.
 */
const CODIGO_SINTETICO_REGEX = /-A\d*$/i;

export function ehEmpresaHistorica(e: Pick<Empresa, 'desligada_em' | 'tags' | 'codigo' | 'apelido'>): boolean {
  if (e.desligada_em) return true;

  const tags = e.tags ?? [];
  if (tags.includes('arquivada') || tags.includes('desligada-historica')) return true;

  const codigo = (e.codigo ?? '').trim();
  if (codigo && CODIGO_SINTETICO_REGEX.test(codigo)) return true;

  const apelido = (e.apelido ?? '').trim();
  if (apelido.toUpperCase().startsWith('[ARQ]')) return true;

  return false;
}
