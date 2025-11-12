import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { HttpModule } from '@nestjs/axios';
import { DynamicModule, ExecutionContext, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { PrismaClient } from 'generated/prisma/client';
import Redis from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import { HotShotsModule } from 'nestjs-hot-shots';
import { randomUUID } from 'node:crypto';
import { Socket } from 'socket.io';
import { HealthController } from 'src/health/health.controller';
import { HealthService } from 'src/health/health.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoggerService } from '../../services/logger';
import { PgBossService } from '../../services/pg-boss.service';
import { Cluster, RedisHealthIndicator, RedisManagerService, RedisService } from '../../services/redis';
import { AppService } from './app.service';
import type { StringValue } from 'ms';

// app.module.ts
export async function createAppModule(prismaClient?: PrismaClient): Promise<DynamicModule> {
  const controllers = [HealthController];
  const appModule = await createAppModuleForTest(controllers, prismaClient);
  return {
    ...appModule,
    module: class AppModule {},
  };
}

export async function createAppModuleForTest(controllers?: Type<unknown>[], prismaClient?: PrismaClient): Promise<ModuleMetadata> {
  const redisService = new RedisService();
  const redisClient = (await redisService.getClient()) as Redis | Cluster;
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
    controllers,
    imports: [
      TerminusModule.forRoot({ logger: true }),
      HttpModule,
      ConfigModule.forRoot({ isGlobal: true }),
      JwtModule.registerAsync({
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: configService.get<StringValue | number>('JWT_EXPIRES_IN') || '60m',
            audience: configService.get<string>('LOGTO_AUDIENCE'),
            issuer: configService.get<string>('LOGTO_ISSUER'),
          },
        }),
        inject: [ConfigService],
      }),
      ClsModule.forRoot({
        global: true,
        guard: {
          mount: true,
          generateId: true,
          idGenerator: (ctx: ExecutionContext): string => {
            return ctx.getType() == 'ws'
              ? ctx.switchToWs().getClient<Socket>().id
              : `${ctx.switchToHttp().getRequest<Request>().headers['x-request-id'] || randomUUID()}`;
          },
        },
      }),
      SentryModule.forRoot(),
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
      ConfigService,
      JwtService,
      Reflector,
      LoggerService,
      HealthService,
      prismaClient
        ? {
            provide: PrismaService,
            useFactory: () => prismaClient as PrismaService,
            inject: [ConfigService, LoggerService],
          }
        : PrismaService,
      {
        provide: APP_FILTER,
        useClass: SentryGlobalFilter,
      },
      AppService,
      { provide: RedisService, useValue: redisService },
      RedisHealthIndicator,
      RedisManagerService,
      PgBossService,
    ],
  };
}
