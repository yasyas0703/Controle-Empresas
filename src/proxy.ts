import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_ENTRY = '/sistema-triar';
const STAFF_COOKIE = 'triar-staff';

// HTML mínimo de 404 — sem framework, sem revelar nada do app
const NOT_FOUND_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>404</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"></head><body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#94a3b8;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="text-align:center"><p style="font-size:14px;margin:0">404</p><p style="font-size:16px;margin-top:4px">Página não encontrada.</p></div></body></html>`;

// Paths que NÃO precisam do cookie de staff — são públicos ou pertencem ao portal do cliente.
function isPublicPath(pathname: string): boolean {
  // Portal do cliente
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return true;
  if (pathname.startsWith('/api/portal/')) return true;

  // Entry point do admin (única porta visível pra logar)
  if (pathname === ADMIN_ENTRY || pathname.startsWith(`${ADMIN_ENTRY}/`)) return true;

  // Arquivos públicos / PWA assets
  if (pathname === '/robots.txt') return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/portal-sw.js') return true;
  if (pathname === '/portal-manifest.json') return true;
  if (pathname === '/triar.png') return true;
  if (pathname.endsWith('.svg')) return true;

  // Callback do OAuth (precisa funcionar sem cookie pra completar login Google)
  if (pathname.startsWith('/api/auth/')) return true;

  // Manutenção pública (AppShell lê antes do login)
  if (pathname === '/api/admin/manutencao') return true;

  return false;
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Proteger rotas admin da API — exigir header Authorization
  //    Exceção: GET /api/admin/manutencao é público (AppShell lê antes do login)
  const isPublicManutencaoGet =
    pathname === '/api/admin/manutencao' && request.method === 'GET';

  if (pathname.startsWith('/api/admin') && !isPublicManutencaoGet) {
    const auth = request.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  }

  // 2. Esconder o admin de clientes: tudo que não é público exige cookie de staff.
  //    Sem cookie, devolve 404 puro — não renderiza AppShell nem revela qualquer parte do app.
  if (!isPublicPath(pathname)) {
    const cookie = request.cookies.get(STAFF_COOKIE);
    if (!cookie || cookie.value !== '1') {
      // APIs: 404 em JSON
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Páginas: HTML 404 mínimo (não passa pelo Next, não usa AppShell)
      return new NextResponse(NOT_FOUND_HTML, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
  }

  // 3. Security headers em todas as respostas
  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    // Todas as rotas exceto arquivos estáticos do Next.js
    '/((?!_next/static|_next/image|favicon.ico|triar.png).*)',
  ],
};
