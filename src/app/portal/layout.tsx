import React from 'react';
import type { Metadata, Viewport } from 'next';
import { PortalProvider } from '@/app/portal/PortalContext';

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
  themeColor: '#10b981',
};

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </div>
    </PortalProvider>
  );
}
