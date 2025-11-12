# NestJS Starter Copilot Instructions

## Architecture Overview

This is a production-grade NestJS application using **Fastify** (not Express), **Prisma with PostgreSQL**, **Redis**, **Sentry**, and **StatsD** for metrics. The app is designed for **clustered deployment** with distributed session management and background job processing.

### Key Stack Decisions

- **Platform**: Fastify (via `@nestjs/platform-fastify`) - NOT Express
- **Database**: PostgreSQL with Prisma ORM + Prisma Accelerate adapter (`@prisma/adapter-pg`)
- **Session Store**: Redis-backed sessions (`fastify-session-redis-store`)
- **WebSockets**: Socket.IO with Redis adapter for multi-instance sync
- **Background Jobs**: pg-boss (Postgres-backed job queue)
- **Observability**: Sentry (errors/profiling), StatsD (metrics), custom logger
- **Process Model**: Node.js cluster mode (see `bootstrap-app.ts`)

## Project Structure

```
src/
├── common/
│   ├── adapters/           # RedisIoAdapter for Socket.IO
│   ├── services/           # Core services (Redis, PgBoss, Logger)
│   ├── interceptors/       # LoggerInterceptor for request logging
│   └── utils/core/         # Bootstrap logic, app.module factory
├── prisma/                 # PrismaService with custom extensions
├── health/                 # Health checks (Terminus)
└── main.ts                 # Entry point (imports instrument.ts first!)
```

### Critical: Module Initialization Order

`main.ts` **must** import `instrument.ts` before any other modules to initialize Sentry tracing:

```typescript
import './common/utils/core/instrument'; // ALWAYS FIRST
```

## Development Workflow

### Package Manager

**Use `npm`** exclusively (not npm/yarn):

```bash
npm install
npm run start:dev    # Watch mode
npm run repl         # NestJS REPL for debugging
```

### Database Commands (via package.json scripts)

```bash
npm run db:generate              # Generate Prisma client to generated/prisma
npm run db:migrate:create        # Create migration named after current git branch
npm run db:migrate               # Run migrations (prisma migrate deploy)
```

**Prisma output location**: Custom output at `generated/prisma` (not default `node_modules/.prisma`)

### Testing

```bash
npm run test         # Unit tests (Jest)
npm run test:e2e     # E2E tests (see test/e2e/app.e2e.spec.ts)
npm run test:cov     # Coverage
```

E2E tests use `createAppModule()` factory pattern - **never** import `AppModule` directly.

## Critical Patterns & Conventions

### 1. Dynamic Module Pattern

`app.module.ts` exports `createAppModule()` async factory, NOT a static module. This allows pre-initialization of Redis clients before NestJS DI container starts:

```typescript
// app.module.ts
export async function createAppModule(): Promise<DynamicModule> {
  const redisService = new RedisService();
  const redisClient = await redisService.getClient();
  // Configure throttler with existing Redis client...
  return { module: class AppModule {}, imports: [...], providers: [...] };
}
```

**Why**: ThrottlerModule needs Redis client synchronously, but RedisService is async.

### 2. PrismaService Extensions

`PrismaService` uses custom Prisma Client extensions for logging queries and metrics:

- `logQueriesExtension`: Auto-logs all queries with timing to StatsD
- Uses `@prisma/adapter-pg` for connection pooling
- **Custom output**: `generated/prisma` (check `prisma/schema.prisma`)

When querying: All Prisma operations automatically timed and sent to StatsD as `prisma.sql.<model>.<operation>`.

### 3. Redis Architecture

`RedisService` supports both standalone and cluster modes:

- Env: `REDIS_USE_CLUSTER=true` switches to cluster mode
- Provides Redlock for distributed locking: `await redisService.lock('key', ttl)`
- **Mock mode**: Returns `RedisMock` in non-production (no Redis dependency for local dev)

### 5. Clustered Deployment

`bootstrap-app.ts` runs Node.js cluster:

- Primary process spawns workers (default: CPU count, override with `NUM_CLUSTER_WORKERS`)
- Socket.IO uses Redis adapter for cross-worker message routing
- Sessions stored in Redis, shareable across workers
- Each worker exits on error and gets auto-restarted

### 6. Observability

- **Sentry**: Initialize in `instrument.ts` (imported first in `main.ts`)
- **StatsD**: `HotShotsModule` configured to send to `STATSD_HOST:STATSD_PORT`, mocked in non-prod
- **Logging**: Custom `LoggerService` + `LoggerInterceptor` logs all HTTP requests with timing
- **Health**: `/health` endpoint (no `/api` prefix) using `@nestjs/terminus`

## Environment Variables (Required)

```bash
DATABASE_URL=postgresql://...     # Required for Prisma + pg-boss
SESSION_SECRET=...                # Required (throws on startup if missing)
SENTRY_DSN=...                    # Optional (Sentry error tracking)
REDIS_HOST=localhost              # Defaults to 'localhost' (dev) or 'redis.internal' (prod)
REDIS_PORT=6379                   # Default: 6379
REDIS_USE_CLUSTER=false           # Set 'true' for Redis cluster mode
STATSD_HOST=statsd.disco          # Default: 'statsd.disco'
STATSD_MOCK=false                 # Auto-mocked in non-production
```

Check `.env.example` for full list.

## Infrastructure & Deployment

- **Dockerfile**: Multi-stage build (development → build → production)
- **AWS CDK**: Infrastructure code in `infra/` directory
  - Deploy: `npm run infra:deploy`
  - Stack includes ALB configuration (see `server.keepAliveTimeout` settings in bootstrap)
- **Database**: Includes extensions: `cube`, `earthdistance`, `pg_stat_statements`, `pgcrypto`

## Common Gotchas

1. **Don't import AppModule directly** - Use `createAppModule()` factory
2. **Instrument.ts must be first import** - Critical for Sentry tracing
3. **Use npm, not npm** - Lock file is `npm-lock.yaml`
4. **Fastify, not Express** - Use Fastify types/plugins (e.g., `FastifyRequest`, `FastifyReply`)
5. **Custom Prisma output** - Import from `generated/prisma`, not `@prisma/client`
6. **Redis mocking** - Auto-enabled in non-prod, no local Redis needed for development
7. **API prefix** - All routes prefixed with `/api/v1` except `/health`, `/ws`, `/socket.io`
8. **Migration naming** - Migrations auto-named after git branch via `db:migrate:create` script

## Adding New Features

### New Controller

```typescript
@Controller('items') // Results in /api/v1/items
export class ItemsController {
  constructor(private readonly prisma: PrismaService) {}
}
```

### New Background Job

```typescript
// In service:
await this.pgBoss.send('job.name', { data });

// Register worker (usually in module init):
await this.pgBoss.work('job.name', async (job: Job<DataType>) => {
  // Process job.data
});
```

### Add Prisma Extension

Edit `prisma.service.ts` → `extendClient()` function to chain additional `$extends()` calls.

---

**For questions**: Check NestJS docs (fastify-specific sections), Prisma docs, or pg-boss docs.
