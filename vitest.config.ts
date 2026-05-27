import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Default environment é 'node' — testes de funções puras (date, password,
// uuid, validation, formatting, apiAuth) não precisam de DOM.
// Pra testes de hook/componente React, adicionar no topo do arquivo:
//   // @vitest-environment jsdom
// (vitest aceita pragma per-file). Mantemos node como default pra os
// testes puros rodarem mais rápido.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', '__tests__/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'scripts/.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/app/utils/**', 'src/app/hooks/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
