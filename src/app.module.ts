import { DynamicModule } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HotShotsModule } from 'nestjs-hot-shots';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Cluster, RedisService } from './common/services/redis';
import Redis from 'ioredis';

// app.module.ts
export async function createAppModule(): Promise<DynamicModule> {
  const redisService = new RedisService();
  const redisClient = (await redisService.getClient()) as Redis | Cluster;
  const throttlerModule = ThrottlerModule.forRoot({
    throttlers: [
      {
        ttl: seconds(60),
        limit: 100,
      },
    ],
    storage: new ThrottlerStorageRedisService(redisClient as Redis),
  });

  return {
    module: class AppModule {},
    imports: [
      PrismaModule,
      HealthModule,
      ConfigModule.forRoot(),
      HotShotsModule.forRoot({
        // StatsD
        host: process.env.STATSD_HOST || 'statsd.disco',
        port: parseInt(process.env.STATSD_PORT || '8125', 10),
        mock: process.env.NODE_ENV !== 'production' || process.env.STATSD_MOCK === 'true',
      }),
      throttlerModule,
    ],
    providers: [AppService],
  };
}
