/* eslint-disable @typescript-eslint/no-misused-promises */
import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from 'generated/prisma/client';
import { ITXClientDenyList } from '@prisma/client/runtime/client';
import { StatsD } from 'hot-shots';
import { isProduction } from 'src/common/enums';
import { app } from 'src/common/utils/core/app-ref';
import { LoggerService } from 'src/logger/logger';

export type PrismaTransaction = Omit<PrismaClient, ITXClientDenyList>;

let logger: LoggerService | undefined;
let metrics: StatsD | undefined;

// This extension logs query timing and emits StatsD metrics in production.
export const logQueriesExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'log_queries',
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          if (!isProduction && !process.env.LOG_FULL_QUERIES) {
            return await query(args);
          }
          const start = performance.now();
          const result = await query(args);
          const time = performance.now() - start;
          // Note: app may be undefined during tests — guard with optional chaining.
          logger ||= app?.get(LoggerService);
          metrics ||= app?.get(StatsD);
          metrics?.timing(`prisma.sql.${model || 'no_model'}.${operation}`, time);
          logger?.debug(`${model}.${operation}(${JSON.stringify(args)}) - ${time.toFixed(2)}ms`);
          return result;
        },
      },
    },
  });
});

function extendClient(base: PrismaClient) {
  return base.$extends(logQueriesExtension);
}

// This extension logs the full SQL query with parameters interpolated (dev only).
class UntypedExtendedClient extends PrismaClient {
  constructor(options?: Omit<ConstructorParameters<typeof PrismaClient>[0], 'adapter' | 'accelerateUrl'>) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ ...options, adapter });
    // @ts-expect-error: https://www.prisma.io/docs/orm/prisma-client/client-extensions#usage-of-on-and-use-with-extended-clients
    this.$on('query', ({ query, params }): void => {
      if (!isProduction && !process.env.LOG_FULL_QUERIES) return;
      let workingQuery: string = query;

      const paramsArray = JSON.parse(params) as Array<unknown>;
      for (let i = 0; i < paramsArray.length; ++i) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        workingQuery = workingQuery.replace(`$${i + 1}`, `'${typeof paramsArray[i] === 'object' ? JSON.stringify(paramsArray[i]) : paramsArray[i]}'`);
      }
      if (isProduction) return;
      logger ||= app?.get(LoggerService);
      logger?.debug(workingQuery);
    });
    extendClient(this) as this;
  }
}

const ExtendedPrismaClient = UntypedExtendedClient as unknown as new (
  options?: Omit<ConstructorParameters<typeof PrismaClient>[0], 'adapter' | 'accelerateUrl'>,
) => PrismaClient & ReturnType<typeof extendClient>;

// @ts-ignore: Prisma $extends causes TS excessive-complexity when schema has many models
@Injectable()
export class PrismaService extends ExtendedPrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  // biome-ignore lint/suspicious/useAwait: outer function registers event handlers; inner waitForAppClose is async
  async enableShutdownHooks(app: INestApplication) {
    async function waitForAppClose() {
      await app.close();
    }
    // https://prisma.io/docs/guides/upgrade-guides/upgrading-versions/upgrading-to-prisma-5#removal-of-the-beforeexit-hook-from-the-library-engine
    process.on('exit', waitForAppClose);
    process.on('beforeExit', waitForAppClose);
    process.on('SIGINT', waitForAppClose);
    process.on('SIGTERM', waitForAppClose);
    process.on('SIGUSR2', waitForAppClose);
  }
}
