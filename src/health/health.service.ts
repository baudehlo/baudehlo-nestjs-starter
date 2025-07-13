import { Injectable } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly prisma: PrismaService, // Assuming PrismaService is imported from the correct path
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.5 }),
      () => this.prismaHealth.pingCheck('prisma', this.prisma),
    ]);
  }
}
