// Validação leve de UUID pra params de rota dinâmica (/api/.../[id]).
// Sem isso, qualquer string vai pra `.eq('id', X)` no Supabase: a query
// devolve nada (ou erro feio de cast), e o handler decide o status sozinho —
// fácil de retornar 500 quando deveria ser 404. Validar no topo da rota
// padroniza pra 404 explícito antes mesmo de tocar o banco.
//
// Regex `loose` (não exige version+variant fixas) — vale pra v4, v7 etc.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True se a string parece um UUID (qualquer versão). */
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_REGEX.test(s);
}
