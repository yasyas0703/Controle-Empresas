'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { SistemaProvider } from '@/app/context/SistemaContext';
import { ThemeProvider } from '@/app/context/ThemeContext';
import ToastStack from '@/app/components/ToastStack';

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPortal = pathname?.startsWith('/portal');

  // O portal do cliente tem auth/state próprios (PortalContext em /portal/layout.tsx).
  // Pular SistemaProvider em /portal/* economiza a inicialização do sistema interno
  // inteiro (auth listener, fetches de empresas/usuários, hooks etc.) pra cada
  // navegação no portal.
  if (isPortal) {
    return <ThemeProvider>{children}</ThemeProvider>;
  }

  return (
    <ThemeProvider>
      <SistemaProvider>
        {children}
        <ToastStack />
      </SistemaProvider>
    </ThemeProvider>
  );
}
