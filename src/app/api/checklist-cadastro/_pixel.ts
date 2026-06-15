// Pixel de visualização (abertura) do envio de CERTIDÕES — espelha o fiscal.
// Usado pelo envio manual (/enviar) e pelo auto-envio (_auto-enviar).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base URL do pixel. Prioriza o HOST da requisição (domínio em que o app roda
 * agora) — se usar NEXT_PUBLIC_APP_URL e ela ficar num domínio antigo, o pixel
 * embute uma URL morta (404) e o tracking para silenciosamente. A env é só
 * fallback (chamadas server-to-server sem host).
 * SEGURANÇA: proto/host vêm de headers do cliente e são interpolados no src do
 * pixel. Validamos (proto http|https, host [a-zA-Z0-9.\-:]) pra não injetar HTML.
 */
export function resolveBaseUrl(req: Request): string | null {
  const proto = req.headers.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  const rawHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const host = rawHost && /^[a-zA-Z0-9.\-:]+$/.test(rawHost) ? rawHost : null;
  if (host) return `${proto}://${host}`;
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return null;
}

/**
 * Tag <img> 1x1 transparente. Só embeda se temos baseUrl + checklistId (UUID
 * da linha em checklist_cadastro) — sem isso a rota de tracking não acha o
 * evento. checklistId validado por UUID_RE pra não injetar no atributo src.
 */
export function pixelTagCadastro(baseUrl: string | null, checklistId: string | undefined, envioId: string): string {
  if (!baseUrl || !checklistId || !UUID_RE.test(checklistId)) return '';
  return `<img src="${baseUrl}/api/checklist-cadastro/track-open/${checklistId}/${envioId}.gif" width="1" height="1" alt="" style="display:none;border:0;outline:none;text-decoration:none;" />`;
}
