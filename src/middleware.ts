import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_ENTRY = '/sistema-triar';
const STAFF_COOKIE = 'triar-staff';

// Paths que NÃO precisam do cookie de staff — são públicos ou pertencem ao portal do cliente.
function isPublicPath(pathname: string): boolean {
  // Raiz redireciona pro portal (página de redirect)
  if (pathname === '/') return true;

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

  // Callback do OAuth (precisa funcionar sem cookie pra completar o login do Google)
  if (pathname.startsWith('/api/auth/')) return true;

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(STAFF_COOKIE);
  if (!cookie || cookie.value !== '1') {
    const url = req.nextUrl.clone();
    url.pathname = '/portal/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Roda em tudo, exceto assets internos do Next.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
