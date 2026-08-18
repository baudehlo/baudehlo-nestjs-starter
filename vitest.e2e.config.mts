import { join } from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
    tsconfigPaths(),
  ],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,

    include: ['test/**/*.e2e.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/infra/**'],

    root: '.',

    alias: {
      src: join(__dirname, 'src'),
      test: join(__dirname, 'test'),
      generated: join(__dirname, 'generated'),
      prisma: join(__dirname, 'prisma'),
    },

    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },

  resolve: {
    conditions: ['node', 'require', 'default'],
    mainFields: ['main', 'module'],
  },
});
