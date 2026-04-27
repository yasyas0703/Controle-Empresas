'use client';

import React from 'react';
import { SistemaProvider } from '@/app/context/SistemaContext';
import { ThemeProvider } from '@/app/context/ThemeContext';
import ToastStack from '@/app/components/ToastStack';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SistemaProvider>
        {children}
        <ToastStack />
      </SistemaProvider>
    </ThemeProvider>
  );
}
