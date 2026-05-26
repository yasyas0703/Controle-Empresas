import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Setup mínimo: roda testes Node-only (funções puras). Sem JSDOM, sem
// React Testing Library, sem MSW por enquanto — isso pode ser adicionado
// depois quando começarmos a testar componentes.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', '__tests__/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'scripts/.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/app/utils/**'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
