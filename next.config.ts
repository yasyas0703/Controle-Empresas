import type { NextConfig } from "next";

// Content-Security-Policy em modo Report-Only.
// O browser NÃO bloqueia recursos que violem — só reporta no console
// (e via report-uri/report-to, se configurado). Roda assim por algumas
// semanas, monitora os violations no DevTools (Console + Network), e
// só depois troca o header pra `Content-Security-Policy` enforcement.
//
// Diretrizes:
// - script-src 'unsafe-inline' 'unsafe-eval': Next.js precisa pra
//   hidratação e chunking dinâmico. Mitigado pelo react-escape padrão
//   + nossa ausência de dangerouslySetInnerHTML.
// - style-src 'unsafe-inline': Tailwind/styled-jsx injetam estilos
//   inline; sem isso, layout quebra.
// - connect-src: tudo que o front legitimamente bate — Supabase REST,
//   auth, storage, realtime (wss://), Google OAuth/APIs.
// - frame-ancestors 'none': defesa contra clickjacking (duplica
//   X-Frame-Options DENY pra browsers modernos).
// - object-src 'none', base-uri 'self', form-action 'self': hardening
//   contra injeção de tags <object>, <base> e form hijacking.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://apis.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // pdfjs-dist tem `require('canvas')` em código de renderização Node que
  // o bundler tenta resolver estaticamente. Como só usamos extração de
  // texto (não renderização), o canvas nunca é executado — marcamos como
  // external pra resolver via require() padrão do Node em runtime.
  serverExternalPackages: ['pdfjs-dist'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Report-only: browser reporta violations no console, NÃO bloqueia.
          // Quando estiver tranquilo (sem violations legítimas), trocar pra
          // `Content-Security-Policy`.
          { key: 'Content-Security-Policy-Report-Only', value: CSP_DIRECTIVES },
        ],
      },
    ];
  },
};

export default nextConfig;
