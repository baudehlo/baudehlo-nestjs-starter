import { DynamicModule } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HotShotsModule } from 'nestjs-hot-shots';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Cluster, RedisManagerService, RedisService } from './common/services/redis';
import Redis from 'ioredis';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
// import { Logger } from './common/services/logger';

// app.module.ts
export async function createAppModule(): Promise<DynamicModule> {
  // const logger = new Logger('AppModule');
  const redisService = new RedisService();
  const redisClient = (await redisService.getClient()) as Redis | Cluster;
  // logger.log(`Redis client initialized: ${redisClient instanceof Redis ? 'Single instance' : (redisClient instanceof Cluster ? 'Cluster instance' : 'Unknown instance')}`);
  // hack so we can replace the internals with our redis client
  const throttlerStorage = new ThrottlerStorageRedisService({ lazyConnect: true });
  throttlerStorage.redis = redisClient;
  const throttlerModule = ThrottlerModule.forRoot({
    throttlers: [
      {
        ttl: seconds(60),
        limit: 100,
      },
    ],
    storage: throttlerStorage,
  });

  return {
    module: class AppModule {},
    imports: [
      SentryModule.forRoot(),
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
    providers: [
      {
        provide: APP_FILTER,
        useClass: SentryGlobalFilter,
      },
      AppService,
      { provide: RedisService, useValue: redisService },
      RedisManagerService,
    ],
  };
}
