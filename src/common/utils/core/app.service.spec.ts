import { describe, expect, it } from 'vitest';
import { AppService } from './app.service';

describe('AppService', () => {
  it('can be instantiated', () => {
    const service = new AppService();
    expect(service).toBeInstanceOf(AppService);
  });
});
