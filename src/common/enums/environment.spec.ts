import { describe, expect, it } from 'vitest';
import { Environment, isProduction } from './environment';

describe('Environment', () => {
  it('has development value', () => {
    expect(Environment.development).toBe('development');
  });

  it('has production value', () => {
    expect(Environment.production).toBe('production');
  });

  it('has test value', () => {
    expect(Environment.test).toBe('test');
  });
});

describe('isProduction', () => {
  it('is false when NODE_ENV is test', () => {
    // NODE_ENV=test in the vitest environment
    expect(isProduction).toBe(false);
  });
});
