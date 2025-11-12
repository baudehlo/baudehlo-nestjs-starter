import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { BadRequestException, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import bytes from 'bytes';
import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import RedisStore from 'fastify-session-redis-store';
import helmet from 'helmet';
import { StatsD } from 'hot-shots';
import cluster, { Worker } from 'node:cluster';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { RedisIoAdapter } from 'src/common/adapters/redis-io.adapter';
import { isProduction } from 'src/common/enums';
import { LoggerService } from 'src/common/services/logger';
import { RedisService } from 'src/common/services/redis';
import { createAppModule } from './app.module';
import { LoggerInterceptor } from 'src/common/interceptors/logger-interceptor';
import { ConfigService } from '@nestjs/config';

declare module 'fastify' {
  interface Session {
    id: string;
    // Add anything you want to store in the session
    csrfSecret?: string; // For CSRF protection
  }
}

export let app: NestFastifyApplication;

export async function bootstrap() {
  try {
    const { name, description, version } = JSON.parse(await readFile('package.json', 'utf-8')) as { version: string; name: string; description: string };

    const serverOptions: FastifyServerOptions = {
      trustProxy: true,
      logger: true,
    };
    const instance: FastifyInstance = fastify(serverOptions);

    const appModule = await createAppModule();
    app = await NestFactory.create<NestFastifyApplication>(appModule, new FastifyAdapter(instance));

    app.setGlobalPrefix('api', {
      exclude: ['/health', '/ws', '/socket.io'],
    });

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();

    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    const redisService = await app.resolve(RedisService);
    const logger = await app.resolve(LoggerService);
    const metrics = await app.resolve(StatsD);
    const config = await app.resolve(ConfigService);

    logger.log(`Starting application ${name} version ${version}`);

    const redisClient = await redisService.getClient();

    // Initialize store.
    const redisStore = new RedisStore({
      client: redisClient,
      prefix: 'myapp:',
    });

    if (!process.env.SESSION_SECRET) {
      throw new BadRequestException('SESSION_SECRET is not set');
    }

    await app.register(fastifyCookie);
    await app.register(fastifySession, {
      secret: process.env.SESSION_SECRET, // Replace with a strong, random secret
      cookie: {
        secure: isProduction, // Use secure cookies in production
        maxAge: 86400000, // Session expiration in milliseconds (e.g., 24 hours)
      },
      store: redisStore,
      prefix: 'session:', // Optional: prefix for session keys in Redis
      rolling: false, // recommended: do not roll session on every request
      saveUninitialized: false, // recommended: only save session when data exists
    });

    app.enableCors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    });

    app.use(helmet());

    app.enableShutdownHooks();

    const payloadLimit = bytes.parse(process.env.PAYLOAD_LIMIT || '10mb') || undefined;
    app.useBodyParser('json', { bodyLimit: payloadLimit });

    app.useGlobalInterceptors(new LoggerInterceptor(metrics, logger, config));

    const swaggerConfig = new DocumentBuilder().setTitle(`API for ${name}`).setDescription(description).setVersion(version).addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('apidocs', app, document);

    if (cluster.isPrimary) {
      const numWorkers = parseInt(process.env.NUM_CLUSTER_WORKERS || cpus().length.toString(), 10);
      const spawnWorker = (): void => {
        logger.debug('Spawning cluster worker');
        metrics.increment(`worker.spawn`);
        cluster.fork({ CLUSTER_MASTER_PID: process.pid });
      };

      for (let i = 0; i < numWorkers; i++) {
        spawnWorker();
      }

      const clusterExitHandler = (worker: Worker, code: number, signal: string): void => {
        metrics.increment(`worker.exit`);

        if (signal) {
          metrics.increment(`worker.signal`);
          logger.error(`Worker ${worker.id} killed by signal ${signal}`);
        } else if (code !== 0) {
          metrics.increment(`worker.error`);
          logger.error(`Worker ${worker.id} exited with error code: ${code}`);
        }

        if (signal || code !== 0) {
          // Restart normal worker
          spawnWorker();
        }
      };

      cluster.on(`exit`, clusterExitHandler);
    } else if (cluster.isWorker) {
      const server = await app.listen(process.env.PORT ?? 3000);
      // These need to be set due to weird behaviour of AWS ALB.
      // See: https://shuheikagawa.com/blog/2019/04/25/keep-alive-timeout/
      server.keepAliveTimeout = 61 * 1000;
      server.headersTimeout = 70 * 1000; // This should be bigger than `keepAliveTimeout + your server's expected response time`
      logger.log(`Application ${name} is running on: ${await app.getUrl()}`);
    }
  } catch (error) {
    console.error('Error during application bootstrap', error);
    process.exit(1); // Exit the process with an error code
  }
}
