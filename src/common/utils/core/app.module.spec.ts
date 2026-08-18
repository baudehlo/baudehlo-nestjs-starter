import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy infrastructure before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({
  SentryModule: { forRoot: vi.fn().mockReturnValue({ module: class SentryMod {} }) },
  SentryGlobalFilter: class {},
}));
vi.mock('@sentry/nestjs/setup', () => ({
  SentryGlobalFilter: class {},
  SentryModule: { forRoot: vi.fn().mockReturnValue({ module: class SentryMod {} }) },
}));

// Stub out ThrottlerStorageRedisService so it doesn't try to talk to Redis
vi.mock('@nest-lab/throttler-storage-redis', () => ({
  ThrottlerStorageRedisService: class {
    // default constructor
    redis: unknown = null;
  },
}));

// Use the real RedisService but getClient() returns a lightweight mock in non-prod
// (that already happens via isProduction=false, so no override needed)

import { createAppModule, createAppModuleForTest } from './app.module';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAppModuleForTest()', () => {
  it('returns module metadata with imports, providers, and controllers', async () => {
    const metadata = await createAppModuleForTest();
    expect(metadata.imports).toBeDefined();
    expect(Array.isArray(metadata.imports)).toBe(true);
    expect(metadata.providers).toBeDefined();
    expect(Array.isArray(metadata.providers)).toBe(true);
  });

  it('includes the supplied controllers in the metadata', async () => {
    class FakeController {}
    const metadata = await createAppModuleForTest([FakeController]);
    expect(metadata.controllers).toContain(FakeController);
  });

  it('overrides PrismaService when a prismaClient is provided, and the useFactory is callable', async () => {
    const fakePrisma = { $connect: vi.fn() } as never;
    const metadata = await createAppModuleForTest([], fakePrisma);

    // Find the custom provider with a useFactory (the prismaClient override)
    type FactoryProvider = { provide: unknown; useFactory: () => unknown; inject?: unknown[] };
    const customProvider = (metadata.providers ?? []).find((p): p is FactoryProvider => typeof p === 'object' && p !== null && 'useFactory' in p);

    expect(customProvider).toBeDefined();
    // Invoke the factory to cover the lambda
    const result = customProvider!.useFactory();
    expect(result).toBe(fakePrisma);
  });
});

describe('createAppModule()', () => {
  it('returns a DynamicModule with a module class', async () => {
    const mod = await createAppModule();
    expect(mod.module).toBeDefined();
    expect(typeof mod.module).toBe('function'); // the anonymous class AppModule
  });

  it('spreads the metadata from createAppModuleForTest', async () => {
    const mod = await createAppModule();
    expect(mod.imports).toBeDefined();
    expect(mod.providers).toBeDefined();
  });

  it('accepts an optional prismaClient argument', async () => {
    const fakePrisma = {} as never;
    const mod = await createAppModule(fakePrisma);
    expect(mod.module).toBeDefined();
  });
});
