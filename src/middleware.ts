import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Proteger rotas admin da API — exigir header Authorization
  if (pathname.startsWith('/api/admin')) {
    const auth = request.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Não autorizado.' },
        { status: 401 }
      );
    }
  }

  // Adicionar security headers em todas as respostas
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

export const config = {
  matcher: [
    // Todas as rotas exceto arquivos estáticos do Next.js
    '/((?!_next/static|_next/image|favicon.ico|triar.png).*)',
  ],
};
