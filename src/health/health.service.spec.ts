import { DiskHealthIndicator, HealthCheckResult, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisClientT, RedisHealthIndicator, RedisService } from 'src/common/services/redis';
import { PrismaService } from 'src/prisma/prisma.service';
import { HealthService } from './health.service';

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));

// ---------------------------------------------------------------------------
// Shared mock values
// ---------------------------------------------------------------------------

const UP = { status: 'up' } as const;

const checkResult: HealthCheckResult = {
  status: 'ok',
  info: { storage: UP, prisma: UP, redis: UP },
  error: {},
  details: { storage: UP, prisma: UP, redis: UP },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService({
  diskThreshold = 0.75,
  redisMemory = 1_000_000_000,
  healthy = true,
}: {
  diskThreshold?: number;
  redisMemory?: number;
  healthy?: boolean;
} = {}) {
  const configService = {
    get: vi.fn().mockImplementation((_key: string, defaultVal: unknown) => {
      if (_key === 'DISK_THRESHOLD_PERCENT') return diskThreshold;
      if (_key === 'REDIS_MEMORY_THRESHOLD_BYTES') return redisMemory;
      return defaultVal;
    }),
  } as unknown as ConfigService;

  const diskIndicator = {
    checkStorage: vi.fn().mockResolvedValue(UP),
  } as unknown as DiskHealthIndicator;

  const prismaIndicator = {
    pingCheck: vi.fn().mockResolvedValue(UP),
  } as unknown as PrismaHealthIndicator;

  const prismaService = {} as unknown as PrismaService;

  const redisIndicator = {
    isHealthy: vi.fn().mockResolvedValue(UP),
  } as unknown as RedisHealthIndicator;

  const mockClient = {};
  const redisService = {
    getClient: vi.fn().mockResolvedValue(mockClient),
  } as unknown as RedisService<RedisClientT>;

  // Simulate health.check() by actually calling each callback
  const healthCheck = {
    check: vi.fn().mockImplementation(async (indicators: Array<() => Promise<unknown>>) => {
      if (!healthy) throw new Error('health check failed');
      for (const fn of indicators) await fn();
      return checkResult;
    }),
  } as unknown as HealthCheckService;

  const service = new HealthService(configService, healthCheck, diskIndicator, prismaService, prismaIndicator, redisService, redisIndicator);

  return { service, diskIndicator, prismaIndicator, redisIndicator, redisService, healthCheck };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthService', () => {
  it('is defined', () => {
    const { service } = makeService();
    expect(service).toBeDefined();
  });

  describe('checkHealth()', () => {
    it('returns a health check result', async () => {
      const { service } = makeService();
      const result = await service.checkHealth();
      expect(result).toEqual(checkResult);
    });

    it('calls disk checkStorage with the configured threshold', async () => {
      const { service, diskIndicator } = makeService({ diskThreshold: 0.9 });
      await service.checkHealth();
      expect(diskIndicator.checkStorage).toHaveBeenCalledWith('storage', { path: '/', thresholdPercent: 0.9 });
    });

    it('calls prismaHealth.pingCheck', async () => {
      const { service, prismaIndicator } = makeService();
      await service.checkHealth();
      expect(prismaIndicator.pingCheck).toHaveBeenCalledWith('prisma', expect.anything());
    });

    it('calls redisHealth.isHealthy with client and memoryThreshold', async () => {
      const { service, redisIndicator } = makeService({ redisMemory: 500_000_000 });
      await service.checkHealth();
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis', {
        client: expect.anything(),
        memoryThreshold: 500_000_000,
      });
    });

    it('uses default thresholds when config is not set', async () => {
      const configService = {
        get: vi.fn().mockImplementation((_key: string, defaultVal: unknown) => defaultVal),
      } as unknown as ConfigService;

      const diskIndicator = { checkStorage: vi.fn().mockResolvedValue(UP) } as unknown as DiskHealthIndicator;
      const prismaIndicator = { pingCheck: vi.fn().mockResolvedValue(UP) } as unknown as PrismaHealthIndicator;
      const prismaService = {} as unknown as PrismaService;
      const redisIndicator = { isHealthy: vi.fn().mockResolvedValue(UP) } as unknown as RedisHealthIndicator;
      const redisService = { getClient: vi.fn().mockResolvedValue({}) } as unknown as RedisService<RedisClientT>;
      const healthCheck = {
        check: vi.fn().mockImplementation(async (fns: Array<() => Promise<unknown>>) => {
          for (const fn of fns) await fn();
          return checkResult;
        }),
      } as unknown as HealthCheckService;

      const service = new HealthService(configService, healthCheck, diskIndicator, prismaService, prismaIndicator, redisService, redisIndicator);
      await service.checkHealth();

      // Defaults: 0.75 for disk, 1_000_000_000 for redis memory
      expect(diskIndicator.checkStorage).toHaveBeenCalledWith('storage', { path: '/', thresholdPercent: 0.75 });
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis', {
        client: expect.anything(),
        memoryThreshold: 1_000_000_000,
      });
    });
  });
});
