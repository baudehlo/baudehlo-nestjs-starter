import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { createAppModule } from 'src/app.module';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    // Raise disk threshold so the health endpoint never fails due to local disk usage
    process.env.DISK_THRESHOLD_PERCENT = '1';

    const appModule = await createAppModule();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [appModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    delete process.env.DISK_THRESHOLD_PERCENT;
    await app.close();
  });

  it('/health (GET) returns 200', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });
});
