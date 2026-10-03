import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/routes': path.resolve(__dirname, './src/routes'),
      '@': path.resolve(__dirname, '../../packages/core/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
  },
});
