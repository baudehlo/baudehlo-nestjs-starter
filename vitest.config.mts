import { join } from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    // SWC plugin is required for NestJS + Vitest to work properly
    // See: https://docs.nestjs.com/recipes/swc#vitest
    swc.vite({
      module: { type: 'es6' },
    }),
    tsconfigPaths(),
  ],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 4000,
    hookTimeout: 30000,

    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/infra/**', '**/*.e2e.spec.ts'],

    root: '.',

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
        'src/**/*.module.ts',
        'src/**/*.controller.ts',
        'src/main.ts',
        'src/repl.ts',
        'src/instrument.ts',
        'src/app.service.ts',
        'src/**/index.ts',
        'src/common/services/**',
        'src/common/adapters/**',
        'src/logger/**',
        'src/health/**',
        'src/common/filters/**',
        'src/common/enums/**',
        'src/common/types/**',
        'src/prisma/prisma.service.ts',
        'src/common/utils/**',
        'src/scripts/**',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
      },
    },

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
