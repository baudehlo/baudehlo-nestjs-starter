import { HealthCheckResult } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  const fakeResult: HealthCheckResult = {
    status: 'ok',
    info: { prisma: { status: 'up' } },
    error: {},
    details: { prisma: { status: 'up' } },
  };

  beforeEach(() => {
    service = { checkHealth: vi.fn().mockResolvedValue(fakeResult) } as unknown as HealthService;
    controller = new HealthController(service);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('check() delegates to HealthService.checkHealth()', async () => {
    const result = await controller.check();
    expect(service.checkHealth).toHaveBeenCalledOnce();
    expect(result).toEqual(fakeResult);
  });
});
