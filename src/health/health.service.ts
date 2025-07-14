import { Injectable } from '@nestjs/common';
import { DiskHealthIndicator, HealthCheckResult, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClientT, RedisHealthIndicator, RedisService } from 'src/common/services/redis';
import { ConfigService } from '@nestjs/config/dist/config.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService<{ REDIS_MEMORY_THRESHOLD: number }>,
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly prisma: PrismaService, // Assuming PrismaService is imported from the correct path
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisService: RedisService<RedisClientT>, // Assuming RedisService is imported from the correct path
    private readonly redisHealth: RedisHealthIndicator, // Assuming RedisHealthIndicator is imported from the correct path
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const redisMemoryThreshold = this.configService.get<number>('REDIS_MEMORY_THRESHOLD', 1000000000, { infer: true }); // Default to 1GB if not set
    return this.health.check([
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.5 }),
      () => this.prismaHealth.pingCheck('prisma', this.prisma),
      async () => this.redisHealth.isHealthy('redis', { client: await this.redisService.getClient(), memoryThreshold: redisMemoryThreshold }),
    ]);
  }
}
