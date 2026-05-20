import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;
