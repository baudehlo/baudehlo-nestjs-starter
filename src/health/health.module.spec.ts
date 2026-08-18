import { describe, expect, it } from 'vitest';

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));

import { HealthModule } from './health.module';

describe('HealthModule', () => {
  it('is defined', () => {
    expect(HealthModule).toBeDefined();
  });

  it('can be instantiated (covers the constructor)', () => {
    const mod = new HealthModule();
    expect(mod).toBeInstanceOf(HealthModule);
  });
});
