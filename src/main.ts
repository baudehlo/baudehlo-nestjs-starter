import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { AppModule } from './app.module';
import { doubleCsrf } from 'csrf-csrf';
import helmet from 'helmet';
import { BadRequestException } from '@nestjs/common';
import { Environment } from './common/enums';
import { Logger } from './common/services/logger';
import { createClient } from 'redis';
import RedisStore from 'fastify-session-redis-store';

declare module 'fastify' {
  interface Session {
    id: string;
    // Add anything you want to store in the session
    csrfSecret?: string; // For CSRF protection
  }
}

const isProduction = process.env.NODE_ENV === Environment.production;

async function bootstrap() {
  try {
    const serverOptions: FastifyServerOptions = {
      logger: true,
    };
    const instance: FastifyInstance = fastify(serverOptions);

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(instance),
    );

    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
      const logger = new Logger('RedisClient');
      logger.error('Redis Client Error', err);
    });
    await redisClient.connect();

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

    const {
      doubleCsrfProtection, // This is the default CSRF protection middleware.
    } = doubleCsrf({
      getSessionIdentifier: (req): string => req.session.id,
      getSecret: (req) => req.session.csrfSecret ?? '',
    });
    app.use(doubleCsrfProtection);

    app.enableShutdownHooks();
    await app.listen(process.env.PORT ?? 3000);
    console.log(`Application is running on: ${await app.getUrl()}`);
  } catch (error) {
    const logger = new Logger('Bootstrap');
    logger.error('Error during application bootstrap', error);
    process.exit(1); // Exit the process with an error code
  }
}

void bootstrap();
