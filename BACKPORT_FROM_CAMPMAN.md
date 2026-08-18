# node-nestjs-starter: Back-Port from CampMan/campman-api

This document catalogs every meaningful difference found between the **CampMan/campman-api** project and **node-nestjs-starter** template. Changes are grouped by category, with the most impactful ones first. CampMan-specific items (web-crawling infrastructure, BrightData certs, etc.) are **excluded** — only template-applicable improvements are listed.

---

## 1. Prisma: v6 → v7 (High Priority)

**Files:** `package.json`, `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`

CampMan upgraded to Prisma 7, which involves both version bumps and import path changes.

### package.json version bumps
| Package | Template | CampMan |
|---|---|---|
| `@prisma/adapter-pg` | `^6.19.0` | `^7.7.0` |
| `@prisma/client` | `^6.11.1` | `^7.7.0` |
| `prisma` (devDep) | `^6.11.1` | `^7.7.0` |

### `src/prisma/prisma.service.ts` — import path changes for Prisma v7
- `import { Prisma, PrismaClient } from 'generated/prisma/client'` ← was `@prisma/client` and separate `generated/prisma`
- `ITXClientDenyList` now from `@prisma/client/runtime/client` ← was `/runtime/library`
- `UntypedExtendedClient` constructor options type narrowed: `Omit<ConstructorParameters<typeof PrismaClient>[0], 'adapter' | 'accelerateUrl'>` to be more explicit
- `$on('query')` callback return type annotation changed to `: void` (was `: Prisma.QueryEvent`)
- Added `@ts-ignore` for Prisma $extends excessive-complexity TS error with large schemas
- `logQueriesExtension`: Now only logs when `isProduction || LOG_FULL_QUERIES` (was only `isProduction`)
- `extendClient(this)` in constructor — removed `return` keyword (different intent from base class pattern)

### `src/prisma/prisma.module.ts` — import path
- `import { PrismaClient } from 'generated/prisma/client'` ← was `@prisma/client`

---

## 2. Testing: Jest → Vitest (High Priority)

CampMan replaced Jest wholesale with **Vitest**. This is a significant tooling migration.

### package.json changes

**Remove from devDependencies:**
- `jest`, `ts-jest`, `@types/jest`, `@babel/preset-env`, `@babel/preset-typescript` (Vitest uses SWC)

**Add to devDependencies:**
- `vitest`, `@vitest/coverage-v8`, `@vitest/ui`
- `unplugin-swc` (SWC transformer for Vitest + NestJS)
- `vite-tsconfig-paths` (path alias resolution)

**Replace scripts:**
```json
// Remove:
"test": "NODE_OPTIONS=\"--experimental-vm-modules\" jest",
"test:watch": "NODE_OPTIONS=\"--experimental-vm-modules\" jest --watch",
"test:cov": "NODE_OPTIONS=\"--experimental-vm-modules\" jest --coverage",
"test:debug": "NODE_OPTIONS=\"--experimental-vm-modules\" node --inspect-brk ...",
"test:e2e": "NODE_OPTIONS=\"--experimental-vm-modules\" jest --config ./test/jest-e2e.json",

// Add:
"test": "vitest run --passWithNoTests",
"test:all": "vitest run --config vitest.all.config.mts",
"test:unit": "vitest run --config vitest.config.mts",
"test:watch": "vitest",
"test:cov": "vitest run --config vitest.all.config.mts --coverage",
"test:debug": "vitest --inspect-brk --no-file-parallelism",
"test:e2e": "vitest run --config vitest.e2e.config.mts",
```

### Files to add (from CampMan, stripped of app-specific paths):
- `vitest.config.mts` — unit tests only (SWC, threads single, include `src/**/*.spec.ts`)
- `vitest.e2e.config.mts` — e2e tests only (include `test/**/*.e2e.spec.ts`)
- `vitest.all.config.mts` — all tests together with coverage (forks pool)

### Files to delete:
- `jest.config.js`

### `tsconfig.json` additions required by Vitest:
- Add `"types": ["vitest/globals"]` so global `describe`, `it`, `expect`, etc. are available without imports
- Remove `"jest.config.js"` from `include` array (no longer needed)

---

## 3. Linting: ESLint + Prettier → Biome (Medium Priority)

CampMan migrated from ESLint/Prettier to **Biome** for both linting and formatting.

### package.json changes

**Remove from devDependencies:**
- `eslint`, `eslint-config-prettier`, `eslint-plugin-prettier`
- `@eslint/eslintrc`, `@eslint/js`, `typescript-eslint`, `globals`

**Add to devDependencies:**
- `@biomejs/biome` (at whatever version is current, CampMan uses `^2.3.8`)

**Replace scripts:**
```json
// Remove:
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
"lint:fix": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
"format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",

// Add:
"format": "biome format . --write",
"lint": "biome check .",
"lint:fix": "biome check . --write",
```

### Files to add:
- `biome.json` — The CampMan version is a good starting point, but strip the CampMan-specific path exclusions (`planllama-change-feed/**`, `_old_backend/**`, etc.) and the crawlee-related vitest config file references.

### Files to delete:
- `eslint.config.mjs`
- `.prettierrc` (formatting is now Biome's job)

---

## 4. Husky Pre-Commit Hooks (Low Priority)

CampMan added Husky to run the linter before each commit and re-stage fixed files.

### package.json changes
- Add `"husky": "^9.1.7"` to devDependencies
- Add `"prepare": "husky"` to scripts

### Files to add:
- `.husky/pre-commit`:
```sh
npm run lint:fix
git add -u
```

---

## 5. Circular Import Fix: `app-ref.ts` (High Priority)

CampMan extracted the NestJS app instance into its own module to break a circular dependency chain:

> `prisma.service → bootstrap-app → app.module → controllers → auth guards → prisma.service`

### New file to add: `src/common/utils/core/app-ref.ts`
```typescript
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export let app: NestFastifyApplication;

export function setAppRef(instance: NestFastifyApplication) {
  app = instance;
}
```

### `src/common/utils/core/bootstrap-app.ts` — use `setAppRef`
- Remove `export let app: NestFastifyApplication` (was a mutable export)
- Import `setAppRef` from `./app-ref`
- After `NestFactory.create(...)`, call `setAppRef(app)` instead of relying on the exported variable

### `src/prisma/prisma.service.ts` — use `app-ref`
- Change `import { app } from 'src/common/utils/core/bootstrap-app'` → `import { app } from 'src/common/utils/core/app-ref'`
- Change all `app.get(...)` calls to `app?.get(...)` (optional chaining — app may be undefined during tests)

---

## 6. `bootstrap-app.ts` Improvements (High Priority)

Several production-correctness improvements were made.

### a) Listen on `0.0.0.0`
```typescript
// Before:
const server = await app.listen(process.env.PORT ?? 3000);
// After:
const server = await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
```
Required for Docker/ECS — the default binds only to localhost.

### b) Body limit moved to Fastify server options
```typescript
// Before (two-step):
const instance: FastifyInstance = fastify(serverOptions);
// ...later:
app.useBodyParser('json', { bodyLimit: payloadLimit });

// After (cleaner):
const payloadLimit = bytes.parse(process.env.PAYLOAD_LIMIT || '10mb') || undefined;
const serverOptions: FastifyServerOptions = {
  trustProxy: true,
  bodyLimit: payloadLimit,
};
const app = await NestFactory.create<NestFastifyApplication>(appModule, new FastifyAdapter(serverOptions), {});
// No app.useBodyParser() call needed
```

### c) Session `rolling: true`
```typescript
// Before:
rolling: false,
// After:
rolling: true, // reset session expiry on every request to prevent unexpected logouts
```

### d) CORS with explicit methods
```typescript
// Before:
app.enableCors({ origin: process.env.CORS_ORIGIN || '*', credentials: true });
// After:
app.enableCors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: true,
});
```

### e) Removed `SentryExceptionFilter` from bootstrap
The template manually calls `app.useGlobalFilters(new SentryExceptionFilter(logger))` in bootstrap. CampMan dropped this — the Sentry filter is already registered via `APP_FILTER` in the module. Remove the manual registration to avoid double-filtering.

### f) Removed FastifyInstance import complexity
The template creates a `FastifyInstance` variable and passes it to `new FastifyAdapter(instance)`. CampMan simplifies to just pass the options directly to `new FastifyAdapter(serverOptions)`. Remove the `fastify` import and `FastifyInstance` type.

---

## 7. `app.module.ts` — Architecture Improvements (High Priority)

### `src/app.module.ts` (root) — should delegate to core
The root `src/app.module.ts` was essentially a duplicate bootstrap. In CampMan, `repl.ts` and `bootstrap-app.ts` both import from `src/common/utils/core/app.module.ts`. The root `src/app.module.ts` can be removed or simplified to a re-export of `createAppModule` from the core location.

### `src/common/utils/core/app.module.ts` — testability pattern

CampMan restructured the module function to split into two:
- `createAppModule(prismaClient?)` — full app module (wraps the below into a NestJS DynamicModule)
- `createAppModuleForTest(controllers?, prismaClient?)` — returns `ModuleMetadata` for injection in unit/e2e tests

Key improvements in the module setup:
- `ConfigModule.forRoot({ isGlobal: true })` — single global config (template has it twice and without `isGlobal`)
- CLS module now mounts on **middleware + guard + interceptor** (template only mounted on guard), ensuring request IDs are captured from all entry points
- JWT module registered via `JwtModule.registerAsync` with OIDC config (audience/issuer from env)
- `PgBossService` moved out of providers and into its own `PgBossModule` (see section 8)
- `TerminusModule.forRoot({ logger: true })` and `HttpModule` now imported in the module (removed from HealthModule)

### `src/repl.ts` — import from core
```typescript
// Before:
import { createAppModule } from './app.module';
// After:
import { createAppModule } from './common/utils/core/app.module';
```

---

## 8. `PgBossModule` — Extract to Own Module (Low-Medium Priority)

CampMan extracted PgBoss into a proper `@Global()` NestJS module.

### New file: `src/common/services/pg-boss.module.ts`
```typescript
import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'src/logger/logger.module';
import { PgBossService } from './pg-boss.service';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [PgBossService],
  exports: [PgBossService],
})
export class PgBossModule {}
```

Then in `app.module.ts`, import `PgBossModule` instead of directly providing `PgBossService` in the providers array.

### `src/common/services/pg-boss.service.ts` improvements
Two notable changes from CampMan:

**a) Improved `subscribe()` method** — now auto-creates queue if missing:
```typescript
// Before: just subscribes (may fail if queue doesn't exist)
// After: checks if queue exists first; creates it if not; then subscribes
```

**b) Added `getJobById()` public method:**
```typescript
async getJobById(name: string, id: string): Promise<JobWithMetadata | null> {
  if (!this.boss) throw new Error(`...`);
  return await this.boss.getJobById(name, id);
}
```

**c) Simpler `onModuleDestroy()`:**
```typescript
// Before:
await this.boss.stop({ wait: true });
// After:
await this.boss.stop();  // less aggressive
```

---

## 9. `redis.ts` — Code Quality Improvements (Low Priority)

The `RedisMock` class was cleaned up — methods now use `Promise.resolve()` instead of `async` + `// eslint-disable` comments:

```typescript
// Before:
// eslint-disable-next-line @typescript-eslint/require-await
async get(key: string): Promise<string | null> {
  return store[key] !== undefined ? (store[key] as string) : null;
}

// After:
get(key: string): Promise<string | null> {
  return Promise.resolve(store[key] ?? null);
}
```

Also: `const store = {}` → `const store: Record<string, string> = {}` (proper type annotation).

The `retryStrategyErrorDetected` private field was removed from `RedisService` (it was declared but never used).

---

## 10. `redis-io.adapter.ts` — Return Type Fix (Low Priority)

```typescript
// Before:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
createIOServer(port: number, options?: ServerOptions): any {

// After:
createIOServer(port: number, options?: ServerOptions): Server {
```

Proper return type removes the `any` escape hatch.

---

## 11. `logger.middleware.ts` — Simplifications (Low Priority)

**a) Removed `HttpAdapterHost` dependency** — was injected but not used in CampMan:
```typescript
// Before:
public constructor(
  private readonly logger: LoggerService,
  private readonly httpAdapterHost: HttpAdapterHost,
) {}
// After:
public constructor(private readonly logger: LoggerService) {}
```

**b) `canActivate` made synchronous:**
```typescript
// Before:
async canActivate(context: ExecutionContext): Promise<boolean> {
// After:
canActivate(context: ExecutionContext): boolean {
```
(The body doesn't use `await`; no need for the async wrapper.)

---

## 12. `health.service.ts` and `health.controller.ts` — Minor Cleanup (Low Priority)

**`health.service.ts`** — `LoggerService` removed from constructor (wasn't used):
```typescript
// Before: constructor had private readonly logger: LoggerService
// After: logger removed
```

**`health.service.ts`** — `checkHealth` made synchronous (returns the `Promise` directly):
```typescript
// Before:
async checkHealth(): Promise<HealthCheckResult> {
  return this.health.check([...]);
}
// After:
checkHealth(): Promise<HealthCheckResult> {
  return this.health.check([...]);
}
```

**`health.controller.ts`** — Same pattern:
```typescript
// Before:
async check(): Promise<HealthCheckResult> {
// After:
check(): Promise<HealthCheckResult> {
```

**`health.module.ts`** — In CampMan this module was removed and its components (`TerminusModule`, `HttpModule`, `HealthController`, `HealthService`) were moved directly into the app module. Consider whether to keep the module or inline as CampMan did.

---

## 13. `tsconfig.json` — Additions (Medium Priority)

CampMan added several useful compiler options:

```json
{
  "compilerOptions": {
    // Explicit path aliases (required by Vitest config and helps editors):
    "paths": {
      "*": ["./*"],
      "src/*": ["./src/*"],
      "generated/prisma": ["./generated/prisma"],
      "generated/prisma/*": ["./generated/prisma/*"]
    },
    "skipDefaultLibCheck": true,  // faster compilation
    "isolatedModules": true,      // required for SWC/Vitest compatibility
    "types": ["vitest/globals"]   // globals (describe/it/expect) without imports
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "prisma/**/*.ts"]
  // NOTE: remove "jest.config.js" from include
}
```

Also remove `"baseUrl": "./"` — it becomes redundant when `paths` is specified.

---

## 14. `tsconfig.build.json` — Restructuring (Medium Priority)

CampMan significantly reworked this:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "./",
    "allowJs": true,
    "declaration": false
  },
  "include": ["src/**/*", "generated/**/*"],
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "infra", "./*.ts"]
}
```

Key differences from template:
- `rootDir: "./"` ensures the compiled output mirrors the source layout (i.e., `dist/src/main.js` not `dist/main.js`)
- `declaration: false` — no `.d.ts` files in production build
- `allowJs: true` — allows JS files in build (e.g., config files)
- `include` explicitly lists `generated/**/*` so Prisma-generated files compile
- `./*.ts` excluded to prevent root-level files (like `bootstrap.ts`) from being compiled into dist

**Note:** This is why CampMan's `start:prod` is `node dist/src/main` — the `rootDir: "./"` shift moves the output one level deeper.

---

## 15. `nest-cli.json` — Minor Changes (Low Priority)

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": false,
    "assets": [{ "include": "**/*.md", "outDir": "./dist/src" }],
    "watchAssets": true
  }
}
```

- `deleteOutDir: false` (template has `true`) — preserves dist between builds for incremental compilation
- `assets` — copies markdown files to dist (useful if you have email templates or documentation served at runtime)
- `watchAssets: true` — rebuilds assets in watch mode

---

## 16. `package.json` — Build Script and `start:prod` (Medium Priority)

```json
// Before:
"build": "nest build",
"start:prod": "node dist/main",

// After (matching tsconfig.build.json rootDir change):
"build": "npx prisma generate && nest build",
"start:prod": "node dist/src/main",
```

The `prisma generate` prefix ensures the generated client is always fresh before a build — critical in CI/CD environments where `node_modules` might be cached but `generated/` is gitignored.

---

## 17. GitHub Actions CI — Major Overhaul (Medium Priority)

**File:** `.github/workflows/lint-and-test.yml`

### Key changes:

**a) Path filters** — avoid running CI on irrelevant changes:
```yaml
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "prisma/**"
      - "test/**"
      - "package.json"
      - "tsconfig*.json"
      - "vitest*.mts"
      - "biome.json"
      - ".github/workflows/**"
  pull_request:
    branches: [main]
    paths: [same as above]
```

**b) Newer action versions** — `actions/checkout@v3 → @v4`, `actions/setup-node@v3 → @v4`

**c) pgvector support** — replace the built-in postgres service with `cpunion/setup-pgvector@main`:
```yaml
- name: Setup PostgreSQL with pgvector
  uses: cpunion/setup-pgvector@main
  with:
    postgres-version: '17'
    pgvector-version: '0.8.0'
    postgres-user: 'postgres'
    postgres-password: 'postgres'
    postgres-db: 'testdb'
```
(Only needed if your schema uses pgvector — skip if not applicable)

**d) `npm install` → `npm ci`** — for reproducible, locked installs in CI

**e) DB setup before tests:**
```yaml
- name: Run tests with coverage
  env:
    DATABASE_URL: postgres://postgres:postgres@localhost:5432/testdb
    SESSION_SECRET: some-long-secret
  run: |
    npm run db:generate
    npm run db:migrate
    npm run db:seed
    npm run test:cov
```

**f) Add a `deploy.yml`** — CampMan has a companion deploy workflow that triggers on successful `lint-and-test` completion and supports manual dispatch with environment selection. Worth porting as a template pattern (with app-specific values stripped out).

---

## 18. `Dockerfile` — Production Improvements (Medium Priority)

### a) `DATABASE_URL` and `NODE_OPTIONS` in build stage
```dockerfile
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build
```
The dummy `DATABASE_URL` is needed for `prisma generate` (called by the build script) to succeed without a live database. `NODE_OPTIONS` prevents OOM during TypeScript compilation of large projects.

### b) `chown node:node /usr/src/app` in production stage
```dockerfile
# Give the node user write access to the workdir so tools can create
# cache/profile directories at runtime.
RUN chown node:node /usr/src/app
```
Without this, the `node` user can't write to the working directory at runtime.

---

## Summary Table

| Item | Priority | Files Affected |
|---|---|---|
| Prisma v6 → v7 | **High** | `package.json`, `prisma.service.ts`, `prisma.module.ts` |
| Circular import fix (`app-ref.ts`) | **High** | new `app-ref.ts`, `bootstrap-app.ts`, `prisma.service.ts` |
| `bootstrap-app.ts` improvements (0.0.0.0, bodyLimit, rolling, CORS) | **High** | `bootstrap-app.ts` |
| Jest → Vitest | **High** | `package.json`, 3 new vitest configs, delete `jest.config.js` |
| `tsconfig.json` / `tsconfig.build.json` restructure | **Medium** | both tsconfig files |
| `app.module.ts` (`createAppModuleForTest` pattern, CLS fix) | **Medium** | `src/common/utils/core/app.module.ts`, `src/app.module.ts` |
| Build script & `start:prod` path | **Medium** | `package.json` |
| ESLint → Biome | **Medium** | `package.json`, new `biome.json`, delete `eslint.config.mjs`, `.prettierrc` |
| GitHub Actions overhaul | **Medium** | `.github/workflows/lint-and-test.yml`, new `deploy.yml` |
| Dockerfile improvements | **Medium** | `Dockerfile` |
| `PgBossModule` extraction | **Low-Med** | new `pg-boss.module.ts`, `app.module.ts` |
| `pg-boss.service.ts` improvements | **Low-Med** | `pg-boss.service.ts` |
| `redis.ts` cleanup | **Low** | `redis.ts` |
| `redis-io.adapter.ts` type fix | **Low** | `redis-io.adapter.ts` |
| `logger.middleware.ts` simplification | **Low** | `logger.middleware.ts` |
| `health.service.ts` / `health.controller.ts` cleanup | **Low** | both files |
| `nest-cli.json` tweaks | **Low** | `nest-cli.json` |
| Husky pre-commit | **Low** | `package.json`, `.husky/pre-commit` |
