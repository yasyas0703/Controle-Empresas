import React from 'react';
import type { Metadata, Viewport } from 'next';
import { PortalProvider } from '@/app/portal/PortalContext';
import SWAutoUpdate from '@/app/portal/components/SWAutoUpdate';

export const metadata: Metadata = {
  title: 'Portal do Cliente — Triar Contabilidade',
  description: 'Acesse suas guias e documentos da Triar Contabilidade.',
  manifest: '/portal-manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Triar',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0891b2' },
    { media: '(prefers-color-scheme: dark)', color: '#0e2230' },
  ],
};

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <SWAutoUpdate />
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </div>
    </PortalProvider>
  );
}
