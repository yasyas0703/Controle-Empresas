'use client';

import React from 'react';
import { SistemaProvider } from '@/app/context/SistemaContext';
import ToastStack from '@/app/components/ToastStack';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SistemaProvider>
      {children}
      <ToastStack />
    </SistemaProvider>
  );
}
