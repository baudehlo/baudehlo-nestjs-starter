import * as sourceMapSupport from 'source-map-support';
sourceMapSupport.install();
import './instrument'; // Ensure this is imported before any other modules

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { createAppModule } from './app.module';
import helmet from 'helmet';
import { BadRequestException } from '@nestjs/common';
import { Environment } from './common/enums';
import { LoggerService } from './common/services/logger';
import RedisStore from 'fastify-session-redis-store';
import { RedisService } from './common/services/redis';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import bytes from 'bytes';
import { readFile } from 'node:fs/promises';

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
    const { name, description, version } = JSON.parse(await readFile('package.json', 'utf-8')) as { version: string; name: string; description: string };

    const serverOptions: FastifyServerOptions = {
      trustProxy: true,
      logger: true,
    };
    const instance: FastifyInstance = fastify(serverOptions);

    const appModule = await createAppModule();
    const app = await NestFactory.create<NestFastifyApplication>(appModule, new FastifyAdapter(instance));
    await app.init();

    const redisService = await app.resolve(RedisService);
    const logger = await app.resolve(LoggerService);

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

    const config = new DocumentBuilder().setTitle(`API for ${name}`).setDescription(description).setVersion(version).addBearerAuth().build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    await app.listen(process.env.PORT ?? 3000);
    logger.log(`Application ${name} is running on: ${await app.getUrl()}`);
  } catch (error) {
    console.error('Error during application bootstrap', error);
    process.exit(1); // Exit the process with an error code
  }
}

void bootstrap();
