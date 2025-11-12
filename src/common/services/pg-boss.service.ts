import { forwardRef, HttpException, Inject, Injectable, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  PgBoss,
  Job as PgJob,
  WorkHandler as PgWorkHandler,
  JobWithMetadata as PgJobWithMetadata,
  Queue as PgQueue,
  QueuePolicy as PgQueuePolicy,
  QueueResult as PgQueueResult,
  SendOptions as PgSendOptions,
  Schedule as PgSchedule,
  ScheduleOptions as PgScheduleOptions,
} from 'pg-boss';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoggerService } from './logger';

export type Job<T = object> = PgJob<T>;
export type JobWithMetadata<T = object> = PgJobWithMetadata<T>;
export type WorkHandler<T> = PgWorkHandler<T>;
export type JobStatus = PgJobWithMetadata['state'];
export type Queue = PgQueue;
export type QueueResult = PgQueueResult;
export type QueuePolicy = PgQueuePolicy;
export type QueueStats = {
  deferredCount: number;
  queuedCount: number;
  activeCount: number;
  completedCount: number;
};
export type Schedule = PgSchedule;
export type ScheduleOptions = PgScheduleOptions;
export type SendOptions = PgSendOptions;

const MAX_QUEUE_WAIT = parseInt(process.env.MAX_QUEUE_WAIT || '25000', 10);

class PgBossServiceError extends Error {}

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  public boss: PgBoss;
  public batchSize: number;
  public pollingInterval: number;
  public pgBossSchema: string;

  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
  ) {
    this.batchSize = this.config.get<number>('PG_BOSS_BATCH_SIZE', 5);
    this.pollingInterval = this.config.get<number>('PG_BOSS_POLLING_INTERVAL', 2);
    this.pgBossSchema = this.config.get<string>('PG_BOSS_SCHEMA', 'pgboss_planllama');
  }

  async onModuleInit(): Promise<void> {
    if (this.boss) {
      return;
    }

    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable not set');
    }
    this.logger.log(`Bootstraping pg-boss on ${process.env.DATABASE_URL}`);
    this.boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: this.pgBossSchema,
      application_name: this.config.get<string>('PG_BOSS_APP_NAME', 'planllama'),
      max: this.config.get<number>('PG_BOSS_MAX_CONNECTIONS', 20),
    });
    this.boss.on('error', (error) => this.logger.error(error));
    await this.boss.start();
  }

  onApplicationShutdown(): void {
    this.logger.log(`Application being shutdown`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.boss) {
      return;
    }
    this.logger.log(`Shutting down pg-boss`);
    this.boss.off('error', (error) => this.logger.error(error));
    await this.boss.stop({
      // destroy: true, // close DB connection
      // graceful: false, // allow jobs to finish processing
      wait: true,
    });
  }

  async createQueue(queueName: string, options?: PgQueue): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to create queue ${queueName} before application is bootstrapped`);
    }
    this.logger.log(`Creating queue ${queueName}${options ? ` with options: ${JSON.stringify(options)}` : ''}`);
    await (options ? this.boss.createQueue(queueName, options) : this.boss.createQueue(queueName));
  }

  async getQueue(queueName: string): Promise<PgQueueResult | null> {
    if (!this.boss) {
      throw new Error(`Attempt to get queue ${queueName} before application is bootstrapped`);
    }
    this.logger.log(`Getting queue ${queueName}`);
    const queue = await this.boss.getQueue(queueName);
    return queue;
  }

  async getQueues(prefix?: string, sort_column: string = 'created_on', sort_order: 'asc' | 'desc' = 'desc'): Promise<PgQueueResult[]> {
    if (!this.boss) {
      throw new Error(`Attempt to get queues before application is bootstrapped`);
    }
    this.logger.log(`Getting all queues${prefix ? ` with prefix ${prefix}` : ''}`);
    const queues = await this.prisma.$queryRawUnsafe<PgQueueResult[]>(
      `SELECT
        name,
        policy,
        retry_limit as "retryLimit",
        retry_delay as "retryDelay",
        retry_backoff as "retryBackoff",
        expire_seconds as "expireInSeconds",
        retention_seconds as "retentionSeconds",
        dead_letter as "deadLetter",
        created_on as "createdOn",
        updated_on as "updatedOn"
      FROM ${this.pgBossSchema}.queue
      WHERE name LIKE $1
      ORDER BY ${sort_column} ${sort_order}
      `,
      prefix + '%',
    );

    return queues;
  }

  async getJobs(
    queueName: string,
    options: {
      limit?: number;
      offset?: number;
      states?: string[];
      includeArchive?: boolean;
    } = {},
  ): Promise<{
    jobs: JobWithMetadata[];
    total: number;
  }> {
    if (!this.boss) {
      throw new Error(`Attempt to get jobs for ${queueName} before application is bootstrapped`);
    }
    this.logger.log(`Getting jobs for queue ${queueName}`);

    const { limit = 50, offset = 0, states = [] } = options;

    // Build dynamic query based on states filter
    let stateCondition = '';
    const baseParams = [queueName];
    const queryParams: (string | number)[] = [...baseParams];
    const countParams: (string | number)[] = [...baseParams];

    if (states.length > 0) {
      // Build placeholders for state filtering
      const statePlaceholders = states.map((_, index) => `$${index + 2}`).join(',');
      stateCondition = `AND state IN (${statePlaceholders})`;
      // Add states to parameters
      queryParams.push(...states);
      countParams.push(...states);
    }

    // Add limit and offset parameters (they come after states)
    const limitParamIndex = queryParams.length + 1;
    const offsetParamIndex = queryParams.length + 2;
    queryParams.push(limit, offset);

    // Query jobs from pgboss.job table
    const jobs = await this.prisma.$queryRawUnsafe<JobWithMetadata[]>(
      `
      SELECT id, name, data, state, priority, retry_count as "retryCount", 
             retry_limit as "retryLimit", retry_delay as "retryDelay",
             created_on as "createdOn", started_on as "startedOn", 
             completed_on as "completedOn", output, 
             keep_until as "keepUntil", singleton_key as "singletonKey", 
             singleton_on as "singletonOn"
      FROM ${this.pgBossSchema}.job 
      WHERE name = $1 ${stateCondition}
      ORDER BY created_on DESC 
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `,
      ...queryParams,
    );

    // Get total count for pagination
    const totalResult = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `
      SELECT COUNT(*) as count
      FROM ${this.pgBossSchema}.job 
      WHERE name = $1 ${stateCondition}
    `,
      ...countParams,
    );

    const total = Number(totalResult[0].count);

    return { jobs, total };
  }

  async publish<T = object>(queue: string, payload: T, _options: PgSendOptions = {}): Promise<string> {
    try {
      return await this._publish(queue, payload, _options);
    } catch (e) {
      // Magically handle if we didn't create the queue first.
      if (e instanceof PgBossServiceError) {
        await this.createQueue(queue);
        return await this._publish(queue, payload, _options);
      }
      throw e;
    }
  }

  async _publish<T = object>(queue: string, payload: T, options: PgSendOptions = {}): Promise<string> {
    if (!this.boss) {
      throw new Error(`Attempt to publish to ${queue} before application is bootstrapped`);
    }

    if (!(await this.boss.getQueue(queue))) {
      throw new PgBossServiceError(`Queue ${queue} not found`);
    } // Ensure queue exists

    this.logger.debug(`Attempt to publish payload ${JSON.stringify(payload)} to ${queue} with options: ${JSON.stringify(options)}`);
    const jobId = await this.boss.send(queue, payload as object, options);
    if (!jobId) {
      throw new Error(`Failed to publish job to ${queue} using options: ${JSON.stringify(options)}`);
    }
    return jobId;
  }

  async subscribe<T>(queue: string, callback: PgWorkHandler<T>): Promise<string | null> {
    if (!this.boss) {
      throw new Error(`Attempt to subscribe to ${queue} before application is bootstrapped`);
    }
    this.logger.debug(`Subscribing to ${queue}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = async (job: PgJob<T>[]): Promise<any> => {
      try {
        return await callback(job);
      } catch (error) {
        this.logger.error(`Error in job ${JSON.stringify(job)}: ${JSON.stringify(error)}`);
        Sentry.captureException(error);
        throw error;
      }
    };
    return this.boss.work<T>(queue, { batchSize: this.batchSize, pollingIntervalSeconds: this.pollingInterval }, cb);
  }

  async schedule<T>(queue: string, cron: string, payload: T, options: PgScheduleOptions = {}): Promise<void> {
    try {
      return await this._schedule(queue, cron, payload, options);
    } catch (e) {
      // Magically handle if we didn't create the queue first.
      if (e instanceof PgBossServiceError) {
        await this.createQueue(queue);
        return await this._schedule(queue, cron, payload, options);
      }
      throw e;
    }
  }

  async _schedule<T>(queue: string, cron: string, payload: T, options: PgScheduleOptions = {}): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to schedule job on ${queue} before application is bootstrapped`);
    }
    this.logger.log(`Scheduling job on ${queue} with cron: ${cron} and payload: ${JSON.stringify(payload)}`);
    try {
      await this.boss.schedule(queue, cron, payload as object, options);
    } catch (e) {
      if (/not found$/.test((e as Error).message)) {
        throw new PgBossServiceError(`Queue ${queue} not found`);
      }
      throw e;
    }
  }

  async getSchedules(namePrefix?: string, key?: string): Promise<PgSchedule[]> {
    if (!this.boss) {
      throw new Error(`Attempt to get schedules before application is bootstrapped`);
    }
    this.logger.log(`Getting schedules${namePrefix ? ` with prefix ${namePrefix}` : ''}${key ? ` and key ${key}` : ''}`);
    const schedules = await this.boss.getSchedules(namePrefix, key);
    return schedules;
  }

  async unschedule(name: string, key?: string): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to unschedule ${name} before application is bootstrapped`);
    }
    this.logger.log(`Unscheduling ${name}${key ? ` with key ${key}` : ''}`);
    await this.boss.unschedule(name, key);
  }

  async queueSize(name: string, before: JobStatus = 'active'): Promise<number> {
    if (!this.boss) {
      throw new Error(`Attempt to get queue size for ${name} before application is bootstrapped`);
    }
    this.logger.log(`Getting queue size for ${name} with state before ${before}`);
    const stats = await this.queueStats(name);
    if (!stats) {
      throw new Error(`Queue ${name} not found`);
    }

    switch (before) {
      case 'created':
        return stats.queuedCount;
      case 'retry':
        return stats.queuedCount + stats.deferredCount;
      case 'active':
        return stats.queuedCount + stats.deferredCount + stats.activeCount;
      case 'completed':
        return stats.queuedCount + stats.deferredCount + stats.activeCount + stats.completedCount;
      default:
        throw new Error(`Invalid state ${before} for queue size`);
    }
  }

  async queueStats(name: string): Promise<QueueStats> {
    if (!this.boss) {
      throw new Error(`Attempt to get queue stats for ${name} before application is bootstrapped`);
    }
    this.logger.log(`Getting queue stats for ${name}`);
    const stats = await this.boss.getQueue(name);
    if (!stats) {
      throw new Error(`Queue ${name} not found`);
    }
    return {
      deferredCount: stats.deferredCount ?? 0,
      queuedCount: stats.queuedCount ?? 0,
      activeCount: stats.activeCount ?? 0,
      completedCount: stats.totalCount ?? 0,
    };
  }

  async cancel(name: string, id: string): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to cancel task ${id} from queue ${name} before application is bootstrapped`);
    }
    await this.boss.cancel(name, id);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async wait(name: string, id: string, maxWaitTime = MAX_QUEUE_WAIT): Promise<any> {
    if (!this.boss) {
      throw new Error(`Attempt to wait for task ${id} before application is bootstrapped`);
    }

    const endTime = Date.now() + maxWaitTime;
    while (true) {
      const job = await this.boss.getJobById(name, id);
      if (job?.state === 'completed' || job?.state === 'cancelled') {
        return job.output;
      }
      // Note retry is here because we only wait for jobs in tests.
      if (job?.state === 'failed' || job?.state === 'retry') {
        this.logger.error(`Job with id ${id} failed with state: ${job?.state} and output: ${JSON.stringify(job?.output)}`);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument
        const err = new HttpException({ message: job.output['message'], statusCode: job.output['status'] }, job.output['status']);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (Date.now() > endTime) {
        throw new Error(`Job with id ${id} did not complete in ${maxWaitTime}ms`);
      }
    }
  }

  async fail(name: string, id: string, error: Error): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to fail task ${id} from queue ${name} before application is bootstrapped`);
    }

    await this.boss.fail(name, id, error);
  }
}
