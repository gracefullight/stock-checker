import path from 'node:path';

import { defineConfig } from 'vitest/config';

const WEB_SRC = path.resolve(__dirname, './src');
const CORE_SRC = path.resolve(__dirname, '../../packages/core/src');

export default defineConfig({
  resolve: {
    // '@/' means "this workspace's src" in every package. Core modules bundled by
    // the web (constants, types, engine) keep their own alias, so resolve by importer.
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: '$1',
        customResolver(source, importer, options) {
          const root =
            importer && importer.includes(`${path.sep}packages${path.sep}core${path.sep}`)
              ? CORE_SRC
              : WEB_SRC;
          return this.resolve(path.resolve(root, source), importer, {
            ...options,
            skipSelf: true,
          });
        },
      },
    ],
  },
  // Use vitest's built-in esbuild for the automatic JSX runtime instead of
  // @vitejs/plugin-react (its Vite peer conflicts with the version vitest bundles).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
