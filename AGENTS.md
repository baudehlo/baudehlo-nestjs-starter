# AI Agent Instructions — node-nestjs-starter

This is a production-grade NestJS application using **Fastify**, **Prisma + PostgreSQL**, **pg-boss**, **Redis**, **Sentry**, and **StatsD**. Read this file before writing any code.

---

## Stack at a Glance

| Concern | Solution |
|---|---|
| HTTP framework | Fastify (`@nestjs/platform-fastify`) — **NOT Express** |
| Database ORM | Prisma + PostgreSQL (`generated/prisma`, NOT `@prisma/client`) |
| Background jobs & queues | `PgBossService` (pg-boss backed by Postgres) |
| Scheduled / cron jobs | `PgBossService.schedule()` (pg-boss cron) |
| Cache / TTL storage | `RedisService` (ioredis, auto-mocked outside prod) |
| Distributed locking | `RedisService.lock()` (Redlock) |
| Sessions | Redis-backed (`fastify-session-redis-store`) |
| WebSockets | Socket.IO with Redis adapter (`RedisIoAdapter`) |
| Logging | `LoggerService` (wraps `ConsoleLogger`, adds request ID + Sentry breadcrumbs) |
| Metrics | `StatsD` via `HotShotsModule` (auto-mocked outside prod) |
| Error tracking | Sentry (`@sentry/nestjs`) — initialised in `instrument.ts` |
| Rate limiting | `ThrottlerModule` backed by Redis |
| Linter / formatter | Biome (`npm run lint:fix`) |
| Test runner | Vitest (`npm run test`) |
| Package manager | **npm** only |

---

## Project Layout

```
src/
├── common/
│   ├── adapters/           # RedisIoAdapter (Socket.IO ↔ Redis)
│   ├── enums/              # Environment enum + isProduction helper
│   ├── filters/            # SentryExceptionFilter
│   ├── services/
│   │   ├── pg-boss.service.ts   # Job queues + cron scheduling
│   │   ├── pg-boss.module.ts    # @Global module — never re-import
│   │   └── redis.ts             # Redis client, locking, health indicator
│   ├── types/              # XOR<T,U> utility type
│   └── utils/
│       ├── core/
│       │   ├── app.module.ts        # createAppModule() / createAppModuleForTest()
│       │   ├── app-ref.ts           # app singleton reference
│       │   ├── bootstrap-app.ts     # cluster bootstrap + session/CORS setup
│       │   ├── instrument.ts        # Sentry init — MUST be first import
│       │   └── app.service.ts       # Placeholder AppService
│       └── promise-timeout.ts   # Race a promise against a timeout
├── health/                 # /health endpoint (Terminus) — no /api prefix
├── logger/                 # LoggerService, LoggerInterceptor, LoggerModule
├── prisma/                 # PrismaService + PrismaModule (@Global)
├── main.ts                 # Entry: imports instrument.ts FIRST
└── repl.ts                 # NestJS REPL entry
```

---

## Critical Rules

### 1. `instrument.ts` must be the very first import in `main.ts`
```typescript
import './common/utils/core/instrument'; // ALWAYS FIRST — initialises Sentry
```
Never reorder this. Sentry tracing wraps all subsequent `require()` calls.

### 2. Never import `AppModule` directly
Always use the factory:
```typescript
import { createAppModule } from 'src/app.module'; // or 'src/common/utils/core/app.module'
const appModule = await createAppModule();
```
This pre-initialises the Redis client before the DI container starts (required for ThrottlerModule).

### 3. Import Prisma from `generated/prisma`, not `@prisma/client`
```typescript
// ✅ Correct
import { PrismaClient, Prisma } from 'generated/prisma/client';

// ❌ Wrong
import { PrismaClient } from '@prisma/client';
```

### 4. Fastify types everywhere
```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
// NOT: Request, Response from express
```

### 5. ESM only — no CommonJS
Biome enforces `noCommonJs: error`. Use `import`/`export`, not `require()`/`module.exports`.

---

## Service Usage Patterns

### Background Jobs — use `PgBossService`

`PgBossModule` is `@Global` — inject `PgBossService` directly into any service, no extra module import needed.

```typescript
import { PgBossService, Job } from 'src/common/services/pg-boss.service';

@Injectable()
export class MyService {
  constructor(private readonly pgBoss: PgBossService) {}

  // Enqueue a job (auto-creates the queue if it doesn't exist)
  async triggerWork(data: MyJobData): Promise<string> {
    return this.pgBoss.publish('my-queue.process', data);
  }

  // Register a worker (call during onModuleInit)
  async onModuleInit(): Promise<void> {
    await this.pgBoss.subscribe<MyJobData>('my-queue.process', async (jobs: Job<MyJobData>[]) => {
      for (const job of jobs) {
        await this.processItem(job.data);
      }
    });
  }
}
```

**Deferred / prioritised jobs** — pass `SendOptions`:
```typescript
await this.pgBoss.publish('my-queue', payload, {
  startAfter: 30,       // delay 30 seconds
  retryLimit: 3,
  retryDelay: 10,
  priority: 1,
  singletonKey: userId, // deduplicate by key
});
```

**Wait for a job result synchronously** (max 25 s by default):
```typescript
const jobId = await this.pgBoss.publish('my-queue', payload);
const result = await this.pgBoss.wait('my-queue', jobId);
```

**Cancel or fail a job manually:**
```typescript
await this.pgBoss.cancel('my-queue', jobId);
await this.pgBoss.fail('my-queue', jobId, new Error('reason'));
```

**Inspect queue health:**
```typescript
const stats = await this.pgBoss.queueStats('my-queue');
// { deferredCount, queuedCount, activeCount, completedCount }
const size = await this.pgBoss.queueSize('my-queue', 'active');
```

---

### Cron / Scheduled Jobs — use `PgBossService.schedule()`

Do **not** use `@nestjs/schedule` or `setInterval`. Use pg-boss scheduling so jobs survive restarts and run exactly once across clustered workers.

```typescript
// Schedule a recurring job with a cron expression
await this.pgBoss.schedule(
  'reports.daily-summary',   // queue name (will be created if absent)
  '0 8 * * *',               // standard cron: every day at 08:00 UTC
  { reportDate: new Date() }, // payload sent to the worker
  { tz: 'America/New_York' }, // optional ScheduleOptions
);

// Register the worker that processes this queue
await this.pgBoss.subscribe<ReportPayload>('reports.daily-summary', async (jobs) => {
  for (const job of jobs) {
    await this.generateReport(job.data);
  }
});

// Remove a schedule
await this.pgBoss.unschedule('reports.daily-summary');

// List all active schedules
const schedules = await this.pgBoss.getSchedules('reports.');
```

---

### Caching / TTL Storage — use `RedisService`

Do **not** use `@nestjs/cache-manager` or in-memory Maps for shared/TTL state. Use Redis so all cluster workers share the same cache.

```typescript
import { RedisService, RedisClientT } from 'src/common/services/redis';

@Injectable()
export class MyService {
  constructor(private readonly redisService: RedisService<RedisClientT>) {}

  async getCached(key: string): Promise<string | null> {
    const client = await this.redisService.getClient();
    return client.get(`myapp:cache:${key}`);
  }

  async setCached(key: string, value: string, ttlSeconds = 300): Promise<void> {
    const client = await this.redisService.getClient();
    await client.set(`myapp:cache:${key}`, value, 'EX', ttlSeconds);
  }

  async deleteCached(key: string): Promise<void> {
    const client = await this.redisService.getClient();
    await client.del(`myapp:cache:${key}`);
  }

  // getex: get-and-refresh-expiry atomically
  async getAndRefresh(key: string, ttlSeconds = 300): Promise<string | null> {
    const client = await this.redisService.getClient();
    return client.getex(`myapp:cache:${key}`, 'EX', ttlSeconds);
  }
}
```

> `RedisService` automatically returns `RedisMock` outside production — no local Redis needed for development or testing.

---

### Distributed Locking — use `RedisService.lock()`

Use this for any operation that must not run concurrently across cluster workers (e.g. one-time initialisation, idempotent writes).

```typescript
const lock = await this.redisService.lock('myapp:lock:resource-id', 20_000); // ttl in ms
try {
  await this.doExclusiveWork();
} finally {
  await lock.safeRelease(); // won't throw if lock already expired
}
```

---

### Database — use `PrismaService`

`PrismaModule` is `@Global` — inject `PrismaService` directly.

```typescript
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MyService {
  constructor(private readonly prisma: PrismaService) {}

  async findUser(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
```

All queries are automatically timed and emitted to StatsD as `prisma.sql.<Model>.<operation>`.

**Transactions:**
```typescript
import { PrismaTransaction } from 'src/prisma/prisma.service';

async doWork(): Promise<void> {
  await this.prisma.$transaction(async (tx: PrismaTransaction) => {
    await tx.user.update(...)
    await tx.order.create(...)
  });
}
```

---

### Logging — use `LoggerService`

Never use `console.log`. Inject `LoggerService`; it attaches request IDs via CLS and sends breadcrumbs to Sentry automatically.

```typescript
import { LoggerService } from 'src/logger/logger';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  doSomething(): void {
    this.logger.log('Thing happened');
    this.logger.debug(`Detail: ${JSON.stringify(data)}`);
    this.logger.warn('Something unusual');
    this.logger.error('Something failed', error.stack);
  }
}
```

---

### Metrics — inject `StatsD`

```typescript
import { StatsD } from 'hot-shots';

@Injectable()
export class MyService {
  constructor(private readonly metrics: StatsD) {}

  recordLatency(ms: number): void {
    this.metrics.timing('my-service.operation', ms);
    this.metrics.increment('my-service.calls');
  }
}
```

Auto-mocked in non-production.

---

### HTTP Requests — use `HttpModule` / `HttpService`

`HttpModule` is imported in `app.module.ts` globally. Use `@nestjs/axios`'s `HttpService`:

```typescript
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const { data } = await firstValueFrom(this.httpService.get<MyType>(url));
```

---

## Module Structure

### Adding a new feature module

```
src/
└── my-feature/
    ├── my-feature.controller.ts
    ├── my-feature.service.ts
    ├── my-feature.module.ts
    └── dto/
        └── create-my-feature.dto.ts
```

**Controller** — routes are automatically prefixed `/api/v1/`:
```typescript
@Controller('my-feature') // → /api/v1/my-feature
export class MyFeatureController {
  constructor(private readonly service: MyFeatureService) {}

  @Get()
  findAll() { return this.service.findAll(); }
}
```

**Module** — add to `createAppModuleForTest()` controllers array and `imports` in `app.module.ts`:
```typescript
@Module({
  imports: [/* add sub-modules here */],
  controllers: [MyFeatureController],
  providers: [MyFeatureService],
  exports: [MyFeatureService],
})
export class MyFeatureModule {}
```

Then register in `src/common/utils/core/app.module.ts`:
```typescript
// In createAppModuleForTest():
imports: [
  ...,
  MyFeatureModule,
],
controllers: [..., MyFeatureController],
```

---

## Testing

### Unit tests

```typescript
// src/my-feature/my-feature.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MyFeatureService } from './my-feature.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('MyFeatureService', () => {
  let service: MyFeatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyFeatureService,
        { provide: PrismaService, useValue: { user: { findUnique: vi.fn() } } },
      ],
    }).compile();
    service = module.get(MyFeatureService);
  });

  it('does the thing', async () => {
    expect(await service.doThing()).toBeDefined();
  });
});
```

### E2E tests

```typescript
// test/e2e/my-feature.e2e.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAppModule } from 'src/app.module';
import request from 'supertest';

describe('MyFeature (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const appModule = await createAppModule(); // ← always use factory
    const module: TestingModule = await Test.createTestingModule({
      imports: [appModule],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  it('GET /api/v1/my-feature returns 200', () => {
    return request(app.getHttpServer()).get('/api/v1/my-feature').expect(200);
  });
});
```

**Never** import `AppModule` directly in tests — always use `createAppModule()` or `createAppModuleForTest()`.

---

## Database Migrations

```bash
npm run db:migrate:create   # Creates migration named after current git branch
npm run db:migrate          # Runs prisma migrate deploy
npm run db:generate         # Regenerates Prisma client to generated/prisma/
```

Schema lives at `prisma/schema.prisma`. Client output is `generated/prisma/`.

---

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | **Required** — Postgres connection string |
| `SESSION_SECRET` | — | **Required** — app refuses to start without it |
| `REDIS_HOST` | `localhost` (dev) / `redis.internal` (prod) | |
| `REDIS_PORT` | `6379` | |
| `REDIS_USE_CLUSTER` | `false` | Set `true` for Redis cluster |
| `REDIS_LOCK_DEFAULT_TTL` | `20000` | Default lock TTL in ms |
| `SENTRY_DSN` | — | Optional — enables Sentry error tracking |
| `STATSD_HOST` | `statsd.disco` | Auto-mocked in non-prod |
| `STATSD_PORT` | `8125` | |
| `STATSD_MOCK` | — | Force-mock StatsD even in prod |
| `CORS_ORIGIN` | `*` | |
| `PAYLOAD_LIMIT` | `10mb` | Max request body size |
| `PORT` | `3000` | |
| `NUM_CLUSTER_WORKERS` | CPU count | Override cluster worker count |
| `PG_BOSS_BATCH_SIZE` | `5` | Jobs fetched per polling tick |
| `PG_BOSS_POLLING_INTERVAL` | `2` | Seconds between polls |
| `PG_BOSS_SCHEMA` | `pgboss_starter` | Postgres schema for pg-boss tables |
| `MAX_QUEUE_WAIT` | `25000` | Max ms for `pgBoss.wait()` |
| `JWT_SECRET` | — | JWT signing secret |
| `JWT_EXPIRES_IN` | `60m` | JWT expiry |
| `LOG_FULL_QUERIES` | — | Set any truthy value to log full SQL in dev |
| `REQUEST_LOGGING` | `false` | Log request bodies for PUT/POST/PATCH |

---

## Commands

```bash
npm run dev              # Start in watch mode
npm run start:prod       # Production start
npm run repl             # NestJS interactive REPL
npm run build            # Compile (also runs prisma generate)
npm run lint             # Check with Biome
npm run lint:fix         # Auto-fix with Biome
npm run test             # Run unit tests (Vitest)
npm run test:watch       # Vitest watch mode
npm run test:e2e         # E2E tests
npm run test:cov         # Coverage report
npm run db:generate      # Regenerate Prisma client
npm run db:migrate:create # New migration (named after git branch)
npm run db:migrate       # Deploy pending migrations
npm run infra:deploy     # Deploy AWS CDK stack
```

---

## Common Gotchas

1. **`instrument.ts` first** — Sentry won't trace properly otherwise.
2. **`generated/prisma`, not `@prisma/client`** — Client is generated to a custom path.
3. **Fastify, not Express** — Use `FastifyRequest`, `FastifyReply`; Fastify plugins, not Express middleware.
4. **`createAppModule()` factory, not `AppModule`** — Required for pre-DI Redis initialisation.
5. **`PgBossModule` and `PrismaModule` are `@Global()`** — Do not re-import them in feature modules; their services are available everywhere.
6. **Redis auto-mocked outside prod** — `RedisMock` is returned in dev/test; no local Redis required.
7. **No `@nestjs/schedule`** — Use `PgBossService.schedule()` instead; it survives restarts and won't double-fire across cluster workers.
8. **No in-memory caches for shared state** — The app runs in cluster mode; always use Redis.
9. **Route prefix** — All controllers are under `/api/v1/`; exceptions are `/health`, `/ws`, `/socket.io`.
10. **Vitest, not Jest** — Use `vi.fn()`, `vi.spyOn()`, `vi.mock()` instead of `jest.*`.
11. **Biome, not ESLint/Prettier** — Single quotes, 160-char lines, trailing commas, spaces.
12. **ESM only** — `import`/`export` everywhere; `require()` is a lint error.
13. **`npm` only** — Lock file is `package-lock.json`; do not use yarn or pnpm.
14. **Session `rolling: true`** — Sessions refresh on every request to prevent unexpected logouts.
