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
    hookTimeout: 30000,

    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/infra/**'],

    root: '.',

    alias: {
      src: join(__dirname, 'src'),
      test: join(__dirname, 'test'),
      generated: join(__dirname, 'generated'),
      prisma: join(__dirname, 'prisma'),
    },

    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    setupFiles: ['test/helpers/vitest.setup.ts'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.e2e.spec.ts',
        'src/**/*.d.ts',
        '**/*.dto.ts',
        'src/main.ts',
        'src/repl.ts',
        'src/instrument.ts',
        'src/**/index.ts',
        'src/common/services/**',
        'src/common/adapters/**',
        'src/common/utils/core/bootstrap-app.ts',
        'src/common/utils/core/instrument.ts',
        'src/common/utils/core/app-ref.ts',
        'src/common/types/**',
        'src/prisma/prisma.service.ts',
        'src/prisma/prisma.module.ts',
        'src/app.module.ts',
        'src/app.service.ts',
        'src/scripts/**',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 85,
      },
    },
  },

  resolve: {
    conditions: ['node', 'require', 'default'],
    mainFields: ['main', 'module'],
  },
});
