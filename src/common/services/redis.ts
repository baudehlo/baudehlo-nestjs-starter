import Redis, { Cluster } from 'ioredis';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isProduction } from '../enums/environment';
import Redlock, { Lock } from 'redlock';
import { Logger } from './logger';

export { Cluster };
const REDIS_LOCK_DEFAULT_TTL = parseInt(process.env.REDIS_LOCK_DEFAULT_TTL || '20000', 10);

const store = {};

declare module 'redlock' {
  interface Lock {
    safeRelease(): Promise<void>;
  }
}

export class RedisMock {
  // eslint-disable-next-line @typescript-eslint/require-await
  async get(key: string): Promise<string | null> {
    return store[key] !== undefined ? (store[key] as string) : null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set(
    key: string,
    value: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._ignoreArgs
  ): Promise<string | null> {
    store[key] = value;
    return 'OK';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async del(...keys: string[]): Promise<number | null> {
    let count = 0;
    for (const key of keys) {
      if (key in store) {
        delete store[key];
        count++;
      }
    }
    return count;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async getex(key: string, ..._ignoreArgs): Promise<string | null> {
    return store[key] !== undefined ? (store[key] as string) : null;
  }

  async quit(): Promise<void> {
    // do nothing
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async ping(): Promise<string> {
    return 'PONG';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async info(key: string): Promise<string> {
    if (key === 'memory') {
      return 'used_memory:123456\npeak_memory:123456\n';
    }
    return '';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async cluster(command: string): Promise<string> {
    if (command === 'INFO') {
      return 'cluster_state:ok\n';
    }
    return '';
  }

  async disconnect(): Promise<void> {
    // do nothing
  }
}

export class RedlockMock {
  async release(): Promise<void> {
    // do nothing
  }
  async safeRelease(): Promise<void> {
    // do nothing
  }
}

export type RedisClientT = Redis | Cluster | RedisMock | undefined;

@Injectable()
export class RedisService<T extends RedisClientT> implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientT;
  private retryStrategyErrorDetected = false;
  private redlock: Redlock;

  constructor(private readonly logger: Logger) {}

  async onModuleInit(): Promise<void> {
    if (this.client || !isProduction) {
      return;
    }

    const host = process.env.REDIS_HOST || (isProduction ? 'redis.internal' : 'localhost');
    const port = Number(process.env.REDIS_PORT) || 6379;

    if (process.env.REDIS_USE_CLUSTER) {
      this.logger.log(`Connecting to CLUSTERED redis at ${host}:${port}`);
      this.client = new Redis.Cluster([{ host, port }], {
        redisOptions: {
          tls: {},
        },
      });
    } else {
      this.logger.log(`Connecting to redis at ${host}:${port}`);
      this.client = new Redis({ host, port, tls: {} });
    }
    this.redlock = new Redlock([this.client], {
      // The expected clock drift; for more details see:
      // http://redis.io/topics/distlock
      driftFactor: 0.01, // multiplied by lock ttl to determine drift time

      // The max number of times Redlock will attempt to lock a resource
      // before erroring.
      retryCount: 18,

      // the time in ms between attempts
      retryDelay: 500, // time in ms

      // the max time in ms randomly added to retries
      // to improve performance under high contention
      // see https://www.awsarchitectureblog.com/2015/03/backoff.html
      retryJitter: 200, // time in ms

      // The minimum remaining time on a lock before an extension is automatically
      // attempted with the `using` API.
      automaticExtensionThreshold: 500, // time in ms
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis Client Error', err);
      process.exit(1);
    });

    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.quit();
  }

  public async lock(key: string, ttl: number = REDIS_LOCK_DEFAULT_TTL): Promise<Lock> {
    if (!isProduction) {
      return new RedlockMock() as unknown as Lock;
    }
    if (!this.client) {
      this.logger.warn(new Error(`No redis client connected yet - pre bootstrap?`).stack);
      await this.onModuleInit();
    }
    const settings = {
      retryDelay: ttl / this.redlock.settings.retryCount + 2,
    };
    this.logger.debug(`Acquiring lock for ${key} with ttl ${ttl}`);
    const lock = await this.redlock.acquire([key], ttl, settings);

    lock.safeRelease = async (): Promise<void> => {
      this.logger.debug(`Releasing lock for ${key}`);
      if (lock.expiration > Date.now()) {
        await lock.release();
      }
    };
    return lock;
  }

  public async getClient(): Promise<T> {
    if (!isProduction) {
      return new RedisMock() as T;
    }
    if (!this.client) {
      this.logger.warn(new Error(`No redis client connected yet - pre bootstrap?`).stack);
      await this.onModuleInit();
    }
    return this.client as T;
  }
}

import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { promiseTimeout } from '../utils/promise-timeout';

export interface RedisCheckSettings {
  client: RedisClientT;
  timeout?: number;
  memoryThreshold?: number; // in bytes, if set, will check memory usage
}

/**
 * The RedisHealthIndicator is used for health checks related to redis.
 *
 * @public
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly logger: Logger,
  ) {}

  /**
   * Checks a redis/cluster connection.
   *
   * @param key - The key which will be used for the result object
   * @param options - The extra options for check
   */
  async isHealthy<Key extends string>(key: Key, options: RedisCheckSettings): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicatorService.check(key);

    const { client } = options;
    if (!client) {
      throw new Error('Redis client is not provided');
    }

    const type = process.env.REDIS_USE_CLUSTER ? 'cluster' : 'redis';

    try {
      if (type === 'redis') {
        await promiseTimeout(options.timeout ?? 1000, client.ping());
        if (options.memoryThreshold) {
          const info = await client.info('memory');
          const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0', 10);
          if (usedMemory > options.memoryThreshold) {
            throw new Error(`Memory usage is too high: ${usedMemory} bytes, threshold is ${options.memoryThreshold} bytes`);
          }
        }
      } else {
        const clusterInfo = await client.cluster('INFO');
        if (typeof clusterInfo === 'string') {
          if (!clusterInfo.includes('cluster_state:ok')) throw new Error(`INFO CLUSTER is not on OK state.`);
        } else throw new Error(`INFO CLUSTER is null or can't be read.`);
      }

      return indicator.up();
    } catch (e) {
      const { message } = e as Error;
      this.logger.error(`Redis health check failed for ${key}: ${message}`);
      return indicator.down({ message });
    }
  }
}

@Injectable()
export class RedisManagerService implements OnModuleDestroy {
  constructor(private readonly redisService: RedisService<RedisClientT>) {}

  async onModuleDestroy(): Promise<void> {
    await this.redisService.onModuleDestroy();
  }
}
