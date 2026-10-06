# EXT-150 — миграция бэкенда на NestJS + Prisma: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline in the current session — no subagents, no worktree (D23, spec §16). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить ASP.NET Core-бэкенд в `backend/` на NestJS 12 + Prisma 7 (PostgreSQL 14) с тем же API для фронтенда и исправленными дефектами аудита.

**Architecture:** CommonJS-проект TypeScript 6 (шаблон Nest 12 `ts`: `module: nodenext`, ESM-пакеты Nest грузятся через `require(esm)`), модуль на агрегат (conferences / sessions / registrations / speakers), слой представления (Prisma `select` → response-DTO) отделён от входных DTO. Сквозные HTTP-правила (requestId, CORS, 405, 415, разбор JSON, единый формат ошибок) — Express-middleware и один глобальный `ExceptionFilter`. Многошаговые записи — интерактивные транзакции Prisma с блокировкой строки конференции.

**Tech Stack:** Node 24 LTS (образ, CI) / ≥22.12 (локально), NestJS 12.1.2, Express 5.2.1, Prisma 7.10.0 + `@prisma/adapter-pg`, PostgreSQL 14, class-validator 0.15.1, Jest 30 + ts-jest 29.4 + supertest 7, ESLint 10 + typescript-eslint 8.71, Docker, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-05-ext150-nestjs-migration-design.md](../specs/2026-10-05-ext150-nestjs-migration-design.md) (коммит `8fc0e6d`). Ссылки «spec 5.4» — на разделы spec.

## Global Constraints

- Ноль диффа в `frontend/` (spec §2). Исключение возможно только по итогам Task 1, шаг «порт 80» — и только одна строка `frontend/nginx.conf`, с согласия пользователя.
- Коммиты, push, PR — только после явного подтверждения пользователя (CLAUDE.md). Шаг «Commit» в каждой задаче = показать `git status`, `git diff --cached --stat`, предложить сообщение, ждать «ок». Формат: `<type>: <что> (EXT-150)`, окончание сообщения — `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `report/` в коммиты не попадает.
- Новые файлы — LF. Существующие файлы сохраняют окончания (`README.md` — CRLF, `docs/devlog.md` — CRLF). Никаких массовых правок по каталогам.
- Версии (точно, `--save-exact`): `@nestjs/common|core|platform-express|testing` 12.1.2, `@nestjs/config` 12.0.1, `@nestjs/swagger` 12.0.2, `@nestjs/cli` 12.0.8, `prisma` и `@prisma/client` и `@prisma/adapter-pg` 7.10.0, `typescript` 6.0.3, `express` 5.2.1, `class-validator` 0.15.1, `class-transformer` 0.5.1, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `jest` 30.5.2, `ts-jest` 29.4.14, `supertest` 7.3.1, `eslint` 10.12.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.71.0, `@types/node` 24.19.1, `@types/express` 5.0.6, `@types/jest` 30.0.0, `@types/supertest` 7.2.1. Другие пакеты — только с согласия пользователя.
- Ничего не устанавливать глобально; Docker-образы — только `node` (тег закрепляется в Task 1) и `postgres:14` (уже есть). `nginx` нужен только для сборки фронтенда в Task 16.
- Compose-стек пользователя и dev-база не трогаются до Task 16. Тестовая БД — одноразовый `postgres:14` без тома в своей сети на `127.0.0.1:55432` (`scripts/test-db.sh`); стенд — своя сеть и порт 5098 (`scripts/stand.sh`).
- Даты расписания — строго `YYYY-MM-DDTHH:mm:ss` (spec 5.5), `registeredAt` — ISO с `Z` и миллисекундами. «Сейчас» — только через `Clock`.
- Формат ошибки (spec 5.6): `{ statusCode, error, message, requestId, errors? }`, заголовок `X-Request-Id`.
- Лимиты длины строк — единая таблица в Task 2 (`src/common/limits.ts`), одна для БД и DTO.
- Долгие команды — с тайм-аутом; две проверки подряд с одной причиной сбоя — остановиться и доложить (CLAUDE.md).
- Решение, не покрытое планом или spec, — остановиться и спросить.

## Review Focus

Входы, которые spec подразумевает, но не называет; тест на каждый — в задаче-владельце.

1. **JSON-тело, которое не объект** (`[]`, `"x"`, `1`, `null`) → `400` в едином формате, не `500` и не «успех с пустым DTO». Тест — Task 5 (`[]` дойдёт до пайпа) и Task 4 (примитивы режет парсер).
2. **Ключи в PascalCase** (`"Title"`): старый API принимал имена без учёта регистра (System.Text.Json web defaults), новый отвечает `400` с полем `Title` → строка в списке изменений контракта PR. Тест — Task 6.
3. **Целые за пределами int32** в `capacity`, `maxAttendees`, `sessionId`, `speakerId`, `roomId` (`3000000000`) → `400`, не `500` от Postgres. Тесты — Task 6, Task 7, Task 8.
4. **Не-ASCII имена** участника (`"Мария"`, `"Kowalská"`) → `201`, имена возвращаются без искажений; ASCII-ограничение — только у email. Тест — Task 8.
5. **Email с пробелами и в верхнем регистре** (`"  Maria.K@Example.com "`) → тот же участник: повтор на ту же конференцию `409`, на другую — тот же `attendeeId`. Тест — Task 8.

---

## Карта файлов

```
backend/                              (заменяет .NET; .NET удаляется в Task 14)
  package.json, package-lock.json     Task 1
  tsconfig.json, tsconfig.build.json, nest-cli.json, eslint.config.mjs, jest.config.js, jest.int.config.js, .gitignore   Task 1
  prisma.config.ts                    Task 3
  prisma/schema.prisma                Task 3
  prisma/migrations/20261005000000_init/migration.sql, prisma/migrations/migration_lock.toml   Task 3
  prisma/seed.ts                      Task 10
  scripts/test-db.sh                  Task 3   — одноразовый Postgres для тестов
  scripts/stand.sh                    Task 12  — изолированный стенд из Docker-образов
  scripts/generate-swagger.ts         Task 11  — swagger.json для артефакта CI
  scripts/compare-reference.ts        Task 13  — сравнение с эталоном
  src/main.ts, src/app.module.ts, src/configure-app.ts                       Task 4
  src/config/app-config.ts (+ .spec.ts)                                      Task 2
  src/common/clock.ts, dates.ts, status.ts, email.ts, limits.ts, parse-id.pipe.ts (+ .spec.ts)   Task 2
  src/common/write-error.ts, errors.ts, request-context.ts, http-middleware.ts, validation.ts,
             exception.filter.ts (+ .spec.ts), common.module.ts             Task 4
  src/common/db-error.ts, locking.ts                                        Task 3
  src/prisma/prisma.service.ts, prisma.module.ts                            Task 3
  src/health/health.controller.ts, health.module.ts                         Task 4
  src/representation/selects.ts, responses.ts, mappers.ts                   Task 5
  src/speakers/*                                                             Task 5
  src/conferences/*                                                          Task 6 (+ маршруты сессий конференции — Task 7)
  src/sessions/*                                                             Task 7
  src/registrations/*                                                        Task 8
  src/swagger/swagger.ts, api-description.ts, api-errors.decorator.ts       Task 5 (каркас), Task 11 (флаг, пути, описание)
  test/integration/setup/global-setup.ts, helpers.ts, fixtures.ts           Task 3
  test/integration/*.e2e-spec.ts                                             Tasks 3–11, 13
  test/fixtures/reference/                                                   Task 11 (swagger.json), Task 13 (остальное)
  Dockerfile, .dockerignore                                                  Task 12
docker-compose.yml, docker-compose.dev.yml, .env.example, .gitignore         Task 12
.github/workflows/ci.yml                                                     Task 14
README.md, CLAUDE.md, docs/architecture.md, docs/tech-debt-audit.md          Task 15
docs/devlog.md                                                               Task 16 (черновик на утверждение)
```

Задачи: 1 — каркас и проверка предположений (стоп-точка); 2 — конфиг и чистые функции; 3 — схема, миграция, PrismaService, тестовая БД, разбор ошибок БД; 4 — HTTP-основа; 5 — представление и спикеры; 6 — конференции; 7 — сессии; 8 — регистрации; 9 — число запросов, REL-1, перенос .NET-тестов; 10 — сид; 11 — Swagger; 12 — Docker и compose; 13 — эталон и сравнение; 14 — CI и удаление .NET; 15 — документация; 16 — финальная проверка.

---

### Task 1: Каркас `backend/` и проверка предположений (стоп-точка)

Проверяет предположения spec §14 №1, №3 и то, что Nest 12 (ESM-пакеты) работает из CommonJS-проекта на TS 6 в Jest и в рантайме. После задачи — доклад пользователю и ожидание «ок».

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/nest-cli.json`, `backend/eslint.config.mjs`, `backend/jest.config.js`, `backend/jest.int.config.js`, `backend/.gitignore`
- Create: `backend/src/main.ts`, `backend/src/app.module.ts` (временные, переписываются в Task 4)
- Test: `backend/src/common/di-metadata.spec.ts`

**Interfaces:**
- Produces: npm-скрипты `build`, `start`, `lint`, `typecheck`, `test`, `test:int`; закреплённый тег образа `NODE_IMAGE` (записывается в Task 12 в `Dockerfile`).

- [ ] **Step 1: Закрепить образ Node**

Run (Git Bash, тайм-аут 10 мин):
```bash
docker pull node:24-alpine
docker run --rm node:24-alpine sh -c 'node -v; cat /etc/alpine-release'
```
Expected: `v24.<x>.<y>` и `3.<n>.<m>`. Тег вида `node:24.<x>.<y>-alpine3.<n>` записать в доклад; выполнить `docker pull node:24.<x>.<y>-alpine3.<n>` и `docker image inspect --format '{{index .RepoDigests 0}}' node:24.<x>.<y>-alpine3.<n>` — digest тоже в доклад.

- [ ] **Step 2: Порт 80 под непривилегированным пользователем (spec §14 №1)**

Run:
```bash
docker run --rm --user node node:24.<x>.<y>-alpine3.<n> sh -c \
 'cat /proc/sys/net/ipv4/ip_unprivileged_port_start; node -e "require(\"http\").createServer((q,s)=>s.end(\"ok\")).listen(80,()=>{console.log(\"listening on 80 as uid\",process.getuid());process.exit(0)})"'
```
Expected: `0` и `listening on 80 as uid 1000`. Иначе — в доклад: порт 3000 и одна строка `frontend/nginx.conf` (spec 9.1), ждать решения пользователя.

- [ ] **Step 3: Создать конфигурацию проекта**

`backend/package.json`:
```json
{
  "name": "brown-events-api",
  "version": "1.0.0",
  "private": true,
  "license": "UNLICENSED",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "build": "nest build",
    "start": "node dist/src/main.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.config.js",
    "test:int": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.int.config.js --runInBand",
    "db:migrate": "prisma migrate deploy",
    "db:seed": "node dist/prisma/seed.js",
    "swagger:generate": "node dist/scripts/generate-swagger.js",
    "compare:reference": "node dist/scripts/compare-reference.js"
  }
}
```

`backend/tsconfig.json` (по шаблону Nest 12 `ts`):
```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "types": ["node", "jest"],
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "useDefineForClassFields": false
  },
  "include": ["src", "test", "prisma", "scripts", "prisma.config.ts"]
}
```
`useDefineForClassFields: false` — чтобы объявленные без значения поля DTO не появлялись в экземпляре как `undefined` и не мешали `forbidNonWhitelisted`/`IsPresent`.

`backend/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "incremental": false },
  "include": ["src", "prisma/seed.ts", "scripts"],
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts", "prisma.config.ts"]
}
```

`backend/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "sourceRoot": "src",
  "entryFile": "src/main",
  "compilerOptions": { "deleteOutDir": true, "tsConfigPath": "tsconfig.build.json" }
}
```

`backend/jest.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
};
```

`backend/jest.int.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  globalSetup: '<rootDir>/test/integration/setup/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
};
```

`backend/eslint.config.mjs`:
```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'coverage/**', 'eslint.config.mjs', 'jest.config.js', 'jest.int.config.js'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // ASYNC-1 Fix: a forgotten await or a fire-and-forget promise is the TS twin of .Result.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
```

`backend/.gitignore`:
```
node_modules/
dist/
coverage/
src/generated/
swagger.json
compare-reference-report.md
*.tsbuildinfo
.env
```

- [ ] **Step 4: Установить зависимости (список — Global Constraints)**

Run (тайм-аут 10 мин):
```bash
cd backend
npm install --save-exact @nestjs/common@12.1.2 @nestjs/core@12.1.2 @nestjs/platform-express@12.1.2 @nestjs/config@12.0.1 @nestjs/swagger@12.0.2 @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 class-validator@0.15.1 class-transformer@0.5.1 express@5.2.1 reflect-metadata@0.2.2 rxjs@7.8.2
npm install --save-dev --save-exact @nestjs/cli@12.0.8 @nestjs/testing@12.1.2 prisma@7.10.0 typescript@6.0.3 jest@30.5.2 ts-jest@29.4.14 supertest@7.3.1 eslint@10.12.0 @eslint/js@10.0.1 typescript-eslint@8.71.0 @types/node@24.19.1 @types/express@5.0.6 @types/jest@30.0.0 @types/supertest@7.2.1
npm ls --depth=0
```
Expected: без `ERESOLVE`, `npm ls` без `UNMET PEER` и `invalid`. Предупреждения о peer (`@fastify/static` у `@nestjs/swagger` и т. п.) — дословно в доклад; если npm поставил пакет, которого нет в списке, на верхний уровень `package.json` — остановиться и доложить.

- [ ] **Step 5: Тест метаданных декораторов — падает без кода**

`backend/src/common/di-metadata.spec.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

@Injectable()
class Dependency {
  value(): string {
    return 'resolved';
  }
}

@Injectable()
class Consumer {
  constructor(private readonly dependency: Dependency) {}
  read(): string {
    return this.dependency.value();
  }
}

describe('decorator metadata (TS 6 + Nest 12 ESM packages under Jest)', () => {
  it('injects a dependency by its constructor type', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [Dependency, Consumer] }).compile();
    expect(moduleRef.get(Consumer).read()).toBe('resolved');
  });
});
```
Run: `npm test`
Expected: PASS — если FAIL с `Nest can't resolve dependencies of the Consumer (?)`, `emitDecoratorMetadata` не работает; если FAIL на загрузке `@nestjs/*` (`Cannot use import statement outside a module`, `require() of ES Module`) — ESM под Jest не работает. В обоих случаях — стоп, доклад с полным выводом.

Run (без флага шаблона Nest): `npx jest --config jest.config.js`
Expected: если PASS — убрать `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` из скриптов `test`/`test:int` (заменить на `jest`), в логе CI не будет `ExperimentalWarning`; если FAIL с ESM-ошибкой — флаг оставить, а `ExperimentalWarning: VM Modules is an experimental feature` записать в доклад как ожидаемое предупреждение для проверки лога CI (CLAUDE.md).

- [ ] **Step 6: Временное приложение и сборка**

`backend/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```
`backend/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? 3999));
}
void bootstrap();
```
Run:
```bash
npx nest build && ls dist/src/main.js
PORT=3999 node dist/src/main.js & sleep 4; curl -s -i http://localhost:3999/x | head -1; kill %1
npm run lint && npm run typecheck
```
Expected: `dist/src/main.js` существует; `HTTP/1.1 404 Not Found`; lint и typecheck без ошибок. То же в контейнере Node 24:
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/app" -w /app node:24.<x>.<y>-alpine3.<n> sh -c 'node dist/src/main.js & sleep 4; wget -qO- -S http://127.0.0.1:3999/x 2>&1 | head -1; kill %1'
```
Expected: `HTTP/1.1 404 Not Found`.

- [ ] **Step 7: Справка Prisma CLI**

Run: `npx prisma --version && npx prisma migrate diff --help && npx prisma migrate deploy --help`
Expected: версии `prisma` и `@prisma/client` 7.10.0. Записать точные имена флагов `migrate diff` (источник «из миграций», цель «из схемы», shadow-БД, `--exit-code`) — Task 3, Step 9 использует их.

- [ ] **Step 8: Доклад и стоп**

Пользователю: тег и digest образа; результат порта 80; вывод `npm ls --depth=0` и предупреждения; результаты Steps 5–7. Ждать «ок».

- [ ] **Step 9: Commit (после «ок»)**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json backend/eslint.config.mjs backend/jest.config.js backend/jest.int.config.js backend/.gitignore backend/src
git status && git diff --cached --stat
git commit -m "build: scaffold NestJS backend next to .NET (EXT-150)"
```

---

### Task 2: Конфигурация и чистые функции

**Files:**
- Create: `backend/src/config/app-config.ts`, `backend/src/config/app-config.spec.ts`
- Create: `backend/src/common/clock.ts`, `dates.ts`, `dates.spec.ts`, `status.ts`, `status.spec.ts`, `email.ts`, `email.spec.ts`, `limits.ts`, `parse-id.pipe.ts`, `parse-id.pipe.spec.ts`

**Interfaces:**
- Produces:
  - `abstract class AppConfig { databaseUrl: string; port: number; corsOrigins: string[]; swaggerEnabled: boolean; logSql: boolean; logSqlParams: boolean; statementTimeoutMs: number }`, `loadConfig(env: Record<string, string | undefined>): AppConfig`
  - `abstract class Clock { now(): Date }`, `SystemClock`, `FixedClock(now: Date)` с `set(now: Date)`
  - `DAY_MS`, `parseWallClock(s: string): Date | null`, `requireWallClock(s: string): Date`, `formatWallClock(d: Date): string`, `formatInstant(d: Date): string`, `dayIndex(d: Date): number`, `isWithinDays(start, end, dayFrom, dayTo: Date): boolean`
  - `CONFERENCE_STATUSES`, `type ConferenceStatus`, `computeStatus(start, end: Date, cancelled: boolean, now: Date): ConferenceStatus`, `isRegistrationOpen(s: ConferenceStatus): boolean`, `resolveStatusInput(input: string | null | undefined, start, end, now: Date): { ok: true; cancelled: boolean } | { ok: false; message: string }`
  - `normalizeEmail(s: string): string`, `ASCII_PRINTABLE: RegExp`
  - `INT32_MAX`, `LIMITS`
  - `ParseIdPipe` (`PipeTransform<string, number>`), бросает `ApiError` 400 — класс `ApiError` создаётся здесь в `errors.ts` (минимальный, расширяется в Task 4 не меняя сигнатуры)

- [ ] **Step 1: Тесты конфигурации — падают**

`backend/src/config/app-config.spec.ts`:
```ts
import { loadConfig } from './app-config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      port: 80,
      corsOrigins: [],
      swaggerEnabled: false,
      logSql: false,
      logSqlParams: false,
      statementTimeoutMs: 5000,
    });
  });

  it('turns flags on only for the exact value "true"', () => {
    const on = loadConfig({ ...base, SWAGGER_ENABLED: 'true', LOG_SQL: 'true', LOG_SQL_PARAMS: 'true' });
    expect([on.swaggerEnabled, on.logSql, on.logSqlParams]).toEqual([true, true, true]);
    const off = loadConfig({ ...base, SWAGGER_ENABLED: 'TRUE', LOG_SQL: '1', LOG_SQL_PARAMS: 'yes' });
    expect([off.swaggerEnabled, off.logSql, off.logSqlParams]).toEqual([false, false, false]);
  });

  it('parses CORS origins', () => {
    const cfg = loadConfig({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://app.example.com' });
    expect(cfg.corsOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('lists every invalid variable in one error', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'mysql://x', PORT: '0', DB_STATEMENT_TIMEOUT_MS: 'soon', CORS_ORIGINS: 'localhost:5173' }),
    ).toThrow(/DATABASE_URL[\s\S]*PORT[\s\S]*DB_STATEMENT_TIMEOUT_MS[\s\S]*CORS_ORIGINS/);
  });
});
```
Run: `npm test -- app-config` → Expected: FAIL `Cannot find module './app-config'`.

- [ ] **Step 2: Реализация конфигурации**

`backend/src/config/app-config.ts`:
```ts
// Abstract class (not an interface) so that Nest can inject it by type.
export abstract class AppConfig {
  abstract readonly databaseUrl: string;
  abstract readonly port: number;
  abstract readonly corsOrigins: string[];
  abstract readonly swaggerEnabled: boolean;
  abstract readonly logSql: boolean;
  abstract readonly logSqlParams: boolean;
  abstract readonly statementTimeoutMs: number;
}

type Env = Record<string, string | undefined>;

function intVar(name: string, raw: string | undefined, fallback: number, min: number, max: number, errors: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

export function loadConfig(env: Env): AppConfig {
  const errors: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a postgresql:// connection string');
  const port = intVar('PORT', env.PORT, 80, 1, 65535, errors);
  const statementTimeoutMs = intVar('DB_STATEMENT_TIMEOUT_MS', env.DB_STATEMENT_TIMEOUT_MS, 5000, 1, 600000, errors);
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  for (const origin of corsOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) errors.push(`CORS_ORIGINS entry "${origin}" must be an origin such as http://localhost:5173`);
  }
  if (errors.length > 0) throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
  return {
    databaseUrl,
    port,
    corsOrigins,
    swaggerEnabled: env.SWAGGER_ENABLED === 'true',
    logSql: env.LOG_SQL === 'true',
    logSqlParams: env.LOG_SQL_PARAMS === 'true',
    statementTimeoutMs,
  };
}
```
Run: `npm test -- app-config` → Expected: PASS (4 tests).

- [ ] **Step 3: Тесты дат и статуса — падают**

`backend/src/common/dates.spec.ts`:
```ts
import { formatInstant, formatWallClock, isWithinDays, parseWallClock, requireWallClock } from './dates';

describe('wall-clock dates', () => {
  it.each(['2025-03-05T10:00:00', '2024-02-29T23:59:59', '2025-03-05T00:00:00'])('accepts %s and formats it back unchanged', (s) => {
    expect(formatWallClock(requireWallClock(s))).toBe(s);
  });

  it.each([
    '2025-03-05T10:00:00Z',
    '2025-03-05T10:00:00+02:00',
    '2025-03-05T10:00:00.000',
    '2025-03-05 10:00:00',
    '2025-03-05',
    '2025-02-30T10:00:00',
    '2025-02-29T10:00:00',
    '2025-13-01T00:00:00',
    '2025-03-05T24:00:00',
    '0099-01-01T00:00:00',
    '',
  ])('rejects %p', (s) => {
    expect(parseWallClock(s)).toBeNull();
  });

  it('does not depend on the machine time zone', () => {
    // The digits survive a round trip whatever TZ the process runs in (CI repeats this under three zones).
    const d = requireWallClock('2025-03-05T00:30:00');
    expect(d.toISOString()).toBe('2025-03-05T00:30:00.000Z');
    // A browser in Los Angeles reading the old "Z" form would see the previous day — the reason spec 5.5 keeps no offset.
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', dateStyle: 'short' }).format(new Date('2025-03-05T00:00:00Z'))).toBe('2025-03-04');
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bishkek', timeStyle: 'short' }).format(new Date('2025-03-05T10:00:00Z'))).toBe('16:00');
  });

  it('formats instants with Z and milliseconds', () => {
    expect(formatInstant(new Date(Date.UTC(2026, 9, 5, 4, 44, 13, 136)))).toBe('2026-10-05T04:44:13.136Z');
  });

  it('checks that a session stays within conference days, both ends inclusive', () => {
    const from = requireWallClock('2025-03-05T00:00:00');
    const to = requireWallClock('2025-03-06T00:00:00');
    expect(isWithinDays(requireWallClock('2025-03-05T09:00:00'), requireWallClock('2025-03-06T23:00:00'), from, to)).toBe(true);
    expect(isWithinDays(requireWallClock('2025-03-04T23:00:00'), requireWallClock('2025-03-05T10:00:00'), from, to)).toBe(false);
    expect(isWithinDays(requireWallClock('2025-03-06T23:00:00'), requireWallClock('2025-03-07T00:30:00'), from, to)).toBe(false);
  });
});
```

`backend/src/common/status.spec.ts`:
```ts
import { requireWallClock } from './dates';
import { computeStatus, isRegistrationOpen, resolveStatusInput } from './status';

const start = requireWallClock('2026-10-05T00:00:00');
const end = requireWallClock('2026-10-06T00:00:00'); // last day = 6 October
const at = (iso: string) => new Date(iso);

describe('computeStatus (spec 6.1)', () => {
  it.each([
    ['2026-10-04T23:59:59Z', 'UPCOMING'],
    ['2026-10-05T00:00:00Z', 'ACTIVE'],
    ['2026-10-06T23:59:59Z', 'ACTIVE'],
    ['2026-10-07T00:00:00Z', 'COMPLETED'],
  ])('at %s is %s', (now, expected) => {
    expect(computeStatus(start, end, false, at(now))).toBe(expected);
  });

  it('counts the start day from midnight even if startDate has a time', () => {
    expect(computeStatus(requireWallClock('2026-10-05T10:00:00'), end, false, at('2026-10-05T01:00:00Z'))).toBe('ACTIVE');
  });

  it('lets CANCELLED override dates', () => {
    expect(computeStatus(start, end, true, at('2026-10-05T12:00:00Z'))).toBe('CANCELLED');
  });

  it('opens registration only for UPCOMING and ACTIVE', () => {
    expect(['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => isRegistrationOpen(s as never))).toEqual([true, true, false, false]);
  });
});

describe('resolveStatusInput (spec 5.4)', () => {
  const now = at('2026-09-01T00:00:00Z'); // conference is UPCOMING
  it('treats null and missing as "not cancelled"', () => {
    expect(resolveStatusInput(null, start, end, now)).toEqual({ ok: true, cancelled: false });
    expect(resolveStatusInput(undefined, start, end, now)).toEqual({ ok: true, cancelled: false });
  });
  it('accepts CANCELLED', () => {
    expect(resolveStatusInput('CANCELLED', start, end, now)).toEqual({ ok: true, cancelled: true });
  });
  it('accepts a computed status only when it matches the dates', () => {
    expect(resolveStatusInput('UPCOMING', start, end, now)).toEqual({ ok: true, cancelled: false });
    expect(resolveStatusInput('ACTIVE', start, end, now)).toEqual({ ok: false, message: 'status is derived from dates; only CANCELLED can be set' });
  });
});
```
Run: `npm test -- dates status` → Expected: FAIL (modules not found).

- [ ] **Step 4: Реализация дат, статуса, часов**

`backend/src/common/dates.ts`:
```ts
export const DAY_MS = 86_400_000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

// Schedule values are venue wall-clock times without a zone (spec 5.5). They are kept in Date objects whose UTC
// fields hold the wall-clock digits, so parsing and formatting never depend on the server time zone.
export function parseWallClock(value: string): Date | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const sameDigits =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return sameDigits ? date : null;
}

export function requireWallClock(value: string): Date {
  const date = parseWallClock(value);
  if (!date) throw new Error(`Not a wall-clock date-time: ${value}`);
  return date;
}

export function formatWallClock(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export function formatInstant(date: Date): string {
  return date.toISOString();
}

export function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function isWithinDays(start: Date, end: Date, firstDay: Date, lastDay: Date): boolean {
  return dayIndex(start) >= dayIndex(firstDay) && dayIndex(end) <= dayIndex(lastDay);
}
```

`backend/src/common/status.ts`:
```ts
import { DAY_MS, dayIndex } from './dates';

export const CONFERENCE_STATUSES = ['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type ConferenceStatus = (typeof CONFERENCE_STATUSES)[number];
export const DERIVED_STATUS_MESSAGE = 'status is derived from dates; only CANCELLED can be set';

// ACTIVE from the start of startDate's day to the end of endDate's day (endDate holds midnight of the last day).
// "now" is UTC while the dates carry no zone, so at a day boundary the status can be off by up to ±14 h (spec 6.1).
export function computeStatus(start: Date, end: Date, cancelled: boolean, now: Date): ConferenceStatus {
  if (cancelled) return 'CANCELLED';
  const opens = dayIndex(start) * DAY_MS;
  const closes = (dayIndex(end) + 1) * DAY_MS;
  const t = now.getTime();
  if (t < opens) return 'UPCOMING';
  if (t < closes) return 'ACTIVE';
  return 'COMPLETED';
}

export function isRegistrationOpen(status: ConferenceStatus): boolean {
  return status === 'UPCOMING' || status === 'ACTIVE';
}

export type StatusInputResult = { ok: true; cancelled: boolean } | { ok: false; message: string };

export function resolveStatusInput(input: string | null | undefined, start: Date, end: Date, now: Date): StatusInputResult {
  if (input === null || input === undefined) return { ok: true, cancelled: false };
  if (input === 'CANCELLED') return { ok: true, cancelled: true };
  if (input === computeStatus(start, end, false, now)) return { ok: true, cancelled: false };
  return { ok: false, message: DERIVED_STATUS_MESSAGE };
}
```

`backend/src/common/clock.ts`:
```ts
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(now: Date): void {
    this.current = now;
  }
}
```
Run: `npm test -- dates status` → Expected: PASS.

- [ ] **Step 5: Тесты email и id — падают**

`backend/src/common/email.spec.ts`:
```ts
import { ASCII_PRINTABLE, normalizeEmail } from './email';

describe('email', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Maria.Kowalska@Example.COM ')).toBe('maria.kowalska@example.com');
  });
  it('recognises ASCII-only addresses', () => {
    expect(ASCII_PRINTABLE.test('maria@example.com')).toBe(true);
    expect(ASCII_PRINTABLE.test('иван@пример.рф')).toBe(false);
    expect(ASCII_PRINTABLE.test('josé@example.com')).toBe(false);
  });
});
```

`backend/src/common/parse-id.pipe.spec.ts`:
```ts
import { ApiError } from './errors';
import { ParseIdPipe } from './parse-id.pipe';

describe('ParseIdPipe (spec 5.4)', () => {
  const pipe = new ParseIdPipe();
  it.each(['1', '42', '2147483647'])('accepts %s', (raw) => {
    expect(pipe.transform(raw)).toBe(Number(raw));
  });
  it.each(['abc', '0', '-1', '007', '+5', ' 5', '5 ', '1e3', '1.0', '2147483648', '99999999999', ''])('rejects %p with 400', (raw) => {
    try {
      pipe.transform(raw);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).errors).toEqual([{ field: 'id', messages: ['id must be an integer between 1 and 2147483647'] }]);
    }
  });
});
```
Run: `npm test -- email parse-id` → Expected: FAIL.

- [ ] **Step 6: Реализация email, лимитов, ошибок, пайпа**

`backend/src/common/email.ts`:
```ts
export const ASCII_PRINTABLE = /^[\x21-\x7E]+$/;

// trim + lower-case on write and lookup (CORR-3). Only ASCII addresses are accepted (spec 6.4), so JS toLowerCase()
// and Postgres lower() in the CHECK constraint agree.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
```

`backend/src/common/limits.ts` — **единая таблица «поле → лимит» (spec 7.2)**:
```ts
export const INT32_MAX = 2_147_483_647;

// One table for the database (prisma/schema.prisma @db.VarChar(n)) and the DTOs (@MaxLength(n)).
// test/integration/schema.e2e-spec.ts checks that the columns match it.
export const LIMITS = {
  conferences: { Title: 200, Description: 4000, Location: 200, Venue: 200, OrganizerName: 200, Website: 2048, Status: 20 },
  sessions: { Title: 200, Description: 4000 },
  speakers: { FirstName: 100, LastName: 100, Bio: 4000, Email: 254 },
  rooms: { Name: 100, Location: 200 },
  attendees: { FirstName: 100, LastName: 100, Email: 254 },
  registrations: { Status: 20 },
  // Accepted from the registration forms but not stored (spec 5.4): limits exist only in the DTO.
  registerForm: { phone: 50, company: 200, dietaryRequirements: 1000 },
} as const;
```

| Колонка | Лимит | Колонка | Лимит |
|---|---|---|---|
| `conferences.Title` | 200 | `speakers.FirstName` / `LastName` | 100 / 100 |
| `conferences.Description` | 4000 | `speakers.Bio` | 4000 |
| `conferences.Location` / `Venue` / `OrganizerName` | 200 | `speakers.Email` | 254 |
| `conferences.Website` | 2048 | `rooms.Name` / `Location` | 100 / 200 |
| `conferences.Status` | 20 | `attendees.FirstName` / `LastName` / `Email` | 100 / 100 / 254 |
| `sessions.Title` / `Description` | 200 / 4000 | `registrations.Status` | 20 |
| форма регистрации (не хранится): `phone` / `company` / `dietaryRequirements` | 50 / 200 / 1000 | | |

`backend/src/common/errors.ts`:
```ts
export interface FieldError {
  field: string;
  messages: string[];
}

// Thrown by services and pipes; AllExceptionsFilter (Task 4) turns it into the error body of spec 5.6.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, errors?: FieldError[]) => new ApiError(400, message, errors);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);
export const unprocessable = (message: string, errors?: FieldError[]) => new ApiError(422, message, errors);
export const serviceUnavailable = (message: string) => new ApiError(503, message, undefined, { 'Retry-After': '1' });
```

`backend/src/common/parse-id.pipe.ts`:
```ts
import { Injectable, PipeTransform } from '@nestjs/common';
import { badRequest } from './errors';
import { INT32_MAX } from './limits';

const ID = /^[1-9][0-9]{0,9}$/;

@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = ID.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(id) || id > INT32_MAX) {
      throw badRequest('Invalid id', [{ field: 'id', messages: [`id must be an integer between 1 and ${INT32_MAX}`] }]);
    }
    return id;
  }
}
```
Run: `npm test` → Expected: PASS (все unit-тесты). `npm run lint && npm run typecheck` → без ошибок.

- [ ] **Step 7: Commit (после «ок»)**

```bash
git add backend/src/config backend/src/common
git status && git diff --cached --stat
git commit -m "feat: add config loading, wall-clock dates, derived status and id parsing (EXT-150)"
```

---

### Task 3: Схема, миграция, PrismaService, тестовая БД, разбор ошибок БД

Проверяет spec §14 №2, №7, №9, №10, №14.

**Files:**
- Create: `backend/prisma.config.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/migration_lock.toml`, `backend/prisma/migrations/20261005000000_init/migration.sql`
- Create: `backend/src/prisma/prisma.service.ts`, `backend/src/prisma/prisma.module.ts`, `backend/src/common/db-error.ts`, `backend/src/common/locking.ts`, `backend/src/common/request-context.ts`
- Create: `backend/scripts/test-db.sh`, `backend/test/integration/setup/test-db-url.ts`, `backend/test/integration/setup/global-setup.ts`, `backend/test/integration/helpers.ts`, `backend/test/integration/fixtures.ts`
- Test: `backend/test/integration/schema.e2e-spec.ts`, `backend/test/integration/db-errors.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppConfig`, `loadConfig` (Task 2); `LIMITS`, `requireWallClock`.
- Produces:
  - `PrismaService extends PrismaClient` — `onQuery(listener: (e: { query: string; params: string; duration: number }) => void): () => void`
  - `PrismaModule` (global, exports `PrismaService`)
  - `type Tx = Prisma.TransactionClient`; `lockConference(tx: Tx, id: number): Promise<LockedConference | null>`, `LockedConference = { id: number; startDate: Date; endDate: Date; status: string | null; maxAttendees: number | null }`
  - `inspectDbError(err: unknown): DbErrorInfo | null` (`{ prismaCode: string; pgCode?: string; constraint?: string }`), `mapDbError(err: unknown): ErrorSpec | null` — `ErrorSpec` объявляется здесь в `db-error.ts` и реэкспортируется из `write-error.ts` в Task 4
  - `requestContext: AsyncLocalStorage<{ requestId: string }>`
  - тест-хелперы: `testDatabaseUrl()`, `newPrisma(env?)`, `resetDb(prisma)`, фабрики `makeConference`, `makeSpeaker`, `makeRoom`, `makeSession`, `makeAttendee`, `makeRegistration`
  - импорт клиента: `../generated/prisma/client` (из `src/*/`), `../src/generated/prisma/client` (из `prisma/`) — проверяется в Step 4

- [ ] **Step 1: Конфиг Prisma и схема**

`backend/prisma.config.ts`:
```ts
import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node dist/prisma/seed.js' },
  // No datasource without DATABASE_URL, so that `prisma generate` runs in the Docker build stage.
  ...(url ? { datasource: { url, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } } : {}),
});
```

`backend/prisma/schema.prisma` (имена таблиц и колонок — как создавал EF, spec 7.1; лимиты — таблица Task 2):
```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}

model Conference {
  id            Int            @id(map: "PK_conferences") @default(autoincrement()) @map("Id")
  title         String         @map("Title") @db.VarChar(200)
  description   String?        @map("Description") @db.VarChar(4000)
  location      String?        @map("Location") @db.VarChar(200)
  venue         String?        @map("Venue") @db.VarChar(200)
  startDate     DateTime       @map("StartDate") @db.Timestamp(0)
  endDate       DateTime       @map("EndDate") @db.Timestamp(0)
  status        String?        @map("Status") @db.VarChar(20)
  maxAttendees  Int?           @map("MaxAttendees")
  organizerName String?        @map("OrganizerName") @db.VarChar(200)
  website       String?        @map("Website") @db.VarChar(2048)
  sessions      Session[]
  registrations Registration[]

  @@map("conferences")
}

model Session {
  id           Int        @id(map: "PK_sessions") @default(autoincrement()) @map("Id")
  title        String     @map("Title") @db.VarChar(200)
  description  String?    @map("Description") @db.VarChar(4000)
  startTime    DateTime   @map("StartTime") @db.Timestamp(0)
  endTime      DateTime   @map("EndTime") @db.Timestamp(0)
  capacity     Int        @map("Capacity")
  conferenceId Int        @map("ConferenceId")
  speakerId    Int?       @map("SpeakerId")
  roomId       Int?       @map("RoomId")
  conference   Conference @relation(fields: [conferenceId], references: [id], onDelete: Restrict, map: "FK_sessions_conferences_ConferenceId")
  speaker      Speaker?   @relation(fields: [speakerId], references: [id], onDelete: Restrict, map: "FK_sessions_speakers_SpeakerId")
  room         Room?      @relation(fields: [roomId], references: [id], onDelete: Restrict, map: "FK_sessions_rooms_RoomId")

  @@index([conferenceId], map: "IX_sessions_ConferenceId")
  @@index([speakerId], map: "IX_sessions_SpeakerId")
  @@index([roomId], map: "IX_sessions_RoomId")
  @@map("sessions")
}

model Speaker {
  id          Int       @id(map: "PK_speakers") @default(autoincrement()) @map("Id")
  firstName   String    @map("FirstName") @db.VarChar(100)
  lastName    String    @map("LastName") @db.VarChar(100)
  bio         String?   @map("Bio") @db.VarChar(4000)
  email       String?   @map("Email") @db.VarChar(254)
  emailPublic Boolean   @default(false) @map("EmailPublic")
  sessions    Session[]

  @@map("speakers")
}

model Room {
  id       Int       @id(map: "PK_rooms") @default(autoincrement()) @map("Id")
  name     String    @map("Name") @db.VarChar(100)
  capacity Int       @map("Capacity")
  location String?   @map("Location") @db.VarChar(200)
  sessions Session[]

  @@map("rooms")
}

model Attendee {
  id            Int            @id(map: "PK_attendees") @default(autoincrement()) @map("Id")
  firstName     String         @map("FirstName") @db.VarChar(100)
  lastName      String         @map("LastName") @db.VarChar(100)
  email         String         @unique(map: "UQ_attendees_Email") @map("Email") @db.VarChar(254)
  registrations Registration[]

  @@map("attendees")
}

model Registration {
  id           Int        @id(map: "PK_registrations") @default(autoincrement()) @map("Id")
  registeredAt DateTime   @map("RegisteredAt") @db.Timestamptz(3)
  status       String     @default("CONFIRMED") @map("Status") @db.VarChar(20)
  conferenceId Int        @map("ConferenceId")
  attendeeId   Int        @map("AttendeeId")
  conference   Conference @relation(fields: [conferenceId], references: [id], onDelete: Restrict, map: "FK_registrations_conferences_ConferenceId")
  attendee     Attendee   @relation(fields: [attendeeId], references: [id], onDelete: Restrict, map: "FK_registrations_attendees_AttendeeId")

  @@unique([conferenceId, attendeeId], map: "UQ_registrations_ConferenceId_AttendeeId")
  @@index([attendeeId], map: "IX_registrations_AttendeeId")
  @@map("registrations")
}
```

- [ ] **Step 2: Начальная миграция (ручной SQL)**

`backend/prisma/migrations/migration_lock.toml`:
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

`backend/prisma/migrations/20261005000000_init/migration.sql`:
```sql
-- Initial schema for EXT-150 (spec 7.2). Written by hand: identity columns and CHECK constraints
-- cannot be expressed in schema.prisma. Table and column names are the ones EF created (spec 7.1).

CREATE TABLE "conferences" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Title" VARCHAR(200) NOT NULL,
    "Description" VARCHAR(4000),
    "Location" VARCHAR(200),
    "Venue" VARCHAR(200),
    "StartDate" TIMESTAMP(0) NOT NULL,
    "EndDate" TIMESTAMP(0) NOT NULL,
    "Status" VARCHAR(20),
    "MaxAttendees" INTEGER,
    "OrganizerName" VARCHAR(200),
    "Website" VARCHAR(2048),
    CONSTRAINT "PK_conferences" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_conferences_Dates" CHECK ("EndDate" >= "StartDate"),
    CONSTRAINT "CK_conferences_Status" CHECK ("Status" = 'CANCELLED'),
    CONSTRAINT "CK_conferences_MaxAttendees" CHECK ("MaxAttendees" >= 1)
);

CREATE TABLE "speakers" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "FirstName" VARCHAR(100) NOT NULL,
    "LastName" VARCHAR(100) NOT NULL,
    "Bio" VARCHAR(4000),
    "Email" VARCHAR(254),
    "EmailPublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PK_speakers" PRIMARY KEY ("Id")
);

CREATE TABLE "rooms" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Name" VARCHAR(100) NOT NULL,
    "Capacity" INTEGER NOT NULL,
    "Location" VARCHAR(200),
    CONSTRAINT "PK_rooms" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_rooms_Capacity" CHECK ("Capacity" >= 1)
);

CREATE TABLE "sessions" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Title" VARCHAR(200) NOT NULL,
    "Description" VARCHAR(4000),
    "StartTime" TIMESTAMP(0) NOT NULL,
    "EndTime" TIMESTAMP(0) NOT NULL,
    "Capacity" INTEGER NOT NULL,
    "ConferenceId" INTEGER NOT NULL,
    "SpeakerId" INTEGER,
    "RoomId" INTEGER,
    CONSTRAINT "PK_sessions" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_sessions_Times" CHECK ("EndTime" > "StartTime"),
    CONSTRAINT "CK_sessions_Capacity" CHECK ("Capacity" >= 1)
);

CREATE TABLE "attendees" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "FirstName" VARCHAR(100) NOT NULL,
    "LastName" VARCHAR(100) NOT NULL,
    "Email" VARCHAR(254) NOT NULL,
    CONSTRAINT "PK_attendees" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_attendees_Email" CHECK ("Email" = lower(btrim("Email")))
);

CREATE TABLE "registrations" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "RegisteredAt" TIMESTAMPTZ(3) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    "ConferenceId" INTEGER NOT NULL,
    "AttendeeId" INTEGER NOT NULL,
    CONSTRAINT "PK_registrations" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_registrations_Status" CHECK ("Status" IN ('CONFIRMED'))
);

CREATE INDEX "IX_sessions_ConferenceId" ON "sessions"("ConferenceId");
CREATE INDEX "IX_sessions_SpeakerId" ON "sessions"("SpeakerId");
CREATE INDEX "IX_sessions_RoomId" ON "sessions"("RoomId");
CREATE UNIQUE INDEX "UQ_attendees_Email" ON "attendees"("Email");
CREATE INDEX "IX_registrations_AttendeeId" ON "registrations"("AttendeeId");
CREATE UNIQUE INDEX "UQ_registrations_ConferenceId_AttendeeId" ON "registrations"("ConferenceId", "AttendeeId");

ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_conferences_ConferenceId" FOREIGN KEY ("ConferenceId") REFERENCES "conferences"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_speakers_SpeakerId" FOREIGN KEY ("SpeakerId") REFERENCES "speakers"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_rooms_RoomId" FOREIGN KEY ("RoomId") REFERENCES "rooms"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "FK_registrations_conferences_ConferenceId" FOREIGN KEY ("ConferenceId") REFERENCES "conferences"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "FK_registrations_attendees_AttendeeId" FOREIGN KEY ("AttendeeId") REFERENCES "attendees"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Тестовая БД**

`backend/scripts/test-db.sh`:
```bash
#!/usr/bin/env bash
# One-off Postgres for integration tests (CLAUDE.md): own network, no volume, 127.0.0.1 only.
set -euo pipefail
export MSYS_NO_PATHCONV=1
NET=ext150-test-net
PG=ext150-test-pg
PORT=${TEST_DB_PORT:-55432}

case "${1:-}" in
  up)
    docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
    docker rm -f -v "$PG" >/dev/null 2>&1 || true
    docker run -d --name "$PG" --network "$NET" -p "127.0.0.1:$PORT:5432" \
      -e POSTGRES_DB=brownevents_test -e POSTGRES_USER=brown -e POSTGRES_PASSWORD=brown123 postgres:14 >/dev/null
    # -h 127.0.0.1: the temporary server started by initdb listens on the socket only, so TCP readiness means the real one.
    for _ in $(seq 1 60); do
      if docker exec "$PG" pg_isready -h 127.0.0.1 -U brown -d brownevents_test >/dev/null 2>&1; then
        echo "test db ready on 127.0.0.1:$PORT"
        exit 0
      fi
      sleep 1
    done
    echo "test db did not become ready in 60 s" >&2
    exit 1
    ;;
  down)
    docker rm -f -v "$PG" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    ;;
  psql)
    shift
    docker exec -i "$PG" psql -U brown -d brownevents_test "$@"
    ;;
  *)
    echo "usage: $0 up|down|psql [psql args]" >&2
    exit 2
    ;;
esac
```
Run: `bash scripts/test-db.sh up` → Expected: `test db ready on 127.0.0.1:55432`.

`backend/test/integration/setup/test-db-url.ts`:
```ts
export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgresql://brown:brown123@127.0.0.1:55432/brownevents_test';
}
```

`backend/test/integration/setup/global-setup.ts`:
```ts
import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-db-url';

export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testDatabaseUrl() } });
}
```

- [ ] **Step 4: Сгенерировать клиент и проверить путь импорта**

Run: `npx prisma generate && ls src/generated/prisma`
Expected: в каталоге есть `client.ts` (импорт `../generated/prisma/client`). Если файлов нет или точка входа другая — стоп, доклад; пути импорта во всех задачах заменить на фактический одной правкой.

Run: `DATABASE_URL=postgresql://brown:brown123@127.0.0.1:55432/brownevents_test npx prisma migrate deploy`
Expected: `1 migration applied` (`20261005000000_init`).

- [ ] **Step 5: Контекст запроса, PrismaService, блокировка**

`backend/src/common/request-context.ts` (middleware добавляется в Task 4):
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

`backend/src/prisma/prisma.service.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config';
import { requestContext } from '../common/request-context';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type QueryListener = (event: Prisma.QueryEvent) => void;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly listeners = new Set<QueryListener>();
  private readonly logger = new Logger('SQL');

  constructor(config: AppConfig) {
    // statement_timeout applies to every query of the application pool (ASYNC-5 Fix); migrate and seed use their own connections.
    const adapter = new PrismaPg({ connectionString: config.databaseUrl, statement_timeout: config.statementTimeoutMs });
    super({
      adapter,
      // Defaults of Prisma 7.10 (runtime/client.js: maxWait 2e3, timeout 5e3), stated explicitly (spec 8).
      transactionOptions: { maxWait: 2000, timeout: 5000 },
      log: [{ emit: 'event', level: 'query' }],
    });
    // Query events always flow: tests count them (DoD-11); the log gets them only with LOG_SQL=true (CFG-2).
    const on = this.$on.bind(this) as (event: 'query', callback: QueryListener) => void;
    on('query', (event) => {
      for (const listener of this.listeners) listener(event);
      if (config.logSql) {
        this.logger.log({
          requestId: requestContext.getStore()?.requestId,
          query: event.query,
          durationMs: event.duration,
          ...(config.logSqlParams ? { params: event.params } : {}),
        });
      }
    });
  }

  onQuery(listener: QueryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`backend/src/prisma/prisma.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`backend/src/common/locking.ts`:
```ts
import { Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface LockedConference {
  id: number;
  startDate: Date;
  endDate: Date;
  status: string | null;
  maxAttendees: number | null;
}

// Every write that depends on a conference's dates or seats locks its row first (spec 6.2, 6.3), so concurrent
// registrations, session writes and conference updates of the same conference run one after another.
// lock_timeout ends the wait before the transaction timeout; the wait surfaces as 55P03 -> 503 (spec 8).
export async function lockConference(tx: Tx, id: number): Promise<LockedConference | null> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
  const rows = await tx.$queryRaw<LockedConference[]>`
    SELECT "Id" AS "id", "StartDate" AS "startDate", "EndDate" AS "endDate", "Status" AS "status", "MaxAttendees" AS "maxAttendees"
    FROM "conferences" WHERE "Id" = ${id} FOR UPDATE`;
  return rows[0] ?? null;
}
```

- [ ] **Step 6: Разбор ошибок БД**

`backend/src/common/db-error.ts`:
```ts
import { Prisma } from '../generated/prisma/client';
import type { FieldError } from './errors';

export interface ErrorSpec {
  status: number;
  message: string;
  errors?: FieldError[];
  headers?: Record<string, string>;
  /** Logged, never sent to the client. */
  detail?: string;
}

export interface DbErrorInfo {
  prismaCode: string;
  pgCode?: string;
  constraint?: string;
}

const FK_FIELDS: Record<string, string> = {
  FK_sessions_speakers_SpeakerId: 'speakerId',
  FK_sessions_rooms_RoomId: 'roomId',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === 'string' && v !== '');
}

// The candidate fields are the ones the probes in test/integration/db-errors.e2e-spec.ts observed for Prisma 7.10 + adapter-pg.
export function inspectDbError(error: unknown): DbErrorInfo | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = record(error.meta);
  const cause = record(record(meta.driverAdapterError).cause);
  return {
    prismaCode: error.code,
    pgCode: firstString(meta.code, cause.originalCode, cause.code),
    constraint: firstString(meta.constraint, record(cause.constraint).index, cause.constraint, meta.field_name, meta.target),
  };
}

const busy = (): ErrorSpec => ({ status: 503, message: 'The database is busy, retry the request', headers: { 'Retry-After': '1' } });

export function mapDbError(error: unknown): ErrorSpec | null {
  const info = inspectDbError(error);
  if (!info) return null;
  const { prismaCode, pgCode, constraint } = info;
  if (prismaCode === 'P2028' || pgCode === '55P03' || pgCode === '57014') return busy();
  if (prismaCode === 'P1001' || prismaCode === 'P1017') return { status: 503, message: 'The database is unavailable', headers: { 'Retry-After': '1' } };
  if (pgCode === '23514') return { status: 400, message: 'The request violates a data constraint', detail: constraint };
  if (pgCode === '22003') return { status: 400, message: 'A number in the request is out of range' };
  if (prismaCode === 'P2003' || pgCode === '23503') {
    const field = constraint ? FK_FIELDS[constraint] : undefined;
    if (!field) return null;
    return { status: 422, message: 'Referenced record does not exist', errors: [{ field, messages: [`${field} does not reference an existing record`] }] };
  }
  if (prismaCode === 'P2002' || pgCode === '23505') return { status: 409, message: 'The request conflicts with an existing record', detail: constraint };
  if (prismaCode === 'P2025') return { status: 404, message: 'Resource not found' };
  return null;
}
```

- [ ] **Step 7: Хелперы и фабрики тестов**

`backend/test/integration/helpers.ts` (в Task 4 сюда добавляется `createTestApp`):
```ts
import { loadConfig } from '../../src/config/app-config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testDatabaseUrl } from './setup/test-db-url';

export { testDatabaseUrl };

export function newPrisma(env: Record<string, string> = {}): PrismaService {
  return new PrismaService(loadConfig({ DATABASE_URL: testDatabaseUrl(), ...env }));
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "registrations", "attendees", "sessions", "speakers", "rooms", "conferences" RESTART IDENTITY CASCADE`;
}
```

`backend/test/integration/fixtures.ts`:
```ts
import { requireWallClock } from '../../src/common/dates';
import type { PrismaService } from '../../src/prisma/prisma.service';

export const wall = requireWallClock;

export function makeConference(
  prisma: PrismaService,
  o: { title?: string; startDate?: string; endDate?: string; status?: string | null; maxAttendees?: number | null } = {},
) {
  return prisma.conference.create({
    data: {
      title: o.title ?? 'Test Conference',
      startDate: wall(o.startDate ?? '2027-01-10T00:00:00'),
      endDate: wall(o.endDate ?? '2027-01-11T00:00:00'),
      status: o.status ?? null,
      maxAttendees: o.maxAttendees ?? null,
    },
  });
}

export function makeSpeaker(prisma: PrismaService, o: { firstName?: string; email?: string | null; emailPublic?: boolean } = {}) {
  return prisma.speaker.create({
    data: { firstName: o.firstName ?? 'Alice', lastName: 'Novak', bio: 'Bio', email: o.email ?? 'alice.novak@example.com', emailPublic: o.emailPublic ?? false },
  });
}

export function makeRoom(prisma: PrismaService, o: { name?: string; capacity?: number } = {}) {
  return prisma.room.create({ data: { name: o.name ?? 'Hall A', capacity: o.capacity ?? 300, location: 'Ground Floor' } });
}

export function makeSession(
  prisma: PrismaService,
  conferenceId: number,
  o: { title?: string; startTime?: string; endTime?: string; capacity?: number; speakerId?: number | null; roomId?: number | null } = {},
) {
  return prisma.session.create({
    data: {
      title: o.title ?? 'Talk',
      startTime: wall(o.startTime ?? '2027-01-10T10:00:00'),
      endTime: wall(o.endTime ?? '2027-01-10T11:00:00'),
      capacity: o.capacity ?? 50,
      conferenceId,
      speakerId: o.speakerId ?? null,
      roomId: o.roomId ?? null,
    },
  });
}

export function makeAttendee(prisma: PrismaService, o: { firstName?: string; email?: string } = {}) {
  return prisma.attendee.create({ data: { firstName: o.firstName ?? 'Maria', lastName: 'Kowalska', email: o.email ?? 'maria.kowalska@example.com' } });
}

export function makeRegistration(prisma: PrismaService, conferenceId: number, attendeeId: number) {
  return prisma.registration.create({ data: { conferenceId, attendeeId, registeredAt: new Date('2026-10-01T09:00:00.000Z') } });
}
```

- [ ] **Step 8: Тесты схемы — падают до миграции/с неверной схемой**

`backend/test/integration/schema.e2e-spec.ts`:
```ts
import { execSync } from 'node:child_process';
import { LIMITS } from '../../src/common/limits';
import { newPrisma, testDatabaseUrl } from './helpers';

const prisma = newPrisma();
afterAll(() => prisma.$disconnect());

function urlFor(database: string): string {
  return testDatabaseUrl().replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

describe('database schema (spec 7.2)', () => {
  it('limits every string column exactly as LIMITS says', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string; max: number | null }[]>`
      SELECT table_name, column_name, character_maximum_length AS max
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('character varying', 'text') AND table_name <> '_prisma_migrations'`;
    const actual = Object.fromEntries(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.max]));
    const expected = Object.fromEntries(
      Object.entries(LIMITS)
        .filter(([table]) => table !== 'registerForm')
        .flatMap(([table, columns]) => Object.entries(columns).map(([column, max]) => [`${table}.${column}`, max])),
    );
    expect(actual).toEqual(expected);
  });

  it('uses GENERATED ALWAYS identity keys', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; identity_generation: string }[]>`
      SELECT table_name, identity_generation FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'Id' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    expect(rows).toEqual(
      ['attendees', 'conferences', 'registrations', 'rooms', 'sessions', 'speakers'].map((t) => ({ table_name: t, identity_generation: 'ALWAYS' })),
    );
  });

  it('has the CHECK, UNIQUE and FK constraints and FK indexes by name', async () => {
    const constraints = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' ORDER BY conname`;
    expect(constraints.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'CK_conferences_Dates', 'CK_conferences_Status', 'CK_conferences_MaxAttendees', 'CK_rooms_Capacity',
        'CK_sessions_Times', 'CK_sessions_Capacity', 'CK_attendees_Email', 'CK_registrations_Status',
        'FK_sessions_conferences_ConferenceId', 'FK_sessions_speakers_SpeakerId', 'FK_sessions_rooms_RoomId',
        'FK_registrations_conferences_ConferenceId', 'FK_registrations_attendees_AttendeeId',
      ]),
    );
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'IX_sessions_ConferenceId', 'IX_sessions_SpeakerId', 'IX_sessions_RoomId', 'IX_registrations_AttendeeId',
        'UQ_attendees_Email', 'UQ_registrations_ConferenceId_AttendeeId',
      ]),
    );
  });

  it('runs on a collation where lower() agrees with JS for ASCII (spec 6.4)', async () => {
    const [row] = await prisma.$queryRaw<{ lc_collate: string }[]>`SHOW lc_collate`;
    expect(row.lc_collate).not.toMatch(/^tr|^az/i);
    const [lowered] = await prisma.$queryRaw<{ v: string }[]>`SELECT lower('MARIA.KOWALSKA@EXAMPLE.COM') AS v`;
    expect(lowered.v).toBe('MARIA.KOWALSKA@EXAMPLE.COM'.toLowerCase());
  });

  it('has no drift between migrations and schema.prisma (spec 7.3)', async () => {
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_shadow');
    await prisma.$executeRawUnsafe('CREATE DATABASE ext150_shadow');
    // Flag names as printed by `npx prisma migrate diff --help` in Task 1, Step 7.
    execSync('npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(), SHADOW_DATABASE_URL: urlFor('ext150_shadow') },
    });
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_shadow');
  });

  it('refuses to migrate a non-empty database without migration history (P3005)', async () => {
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_p3005');
    await prisma.$executeRawUnsafe('CREATE DATABASE ext150_p3005');
    const probe = newPrisma({ DATABASE_URL: urlFor('ext150_p3005') });
    await probe.$executeRawUnsafe('CREATE TABLE "conferences" ("Id" integer primary key)');
    await probe.$disconnect();
    let output = '';
    try {
      execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: urlFor('ext150_p3005') }, stdio: 'pipe' });
    } catch (error) {
      const e = error as { stdout?: Buffer; stderr?: Buffer };
      output = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    }
    expect(output).toContain('P3005');
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_p3005');
  });
});
```
`$executeRawUnsafe` здесь — только постоянные строки без пользовательского ввода (DDL не параметризуется).

Run: `npm run test:int -- schema` → Expected: PASS. Если тест дрейфа падает из-за `GENERATED ALWAYS` (Prisma видит отличие от `SERIAL`) — стоп, доклад: варианты (принять дрейф с пояснением или `BY DEFAULT`) решает пользователь. Если падают имена флагов `migrate diff` — подставить имена из Task 1, Step 7.

- [ ] **Step 9: Пробы ошибок БД — падают, пока разбор не совпал с фактом**

`backend/test/integration/db-errors.e2e-spec.ts`:
```ts
import { inspectDbError, mapDbError } from '../../src/common/db-error';
import { lockConference } from '../../src/common/locking';
import { makeAttendee, makeConference, wall } from './fixtures';
import { newPrisma, resetDb } from './helpers';

const prisma = newPrisma({ DB_STATEMENT_TIMEOUT_MS: '500' });
beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to reject the operation');
}

function shape(error: unknown): string {
  return JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2);
}

describe('database error probes (spec §14 №7, №14)', () => {
  it('unique violation -> 23505 with the index name -> 409', async () => {
    await makeAttendee(prisma);
    const error = await caught(() => makeAttendee(prisma));
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '23505', constraint: 'UQ_attendees_Email' } });
    expect(mapDbError(error)?.status).toBe(409);
  });

  it('FK violation -> constraint name -> 422 on the right field', async () => {
    const conference = await makeConference(prisma);
    const error = await caught(() =>
      prisma.session.create({
        data: { title: 'x', startTime: wall('2027-01-10T10:00:00'), endTime: wall('2027-01-10T11:00:00'), capacity: 1, conferenceId: conference.id, speakerId: 999 },
      }),
    );
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { constraint: 'FK_sessions_speakers_SpeakerId' } });
    expect(mapDbError(error)).toMatchObject({ status: 422, errors: [{ field: 'speakerId' }] });
  });

  it('CHECK violation -> 23514 -> 400', async () => {
    const error = await caught(() => prisma.$executeRaw`INSERT INTO "attendees" ("FirstName", "LastName", "Email") VALUES ('A', 'B', 'UPPER@EXAMPLE.COM')`);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '23514' } });
    expect(mapDbError(error)?.status).toBe(400);
  });

  it('statement_timeout reaches the pool -> 57014 -> 503', async () => {
    const error = await caught(() => prisma.$queryRaw`SELECT pg_sleep(2)`);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '57014' } });
    expect(mapDbError(error)).toMatchObject({ status: 503, headers: { 'Retry-After': '1' } });
  });

  it('a held conference lock -> 55P03 after lock_timeout -> 503', async () => {
    const conference = await makeConference(prisma);
    // Both sides use the default 5 s statement_timeout: the 500 ms one of `prisma` would fire before lock_timeout (2 s).
    const holder = newPrisma();
    const waiter = newPrisma();
    let release: () => void = () => undefined;
    const held = holder.$transaction(
      async (tx) => {
        await lockConference(tx, conference.id);
        await new Promise<void>((resolve) => (release = resolve));
      },
      { timeout: 15000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    const error = await caught(() => waiter.$transaction((tx) => lockConference(tx, conference.id)));
    release();
    await held;
    await holder.$disconnect();
    await waiter.$disconnect();
    expect(Date.now() - started).toBeLessThan(4500);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '55P03' } });
    expect(mapDbError(error)?.status).toBe(503);
  });

  it('interactive transaction timeout -> P2028 -> 503', async () => {
    const error = await caught(() =>
      prisma.$transaction(
        async (tx) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          await tx.conference.count();
        },
        { timeout: 100 },
      ),
    );
    expect(inspectDbError(error)?.prismaCode).toBe('P2028');
    expect(mapDbError(error)?.status).toBe(503);
  });
});
```
Run: `npm run test:int -- db-errors`
Expected: PASS. Если `toMatchObject` падает, в выводе Jest есть поле `shape` — фактическая структура ошибки. Найти в ней код Postgres / имя ограничения и добавить этот путь первым аргументом в `firstString(...)` в `inspectDbError`; других изменений не делать. Повторить. Если `$queryRaw` даёт не `PrismaClientKnownRequestError` (например, `PrismaClientUnknownRequestError`), — стоп, доклад с `shape`.

- [ ] **Step 10: Lint, typecheck, остановка БД**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int && bash scripts/test-db.sh down`
Expected: всё зелёное.

- [ ] **Step 11: Commit (после «ок»)**

```bash
git add backend/prisma.config.ts backend/prisma backend/src backend/scripts/test-db.sh backend/test
git status && git diff --cached --stat
git commit -m "feat: add Prisma schema, initial migration and database error mapping (EXT-150)"
```

---

### Task 4: HTTP-основа — requestId, CORS, 405, 415, разбор JSON, ошибки, валидация, health

**Files:**
- Create: `backend/src/common/write-error.ts`, `backend/src/common/http-middleware.ts`, `backend/src/common/validation.ts`, `backend/src/common/validation.spec.ts`, `backend/src/common/exception.filter.ts`, `backend/src/common/exception.filter.spec.ts`, `backend/src/common/common.module.ts`
- Modify: `backend/src/common/request-context.ts` (добавить middleware)
- Create: `backend/src/health/health.controller.ts`, `backend/src/health/health.module.ts`, `backend/src/configure-app.ts`
- Replace: `backend/src/app.module.ts`, `backend/src/main.ts`
- Modify: `backend/test/integration/helpers.ts` (добавить `createTestApp`)
- Test: `backend/test/integration/http.e2e-spec.ts`

**Interfaces:**
- Consumes: `ApiError`, `FieldError`, `ErrorSpec`, `mapDbError`, `requestContext`, `AppConfig`, `Clock`, `PrismaService`.
- Produces:
  - `writeError(res: Response, spec: ErrorSpec): void`; `errorBody(spec, requestId): ErrorBody`
  - `API_ROUTES: ReadonlyArray<{ pattern: RegExp; path: string; methods: readonly string[] }>`, `methodNotAllowedMiddleware`, `isJsonContentType(header?: string): boolean`, `contentTypeMiddleware`, `BODY_LIMIT = '100kb'`, `bodyParserErrorHandler`
  - `AppValidationPipe`, `flattenValidationErrors`, декораторы `IsPresent()`, `NullOr(name, check, message)`, `IsWallClock()`, `IsLaterThan(other, { allowEqual })`, `IsAsciiEmail()`, `NormalizeEmail()`, `Trim()`; предикаты `isText(max)`, `isPositiveInt32`, `isUrlValue`
  - `AllExceptionsFilter`, `toErrorSpec(e: unknown): ErrorSpec`
  - `CommonModule` (global: `AppConfig`, `Clock`)
  - `configureApp(app: NestExpressApplication, config: AppConfig): void`
  - `AppModule.forRoot(env): DynamicModule`
  - тест: `createTestApp({ now?, env? }): Promise<TestApp>` — `{ app, http(): supertest agent, prisma, clock: FixedClock, close() }`

- [ ] **Step 1: Тест фильтра (unit) — падает**

`backend/src/common/exception.filter.spec.ts`:
```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiError } from './errors';
import { toErrorSpec } from './exception.filter';

describe('toErrorSpec (spec 5.6)', () => {
  it('passes ApiError through', () => {
    const error = new ApiError(422, 'Session violates conference rules', [{ field: 'capacity', messages: ['too big'] }]);
    expect(toErrorSpec(error)).toMatchObject({ status: 422, message: 'Session violates conference rules', errors: [{ field: 'capacity', messages: ['too big'] }] });
  });
  it('renames the router 404', () => {
    expect(toErrorSpec(new NotFoundException('Cannot GET /x'))).toMatchObject({ status: 404, message: 'Route not found' });
  });
  it('keeps other Nest HTTP errors, without internals', () => {
    expect(toErrorSpec(new BadRequestException('bad'))).toMatchObject({ status: 400, message: 'Bad Request' });
  });
  it('hides unexpected errors behind a generic 500', () => {
    const spec = toErrorSpec(new TypeError("Cannot read properties of undefined (reading 'toUpperCase')"));
    expect(spec).toMatchObject({ status: 500, message: 'Internal server error' });
    expect(JSON.stringify(spec)).not.toContain('toUpperCase');
  });
});
```
Run: `npm test -- exception.filter` → Expected: FAIL (module not found).

- [ ] **Step 2: Запись ошибки, фильтр, middleware**

`backend/src/common/write-error.ts`:
```ts
import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import type { ErrorSpec } from './db-error';
import type { FieldError } from './errors';

export type { ErrorSpec } from './db-error';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  requestId: string;
  errors?: FieldError[];
}

export function requestIdOf(res: Response): string {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : '';
}

export function errorBody(spec: ErrorSpec, requestId: string): ErrorBody {
  return {
    statusCode: spec.status,
    error: STATUS_CODES[spec.status] ?? 'Error',
    message: spec.message,
    requestId,
    ...(spec.errors ? { errors: spec.errors } : {}),
  };
}

// The one place that writes an error response (spec 5.6). Used by the Nest filter and by the Express middleware
// that runs before Nest (405, 415, body parser), so every error has the same body and keeps the CORS headers.
export function writeError(res: Response, spec: ErrorSpec): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  for (const [name, value] of Object.entries(spec.headers ?? {})) res.setHeader(name, value);
  res.status(spec.status).json(errorBody(spec, requestIdOf(res)));
}
```

`backend/src/common/exception.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import { mapDbError, type ErrorSpec } from './db-error';
import { ApiError } from './errors';
import { requestIdOf, writeError } from './write-error';

export function toErrorSpec(exception: unknown): ErrorSpec {
  if (exception instanceof ApiError) {
    return { status: exception.status, message: exception.message, errors: exception.errors, headers: exception.headers };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { status, message: status === 404 ? 'Route not found' : (STATUS_CODES[status] ?? 'Error') };
  }
  return mapDbError(exception) ?? { status: 500, message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const spec = toErrorSpec(exception);
    const requestId = requestIdOf(res);
    if (spec.status >= 500) {
      // Stack and driver details go to the log only (CFG-3).
      this.logger.error({ requestId, status: spec.status, error: exception instanceof Error ? exception.stack : String(exception) });
    } else if (spec.detail) {
      this.logger.warn({ requestId, status: spec.status, detail: spec.detail });
    }
    writeError(res, spec);
  }
}
```

Добавить в конец `backend/src/common/request-context.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// The server always generates the id; an incoming X-Request-Id is ignored so clients cannot put text into the log (spec 5.6).
export function requestContextMiddleware(logger: LoggerService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.log({ requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
    });
    requestContext.run({ requestId }, next);
  };
}
```
(импорты перенести в начало файла.)

`backend/src/common/http-middleware.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';
import { writeError } from './write-error';

export const BODY_LIMIT = '100kb';

// Routes of the public API (spec 5.8) with their methods. A test compares this table with the Swagger document,
// so the 405 answer cannot drift from the real routes.
export const API_ROUTES = [
  { path: '/api/conferences', pattern: /^\/api\/conferences\/?$/, methods: ['GET', 'POST'] },
  { path: '/api/conferences/{id}', pattern: /^\/api\/conferences\/[^/]+\/?$/, methods: ['GET', 'PUT'] },
  { path: '/api/conferences/{id}/sessions', pattern: /^\/api\/conferences\/[^/]+\/sessions\/?$/, methods: ['GET', 'POST'] },
  { path: '/api/conferences/{id}/registrations', pattern: /^\/api\/conferences\/[^/]+\/registrations\/?$/, methods: ['GET'] },
  { path: '/api/conferences/{id}/register', pattern: /^\/api\/conferences\/[^/]+\/register\/?$/, methods: ['POST'] },
  { path: '/api/sessions/{id}', pattern: /^\/api\/sessions\/[^/]+\/?$/, methods: ['GET', 'PUT'] },
  { path: '/api/speakers', pattern: /^\/api\/speakers\/?$/, methods: ['GET', 'POST'] },
] as const;

export function methodNotAllowedMiddleware(req: Request, res: Response, next: NextFunction): void {
  const route = API_ROUTES.find((r) => r.pattern.test(req.path));
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (req.method === 'OPTIONS' || !route || (route.methods as readonly string[]).includes(method)) {
    next();
    return;
  }
  writeError(res, { status: 405, message: `Method ${req.method} is not allowed for this path`, headers: { Allow: route.methods.join(', ') } });
}

export function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const mediaType = header.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || /^application\/[a-z0-9.!#$&^_-]+\+json$/.test(mediaType);
}

// 415 before the body parser: otherwise a non-JSON body would reach validation as an empty object and answer 400 (spec 5.4).
export function contentTypeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasBody = req.method === 'POST' || req.method === 'PUT';
  if (hasBody && req.path.startsWith('/api/') && !isJsonContentType(req.headers['content-type'])) {
    writeError(res, { status: 415, message: 'Content-Type must be application/json' });
    return;
  }
  next();
}

interface ParserError {
  type?: unknown;
}

// Parser messages ("Unexpected token } in JSON at position 10") are not sent to the client (spec 5.6).
export function bodyParserErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (error as ParserError | null)?.type;
  if (type === 'entity.parse.failed') return writeError(res, { status: 400, message: 'Request body is not valid JSON' });
  if (type === 'entity.too.large') return writeError(res, { status: 413, message: `Request body exceeds ${BODY_LIMIT}` });
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') return writeError(res, { status: 415, message: 'Unsupported request body encoding' });
  next(error);
}
```

Run: `npm test -- exception.filter` → Expected: PASS.

- [ ] **Step 3: Тест валидационных декораторов — падает**

`backend/src/common/validation.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { IsInt, IsString, validate } from 'class-validator';
import { flattenValidationErrors, IsAsciiEmail, IsLaterThan, IsPresent, IsWallClock, isText, NormalizeEmail, NullOr } from './validation';

class Probe {
  @IsString() title!: string;
  @IsPresent() @NullOr('isNullableText', isText(10), 'must be a string of at most 10 characters or null') note!: string | null;
  @IsWallClock() startTime!: string;
  @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @NormalizeEmail() @IsAsciiEmail() email!: string;
  @IsInt() n!: number;
}

async function errorsOf(plain: object) {
  return flattenValidationErrors(await validate(plainToInstance(Probe, plain)));
}

const ok = { title: 't', note: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', email: '  Maria@Example.COM ', n: 1 };

describe('validation decorators', () => {
  it('accepts a valid object and normalises the email', async () => {
    expect(await errorsOf(ok)).toEqual([]);
    expect(plainToInstance(Probe, ok).email).toBe('maria@example.com');
  });
  it('requires present keys but allows null', async () => {
    const { note: _note, ...missing } = ok;
    expect(await errorsOf(missing)).toEqual([{ field: 'note', messages: ['note is required (send null to clear it)'] }]);
  });
  it('checks nullable text and wall-clock format and order', async () => {
    const errors = await errorsOf({ ...ok, note: 'x'.repeat(11), startTime: '2027-01-10T10:00:00Z', endTime: '2027-01-10T10:00:00' });
    expect(errors.map((e) => e.field)).toEqual(['note', 'startTime']);
    const order = await errorsOf({ ...ok, endTime: '2027-01-10T10:00:00' });
    expect(order).toEqual([{ field: 'endTime', messages: ['endTime must be later than startTime'] }]);
  });
  it('rejects non-ASCII and malformed emails', async () => {
    expect((await errorsOf({ ...ok, email: 'иван@пример.рф' }))[0].field).toBe('email');
    expect((await errorsOf({ ...ok, email: 'not-an-email' }))[0].field).toBe('email');
  });
});
```
Run: `npm test -- validation` → Expected: FAIL.

- [ ] **Step 4: Валидация**

`backend/src/common/validation.ts`:
```ts
import { applyDecorators, ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { buildMessage, IsEmail, isURL, Matches, MaxLength, ValidateBy, ValidationArguments, ValidationError } from 'class-validator';
import { parseWallClock } from './dates';
import { ASCII_PRINTABLE, normalizeEmail } from './email';
import { badRequest, type FieldError } from './errors';
import { INT32_MAX, LIMITS } from './limits';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

// whitelist + forbidNonWhitelisted for every body, no exceptions (spec 5.4, CORR-4, SEC-3). Only bodies:
// path ids go through ParseIdPipe, so the built-in primitive conversion ("007" -> 7) never runs on them.
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) => badRequest('Validation failed', flattenValidationErrors(errors)),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type !== 'body') return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Request body must be a JSON object');
    return await super.transform(value, metadata);
  }
}

export const isText = (max: number) => (value: unknown) => typeof value === 'string' && value.length <= max;
export const isPositiveInt32 = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= INT32_MAX;
export const isUrlValue = (max: number) => (value: unknown) =>
  typeof value === 'string' && value.length <= max && isURL(value, { require_protocol: true, protocols: ['http', 'https'] });

// The key must be in the body; null is a valid value (PUT is a full replacement, spec 5.4 / CORR-5).
export function IsPresent(): PropertyDecorator {
  return ValidateBy({
    name: 'isPresent',
    validator: {
      validate: (value: unknown) => value !== undefined,
      defaultMessage: buildMessage((each) => `${each}$property is required (send null to clear it)`),
    },
  });
}

// Validates only non-null values, unlike @IsOptional which would also silence @IsPresent.
export function NullOr(name: string, check: (value: unknown) => boolean, message: string): PropertyDecorator {
  return ValidateBy({
    name,
    validator: {
      validate: (value: unknown) => value === undefined || value === null || check(value),
      defaultMessage: buildMessage((each) => `${each}$property ${message}`),
    },
  });
}

export function IsWallClock(): PropertyDecorator {
  return ValidateBy({
    name: 'isWallClock',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && parseWallClock(value) !== null,
      defaultMessage: buildMessage((each) => `${each}$property must be a local date-time YYYY-MM-DDTHH:mm:ss without offset or fraction`),
    },
  });
}

export function IsLaterThan(other: string, options: { allowEqual: boolean }): PropertyDecorator {
  return ValidateBy({
    name: options.allowEqual ? 'isNotBefore' : 'isLaterThan',
    constraints: [other],
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const otherValue: unknown = args ? (args.object as Record<string, unknown>)[other] : undefined;
        const end = typeof value === 'string' ? parseWallClock(value) : null;
        const start = typeof otherValue === 'string' ? parseWallClock(otherValue) : null;
        if (!end || !start) return true; // format errors are reported by @IsWallClock
        return options.allowEqual ? end >= start : end > start;
      },
      defaultMessage: buildMessage((each) => `${each}$property must be ${options.allowEqual ? 'on or after' : 'later than'} $constraint1`),
    },
  });
}

export function IsAsciiEmail(): PropertyDecorator {
  return applyDecorators(
    MaxLength(LIMITS.attendees.Email),
    Matches(ASCII_PRINTABLE, { message: '$property must contain only ASCII characters' }),
    IsEmail({ allow_utf8_local_part: false, require_tld: true }, { message: '$property must be an email address' }),
  );
}

export const NormalizeEmail = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value));
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
```
Run: `npm test -- validation` → Expected: PASS.

- [ ] **Step 5: Общий модуль, health, приложение**

`backend/src/common/common.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/app-config';
import { Clock, SystemClock } from './clock';

@Global()
@Module({
  providers: [
    { provide: AppConfig, inject: [ConfigService], useFactory: (config: ConfigService) => config.getOrThrow<AppConfig>('app') },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [AppConfig, Clock],
})
export class CommonModule {}
```

`backend/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceUnavailable } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

// Infrastructure, not part of the API surface: outside /api and outside Swagger (spec 9.3).
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw serviceUnavailable('The database is unavailable');
    }
    return { status: 'ok' };
  }
}
```

`backend/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`backend/src/configure-app.ts`:
```ts
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { AllExceptionsFilter } from './common/exception.filter';
import { BODY_LIMIT, bodyParserErrorHandler, contentTypeMiddleware, isJsonContentType, methodNotAllowedMiddleware } from './common/http-middleware';
import { requestContextMiddleware } from './common/request-context';
import { AppValidationPipe } from './common/validation';
import { AppConfig } from './config/app-config';

// Order matters: request id first (every later answer carries it), CORS before any error so errors keep the
// CORS headers (CFG-3), 405 and 415 before the parser, the parser's own errors right after it.
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.use(requestContextMiddleware(new Logger('HTTP')));
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.use(methodNotAllowedMiddleware);
  app.use(contentTypeMiddleware);
  app.use(json({ limit: BODY_LIMIT, strict: true, type: (req) => isJsonContentType(req.headers['content-type']) }));
  app.use(bodyParserErrorHandler);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
```

`backend/src/app.module.ts` (заменить):
```ts
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { loadConfig } from './config/app-config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  // env is a parameter (not process.env read at import time) so that tests can start apps with different settings.
  static forRoot(env: Record<string, string | undefined>): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ app: loadConfig(env) })] }),
        CommonModule,
        PrismaModule,
        HealthModule,
      ],
    };
  }
}
```

`backend/src/main.ts` (заменить):
```ts
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(process.env), {
    bodyParser: false, // configureApp installs its own parser with error handling (spec 5.6)
    logger: new ConsoleLogger({ json: true }),
  });
  const config = app.get(AppConfig);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
```

Добавить в `backend/test/integration/helpers.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock, FixedClock } from '../../src/common/clock';
import { configureApp } from '../../src/configure-app';
import { AppConfig } from '../../src/config/app-config';

export const DEFAULT_NOW = '2026-10-05T12:00:00.000Z';

export interface TestApp {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  clock: FixedClock;
  close: () => Promise<void>;
}

export async function createTestApp(options: { now?: string; env?: Record<string, string> } = {}): Promise<TestApp> {
  const env = { DATABASE_URL: testDatabaseUrl(), CORS_ORIGINS: 'http://localhost:5173', SWAGGER_ENABLED: 'true', ...options.env };
  const clock = new FixedClock(new Date(options.now ?? DEFAULT_NOW));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, app.get(AppConfig));
  await app.init();
  return { app, http: () => request(app.getHttpServer()), prisma: app.get(PrismaService), clock, close: () => app.close() };
}
```
(импорты — в начало файла.)

- [ ] **Step 6: Интеграционные тесты HTTP-основы — проверить, что падают до Step 5, и что проходят после**

`backend/test/integration/http.e2e-spec.ts`:
```ts
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('error format and request id (spec 5.6)', () => {
  it('answers an unknown route with the JSON error and a server-made request id', async () => {
    const res = await t.http().get('/api/nothing-here').set('X-Request-Id', 'injected<script>');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Route not found', requestId: res.headers['x-request-id'] });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('405 (spec 5.6)', () => {
  it('lists the allowed methods', async () => {
    const res = await t.http().delete('/api/conferences/2');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, PUT');
    expect(res.body.message).toBe('Method DELETE is not allowed for this path');
  });
  it('keeps 404 for paths outside the table (A21)', async () => {
    expect((await t.http().delete('/api/conferences/2/registrations/1')).status).toBe(404);
  });
});

describe('415 and body parsing (spec 5.4, 5.6)', () => {
  it('rejects POST without Content-Type', async () => {
    const res = await t.http().post('/api/speakers').send('{"firstName":"A"}');
    expect(res.status).toBe(415);
    expect(res.body.message).toBe('Content-Type must be application/json');
  });
  it.each(['text/plain', 'text/json', 'application/x-www-form-urlencoded'])('rejects %s', async (type) => {
    expect((await t.http().post('/api/speakers').set('Content-Type', type).send('{}')).status).toBe(415);
  });
  it('accepts application/json with parameters and +json types (route missing -> 404, not 415)', async () => {
    expect((await t.http().post('/api/nothing').set('Content-Type', 'application/json; charset=utf-8').send('{}')).status).toBe(404);
    expect((await t.http().post('/api/nothing').set('Content-Type', 'application/merge-patch+json').send('{}')).status).toBe(404);
  });
  it('answers malformed JSON with 400 and without the parser text (B04)', async () => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request body is not valid JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position/);
  });
  it.each(['"x"', '1', 'null'])('rejects the primitive body %s with 400 (Review Focus 1)', async (body) => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(400);
  });
  it('answers an oversized body with 413', async () => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send(JSON.stringify({ bio: 'x'.repeat(110_000) }));
    expect(res.status).toBe(413);
    expect(res.body.statusCode).toBe(413);
  });
});

describe('CORS (spec 5.7, SEC-4, audit step 3)', () => {
  it('allows the frontend origin and exposes X-Request-Id', async () => {
    const res = await t.http().get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toBe('X-Request-Id');
  });
  it('keeps CORS headers on errors (CFG-3)', async () => {
    const res = await t.http().get('/api/nothing').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
  it('answers an allowed preflight with max age', async () => {
    const res = await t.http().options('/api/conferences/2/register').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-max-age']).toBe('600');
  });
  it('gives no Access-Control-Allow-Origin to a foreign origin', async () => {
    const preflight = await t.http().options('/api/conferences').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const get = await t.http().get('/health').set('Origin', 'https://evil.example');
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('/health (spec 9.3)', () => {
  it('is 200 with a database', async () => {
    const res = await t.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
  it('is 503 without one', async () => {
    const down = await createTestApp({ env: { DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none' } });
    const res = await down.http().get('/health');
    await down.close();
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
  });
  it('is not under /api', async () => {
    expect((await t.http().get('/api/health')).status).toBe(404);
  });
});
```
Run: `bash scripts/test-db.sh up && npm run test:int -- http`
Expected: PASS. Если 404 неизвестного маршрута приходит не от нашего фильтра (тело Nest `{"message":"Cannot GET ..."}`), — стоп, доклад: глобальный фильтр не ловит 404 роутера в Nest 12.

- [ ] **Step 7: Проверка, commit (после «ок»)**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`
```bash
git add backend/src backend/test
git status && git diff --cached --stat
git commit -m "feat: add HTTP foundation: request id, CORS, 405/415, JSON errors, validation, health (EXT-150)"
```

---

### Task 5: Слой представления и спикеры

**Files:**
- Create: `backend/src/representation/selects.ts`, `responses.ts`, `mappers.ts`
- Create: `backend/src/swagger/api-errors.decorator.ts`
- Create: `backend/src/speakers/speaker.dto.ts`, `speakers.service.ts`, `speakers.controller.ts`, `speakers.module.ts`
- Modify: `backend/src/app.module.ts` (добавить `SpeakersModule`)
- Test: `backend/test/integration/speakers.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `Clock`, `formatWallClock`, `formatInstant`, `computeStatus`, валидационные декораторы, `LIMITS`.
- Produces:
  - selects: `conferenceFields`, `sessionFields`, `speakerFields`, `roomFields`, `registrationFields`, `attendeePublicFields`, `conferenceWithRelations`, `sessionWithRelations`, `registrationWithRelations`, `speakerWithSessions` и типы строк `ConferenceRow`, `ConferenceWithRelationsRow`, `SessionRow`, `SessionWithRelationsRow`, `SpeakerRow`, `SpeakerWithSessionsRow`, `RegistrationRow`, `RegistrationWithRelationsRow`
  - responses (классы для Swagger и типизации): `ConferenceSummaryResponse`, `ConferenceResponse`, `SessionSummaryResponse`, `SessionResponse`, `SpeakerSummaryResponse`, `SpeakerResponse`, `RoomResponse`, `RegistrationSummaryResponse`, `RegistrationResponse`, `AttendeePublicResponse`, `ErrorResponse`, `FieldErrorResponse`
  - mappers: `toConferenceSummary(row, now)`, `toConference(row, now)`, `toSessionSummary(row)`, `toSession(row, now)`, `toSpeakerSummary(row)`, `toSpeaker(row)`, `toRoom(row)`, `toRegistrationSummary(row)`, `toRegistration(row, now)`
  - `ApiErrors(...codes: number[])` — декоратор Swagger с примерами тел ошибок
  - `SpeakersService.list()`, `SpeakersService.create(dto)`

- [ ] **Step 1: Тесты спикеров — падают**

`backend/test/integration/speakers.e2e-spec.ts`:
```ts
import { makeConference, makeSession, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const json = (path: string) => t.http().post(path).set('Content-Type', 'application/json');

describe('GET /api/speakers', () => {
  it('returns speakers with their sessions, own fields only (A13, spec 5.2)', async () => {
    const conference = await makeConference(t.prisma);
    const speaker = await makeSpeaker(t.prisma, { emailPublic: true });
    await makeSession(t.prisma, conference.id, { speakerId: speaker.id });
    const res = await t.http().get('/api/speakers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1, firstName: 'Alice', lastName: 'Novak', bio: 'Bio', email: 'alice.novak@example.com', emailPublic: true,
        sessions: [
          { id: 1, title: 'Talk', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 50, conferenceId: 1, speakerId: 1, roomId: null },
        ],
      },
    ]);
  });

  it('hides the email of a speaker who has not made it public (SEC-1)', async () => {
    await makeSpeaker(t.prisma, { emailPublic: false });
    const res = await t.http().get('/api/speakers');
    expect(res.body[0].email).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('@');
  });
});

describe('POST /api/speakers', () => {
  it('creates a speaker: 201, emailPublic defaults to false (D01)', async () => {
    const res = await json('/api/speakers').send({ firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: 'dmitri.ivanov@example.com' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({ id: 1, firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: null, emailPublic: false, sessions: [] });
    expect((await t.prisma.speaker.findUniqueOrThrow({ where: { id: 1 } })).email).toBe('dmitri.ivanov@example.com');
  });

  it('returns the email when emailPublic is true', async () => {
    const res = await json('/api/speakers').send({ firstName: 'A', lastName: 'B', email: 'a.b@example.com', emailPublic: true });
    expect(res.body.email).toBe('a.b@example.com');
  });

  it('lists every failed field (D02, BEVN-107)', async () => {
    const res = await json('/api/speakers').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(['firstName', 'lastName']);
  });

  it.each([
    [{ firstName: 'X', lastName: 'Y', email: 'not-an-email' }, 'email'],
    [{ firstName: 'X', lastName: 'Y', email: 'иван@пример.рф' }, 'email'],
    [{ firstName: 'X', lastName: 'Y', id: 50 }, 'id'],
    [{ firstName: 'X'.repeat(101), lastName: 'Y' }, 'firstName'],
    [{ firstName: 'X', lastName: 'Y', emailPublic: 'yes' }, 'emailPublic'],
  ])('rejects %j on field %s', async (body, field) => {
    const res = await json('/api/speakers').send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
  });

  it('rejects a JSON array body (Review Focus 1)', async () => {
    const res = await json('/api/speakers').send([{ firstName: 'A', lastName: 'B' }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request body must be a JSON object');
  });
});
```
Run: `npm run test:int -- speakers` → Expected: FAIL (404 Route not found).

- [ ] **Step 2: Selects, responses, mappers**

`backend/src/representation/selects.ts`:
```ts
import type { Prisma } from '../generated/prisma/client';

// One record and its direct relations, each with its own fields only (BEVN-101 criterion, spec 5.2).
export const conferenceFields = {
  id: true, title: true, description: true, location: true, venue: true, startDate: true, endDate: true,
  status: true, maxAttendees: true, organizerName: true, website: true,
} satisfies Prisma.ConferenceSelect;
export const sessionFields = {
  id: true, title: true, description: true, startTime: true, endTime: true, capacity: true, conferenceId: true, speakerId: true, roomId: true,
} satisfies Prisma.SessionSelect;
export const speakerFields = { id: true, firstName: true, lastName: true, bio: true, email: true, emailPublic: true } satisfies Prisma.SpeakerSelect;
export const roomFields = { id: true, name: true, capacity: true, location: true } satisfies Prisma.RoomSelect;
export const registrationFields = { id: true, registeredAt: true, status: true, conferenceId: true, attendeeId: true } satisfies Prisma.RegistrationSelect;
// Never the email of an attendee (SEC-1, spec 5.3).
export const attendeePublicFields = { id: true, firstName: true, lastName: true } satisfies Prisma.AttendeeSelect;

const byId = { id: 'asc' } as const;

export const conferenceWithRelations = {
  ...conferenceFields,
  sessions: { select: sessionFields, orderBy: byId },
  registrations: { select: registrationFields, orderBy: byId },
} satisfies Prisma.ConferenceSelect;
export const sessionWithRelations = {
  ...sessionFields,
  conference: { select: conferenceFields },
  speaker: { select: speakerFields },
  room: { select: roomFields },
} satisfies Prisma.SessionSelect;
export const registrationWithRelations = {
  ...registrationFields,
  conference: { select: conferenceFields },
  attendee: { select: attendeePublicFields },
} satisfies Prisma.RegistrationSelect;
export const speakerWithSessions = { ...speakerFields, sessions: { select: sessionFields, orderBy: byId } } satisfies Prisma.SpeakerSelect;

export type ConferenceRow = Prisma.ConferenceGetPayload<{ select: typeof conferenceFields }>;
export type ConferenceWithRelationsRow = Prisma.ConferenceGetPayload<{ select: typeof conferenceWithRelations }>;
export type SessionRow = Prisma.SessionGetPayload<{ select: typeof sessionFields }>;
export type SessionWithRelationsRow = Prisma.SessionGetPayload<{ select: typeof sessionWithRelations }>;
export type SpeakerRow = Prisma.SpeakerGetPayload<{ select: typeof speakerFields }>;
export type SpeakerWithSessionsRow = Prisma.SpeakerGetPayload<{ select: typeof speakerWithSessions }>;
export type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomFields }>;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ select: typeof registrationFields }>;
export type RegistrationWithRelationsRow = Prisma.RegistrationGetPayload<{ select: typeof registrationWithRelations }>;
```

`backend/src/representation/responses.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { CONFERENCE_STATUSES, type ConferenceStatus } from '../common/status';

const WALL = { type: String, example: '2025-03-05T10:00:00', description: 'Venue wall-clock time, YYYY-MM-DDTHH:mm:ss, no offset (spec 5.5)' };

export class ConferenceSummaryResponse {
  @ApiProperty({ example: 2 }) id!: number;
  @ApiProperty({ example: 'CloudOps Days' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Amsterdam, Netherlands' }) location!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Beurs van Berlage' }) venue!: string | null;
  @ApiProperty({ ...WALL, example: '2025-03-05T00:00:00' }) startDate!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T00:00:00', description: 'Midnight at the start of the last day' }) endDate!: string;
  @ApiProperty({ enum: CONFERENCE_STATUSES, description: 'CANCELLED if cancelled, otherwise derived from the dates' }) status!: ConferenceStatus;
  @ApiProperty({ type: Number, nullable: true, example: 400 }) maxAttendees!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'Infra Guild' }) organizerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
}

export class SessionSummaryResponse {
  @ApiProperty({ example: 4 }) id!: number;
  @ApiProperty({ example: 'Kubernetes for .NET Developers' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty(WALL) startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-05T11:00:00' }) endTime!: string;
  @ApiProperty({ example: 200 }) capacity!: number;
  @ApiProperty({ example: 2 }) conferenceId!: number;
  @ApiProperty({ type: Number, nullable: true, example: 3 }) speakerId!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 1 }) roomId!: number | null;
}

export class RegistrationSummaryResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: '2026-10-05T04:44:13.136Z', description: 'UTC instant with Z' }) registeredAt!: string;
  @ApiProperty({ example: 'CONFIRMED' }) status!: string;
  @ApiProperty({ example: 2 }) conferenceId!: number;
  @ApiProperty({ example: 1 }) attendeeId!: number;
}

export class ConferenceResponse extends ConferenceSummaryResponse {
  @ApiProperty({ type: [SessionSummaryResponse] }) sessions!: SessionSummaryResponse[];
  @ApiProperty({ type: [RegistrationSummaryResponse] }) registrations!: RegistrationSummaryResponse[];
}

export class SpeakerSummaryResponse {
  @ApiProperty({ example: 3 }) id!: number;
  @ApiProperty({ example: 'Chloe' }) firstName!: string;
  @ApiProperty({ example: 'Tanaka' }) lastName!: string;
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only when emailPublic is true, otherwise null (SEC-1)' }) email!: string | null;
  @ApiProperty({ example: true }) emailPublic!: boolean;
}

export class SpeakerResponse extends SpeakerSummaryResponse {
  @ApiProperty({ type: [SessionSummaryResponse] }) sessions!: SessionSummaryResponse[];
}

export class RoomResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'Hall A' }) name!: string;
  @ApiProperty({ example: 300 }) capacity!: number;
  @ApiProperty({ type: String, nullable: true, example: 'Ground Floor' }) location!: string | null;
}

export class SessionResponse extends SessionSummaryResponse {
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
  @ApiProperty({ type: SpeakerSummaryResponse, nullable: true }) speaker!: SpeakerSummaryResponse | null;
  @ApiProperty({ type: RoomResponse, nullable: true }) room!: RoomResponse | null;
}

export class AttendeePublicResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'Maria' }) firstName!: string;
  @ApiProperty({ example: 'Kowalska' }) lastName!: string;
}

export class RegistrationResponse extends RegistrationSummaryResponse {
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
  @ApiProperty({ type: AttendeePublicResponse, description: 'Stored name; the email is never returned (SEC-1)' }) attendee!: AttendeePublicResponse;
}

export class FieldErrorResponse {
  @ApiProperty({ example: 'email' }) field!: string;
  @ApiProperty({ type: [String], example: ['email must be an email address'] }) messages!: string[];
}

export class ErrorResponse {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: 'Bad Request' }) error!: string;
  @ApiProperty({ example: 'Validation failed' }) message!: string;
  @ApiProperty({ example: '3f1c2a7e-8b4d-4c1e-9a55-2d6f0b9e7c11', description: 'Same value as the X-Request-Id header' }) requestId!: string;
  @ApiProperty({ type: [FieldErrorResponse], required: false }) errors?: FieldErrorResponse[];
}
```

`backend/src/representation/mappers.ts`:
```ts
import { formatInstant, formatWallClock } from '../common/dates';
import { computeStatus } from '../common/status';
import type {
  ConferenceResponse, ConferenceSummaryResponse, RegistrationResponse, RegistrationSummaryResponse, RoomResponse,
  SessionResponse, SessionSummaryResponse, SpeakerResponse, SpeakerSummaryResponse,
} from './responses';
import type {
  ConferenceRow, ConferenceWithRelationsRow, RegistrationRow, RegistrationWithRelationsRow, RoomRow,
  SessionRow, SessionWithRelationsRow, SpeakerRow, SpeakerWithSessionsRow,
} from './selects';

export function toConferenceSummary(c: ConferenceRow, now: Date): ConferenceSummaryResponse {
  return {
    id: c.id, title: c.title, description: c.description, location: c.location, venue: c.venue,
    startDate: formatWallClock(c.startDate), endDate: formatWallClock(c.endDate),
    status: computeStatus(c.startDate, c.endDate, c.status === 'CANCELLED', now),
    maxAttendees: c.maxAttendees, organizerName: c.organizerName, website: c.website,
  };
}

export function toSessionSummary(s: SessionRow): SessionSummaryResponse {
  return {
    id: s.id, title: s.title, description: s.description, startTime: formatWallClock(s.startTime), endTime: formatWallClock(s.endTime),
    capacity: s.capacity, conferenceId: s.conferenceId, speakerId: s.speakerId, roomId: s.roomId,
  };
}

export function toRegistrationSummary(r: RegistrationRow): RegistrationSummaryResponse {
  return { id: r.id, registeredAt: formatInstant(r.registeredAt), status: r.status, conferenceId: r.conferenceId, attendeeId: r.attendeeId };
}

export function toConference(c: ConferenceWithRelationsRow, now: Date): ConferenceResponse {
  return { ...toConferenceSummary(c, now), sessions: c.sessions.map(toSessionSummary), registrations: c.registrations.map(toRegistrationSummary) };
}

export function toSpeakerSummary(sp: SpeakerRow): SpeakerSummaryResponse {
  return { id: sp.id, firstName: sp.firstName, lastName: sp.lastName, bio: sp.bio, email: sp.emailPublic ? sp.email : null, emailPublic: sp.emailPublic };
}

export function toSpeaker(sp: SpeakerWithSessionsRow): SpeakerResponse {
  return { ...toSpeakerSummary(sp), sessions: sp.sessions.map(toSessionSummary) };
}

export function toRoom(r: RoomRow): RoomResponse {
  return { id: r.id, name: r.name, capacity: r.capacity, location: r.location };
}

export function toSession(s: SessionWithRelationsRow, now: Date): SessionResponse {
  return {
    ...toSessionSummary(s),
    conference: toConferenceSummary(s.conference, now),
    speaker: s.speaker ? toSpeakerSummary(s.speaker) : null,
    room: s.room ? toRoom(s.room) : null,
  };
}

export function toRegistration(r: RegistrationWithRelationsRow, now: Date): RegistrationResponse {
  return {
    ...toRegistrationSummary(r),
    conference: toConferenceSummary(r.conference, now),
    attendee: { id: r.attendee.id, firstName: r.attendee.firstName, lastName: r.attendee.lastName },
  };
}
```

`backend/src/swagger/api-errors.decorator.ts`:
```ts
import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { STATUS_CODES } from 'node:http';
import { ErrorResponse } from '../representation/responses';

const EXAMPLES: Record<number, { message: string; errors?: { field: string; messages: string[] }[] }> = {
  400: { message: 'Validation failed', errors: [{ field: 'email', messages: ['email must be an email address'] }] },
  404: { message: 'Conference 999 not found' },
  409: { message: 'Attendee is already registered for this conference' },
  413: { message: 'Request body exceeds 100kb' },
  415: { message: 'Content-Type must be application/json' },
  422: { message: 'Referenced record does not exist', errors: [{ field: 'speakerId', messages: ['speakerId does not reference an existing record'] }] },
  500: { message: 'Internal server error' },
  503: { message: 'The database is busy, retry the request' },
};

// Every documented error code with an example body (spec 5.8).
export function ApiErrors(...codes: number[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponse),
    ...[...codes, 500].map((status) =>
      ApiResponse({
        status,
        description: STATUS_CODES[status],
        content: {
          'application/json': {
            schema: { $ref: getSchemaPath(ErrorResponse) },
            example: { statusCode: status, error: STATUS_CODES[status], requestId: '3f1c2a7e-8b4d-4c1e-9a55-2d6f0b9e7c11', ...EXAMPLES[status] },
          },
        },
      }),
    ),
  );
}
```

- [ ] **Step 3: Модуль спикеров**

`backend/src/speakers/speaker.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { LIMITS } from '../common/limits';
import { IsAsciiEmail, Trim } from '../common/validation';

export class CreateSpeakerDto {
  @ApiProperty({ example: 'Dmitri', maxLength: LIMITS.speakers.FirstName })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.speakers.FirstName)
  firstName!: string;

  @ApiProperty({ example: 'Ivanov', maxLength: LIMITS.speakers.LastName })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.speakers.LastName)
  lastName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: LIMITS.speakers.Bio })
  @IsOptional() @IsString() @MaxLength(LIMITS.speakers.Bio)
  bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'dmitri.ivanov@example.com', description: 'ASCII only. Returned only if emailPublic is true.' })
  @IsOptional() @Trim() @IsAsciiEmail()
  email?: string | null;

  @ApiPropertyOptional({ default: false, description: 'Whether the email may appear in public responses (SEC-1). Cannot be changed later: there is no PUT for speakers.' })
  @IsOptional() @IsBoolean()
  emailPublic?: boolean;
}
```

`backend/src/speakers/speakers.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toSpeaker } from '../representation/mappers';
import type { SpeakerResponse } from '../representation/responses';
import { speakerWithSessions } from '../representation/selects';
import type { CreateSpeakerDto } from './speaker.dto';

@Injectable()
export class SpeakersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SpeakerResponse[]> {
    const rows = await this.prisma.speaker.findMany({ select: speakerWithSessions, orderBy: { id: 'asc' } });
    return rows.map(toSpeaker);
  }

  async create(dto: CreateSpeakerDto): Promise<SpeakerResponse> {
    const row = await this.prisma.speaker.create({
      data: { firstName: dto.firstName, lastName: dto.lastName, bio: dto.bio ?? null, email: dto.email ?? null, emailPublic: dto.emailPublic ?? false },
      select: speakerWithSessions,
    });
    return toSpeaker(row);
  }
}
```

`backend/src/speakers/speakers.controller.ts`:
```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SpeakerResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { CreateSpeakerDto } from './speaker.dto';
import { SpeakersService } from './speakers.service';

@ApiTags('Speakers')
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly speakers: SpeakersService) {}

  @Get()
  @ApiOperation({ operationId: 'Speakers_GetAll', summary: 'List speakers with their sessions' })
  @ApiOkResponse({ type: [SpeakerResponse] })
  @ApiErrors(503)
  list(): Promise<SpeakerResponse[]> {
    return this.speakers.list();
  }

  @Post()
  @ApiOperation({ operationId: 'Speakers_Create', summary: 'Create a speaker', description: 'No Location header: there is no GET for a single speaker.' })
  @ApiBody({ type: CreateSpeakerDto, examples: { speaker: { value: { firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: 'dmitri.ivanov@example.com', emailPublic: true } } } })
  @ApiCreatedResponse({ type: SpeakerResponse })
  @ApiErrors(400, 413, 415)
  create(@Body() dto: CreateSpeakerDto): Promise<SpeakerResponse> {
    return this.speakers.create(dto);
  }
}
```

`backend/src/speakers/speakers.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SpeakersController } from './speakers.controller';
import { SpeakersService } from './speakers.service';

@Module({ controllers: [SpeakersController], providers: [SpeakersService] })
export class SpeakersModule {}
```

В `backend/src/app.module.ts` добавить `SpeakersModule` в `imports` (импорт `./speakers/speakers.module`).

- [ ] **Step 4: Прогон**

Run: `npm run test:int -- speakers` → Expected: PASS.
Run: `npm run lint && npm run typecheck && npm test && npm run test:int` → Expected: всё зелёное.

- [ ] **Step 5: Commit (после «ок»)**

```bash
git add backend/src backend/test
git status && git diff --cached --stat
git commit -m "feat: add response representation and speakers endpoints (EXT-150)"
```

---

### Task 6: Конференции

**Files:**
- Create: `backend/src/conferences/conference.dto.ts`, `conferences.service.ts`, `conferences.controller.ts`, `conferences.module.ts`
- Modify: `backend/src/app.module.ts` (добавить `ConferencesModule`)
- Test: `backend/test/integration/conferences.e2e-spec.ts`

**Interfaces:**
- Consumes: `lockConference`, `Tx`, `resolveStatusInput`, `requireWallClock`, `isWithinDays`, `conferenceWithRelations`, `toConference`, `ParseIdPipe`, `ApiErrors`, ошибки из `errors.ts`.
- Produces: `CreateConferenceDto`, `UpdateConferenceDto`; `ConferencesService.list()`, `.get(id)`, `.create(dto)`, `.update(id, dto)`; `ConferencesController` (`@Controller('conferences')`, Task 7 добавляет в него маршруты сессий).

- [ ] **Step 1: Тесты — падают**

`backend/test/integration/conferences.e2e-spec.ts`:
```ts
import { makeAttendee, makeConference, makeRegistration, makeSession } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: unknown) => t.http()[method](path).set('Content-Type', 'application/json').send(body as object);

const FULL = {
  title: 'Frontend Frontiers 2026', description: 'React, TypeScript and web performance for product teams.', location: 'Berlin, Germany',
  venue: 'Station Berlin', startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00', status: 'UPCOMING', maxAttendees: 350,
  organizerName: 'Web Guild', website: 'https://frontendfrontiers.example.com',
};
const fieldsOf = (res: { body: { errors?: { field: string }[] } }) => (res.body.errors ?? []).map((e) => e.field);

describe('GET /api/conferences', () => {
  it('returns bare arrays with direct relations, own fields only (A01, spec 5.1, 5.2)', async () => {
    const conference = await makeConference(t.prisma, { startDate: '2026-10-05T00:00:00', endDate: '2026-10-06T00:00:00', maxAttendees: 10 });
    await makeSession(t.prisma, conference.id, { startTime: '2026-10-05T10:00:00', endTime: '2026-10-05T11:00:00' });
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, conference.id, attendee.id);
    const res = await t.http().get('/api/conferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1, title: 'Test Conference', description: null, location: null, venue: null, startDate: '2026-10-05T00:00:00', endDate: '2026-10-06T00:00:00',
        status: 'ACTIVE', maxAttendees: 10, organizerName: null, website: null,
        sessions: [{ id: 1, title: 'Talk', description: null, startTime: '2026-10-05T10:00:00', endTime: '2026-10-05T11:00:00', capacity: 50, conferenceId: 1, speakerId: null, roomId: null }],
        registrations: [{ id: 1, registeredAt: '2026-10-01T09:00:00.000Z', status: 'CONFIRMED', conferenceId: 1, attendeeId: 1 }],
      },
    ]);
  });
});

describe('GET /api/conferences/:id', () => {
  it('returns one conference; status derived, CANCELLED kept', async () => {
    await makeConference(t.prisma, { startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00' });
    await makeConference(t.prisma, { status: 'CANCELLED' });
    expect((await t.http().get('/api/conferences/1')).body.status).toBe('COMPLETED');
    expect((await t.http().get('/api/conferences/2')).body.status).toBe('CANCELLED');
  });
  it.each([['999', 404], ['abc', 400], ['0', 400], ['-1', 400], ['2147483648', 400]])('GET /api/conferences/%s -> %d (A03-A05, CORR-7)', async (id, status) => {
    const res = await t.http().get(`/api/conferences/${id}`);
    expect(res.status).toBe(status);
    expect(res.body.requestId).toBeDefined();
  });
});

describe('POST /api/conferences', () => {
  it('creates: 201 + Location + same body as GET (B01, MNT-2)', async () => {
    const res = await send('post', '/api/conferences', FULL);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/conferences/1');
    expect(res.body).toEqual((await t.http().get('/api/conferences/1')).body);
    expect(res.body).toMatchObject({ ...FULL, id: 1, sessions: [], registrations: [] });
  });

  it.each([
    ['{} (B05)', {}, ['title', 'startDate', 'endDate']],
    ['lower-case status (B06)', { ...FULL, status: 'active' }, ['status']],
    ['wrong types (B07)', { ...FULL, title: 123, maxAttendees: 'many' }, ['title', 'maxAttendees']],
    ['dates with offsets (B08)', { ...FULL, startDate: '2026-11-12T10:00:00Z', endDate: '2026-11-13T10:00:00+02:00' }, ['startDate', 'endDate']],
    ['end before start, negative seats (B09)', { ...FULL, startDate: '2026-05-02T00:00:00', endDate: '2026-05-01T00:00:00', maxAttendees: -3 }, ['endDate', 'maxAttendees']],
    ['non-existent date', { ...FULL, startDate: '2027-02-29T00:00:00' }, ['startDate']],
    ['int32 overflow (Review Focus 3)', { ...FULL, maxAttendees: 3_000_000_000 }, ['maxAttendees']],
    ['PascalCase key (Review Focus 2)', { ...FULL, Title: 'x' }, ['Title']],
    ['mass assignment (B16, SEC-3)', { ...FULL, id: 50, registrations: [{ status: 'VIP' }], sessions: [{ title: 'Injected' }] }, ['id', 'registrations', 'sessions']],
    ['website without scheme', { ...FULL, website: 'frontendfrontiers.example.com' }, ['website']],
  ])('rejects %s with 400 listing the fields', async (_name, body, fields) => {
    const res = await send('post', '/api/conferences', body);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(fields));
    expect(await t.prisma.conference.count()).toBe(0);
  });

  it('accepts a status only when it matches the dates (spec 5.4)', async () => {
    const wrong = await send('post', '/api/conferences', { ...FULL, status: 'ACTIVE' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors).toEqual([{ field: 'status', messages: ['status is derived from dates; only CANCELLED can be set'] }]);
    expect((await send('post', '/api/conferences', { ...FULL, status: 'CANCELLED' })).body.status).toBe('CANCELLED');
    const { status: _s, ...noStatus } = FULL;
    expect((await send('post', '/api/conferences', noStatus)).body.status).toBe('UPCOMING');
  });
});

describe('PUT /api/conferences/:id', () => {
  it('replaces the conference (B10 with a valid status)', async () => {
    await makeConference(t.prisma);
    const res = await send('put', '/api/conferences/1', { ...FULL, description: 'Updated', endDate: '2026-11-14T00:00:00' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, description: 'Updated', endDate: '2026-11-14T00:00:00', status: 'UPCOMING' });
  });

  it('requires every key, null allowed (B11, B14, CORR-5)', async () => {
    await makeConference(t.prisma, { title: 'Before' });
    const partial = await send('put', '/api/conferences/1', { title: 'Only title' });
    expect(partial.status).toBe(400);
    expect(fieldsOf(partial)).toEqual(expect.arrayContaining(['description', 'location', 'venue', 'startDate', 'endDate', 'status', 'maxAttendees', 'organizerName', 'website']));
    const { status: _s, ...noStatusKey } = FULL;
    expect(fieldsOf(await send('put', '/api/conferences/1', noStatusKey))).toEqual(['status']);
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: 1 } })).title).toBe('Before'); // CORR-6: nothing half-applied
    const nulls = await send('put', '/api/conferences/1', { ...FULL, description: null, location: null, venue: null, status: null, maxAttendees: null, organizerName: null, website: null });
    expect(nulls.status).toBe(200);
  });

  it('cancels and un-cancels', async () => {
    await makeConference(t.prisma);
    expect((await send('put', '/api/conferences/1', { ...FULL, status: 'CANCELLED' })).body.status).toBe('CANCELLED');
    expect((await send('put', '/api/conferences/1', { ...FULL, status: null })).body.status).toBe('UPCOMING');
  });

  it('answers 404 for a missing conference and 400 for a bad id (B12, B13)', async () => {
    expect((await send('put', '/api/conferences/999', FULL)).status).toBe(404);
    expect((await send('put', '/api/conferences/abc', FULL)).status).toBe(400);
  });

  it('refuses dates that would leave sessions outside, listing them (spec 6.3)', async () => {
    const conference = await makeConference(t.prisma, { startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00' });
    await makeSession(t.prisma, conference.id, { startTime: '2026-11-13T10:00:00', endTime: '2026-11-13T11:00:00' });
    const res = await send('put', '/api/conferences/1', { ...FULL, startDate: '2026-11-12T00:00:00', endDate: '2026-11-12T00:00:00' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Sessions 1 would fall outside the new conference dates');
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: 1 } })).endDate.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });
});
```
Run: `npm run test:int -- conferences` → Expected: FAIL (404 Route not found).

- [ ] **Step 2: DTO**

`backend/src/conferences/conference.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { CONFERENCE_STATUSES, type ConferenceStatus } from '../common/status';
import { IsLaterThan, IsPresent, IsWallClock, isPositiveInt32, isText, isUrlValue, NullOr } from '../common/validation';

const L = LIMITS.conferences;
const WALL = { type: String, example: '2026-11-12T00:00:00', description: 'YYYY-MM-DDTHH:mm:ss, venue wall-clock time, no offset (spec 5.5)' };
const STATUS_DOC = {
  enum: CONFERENCE_STATUSES,
  nullable: true,
  description: 'CANCELLED cancels; null means not cancelled. UPCOMING/ACTIVE/COMPLETED are accepted only if they match the status derived from the dates.',
};
const nullableText = (max: number) => NullOr('isNullableText', isText(max), `must be a string of at most ${max} characters or null`);

export class CreateConferenceDto {
  @ApiProperty({ example: 'Frontend Frontiers 2026', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Description }) @IsOptional() @IsString() @MaxLength(L.Description) description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Location }) @IsOptional() @IsString() @MaxLength(L.Location) location?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Venue }) @IsOptional() @IsString() @MaxLength(L.Venue) venue?: string | null;
  @ApiProperty(WALL) @IsWallClock() startDate!: string;
  @ApiProperty({ ...WALL, example: '2026-11-13T00:00:00' }) @IsWallClock() @IsLaterThan('startDate', { allowEqual: true }) endDate!: string;
  @ApiPropertyOptional(STATUS_DOC) @IsOptional() @IsIn(CONFERENCE_STATUSES) status?: ConferenceStatus | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: INT32_MAX }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) maxAttendees?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.OrganizerName }) @IsOptional() @IsString() @MaxLength(L.OrganizerName) organizerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Website }) @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(L.Website) website?: string | null;
}

// PUT is a full replacement: every key must be present, null clears a nullable field (spec 5.4, CORR-5).
export class UpdateConferenceDto {
  @ApiProperty({ example: 'Frontend Frontiers 2026', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Description }) @IsPresent() @nullableText(L.Description) description!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Location }) @IsPresent() @nullableText(L.Location) location!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Venue }) @IsPresent() @nullableText(L.Venue) venue!: string | null;
  @ApiProperty(WALL) @IsWallClock() startDate!: string;
  @ApiProperty({ ...WALL, example: '2026-11-13T00:00:00' }) @IsWallClock() @IsLaterThan('startDate', { allowEqual: true }) endDate!: string;
  @ApiProperty(STATUS_DOC)
  @IsPresent()
  @NullOr('isConferenceStatus', (v) => (CONFERENCE_STATUSES as readonly unknown[]).includes(v), `must be one of ${CONFERENCE_STATUSES.join(', ')} or null`)
  status!: ConferenceStatus | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: INT32_MAX })
  @IsPresent()
  @NullOr('isPositiveInt32', isPositiveInt32, `must be an integer between 1 and ${INT32_MAX} or null`)
  maxAttendees!: number | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.OrganizerName }) @IsPresent() @nullableText(L.OrganizerName) organizerName!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Website })
  @IsPresent()
  @NullOr('isUrl', isUrlValue(L.Website), `must be an http(s) URL of at most ${L.Website} characters or null`)
  website!: string | null;
}
```

- [ ] **Step 3: Сервис, контроллер, модуль**

`backend/src/conferences/conferences.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { isWithinDays, requireWallClock } from '../common/dates';
import { badRequest, conflict, notFound } from '../common/errors';
import { lockConference } from '../common/locking';
import { resolveStatusInput } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { toConference } from '../representation/mappers';
import type { ConferenceResponse } from '../representation/responses';
import { conferenceWithRelations } from '../representation/selects';
import type { CreateConferenceDto, UpdateConferenceDto } from './conference.dto';

@Injectable()
export class ConferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<ConferenceResponse[]> {
    const rows = await this.prisma.conference.findMany({ select: conferenceWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toConference(row, now));
  }

  async get(id: number): Promise<ConferenceResponse> {
    const row = await this.prisma.conference.findUnique({ where: { id }, select: conferenceWithRelations });
    if (!row) throw notFound(`Conference ${id} not found`);
    return toConference(row, this.clock.now());
  }

  async create(dto: CreateConferenceDto): Promise<ConferenceResponse> {
    const row = await this.prisma.conference.create({ data: this.toData(dto), select: conferenceWithRelations });
    return toConference(row, this.clock.now());
  }

  async update(id: number, dto: UpdateConferenceDto): Promise<ConferenceResponse> {
    const data = this.toData(dto);
    // One transaction with the conference row locked: without it a session added concurrently could end up outside
    // the new dates, and a failed check after the first write would leave a half-applied update (CORR-6, REL-4).
    const row = await this.prisma.$transaction(async (tx) => {
      if (!(await lockConference(tx, id))) throw notFound(`Conference ${id} not found`);
      const sessions = await tx.session.findMany({ where: { conferenceId: id }, select: { id: true, startTime: true, endTime: true }, orderBy: { id: 'asc' } });
      const outside = sessions.filter((s) => !isWithinDays(s.startTime, s.endTime, data.startDate, data.endDate));
      if (outside.length > 0) throw conflict(`Sessions ${outside.map((s) => s.id).join(', ')} would fall outside the new conference dates`);
      return tx.conference.update({ where: { id }, data, select: conferenceWithRelations });
    });
    return toConference(row, this.clock.now());
  }

  private toData(dto: CreateConferenceDto | UpdateConferenceDto) {
    const startDate = requireWallClock(dto.startDate);
    const endDate = requireWallClock(dto.endDate);
    const status = resolveStatusInput(dto.status, startDate, endDate, this.clock.now());
    if (!status.ok) throw badRequest('Validation failed', [{ field: 'status', messages: [status.message] }]);
    return {
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      venue: dto.venue ?? null,
      startDate,
      endDate,
      status: status.cancelled ? 'CANCELLED' : null,
      maxAttendees: dto.maxAttendees ?? null,
      organizerName: dto.organizerName ?? null,
      website: dto.website ?? null,
    };
  }
}
```

`backend/src/conferences/conferences.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ConferenceResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { CreateConferenceDto, UpdateConferenceDto } from './conference.dto';
import { ConferencesService } from './conferences.service';

const EXAMPLE = {
  title: 'Frontend Frontiers 2026', description: 'React, TypeScript and web performance for product teams.', location: 'Berlin, Germany',
  venue: 'Station Berlin', startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00', status: null, maxAttendees: 350,
  organizerName: 'Web Guild', website: 'https://frontendfrontiers.example.com',
};

@ApiTags('Conferences')
@Controller('conferences')
export class ConferencesController {
  constructor(private readonly conferences: ConferencesService) {}

  @Get()
  @ApiOperation({ operationId: 'Conferences_GetAll', summary: 'List conferences with their sessions and registrations' })
  @ApiOkResponse({ type: [ConferenceResponse] })
  @ApiErrors(503)
  list(): Promise<ConferenceResponse[]> {
    return this.conferences.list();
  }

  @Get(':id')
  @ApiOperation({ operationId: 'Conferences_GetById', summary: 'Get a conference' })
  @ApiOkResponse({ type: ConferenceResponse })
  @ApiErrors(400, 404, 503)
  get(@Param('id', ParseIdPipe) id: number): Promise<ConferenceResponse> {
    return this.conferences.get(id);
  }

  @Post()
  @ApiOperation({ operationId: 'Conferences_Create', summary: 'Create a conference' })
  @ApiBody({ type: CreateConferenceDto, examples: { conference: { value: EXAMPLE } } })
  @ApiCreatedResponse({ type: ConferenceResponse, description: 'Location: /api/conferences/{id}' })
  @ApiErrors(400, 413, 415, 503)
  async create(@Body() dto: CreateConferenceDto, @Res({ passthrough: true }) res: Response): Promise<ConferenceResponse> {
    const created = await this.conferences.create(dto);
    res.setHeader('Location', `/api/conferences/${created.id}`);
    return created;
  }

  @Put(':id')
  @ApiOperation({ operationId: 'Conferences_Update', summary: 'Replace a conference', description: 'Full replacement: every key is required, null clears a nullable field.' })
  @ApiBody({ type: UpdateConferenceDto, examples: { conference: { value: EXAMPLE } } })
  @ApiOkResponse({ type: ConferenceResponse })
  @ApiErrors(400, 404, 409, 413, 415, 503)
  update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateConferenceDto): Promise<ConferenceResponse> {
    return this.conferences.update(id, dto);
  }
}
```
`backend/src/conferences/conferences.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConferencesController } from './conferences.controller';
import { ConferencesService } from './conferences.service';

@Module({ controllers: [ConferencesController], providers: [ConferencesService] })
export class ConferencesModule {}
```
В `app.module.ts` добавить `ConferencesModule`.

- [ ] **Step 4: Прогон и commit (после «ок»)**

Run: `npm run test:int -- conferences` → Expected: PASS. Затем `npm run lint && npm run typecheck && npm test && npm run test:int`.
```bash
git add backend/src backend/test
git status && git diff --cached --stat
git commit -m "feat: add conference endpoints with derived status and full-replacement PUT (EXT-150)"
```

---

### Task 7: Сессии

**Files:**
- Create: `backend/src/sessions/session.dto.ts`, `sessions.service.ts`, `sessions.controller.ts`, `sessions.module.ts`
- Modify: `backend/src/conferences/conferences.controller.ts` (маршруты `:id/sessions`), `backend/src/conferences/conferences.module.ts` (импорт `SessionsModule`), `backend/src/app.module.ts`
- Test: `backend/test/integration/sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `lockConference`, `LockedConference`, `Tx`, `isWithinDays`, `requireWallClock`, `sessionWithRelations`, `toSession`, `unprocessable`.
- Produces: `CreateSessionDto`, `UpdateSessionDto`; `SessionsService.listForConference(conferenceId)`, `.get(id)`, `.create(conferenceId, dto)`, `.update(id, dto)`; `SessionsModule` экспортирует `SessionsService`.

- [ ] **Step 1: Тесты — падают**

`backend/test/integration/sessions.e2e-spec.ts`:
```ts
import { makeConference, makeRoom, makeSession, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: unknown) => t.http()[method](path).set('Content-Type', 'application/json').send(body as object);
const fieldsOf = (res: { body: { errors?: { field: string }[] } }) => (res.body.errors ?? []).map((e) => e.field);
// Conference 1: 2027-01-10..2027-01-11; speaker 1 (public email), room 1 Hall A (300), room 2 Room 101 (80).
const SESSION = { title: 'Platform Engineering Without the Hype', description: 'IDP on day one.', startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 80, speakerId: 1, roomId: 2 };

beforeEach(async () => {
  await resetDb(t.prisma);
  const conference = await makeConference(t.prisma);
  await makeSpeaker(t.prisma, { emailPublic: true });
  await makeRoom(t.prisma, { name: 'Hall A', capacity: 300 });
  await makeRoom(t.prisma, { name: 'Room 101', capacity: 80 });
  await makeSession(t.prisma, conference.id, { speakerId: 1, roomId: 1 });
});

describe('GET sessions', () => {
  it('lists a conference sessions as a bare array with conference, speaker, room (A06, C09, spec 5.1)', async () => {
    const res = await t.http().get('/api/conferences/1/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Object.keys(res.body[0]).sort()).toEqual(['capacity', 'conference', 'conferenceId', 'description', 'endTime', 'id', 'room', 'roomId', 'speaker', 'speakerId', 'startTime', 'title']);
    expect(Object.keys(res.body[0].conference)).not.toContain('sessions');
    expect(res.body[0].speaker).toEqual({ id: 1, firstName: 'Alice', lastName: 'Novak', bio: 'Bio', email: 'alice.novak@example.com', emailPublic: true });
    expect(res.body[0].room).toEqual({ id: 1, name: 'Hall A', capacity: 300, location: 'Ground Floor' });
  });
  it.each([['/api/conferences/999/sessions', 404], ['/api/conferences/abc/sessions', 400], ['/api/sessions/1', 200], ['/api/sessions/999', 404], ['/api/sessions/abc', 400]])(
    'GET %s -> %d (A07, A10-A12)',
    async (path, status) => {
      expect((await t.http().get(path)).status).toBe(status);
    },
  );
});

describe('POST /api/conferences/:id/sessions', () => {
  it('creates: 201 + Location (C01, MNT-2)', async () => {
    const res = await send('post', '/api/conferences/1/sessions', SESSION);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/sessions/2');
    expect(res.body).toMatchObject({ ...SESSION, id: 2, conferenceId: 1 });
  });
  it('accepts capacity equal to the room capacity', async () => {
    expect((await send('post', '/api/conferences/1/sessions', { ...SESSION, capacity: 80 })).status).toBe(201);
  });
  it.each([
    ['{} (C02)', {}, ['title', 'startTime', 'endTime', 'capacity']],
    ['end equal to start', { ...SESSION, endTime: SESSION.startTime }, ['endTime']],
    ['negative capacity (C05)', { ...SESSION, capacity: -5 }, ['capacity']],
    ['int32 overflow (Review Focus 3)', { ...SESSION, capacity: 3_000_000_000, speakerId: 3_000_000_000 }, ['capacity', 'speakerId']],
    ['conferenceId in the body', { ...SESSION, conferenceId: 1 }, ['conferenceId']],
  ])('rejects %s with 400', async (_name, body, fields) => {
    const res = await send('post', '/api/conferences/1/sessions', body);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(fields));
  });
  it('rejects a session outside the conference days with 422', async () => {
    const res = await send('post', '/api/conferences/1/sessions', { ...SESSION, startTime: '2027-01-12T10:00:00', endTime: '2027-01-12T11:00:00' });
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['startTime']);
  });
  it('rejects capacity above the room capacity with 422', async () => {
    const res = await send('post', '/api/conferences/1/sessions', { ...SESSION, capacity: 81 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ field: 'capacity', messages: ['capacity must not exceed the room capacity (80)'] }]);
  });
  it('answers 422 on a missing speaker and keeps working afterwards (C10 -> C11, REL-2)', async () => {
    const bad = await send('post', '/api/conferences/1/sessions', { ...SESSION, speakerId: 999 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual([{ field: 'speakerId', messages: ['speakerId does not reference an existing record'] }]);
    expect((await send('post', '/api/speakers', { firstName: 'Valid', lastName: 'Speaker' })).status).toBe(201);
  });
  it('answers 422 on a missing room', async () => {
    expect(fieldsOf(await send('post', '/api/conferences/1/sessions', { ...SESSION, roomId: 999 }))).toEqual(['roomId']);
  });
  it('answers 404 for a missing conference', async () => {
    expect((await send('post', '/api/conferences/999/sessions', SESSION)).status).toBe(404);
  });
});

describe('PUT /api/sessions/:id', () => {
  it('replaces the session (C04)', async () => {
    const res = await send('put', '/api/sessions/1', { ...SESSION, title: 'Kubernetes for .NET Developers', capacity: 250, roomId: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: 'Kubernetes for .NET Developers', capacity: 250, roomId: 1 });
  });
  it('requires every key (C06) and refuses conferenceId (C08)', async () => {
    expect(fieldsOf(await send('put', '/api/sessions/1', { title: 'Only title' }))).toEqual(expect.arrayContaining(['description', 'startTime', 'endTime', 'capacity', 'speakerId', 'roomId']));
    expect(fieldsOf(await send('put', '/api/sessions/1', { ...SESSION, conferenceId: 1 }))).toEqual(['conferenceId']);
  });
  it('allows null for speaker and room', async () => {
    const res = await send('put', '/api/sessions/1', { ...SESSION, description: null, speakerId: null, roomId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ speaker: null, room: null });
  });
  it('answers 404 for a missing session (C07)', async () => {
    expect((await send('put', '/api/sessions/999', SESSION)).status).toBe(404);
  });
});
```
Run: `npm run test:int -- sessions` → Expected: FAIL.

- [ ] **Step 2: DTO**

`backend/src/sessions/session.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { IsLaterThan, IsPresent, IsWallClock, isPositiveInt32, isText, NullOr } from '../common/validation';

const L = LIMITS.sessions;
const WALL = { type: String, example: '2025-03-06T10:00:00', description: 'YYYY-MM-DDTHH:mm:ss, venue wall-clock time; must fall within the conference days' };
const nullableId = (name: string) => NullOr(`isNullable${name}`, isPositiveInt32, `must be an integer between 1 and ${INT32_MAX} or null`);

export class CreateSessionDto {
  @ApiProperty({ example: 'Platform Engineering Without the Hype', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Description }) @IsOptional() @IsString() @MaxLength(L.Description) description?: string | null;
  @ApiProperty(WALL) @IsWallClock() startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T11:00:00' }) @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @ApiProperty({ example: 80, minimum: 1, maximum: INT32_MAX, description: 'At most the room capacity' }) @IsInt() @Min(1) @Max(INT32_MAX) capacity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) speakerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 2, description: 'Seeded rooms have ids 1-4; there is no rooms endpoint' }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) roomId?: number | null;
}

// Full replacement; conferenceId is not part of the body: a session never moves between conferences (spec 6.3, C08).
export class UpdateSessionDto {
  @ApiProperty({ maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Description })
  @IsPresent()
  @NullOr('isNullableText', isText(L.Description), `must be a string of at most ${L.Description} characters or null`)
  description!: string | null;
  @ApiProperty(WALL) @IsWallClock() startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T11:00:00' }) @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @ApiProperty({ example: 80, minimum: 1, maximum: INT32_MAX }) @IsInt() @Min(1) @Max(INT32_MAX) capacity!: number;
  @ApiProperty({ type: Number, nullable: true }) @IsPresent() @nullableId('SpeakerId') speakerId!: number | null;
  @ApiProperty({ type: Number, nullable: true }) @IsPresent() @nullableId('RoomId') roomId!: number | null;
}
```

- [ ] **Step 3: Сервис, контроллеры, модули**

`backend/src/sessions/sessions.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { isWithinDays, requireWallClock } from '../common/dates';
import { notFound, unprocessable, type FieldError } from '../common/errors';
import { lockConference, type LockedConference, type Tx } from '../common/locking';
import { PrismaService } from '../prisma/prisma.service';
import { toSession } from '../representation/mappers';
import type { SessionResponse } from '../representation/responses';
import { sessionWithRelations } from '../representation/selects';
import type { CreateSessionDto, UpdateSessionDto } from './session.dto';

interface SessionData {
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  capacity: number;
  speakerId: number | null;
  roomId: number | null;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async listForConference(conferenceId: number): Promise<SessionResponse[]> {
    const conference = await this.prisma.conference.findUnique({ where: { id: conferenceId }, select: { id: true } });
    if (!conference) throw notFound(`Conference ${conferenceId} not found`);
    const rows = await this.prisma.session.findMany({ where: { conferenceId }, select: sessionWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toSession(row, now));
  }

  async get(id: number): Promise<SessionResponse> {
    const row = await this.prisma.session.findUnique({ where: { id }, select: sessionWithRelations });
    if (!row) throw notFound(`Session ${id} not found`);
    return toSession(row, this.clock.now());
  }

  async create(conferenceId: number, dto: CreateSessionDto): Promise<SessionResponse> {
    const data = toSessionData(dto);
    // The conference row is locked: a concurrent PUT of the conference could otherwise move its dates so that this
    // session ends up outside them (spec 6.3). A missing speaker/room fails on the FK -> 422, no pre-check (spec 5.6).
    const row = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(`Conference ${conferenceId} not found`);
      await checkRules(tx, conference, data);
      return tx.session.create({ data: { ...data, conferenceId }, select: sessionWithRelations });
    });
    return toSession(row, this.clock.now());
  }

  async update(id: number, dto: UpdateSessionDto): Promise<SessionResponse> {
    const data = toSessionData(dto);
    const current = await this.prisma.session.findUnique({ where: { id }, select: { conferenceId: true } });
    if (!current) throw notFound(`Session ${id} not found`);
    // Same lock as create: the rules depend on the conference dates. conferenceId never changes, so reading it first is safe.
    const row = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, current.conferenceId);
      if (!conference) throw notFound(`Conference ${current.conferenceId} not found`);
      await checkRules(tx, conference, data);
      return tx.session.update({ where: { id }, data, select: sessionWithRelations });
    });
    return toSession(row, this.clock.now());
  }
}

function toSessionData(dto: CreateSessionDto | UpdateSessionDto): SessionData {
  return {
    title: dto.title,
    description: dto.description ?? null,
    startTime: requireWallClock(dto.startTime),
    endTime: requireWallClock(dto.endTime),
    capacity: dto.capacity,
    speakerId: dto.speakerId ?? null,
    roomId: dto.roomId ?? null,
  };
}

async function checkRules(tx: Tx, conference: LockedConference, data: SessionData): Promise<void> {
  const errors: FieldError[] = [];
  if (!isWithinDays(data.startTime, data.endTime, conference.startDate, conference.endDate)) {
    errors.push({ field: 'startTime', messages: ['the session must take place within the conference days'] });
  }
  if (data.roomId !== null) {
    const room = await tx.room.findUnique({ where: { id: data.roomId }, select: { capacity: true } });
    if (room && data.capacity > room.capacity) errors.push({ field: 'capacity', messages: [`capacity must not exceed the room capacity (${room.capacity})`] });
  }
  if (errors.length > 0) throw unprocessable('Session violates conference rules', errors);
}
```

`backend/src/sessions/sessions.controller.ts`:
```ts
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { SessionResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { UpdateSessionDto } from './session.dto';
import { SessionsService } from './sessions.service';

@ApiTags('Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id')
  @ApiOperation({ operationId: 'Sessions_GetById', summary: 'Get a session with its conference, speaker and room' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrors(400, 404, 503)
  get(@Param('id', ParseIdPipe) id: number): Promise<SessionResponse> {
    return this.sessions.get(id);
  }

  @Put(':id')
  @ApiOperation({ operationId: 'Sessions_Update', summary: 'Replace a session', description: 'Full replacement; conferenceId cannot be sent.' })
  @ApiBody({ type: UpdateSessionDto, examples: { session: { value: { title: 'Kubernetes for .NET Developers', description: 'Updated', startTime: '2025-03-05T10:30:00', endTime: '2025-03-05T11:30:00', capacity: 250, speakerId: 3, roomId: 1 } } } })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrors(400, 404, 413, 415, 422, 503)
  update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateSessionDto): Promise<SessionResponse> {
    return this.sessions.update(id, dto);
  }
}
```

`backend/src/sessions/sessions.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({ controllers: [SessionsController], providers: [SessionsService], exports: [SessionsService] })
export class SessionsModule {}
```

В `backend/src/conferences/conferences.controller.ts` — добавить в конструктор `private readonly sessions: SessionsService` и методы:
```ts
  @Get(':id/sessions')
  @ApiOperation({ operationId: 'Conferences_GetSessions', summary: 'List sessions of a conference', description: 'A bare array (no {data} wrapper since EXT-150).' })
  @ApiOkResponse({ type: [SessionResponse] })
  @ApiErrors(400, 404, 503)
  listSessions(@Param('id', ParseIdPipe) id: number): Promise<SessionResponse[]> {
    return this.sessions.listForConference(id);
  }

  @Post(':id/sessions')
  @ApiOperation({ operationId: 'Conferences_AddSession', summary: 'Add a session to a conference' })
  @ApiBody({ type: CreateSessionDto, examples: { session: { value: { title: 'Platform Engineering Without the Hype', description: 'What an internal developer platform really needs on day one.', startTime: '2025-03-06T10:00:00', endTime: '2025-03-06T11:00:00', capacity: 80, speakerId: 3, roomId: 2 } } } })
  @ApiCreatedResponse({ type: SessionResponse, description: 'Location: /api/sessions/{id}' })
  @ApiErrors(400, 404, 413, 415, 422, 503)
  async addSession(@Param('id', ParseIdPipe) id: number, @Body() dto: CreateSessionDto, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const created = await this.sessions.create(id, dto);
    res.setHeader('Location', `/api/sessions/${created.id}`);
    return created;
  }
```
(импорты `SessionsService`, `CreateSessionDto`, `SessionResponse`.) В `conferences.module.ts` — `imports: [SessionsModule]`. В `app.module.ts` — `SessionsModule`.

- [ ] **Step 4: Прогон и commit (после «ок»)**

Run: `npm run test:int -- sessions` → PASS; затем полный прогон (`lint`, `typecheck`, `test`, `test:int`).
```bash
git add backend/src backend/test
git status && git diff --cached --stat
git commit -m "feat: add session endpoints with conference-day and room-capacity rules (EXT-150)"
```

---

### Task 8: Регистрации

**Files:**
- Create: `backend/src/registrations/register.dto.ts`, `registrations.service.ts`, `registrations.controller.ts`, `registrations.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/integration/registrations.e2e-spec.ts`

**Interfaces:**
- Consumes: `lockConference`, `computeStatus`, `isRegistrationOpen`, `registrationWithRelations`, `toRegistration`, `inspectDbError`, `Clock`.
- Produces: `RegisterAttendeeDto`; `RegistrationsService.listForConference(id)`, `.register(conferenceId, dto)`; `RegistrationsController` на `@Controller('conferences')` с `operationId` `Conferences_GetRegistrations`, `Conferences_Register`.

- [ ] **Step 1: Тесты — падают**

`backend/test/integration/registrations.e2e-spec.ts`:
```ts
import { lockConference } from '../../src/common/locking';
import { makeAttendee, makeConference, makeRegistration } from './fixtures';
import { createTestApp, newPrisma, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const register = (conferenceId: number | string, body: unknown) =>
  t.http().post(`/api/conferences/${conferenceId}/register`).set('Content-Type', 'application/json').send(body as object);
// Bodies sent by the two frontend forms (D04 modal, D05 page).
const MODAL = { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com', phone: '', company: '', dietaryRequirements: '', sessionId: null };
const PAGE = { firstName: 'Jan', lastName: 'Nowak', email: 'jan.nowak@example.com', phone: '+48 600 000 000', company: 'ACME' };

describe('POST /api/conferences/:id/register', () => {
  it('registers from the modal form: 201, attendee without email, registeredAt with Z (D04, spec 5.3, 5.5)', async () => {
    await makeConference(t.prisma);
    const res = await register(1, MODAL);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toMatchObject({ id: 1, registeredAt: '2026-10-05T12:00:00.000Z', status: 'CONFIRMED', conferenceId: 1, attendeeId: 1, attendee: { id: 1, firstName: 'Maria', lastName: 'Kowalska' } });
    expect(Object.keys(res.body.attendee).sort()).toEqual(['firstName', 'id', 'lastName']);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('registers from the page form and ignores the unstored fields (D05, D06)', async () => {
    await makeConference(t.prisma);
    expect((await register(1, PAGE)).status).toBe(201);
    expect((await register(1, { ...MODAL, email: 'other@example.com', sessionId: 6 })).status).toBe(201);
  });

  it.each([
    [{}, ['firstName', 'lastName', 'email']],
    [{ ...MODAL, sessionId: '5' }, ['sessionId']],
    [{ ...MODAL, sessionId: 0 }, ['sessionId']],
    [{ ...MODAL, sessionId: 3_000_000_000 }, ['sessionId']],
    [{ ...MODAL, email: 'иван@пример.рф' }, ['email']],
    [{ ...MODAL, phone: 'x'.repeat(51) }, ['phone']],
    [{ ...MODAL, status: 'VIP' }, ['status']],
  ])('rejects %j with 400 (D10, Review Focus 3)', async (body, fields) => {
    await makeConference(t.prisma);
    const res = await register(1, body);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(expect.arrayContaining(fields));
  });

  it('keeps non-ASCII names intact (Review Focus 4)', async () => {
    await makeConference(t.prisma);
    const res = await register(1, { ...MODAL, firstName: 'Мария', lastName: 'Kowalská' });
    expect(res.status).toBe(201);
    expect(res.body.attendee).toMatchObject({ firstName: 'Мария', lastName: 'Kowalská' });
  });

  it('refuses a duplicate, whatever the case, spaces or name (D07-D09, Review Focus 5, CORR-3)', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    for (const body of [MODAL, { ...MODAL, firstName: 'Other', lastName: 'Name' }, { ...MODAL, firstName: 'Maria', lastName: 'Upper', email: '  MARIA.Kowalska@Example.com ' }]) {
      const res = await register(1, body);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Attendee is already registered for this conference');
    }
    expect(await t.prisma.attendee.count()).toBe(1);
    expect(await t.prisma.registration.count()).toBe(1);
  });

  it('reuses the attendee on another conference and keeps the stored name (spec 6.2)', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    await register(1, MODAL);
    const res = await register(2, { ...MODAL, firstName: 'Other', email: ' Maria.Kowalska@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.attendee).toEqual({ id: 1, firstName: 'Maria', lastName: 'Kowalska' });
  });

  it.each([
    ['COMPLETED (D11)', { startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00' }],
    ['CANCELLED', { status: 'CANCELLED' }],
  ])('refuses a %s conference with 409 (CORR-1)', async (_name, conference) => {
    await makeConference(t.prisma, conference);
    const res = await register(1, MODAL);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Registration is closed: the conference is (COMPLETED|CANCELLED)$/);
  });

  it('allows an ACTIVE conference on its last day', async () => {
    await makeConference(t.prisma, { startDate: '2026-10-04T00:00:00', endDate: '2026-10-05T00:00:00' });
    expect((await register(1, MODAL)).status).toBe(201);
  });

  it('answers 404 for a missing conference and creates no attendee (D16, REL-5)', async () => {
    expect((await register(9999, MODAL)).status).toBe(404);
    expect(await t.prisma.attendee.count()).toBe(0);
  });

  it('refuses a full conference with 409', async () => {
    await makeConference(t.prisma, { maxAttendees: 1 });
    await register(1, MODAL);
    const res = await register(1, PAGE);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('No seats left');
  });

  it('gives the last seat to exactly one of ten parallel requests (CORR-1, spec 6.2)', async () => {
    await makeConference(t.prisma, { maxAttendees: 3 });
    await register(1, { ...MODAL, email: 'a@example.com' });
    await register(1, { ...MODAL, email: 'b@example.com' });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => register(1, { ...MODAL, email: `racer${i}@example.com` })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(await t.prisma.registration.count()).toBe(3);
  });

  it('creates one attendee for one new email on two conferences at once (spec 6.2)', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    const [a, b] = await Promise.all([register(1, MODAL), register(2, MODAL)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.attendeeId).toBe(b.body.attendeeId);
    expect(await t.prisma.attendee.count()).toBe(1);
  });

  it('answers 503 with Retry-After while the conference is locked longer than lock_timeout (spec 8)', async () => {
    await makeConference(t.prisma);
    const other = newPrisma();
    let release: () => void = () => undefined;
    const held = other.$transaction(
      async (tx) => {
        await lockConference(tx, 1);
        await new Promise<void>((resolve) => (release = resolve));
      },
      { timeout: 15000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const res = await register(1, MODAL);
    release();
    await held;
    await other.$disconnect();
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
  });
});

describe('GET /api/conferences/:id/registrations', () => {
  it('lists registrations with conference and public attendee, no email anywhere (D13, SEC-1)', async () => {
    await makeConference(t.prisma);
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, 1, attendee.id);
    const res = await t.http().get('/api/conferences/1/registrations');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 1, registeredAt: '2026-10-01T09:00:00.000Z', attendee: { id: 1, firstName: 'Maria', lastName: 'Kowalska' }, conference: { id: 1 } });
    expect(JSON.stringify(res.body)).not.toContain('@');
    const conference = await t.http().get('/api/conferences/1');
    expect(Object.keys(conference.body.registrations[0])).not.toContain('attendee');
  });
  it.each([['999', 404], ['abc', 400]])('GET /api/conferences/%s/registrations -> %d (A09)', async (id, status) => {
    expect((await t.http().get(`/api/conferences/${id}/registrations`)).status).toBe(status);
  });
});
```
Run: `npm run test:int -- registrations` → Expected: FAIL.

- [ ] **Step 2: DTO**

`backend/src/registrations/register.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { IsAsciiEmail, NormalizeEmail } from '../common/validation';

const NOT_STORED = 'Accepted from the registration forms, not stored (spec 5.4).';

export class RegisterAttendeeDto {
  @ApiProperty({ example: 'Maria', maxLength: LIMITS.attendees.FirstName, description: 'Ignored if the attendee already exists: the stored name is kept and returned.' })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.attendees.FirstName)
  firstName!: string;

  @ApiProperty({ example: 'Kowalska', maxLength: LIMITS.attendees.LastName })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.attendees.LastName)
  lastName!: string;

  @ApiProperty({ example: 'maria.kowalska@example.com', description: 'ASCII only; trimmed and lower-cased; identifies the attendee. Never returned.' })
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+48 600 000 000', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.phone) phone?: string;
  @ApiPropertyOptional({ example: 'ACME', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.company) company?: string;
  @ApiPropertyOptional({ example: '', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.dietaryRequirements) dietaryRequirements?: string;
  @ApiPropertyOptional({ type: Number, nullable: true, example: null, description: `${NOT_STORED} Not checked against existing sessions.` })
  @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX)
  sessionId?: number | null;
}
```

- [ ] **Step 3: Сервис, контроллер, модуль**

`backend/src/registrations/registrations.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { conflict, notFound } from '../common/errors';
import { lockConference } from '../common/locking';
import { computeStatus, isRegistrationOpen } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { toRegistration } from '../representation/mappers';
import type { RegistrationResponse } from '../representation/responses';
import { registrationWithRelations } from '../representation/selects';
import type { RegisterAttendeeDto } from './register.dto';

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async listForConference(conferenceId: number): Promise<RegistrationResponse[]> {
    const conference = await this.prisma.conference.findUnique({ where: { id: conferenceId }, select: { id: true } });
    if (!conference) throw notFound(`Conference ${conferenceId} not found`);
    const rows = await this.prisma.registration.findMany({ where: { conferenceId }, select: registrationWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toRegistration(row, now));
  }

  async register(conferenceId: number, dto: RegisterAttendeeDto): Promise<RegistrationResponse> {
    const now = this.clock.now();
    // One transaction with the conference row locked (spec 6.2). Without it a failure after creating the attendee
    // left an orphan attendee (REL-5), and two requests for the last seat could both pass the count check (CORR-1).
    const row = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(`Conference ${conferenceId} not found`);
      const status = computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now);
      if (!isRegistrationOpen(status)) throw conflict(`Registration is closed: the conference is ${status}`);
      // The conference lock does not cover the same new email arriving for another conference at the same time:
      // ON CONFLICT waits for the other insert and then reuses its row instead of failing with a unique violation.
      await tx.$executeRaw`
        INSERT INTO "attendees" ("FirstName", "LastName", "Email") VALUES (${dto.firstName}, ${dto.lastName}, ${dto.email})
        ON CONFLICT ("Email") DO NOTHING`;
      const attendee = await tx.attendee.findUniqueOrThrow({ where: { email: dto.email }, select: { id: true } });
      const existing = await tx.registration.findUnique({ where: { conferenceId_attendeeId: { conferenceId, attendeeId: attendee.id } }, select: { id: true } });
      if (existing) throw conflict('Attendee is already registered for this conference');
      if (conference.maxAttendees !== null) {
        const taken = await tx.registration.count({ where: { conferenceId, status: 'CONFIRMED' } });
        if (taken >= conference.maxAttendees) throw conflict('No seats left');
      }
      return tx.registration.create({ data: { conferenceId, attendeeId: attendee.id, registeredAt: now }, select: registrationWithRelations });
    });
    return toRegistration(row, now);
  }
}
```

`backend/src/registrations/registrations.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { RegistrationResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { RegisterAttendeeDto } from './register.dto';
import { RegistrationsService } from './registrations.service';

// Same URLs as before (spec 4.2); a module of its own instead of a call from the conferences controller (MNT-3).
@ApiTags('Conferences')
@Controller('conferences')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get(':id/registrations')
  @ApiOperation({ operationId: 'Conferences_GetRegistrations', summary: 'List registrations of a conference', description: 'Attendee names only; emails are never returned (SEC-1).' })
  @ApiOkResponse({ type: [RegistrationResponse] })
  @ApiErrors(400, 404, 503)
  list(@Param('id', ParseIdPipe) id: number): Promise<RegistrationResponse[]> {
    return this.registrations.listForConference(id);
  }

  @Post(':id/register')
  @ApiOperation({
    operationId: 'Conferences_Register',
    summary: 'Register an attendee',
    description: 'Open while the conference is UPCOMING or ACTIVE and has seats. 409: already registered, no seats, closed. No Location header.',
  })
  @ApiBody({ type: RegisterAttendeeDto, examples: { modal: { value: { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com', phone: '', company: '', dietaryRequirements: '', sessionId: null } }, page: { value: { firstName: 'Jan', lastName: 'Nowak', email: 'jan.nowak@example.com', phone: '+48 600 000 000', company: 'ACME' } } } })
  @ApiCreatedResponse({ type: RegistrationResponse })
  @ApiErrors(400, 404, 409, 413, 415, 503)
  register(@Param('id', ParseIdPipe) id: number, @Body() dto: RegisterAttendeeDto): Promise<RegistrationResponse> {
    return this.registrations.register(id, dto);
  }
}
```

`backend/src/registrations/registrations.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({ controllers: [RegistrationsController], providers: [RegistrationsService] })
export class RegistrationsModule {}
```
В `app.module.ts` добавить `RegistrationsModule`.

- [ ] **Step 4: Прогон и commit (после «ок»)**

Run: `npm run test:int -- registrations` → PASS. Гонки повторить 5 раз подряд: `for i in 1 2 3 4 5; do npm run test:int -- registrations -t "parallel|two conferences" || break; done` — все прогоны зелёные (нестабильность = стоп и доклад). Затем полный прогон.
```bash
git add backend/src backend/test
git status && git diff --cached --stat
git commit -m "feat: add atomic registration with seat limit, duplicate and closed-conference checks (EXT-150)"
```

---

### Task 9: Число запросов, REL-1, перенос .NET-тестов

**Files:**
- Test: `backend/test/integration/query-count.e2e-spec.ts`, `backend/test/integration/ported-dotnet.e2e-spec.ts`, `backend/test/integration/logging.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService.onQuery`, `createTestApp`, фабрики.
- Produces: таблица «.NET-тест → новый тест» для PR (spec 11.3) — имена `describe`/`it` ниже совпадают с ней.

- [ ] **Step 1: Тест числа запросов (порт `QueryCountTests`, 11 кейсов)**

`backend/test/integration/query-count.e2e-spec.ts`:
```ts
import { makeAttendee, makeConference, makeRegistration, makeRoom, makeSession, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: object) => t.http()[method](path).set('Content-Type', 'application/json').send(body);

async function seed(sessions: number): Promise<void> {
  await resetDb(t.prisma);
  await makeConference(t.prisma, { maxAttendees: 1000 });
  await makeSpeaker(t.prisma, { emailPublic: true });
  await makeSpeaker(t.prisma, { firstName: 'Ben', email: 'ben@example.com' });
  await makeRoom(t.prisma, { name: 'Hall A', capacity: 300 });
  await makeRoom(t.prisma, { name: 'Room 101', capacity: 300 });
  for (let i = 0; i < sessions; i += 1) {
    await makeSession(t.prisma, 1, { title: `Talk ${i}`, speakerId: (i % 2) + 1, roomId: (i % 2) + 1 });
  }
  const registered = await makeAttendee(t.prisma, { email: 'registered@example.com' });
  await makeRegistration(t.prisma, 1, registered.id);
  await makeAttendee(t.prisma, { firstName: 'Attendee', email: 'attendee1@example.com' });
}

const CONFERENCE = { title: 'Updated', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: 1000, organizerName: null, website: null };
const CASES: Record<string, () => Promise<{ status: number }>> = {
  'GET /api/conferences': () => t.http().get('/api/conferences'),
  'GET /api/conferences/{id}': () => t.http().get('/api/conferences/1'),
  'GET /api/conferences/{id}/sessions': () => t.http().get('/api/conferences/1/sessions'),
  'GET /api/conferences/{id}/registrations': () => t.http().get('/api/conferences/1/registrations'),
  'GET /api/sessions/{id}': () => t.http().get('/api/sessions/1'),
  'GET /api/speakers': () => t.http().get('/api/speakers'),
  'PUT /api/conferences/{id}': () => send('put', '/api/conferences/1', CONFERENCE),
  'PUT /api/sessions/{id}': () => send('put', '/api/sessions/1', { title: 'Updated', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 5, speakerId: 2, roomId: 2 }),
  'POST /api/conferences/{id}/sessions': () => send('post', '/api/conferences/1/sessions', { title: 'New', startTime: '2027-01-10T12:00:00', endTime: '2027-01-10T13:00:00', capacity: 5, speakerId: 1, roomId: 1 }),
  'POST /api/conferences/{id}/register, new attendee': () => send('post', '/api/conferences/1/register', { firstName: 'New', lastName: 'Attendee', email: 'new@example.com' }),
  'POST /api/conferences/{id}/register, existing attendee': () => send('post', '/api/conferences/1/register', { firstName: 'Attendee', lastName: '1', email: 'attendee1@example.com' }),
};

describe('QueryCount_DoesNotDependOnNumberOfSessions (DoD-11, PERF-1)', () => {
  it.each(Object.keys(CASES))('%s runs as many queries with 40 sessions as with 2', async (name) => {
    const counts: number[] = [];
    for (const sessions of [2, 40]) {
      await seed(sessions);
      let queries = 0;
      const stop = t.prisma.onQuery(() => {
        queries += 1;
      });
      const res = await CASES[name]();
      stop();
      expect(res.status).toBeLessThan(300);
      counts.push(queries);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
});

describe('GetSessionsAsync_ReturnsSessionsWithDirectRelationsOnly', () => {
  it('returns each session with conference, speaker and room, each with its own fields only', async () => {
    await seed(2);
    const res = await t.http().get('/api/conferences/1/sessions');
    for (const session of res.body as Record<string, Record<string, unknown>>[]) {
      expect(Object.keys(session.conference)).not.toEqual(expect.arrayContaining(['sessions']));
      expect(Object.keys(session.conference)).not.toContain('registrations');
      expect(Object.keys(session.speaker)).not.toContain('sessions');
      expect(Object.keys(session.room)).not.toContain('sessions');
    }
  });
});

describe('REL-1: the three parallel requests of the conference page (audit step 2)', () => {
  it.each([1, 2, 3, 4, 5])('round %d on a fresh application: all 200', async () => {
    const fresh = await createTestApp();
    await resetDb(fresh.prisma);
    await makeConference(fresh.prisma);
    await makeSession(fresh.prisma, 1);
    const results = await Promise.all([
      fresh.http().get('/api/conferences/1'),
      fresh.http().get('/api/conferences/1/sessions'),
      fresh.http().get('/api/conferences/1/registrations'),
    ]);
    await fresh.close();
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });
});
```
Run: `npm run test:int -- query-count` → Expected: PASS. Повторить 3 раза — счётчики стабильны (иначе стоп, доклад: события `query` приходят после ответа).

- [ ] **Step 2: Перенос остальных .NET-тестов**

`backend/test/integration/ported-dotnet.e2e-spec.ts`:
```ts
import { makeConference, makeSession } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

// One-to-one port of BrownEvents.Tests (e95142d): ConferenceServiceTests (5) and SessionServiceTests (2), now over HTTP
// and a real Postgres (TEST-1). QueryCountTests are in query-count.e2e-spec.ts.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: object) => t.http()[method](path).set('Content-Type', 'application/json').send(body);
const CONFERENCE = { title: 'New Title', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: null, organizerName: null, website: null };

describe('ConferenceServiceTests', () => {
  it('GetAllAsync_ReturnsAllConferences', async () => {
    await makeConference(t.prisma, { title: 'A' });
    await makeConference(t.prisma, { title: 'B' });
    const res = await t.http().get('/api/conferences');
    expect(res.body.map((c: { title: string }) => c.title)).toEqual(['A', 'B']);
  });

  it('CreateAsync_PersistsConference', async () => {
    const res = await send('post', '/api/conferences', { title: 'Created', startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00' });
    expect(res.status).toBe(201);
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: res.body.id } })).title).toBe('Created');
  });

  // ADAPTED: the .NET test sent Status = "active" and expected "ACTIVE". Since EXT-150 the status is derived from the
  // dates and must match exactly (spec 5.4, D9b), so "active" is a 400. The test now checks the title change and the
  // derived status (precedent: BEVN-104 DoD "at least one existing unit test updated to reflect the new response shape").
  it('UpdateAsync_ChangesTitle', async () => {
    await makeConference(t.prisma, { title: 'Old Title' });
    const res = await send('put', '/api/conferences/1', CONFERENCE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'New Title', status: 'UPCOMING' });
    expect((await send('put', '/api/conferences/1', { ...CONFERENCE, status: 'active' })).status).toBe(400);
  });

  it('UpdateAsync_ReturnsNull_WhenNotFound -> 404', async () => {
    expect((await send('put', '/api/conferences/999', CONFERENCE)).status).toBe(404);
  });

  it('GetSessionsAsync_ReturnsOnlyConferenceSessions', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    await makeSession(t.prisma, 1, { title: 'Mine' });
    await makeSession(t.prisma, 2, { title: 'Other' });
    const res = await t.http().get('/api/conferences/1/sessions');
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(['Mine']);
  });
});

describe('SessionServiceTests', () => {
  const SESSION = { title: 'New Session Title', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 10, speakerId: null, roomId: null };

  it('UpdateAsync_ChangesSessionTitle', async () => {
    await makeConference(t.prisma);
    await makeSession(t.prisma, 1, { title: 'Old Session Title' });
    const res = await send('put', '/api/sessions/1', SESSION);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New Session Title');
  });

  it('UpdateAsync_ReturnsNull_WhenNotFound -> 404', async () => {
    expect((await send('put', '/api/sessions/999', SESSION)).status).toBe(404);
  });
});
```
Run: `npm run test:int -- ported-dotnet` → Expected: PASS.

- [ ] **Step 3: Логи — SQL по флагу, requestId (spec 9.3, 11.2; вместо шага 7 аудита)**

`backend/test/integration/logging.e2e-spec.ts`:
```ts
import { Logger, type LoggerService } from '@nestjs/common';
import { createTestApp, resetDb } from './helpers';

class CapturingLogger implements LoggerService {
  readonly entries: Record<string, unknown>[] = [];
  log(message: unknown): void {
    if (message !== null && typeof message === 'object') this.entries.push(message as Record<string, unknown>);
  }
  error(message: unknown): void {
    this.log(message);
  }
  warn(message: unknown): void {
    this.log(message);
  }
}

async function run(env: Record<string, string>) {
  const t = await createTestApp({ env });
  await resetDb(t.prisma);
  const logger = new CapturingLogger();
  Logger.overrideLogger(logger);
  const res = await t.http().get('/api/conferences');
  await t.close();
  Logger.overrideLogger(false);
  return { requestId: res.headers['x-request-id'] as string, entries: logger.entries };
}

describe('logs (CFG-2)', () => {
  it('has no SQL without LOG_SQL, but logs the request with its id', async () => {
    const { requestId, entries } = await run({});
    expect(entries.some((e) => 'query' in e)).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ requestId, method: 'GET', path: '/api/conferences', status: 200 }));
  });
  it('logs SQL with the request id and without parameters under LOG_SQL=true', async () => {
    const { requestId, entries } = await run({ LOG_SQL: 'true' });
    const sql = entries.filter((e) => 'query' in e);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.every((e) => e.requestId === requestId)).toBe(true);
    expect(sql.some((e) => 'params' in e)).toBe(false);
  });
  it('adds parameters only with LOG_SQL_PARAMS=true', async () => {
    const { entries } = await run({ LOG_SQL: 'true', LOG_SQL_PARAMS: 'true' });
    expect(entries.filter((e) => 'query' in e).every((e) => 'params' in e)).toBe(true);
  });
});
```
Run: `npm run test:int -- logging` → Expected: PASS. Если в SQL-строках нет `requestId` (контекст `AsyncLocalStorage` не доходит до событий Prisma) — стоп, доклад: это предположение spec, варианты — без `requestId` в SQL-строках (только в строке запроса) или иной способ; решает пользователь.

- [ ] **Step 4: Полный прогон и commit (после «ок»)**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`
```bash
git add backend/test
git status && git diff --cached --stat
git commit -m "test: port .NET tests, query-count and logging checks to the new backend (EXT-150)"
```

---

### Task 10: Сид демо-данных

**Files:**
- Create: `backend/prisma/seed.ts`
- Test: `backend/test/integration/seed.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `PrismaPg`, `DAY_MS`, `isWithinDays`.
- Produces: `seedDemoData(prisma: PrismaClient, now: Date): Promise<boolean>` (true — залито, false — данные уже есть); CLI: `node dist/prisma/seed.js` (читает `DATABASE_URL`).

- [ ] **Step 1: Тест — падает**

`backend/test/integration/seed.e2e-spec.ts`:
```ts
import { isWithinDays } from '../../src/common/dates';
import { seedDemoData } from '../../prisma/seed';
import { createTestApp, resetDb, type TestApp } from './helpers';

const NOW = new Date('2026-10-05T15:30:00.000Z');
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: NOW.toISOString() });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

describe('seedDemoData (spec 7.5)', () => {
  it('seeds once and then does nothing', async () => {
    expect(await seedDemoData(t.prisma, NOW)).toBe(true);
    expect(await seedDemoData(t.prisma, NOW)).toBe(false);
    expect([await t.prisma.speaker.count(), await t.prisma.room.count(), await t.prisma.conference.count(), await t.prisma.session.count()]).toEqual([3, 4, 3, 7]);
    expect(await t.prisma.registration.count()).toBe(0);
  });

  it('keeps .NET Summit in the past and moves the other two to +30 and +90 days with the same times of day', async () => {
    await seedDemoData(t.prisma, NOW);
    const res = await t.http().get('/api/conferences');
    const byTitle = Object.fromEntries((res.body as { title: string }[]).map((c) => [c.title, c])) as Record<string, { startDate: string; endDate: string; status: string; sessions: { startTime: string; endTime: string }[] }>;
    expect(byTitle['.NET Summit 2024']).toMatchObject({ startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00', status: 'COMPLETED' });
    expect(byTitle['CloudOps Days']).toMatchObject({ startDate: '2026-11-04T00:00:00', endDate: '2026-11-05T00:00:00', status: 'UPCOMING' });
    expect(byTitle['CloudOps Days'].sessions.map((s) => [s.startTime, s.endTime])).toEqual([
      ['2026-11-04T10:00:00', '2026-11-04T11:00:00'],
      ['2026-11-04T14:00:00', '2026-11-04T15:00:00'],
    ]);
    expect(byTitle['Data & AI Forum']).toMatchObject({ startDate: '2027-01-03T00:00:00', endDate: '2027-01-04T00:00:00', status: 'UPCOMING' });
    expect(byTitle['Data & AI Forum'].sessions.map((s) => [s.startTime, s.endTime])).toEqual([
      ['2027-01-03T10:00:00', '2027-01-03T11:30:00'],
      ['2027-01-03T14:00:00', '2027-01-03T15:00:00'],
    ]);
  });

  it('passes every domain rule and keeps room ids 1-4 and public speaker emails', async () => {
    await seedDemoData(t.prisma, NOW);
    const sessions = await t.prisma.session.findMany({ include: { conference: true, room: true } });
    for (const s of sessions) {
      expect(isWithinDays(s.startTime, s.endTime, s.conference.startDate, s.conference.endDate)).toBe(true);
      expect(s.capacity).toBeLessThanOrEqual(s.room?.capacity ?? Infinity);
    }
    expect((await t.prisma.room.findMany({ orderBy: { id: 'asc' } })).map((r) => [r.id, r.name])).toEqual([[1, 'Hall A'], [2, 'Room 101'], [3, 'Room 202'], [4, 'Workshop']]);
    expect((await t.http().get('/api/speakers')).body.map((s: { email: string }) => s.email)).toEqual(['alice.novak@example.com', 'ben.okafor@example.com', 'chloe.tanaka@example.com']);
  });

  it('makes demo registration work: open on CloudOps Days, closed on .NET Summit', async () => {
    await seedDemoData(t.prisma, NOW);
    const body = { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com' };
    expect((await t.http().post('/api/conferences/2/register').set('Content-Type', 'application/json').send(body)).status).toBe(201);
    expect((await t.http().post('/api/conferences/1/register').set('Content-Type', 'application/json').send(body)).status).toBe(409);
  });
});
```
Run: `npm run test:int -- seed` → Expected: FAIL (`Cannot find module '../../prisma/seed'`).

- [ ] **Step 2: Сид**

`backend/prisma/seed.ts`:
```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const DAY_MS = 86_400_000;

// Demo data of the .NET DataSeeder (e95142d), with two changes (spec 7.5, CORR-10): CloudOps Days and Data & AI Forum
// start 30 and 90 days after the seed runs, so registration works on the demo; statuses are derived, not stored.
export async function seedDemoData(prisma: PrismaClient, now: Date): Promise<boolean> {
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (dayOffset: number, hour = 0, minute = 0) => new Date(day0 + dayOffset * DAY_MS + (hour * 60 + minute) * 60_000);
  const fixed = (y: number, m: number, d: number, hour = 0, minute = 0) => new Date(Date.UTC(y, m - 1, d, hour, minute));

  // One transaction: the old seeder saved in four steps and checked only conferences, so a failure after the
  // speakers were saved left duplicate speakers behind on the next start (DataSeeder.cs:9, :18).
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.conference.count()) > 0) return false;

      const speaker = (firstName: string, lastName: string, bio: string, email: string) =>
        tx.speaker.create({ data: { firstName, lastName, bio, email, emailPublic: true } });
      const alice = await speaker('Alice', 'Novak', 'Principal Engineer at CloudScale. 15 years in distributed systems.', 'alice.novak@example.com');
      const ben = await speaker('Ben', 'Okafor', "Author of 'Pragmatic .NET'. Microsoft MVP.", 'ben.okafor@example.com');
      const chloe = await speaker('Chloe', 'Tanaka', 'Staff SRE at Observio. Reliability evangelist.', 'chloe.tanaka@example.com');

      const room = (name: string, capacity: number, location: string) => tx.room.create({ data: { name, capacity, location } });
      const hallA = await room('Hall A', 300, 'Ground Floor');
      const room101 = await room('Room 101', 80, 'First Floor');
      const room202 = await room('Room 202', 50, 'Second Floor');
      await room('Workshop', 30, 'Basement');

      const summit = await tx.conference.create({
        data: {
          title: '.NET Summit 2024',
          description: 'The premier .NET conference for enterprise developers. Three tracks covering ASP.NET Core, EF Core, and cloud-native patterns.',
          location: 'Prague, Czech Republic', venue: 'Prague Convention Centre', startDate: fixed(2024, 10, 14), endDate: fixed(2024, 10, 16),
          maxAttendees: 600, organizerName: 'DotNet Crew', website: 'https://dotnetsummit.example.com',
        },
      });
      const cloudOps = await tx.conference.create({
        data: {
          title: 'CloudOps Days', description: 'Kubernetes, observability, platform engineering, and SRE practices for modern infrastructure teams.',
          location: 'Amsterdam, Netherlands', venue: 'Beurs van Berlage', startDate: at(30), endDate: at(31), maxAttendees: 400, organizerName: 'Infra Guild',
        },
      });
      const dataAi = await tx.conference.create({
        data: {
          title: 'Data & AI Forum', description: 'Machine learning, vector databases, and LLM integrations for the working software engineer.',
          location: 'Warsaw, Poland', venue: 'Warsaw Expo Centre', startDate: at(90), endDate: at(91), maxAttendees: 250, organizerName: 'DataFlow Community',
        },
      });

      const sessions = [
        { title: 'EF Core Performance Deep Dive', description: 'Query profiling, batching strategies, and caching patterns for production EF Core applications.', startTime: fixed(2024, 10, 14, 10), endTime: fixed(2024, 10, 14, 11), capacity: 300, conferenceId: summit.id, speakerId: alice.id, roomId: hallA.id },
        { title: 'ASP.NET Core Minimal APIs in Practice', description: 'When to use minimal APIs over controllers, and how to structure them for production applications.', startTime: fixed(2024, 10, 14, 11, 30), endTime: fixed(2024, 10, 14, 12, 30), capacity: 80, conferenceId: summit.id, speakerId: ben.id, roomId: room101.id },
        { title: 'Async .NET in Practice', description: 'Writing correct and efficient asynchronous code in .NET: patterns, pitfalls, and real-world examples.', startTime: fixed(2024, 10, 15, 9), endTime: fixed(2024, 10, 15, 10), capacity: 50, conferenceId: summit.id, speakerId: ben.id, roomId: room202.id },
        { title: 'Kubernetes for .NET Developers', description: "Manifests, health checks, graceful shutdown, and resource limits — from a developer's perspective.", startTime: at(30, 10), endTime: at(30, 11), capacity: 200, conferenceId: cloudOps.id, speakerId: chloe.id, roomId: hallA.id },
        { title: 'OpenTelemetry End-to-End', description: 'Traces, metrics, logs. Instrumenting a real microservices application from zero to Grafana dashboard.', startTime: at(30, 14), endTime: at(30, 15), capacity: 80, conferenceId: cloudOps.id, speakerId: chloe.id, roomId: room101.id },
        { title: 'Building RAG Systems with .NET', description: 'Vector embeddings, semantic search, and retrieval-augmented generation using Microsoft.Extensions.AI.', startTime: at(90, 10), endTime: at(90, 11, 30), capacity: 120, conferenceId: dataAi.id, speakerId: alice.id, roomId: hallA.id },
        { title: 'EF Core + pgvector: Vector Search in Postgres', description: 'Storing and querying vector embeddings inside PostgreSQL using the pgvector extension and EF Core.', startTime: at(90, 14), endTime: at(90, 15), capacity: 50, conferenceId: dataAi.id, speakerId: ben.id, roomId: room202.id },
      ];
      for (const data of sessions) await tx.session.create({ data });
      return true;
    },
    { timeout: 30_000 },
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    console.log((await seedDemoData(prisma, new Date())) ? 'Demo data seeded' : 'Demo data already present, nothing to do');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
```
Run: `npm run test:int -- seed` → Expected: PASS.

- [ ] **Step 3: Сид из собранного JS**

Run:
```bash
npm run build && ls dist/prisma/seed.js
bash scripts/test-db.sh psql -c 'TRUNCATE registrations, attendees, sessions, speakers, rooms, conferences RESTART IDENTITY CASCADE'
DATABASE_URL=postgresql://brown:brown123@127.0.0.1:55432/brownevents_test npm run db:seed
DATABASE_URL=postgresql://brown:brown123@127.0.0.1:55432/brownevents_test npm run db:seed
```
Expected: `Demo data seeded`, затем `Demo data already present, nothing to do`.

- [ ] **Step 4: Commit (после «ок»)**

```bash
git add backend/prisma/seed.ts backend/test
git status && git diff --cached --stat
git commit -m "feat: add idempotent transactional demo seed with rolling demo dates (EXT-150)"
```

---

### Task 11: Swagger

**Files:**
- Create: `backend/src/swagger/swagger.ts`, `backend/src/swagger/api-description.ts`, `backend/scripts/generate-swagger.ts`
- Create: `backend/test/fixtures/reference/swagger.json` (копия `ext150-step0/swagger.json`)
- Modify: `backend/src/configure-app.ts` (подключить Swagger по флагу)
- Test: `backend/test/integration/swagger.e2e-spec.ts`

**Interfaces:**
- Consumes: `API_ROUTES`, `AppConfig.swaggerEnabled`, контроллеры с `operationId`.
- Produces: `buildSwaggerDocument(app): OpenAPIObject`, `setupSwagger(app): void`; `npm run swagger:generate -- <file>`.

- [ ] **Step 1: Фикстура и тест — падает**

Run: `mkdir -p test/fixtures/reference && cp /c/Users/POiB/Documents/ai-native-dev/ext150-step0/swagger.json test/fixtures/reference/swagger.json && file test/fixtures/reference/swagger.json`
Expected: JSON без CRLF (иначе `sed -i 's/\r$//'` только для этого файла).

`backend/test/integration/swagger.e2e-spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES } from '../../src/common/http-middleware';
import { createTestApp, type TestApp } from './helpers';

interface Doc {
  paths: Record<string, Record<string, { operationId?: string; summary?: string; responses: Record<string, { content?: Record<string, { example?: unknown }> }>; requestBody?: { content: Record<string, { examples?: object }> } }>>;
  servers?: { url: string }[];
}
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const reference = JSON.parse(readFileSync(join(__dirname, '../fixtures/reference/swagger.json'), 'utf8')) as Doc;
const operations = (doc: Doc) =>
  Object.entries(doc.paths)
    .flatMap(([path, item]) => Object.entries(item).filter(([m]) => METHODS.includes(m)).map(([m, op]) => `${m.toUpperCase()} ${path} ${op.operationId}`))
    .sort();

let t: TestApp;
let doc: Doc;
beforeAll(async () => {
  t = await createTestApp();
  doc = (await t.http().get('/swagger/v1/swagger.json').set('Host', 'example.test:5000')).body as Doc;
});
afterAll(() => t.close());

describe('Swagger (spec 5.8, DoD-10)', () => {
  it('has exactly the operations of the .NET document', () => {
    expect(operations(doc)).toEqual(operations(reference));
  });
  it('agrees with the 405 route table', () => {
    const fromDoc = Object.fromEntries(Object.entries(doc.paths).map(([p, item]) => [p, Object.keys(item).filter((m) => METHODS.includes(m)).map((m) => m.toUpperCase()).sort()]));
    const fromTable = Object.fromEntries(API_ROUTES.map((r) => [r.path, [...r.methods].sort()]));
    expect(fromDoc).toEqual(fromTable);
  });
  it('documents every operation with a summary, error examples and request examples', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item).filter(([m]) => METHODS.includes(m))) {
        expect({ path, method, summary: op.summary }).toMatchObject({ summary: expect.any(String) });
        expect(Object.keys(op.responses)).toContain('500');
        for (const [code, response] of Object.entries(op.responses).filter(([c]) => Number(c) >= 400)) {
          expect({ path, method, code, example: response.content?.['application/json']?.example }).toMatchObject({ example: expect.anything() });
        }
        if (method === 'post' || method === 'put') {
          expect(Object.keys(op.requestBody?.content['application/json']?.examples ?? {}).length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('advertises the host the document was requested from', () => {
    expect(doc.servers).toEqual([{ url: 'http://example.test:5000' }]);
  });
  it('does not contain /health or the old "Known issues"', () => {
    expect(Object.keys(doc.paths)).not.toContain('/health');
    expect(JSON.stringify(doc)).not.toContain('Known issues');
  });
  it('serves the UI at /swagger and /swagger/index.html (A16)', async () => {
    const ui = await t.http().get('/swagger').redirects(1);
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('BrownEvents API');
    const legacy = await t.http().get('/swagger/index.html');
    expect(legacy.status).toBe(200);
    expect(legacy.text).toContain('BrownEvents API');
  });
  it('is switched off unless SWAGGER_ENABLED is exactly "true" (SEC-5)', async () => {
    const off = await createTestApp({ env: { SWAGGER_ENABLED: 'TRUE' } });
    const ui = await off.http().get('/swagger');
    const json = await off.http().get('/swagger/v1/swagger.json');
    await off.close();
    expect([ui.status, json.status]).toEqual([404, 404]);
    expect(json.body.message).toBe('Route not found');
  });
});
```
Run: `npm run test:int -- swagger` → Expected: FAIL (404).

- [ ] **Step 2: Описание API (Conventions)**

`backend/src/swagger/api-description.ts`:
```ts
export const API_DESCRIPTION = `
BrownEvents conference API (NestJS since EXT-150). Base URL: the server that served this document; all routes start with \`/api\`.
No authentication. CORS allows only the origins configured in \`CORS_ORIGINS\`.

### Conventions
- **JSON only.** \`POST\`/\`PUT\` need \`Content-Type: application/json\` (parameters allowed) or \`application/*+json\`; anything else,
  including \`text/json\`, is **415**. Bodies are limited to 100 kB (**413**).
- **Strict bodies.** Unknown properties are rejected with **400** naming the property (property names are case-sensitive camelCase).
  The registration endpoint also accepts \`phone\`, \`company\`, \`dietaryRequirements\` and \`sessionId\` from the frontend forms; they are not stored.
- **Responses** are bare objects and arrays (no \`{data}\` wrapper). A record comes with its direct relations, each with its own fields only.
  \`POST\` answers **201** with the created resource; conferences and sessions also send \`Location\`.
- **PUT is a full replacement:** every writable property must be present; \`null\` clears a nullable one. \`id\` and relations are read-only.
- **Ids in paths** are integers from 1 to 2147483647; anything else is **400**. A missing record or parent is **404**.
- **Dates.** \`startDate\`, \`endDate\`, \`startTime\`, \`endTime\` are venue wall-clock times \`YYYY-MM-DDTHH:mm:ss\` without offset or fraction,
  in requests and responses; values with \`Z\` or an offset are **400**. \`registeredAt\` is a UTC instant with \`Z\` and milliseconds.
- **Conference status** is derived from the dates: UPCOMING before the first day, ACTIVE until the end of the last day (\`endDate\` holds
  midnight at the start of the last day), then COMPLETED; CANCELLED if cancelled. In requests send \`CANCELLED\`, \`null\`, or the status
  that matches the dates (anything else is **400**). The day boundary is computed in UTC, so it can be off by up to 14 hours.
- **Registration** is open while the conference is UPCOMING or ACTIVE and has seats; a repeat, a full or closed conference is **409**.
  Emails are trimmed and lower-cased, must be ASCII and identify the attendee; an existing attendee keeps the stored name.
- **Personal data.** Attendee emails are never returned. A speaker email is returned only if \`emailPublic\` is true, otherwise it is \`null\`.
- **Sessions** must take place within the conference days (**422**), their capacity must not exceed the room capacity (**422**),
  \`speakerId\`/\`roomId\` must exist (**422**). Rooms have no endpoint; the seeded rooms have ids 1-4.
- **Errors** are JSON: \`{ statusCode, error, message, requestId, errors? }\`; \`errors\` lists failed fields for 400 and 422.
  \`requestId\` equals the \`X-Request-Id\` header. A wrong method on a known path is **405** with \`Allow\`.
  **503** with \`Retry-After\` means the database was busy or unreachable: retry.
`;
```

- [ ] **Step 3: Подключение Swagger и генератор**

`backend/src/swagger/swagger.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Request } from 'express';
import { API_DESCRIPTION } from './api-description';

export function buildSwaggerDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('BrownEvents API').setVersion('v1').setDescription(API_DESCRIPTION).build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: NestExpressApplication): void {
  SwaggerModule.setup('swagger', app, buildSwaggerDocument(app), {
    jsonDocumentUrl: 'swagger/v1/swagger.json', // the .NET path, kept for clients generated from it (spec 5.8)
    customSiteTitle: 'BrownEvents API',
    // Advertise the host the document was requested from, as Program.cs:76-81 did, so "Try it out" hits the same server.
    patchDocumentOnRequest: (req: Request, _res: unknown, document: OpenAPIObject) => ({
      ...document,
      servers: [{ url: `${req.protocol}://${req.get('host') ?? ''}` }],
    }),
  });
}
```
В конце `configureApp` добавить: `if (config.swaggerEnabled) setupSwagger(app);` (импорт `./swagger/swagger`).

`backend/scripts/generate-swagger.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AppConfig } from '../src/config/app-config';
import { buildSwaggerDocument } from '../src/swagger/swagger';

// OpenAPI document for the CI artifact (SEC-5 Fix). DATABASE_URL must be set but is never used: Prisma connects lazily.
async function main(): Promise<void> {
  const out = process.argv[2] ?? 'swagger.json';
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(process.env), { bodyParser: false, logger: false });
  configureApp(app, { ...app.get(AppConfig), swaggerEnabled: false });
  writeFileSync(out, `${JSON.stringify(buildSwaggerDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Прогон**

Run: `npm run test:int -- swagger` → Expected: PASS. Если падает только `/swagger/index.html`: spec 5.8 разрешает расхождение — заменить в тесте ожидание для `legacy` на `404` с `message: 'Route not found'` и записать строку для PR («`/swagger/index.html` больше не отдаётся, UI — `/swagger`»). Если `patchDocumentOnRequest` или `jsonDocumentUrl` не поддерживаются — стоп, доклад (spec §14 №4).

Run (spec §14 №11 — без БД):
```bash
npm run build
DATABASE_URL=postgresql://nobody:x@127.0.0.1:1/none npm run swagger:generate -- swagger.json && node -e "console.log(Object.keys(require('./swagger.json').paths).length)"
```
Expected: `OpenAPI document written to swagger.json` и `7`.

- [ ] **Step 5: Commit (после «ок»)**

```bash
git add backend/src backend/scripts/generate-swagger.ts backend/test
git status && git diff --cached --stat
git commit -m "feat: add Swagger behind SWAGGER_ENABLED with the .NET operation ids and paths (EXT-150)"
```

---

### Task 12: Docker-образ, compose, стенд

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `backend/scripts/stand.sh`
- Replace: `docker-compose.yml`
- Create: `docker-compose.dev.yml`, `.env.example`
- Modify: `.gitignore` в корне (если файла нет — создать) — добавить `.env`

**Interfaces:**
- Consumes: тег образа из Task 1, Step 1; `npm run build`, `db:seed`.
- Produces: targets `migrator` и `runtime`; `scripts/stand.sh build|up|down|restart|logs|psql` — стенд на `http://127.0.0.1:5098`.

- [ ] **Step 1: Dockerfile и .dockerignore**

`backend/Dockerfile` (в `ARG NODE_IMAGE` — тег, закреплённый в Task 1, Step 1, например `node:24.21.0-alpine3.22`):
```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.21.0-alpine3.22

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# One-off migration + seed step (spec 7.3, 7.5). Has the Prisma CLI (dev dependency), so it is not the runtime image.
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
USER node
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js"]

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=80
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 80
CMD ["node", "dist/src/main.js"]
```

`backend/.dockerignore`:
```
node_modules
dist
coverage
src/generated
test
*.md
.env
swagger.json
compare-reference-report.md
BrownEvents.Api
BrownEvents.Tests
BrownEvents.sln
```

- [ ] **Step 2: Стенд**

`backend/scripts/stand.sh`:
```bash
#!/usr/bin/env bash
# Isolated stand of the new backend from its Docker images (CLAUDE.md): own network, throwaway Postgres without a
# volume and without a host port, API on 127.0.0.1:${STAND_PORT:-5098}. STAND_ENV adds API env, e.g. "LOG_SQL=true".
set -euo pipefail
export MSYS_NO_PATHCONV=1
NET=ext150-stand-net
PG=ext150-stand-pg
API=ext150-stand-api
PORT=${STAND_PORT:-5098}
DB_URL=postgresql://brown:brown123@$PG:5432/brownevents
HERE=$(cd "$(dirname "$0")/.." && pwd)
case "$(uname -s)" in MINGW* | MSYS*) NULL_OUT=NUL ;; *) NULL_OUT=/dev/null ;; esac

wait_healthy() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -m 2 -o "$NULL_OUT" -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)" = 200 ]; then
      echo "stand up on http://127.0.0.1:$PORT (container started $(docker inspect -f '{{.State.StartedAt}}' $API))"
      return 0
    fi
    sleep 1
  done
  echo "API did not become healthy in 60 s; see: $0 logs" >&2
  return 1
}

case "${1:-}" in
  build)
    docker build --target migrator -t brownevents-migrator:stand "$HERE"
    docker build --target runtime -t brownevents-api:stand "$HERE"
    ;;
  up)
    "$0" down
    docker network create $NET >/dev/null
    docker run -d --name $PG --network $NET -e POSTGRES_DB=brownevents -e POSTGRES_USER=brown -e POSTGRES_PASSWORD=brown123 postgres:14 -c log_statement=all >/dev/null
    for _ in $(seq 1 60); do docker exec $PG pg_isready -h 127.0.0.1 -U brown -d brownevents >/dev/null 2>&1 && break; sleep 1; done
    docker run --rm --network $NET -e DATABASE_URL=$DB_URL brownevents-migrator:stand
    extra=()
    for kv in ${STAND_ENV:-}; do extra+=(-e "$kv"); done
    docker run -d --name $API --network $NET -p "127.0.0.1:$PORT:80" -e DATABASE_URL=$DB_URL -e CORS_ORIGINS=http://localhost:5173 \
      -e SWAGGER_ENABLED=true "${extra[@]}" brownevents-api:stand >/dev/null
    wait_healthy
    ;;
  restart)
    docker restart -t 2 $API >/dev/null
    wait_healthy
    ;;
  down)
    docker rm -f -v $API $PG >/dev/null 2>&1 || true
    docker network rm $NET >/dev/null 2>&1 || true
    ;;
  logs) docker logs $API ;;
  pglog) docker logs $PG 2>&1 ;;
  psql)
    shift
    docker exec -i $PG psql -U brown -d brownevents "$@"
    ;;
  *)
    echo "usage: $0 build|up|restart|down|logs|pglog|psql" >&2
    exit 2
    ;;
esac
```

Run (тайм-аут 15 мин): `bash scripts/stand.sh build && bash scripts/stand.sh up`
Expected: обе сборки успешны; в выводе миграции `1 migration applied` и `Demo data seeded`; `stand up on http://127.0.0.1:5098`.

- [ ] **Step 3: Проверки на стенде**

Run:
```bash
docker exec ext150-stand-api sh -c 'id -u; node -v'
docker exec ext150-stand-api node -e "fetch('http://127.0.0.1/health').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
curl -s http://127.0.0.1:5098/api/conferences | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).map(c=>c.title+' '+c.status).join('\n')))"
curl -s -o NUL -w '%{http_code}\n' http://127.0.0.1:5098/swagger
docker run --rm --network ext150-stand-net -e DATABASE_URL=postgresql://brown:brown123@ext150-stand-pg:5432/brownevents brownevents-migrator:stand
```
Expected: `1000` и `v24.*`; `200` (healthcheck для compose — `node -e fetch`, wget не нужен); три конференции — `.NET Summit 2024 COMPLETED`, две `UPCOMING`; `200`; повторный migrator — `No pending migrations` и `Demo data already present, nothing to do`.

- [ ] **Step 4: docker-compose.yml, dev-override, .env.example**

`docker-compose.yml` (заменить целиком):
```yaml
services:

  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-brownevents}
      POSTGRES_USER: ${POSTGRES_USER:-brown}
      # dev-only default for the local demo; set POSTGRES_PASSWORD in .env for anything else (SEC-6).
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-brown123}
    # No published port (SEC-6). For host access: docker compose -f docker-compose.yml -f docker-compose.dev.yml up
    volumes:
      # New volume name: the pre-EXT-150 volume postgres_data (EnsureCreated schema) is neither migrated nor reused.
      - postgres_data_v2:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build:
      context: ./backend
      target: migrator
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-brown}:${POSTGRES_PASSWORD:-brown123}@postgres:5432/${POSTGRES_DB:-brownevents}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  backend:
    build:
      context: ./backend
      target: runtime
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-brown}:${POSTGRES_PASSWORD:-brown123}@postgres:5432/${POSTGRES_DB:-brownevents}
      CORS_ORIGINS: http://localhost:5173
      SWAGGER_ENABLED: "true"
    ports:
      # Published only because the frontend calls http://localhost:5000 directly (FE-1).
      - "5000:80"
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s

  frontend:
    build:
      context: ./frontend
    ports:
      - "5173:80"
    depends_on:
      backend:
        condition: service_healthy

volumes:
  postgres_data_v2:
```

`docker-compose.dev.yml`:
```yaml
# Local development only: publishes Postgres on the host.
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
services:
  postgres:
    ports:
      - "127.0.0.1:5433:5432"
```

`.env.example`:
```
# Copy to .env (not committed) to override the demo defaults of docker-compose.yml (SEC-6).
POSTGRES_DB=brownevents
POSTGRES_USER=brown
POSTGRES_PASSWORD=change-me
```
Корневой `.gitignore`: добавить строку `.env` (если файла нет — создать с одной этой строкой; окончания LF).

Run: `docker compose config --quiet && docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep -A2 'ports:'`
Expected: без ошибок; у postgres в dev-варианте — `127.0.0.1:5433`. Сам `up --build` — только в Task 16 (стек пользователя).

- [ ] **Step 5: Остановить стенд, commit (после «ок»)**

Run: `bash scripts/stand.sh down`
```bash
git add backend/Dockerfile backend/.dockerignore backend/scripts/stand.sh docker-compose.yml docker-compose.dev.yml .env.example .gitignore
git status && git diff --cached --stat
git commit -m "build: add backend image, migrate step and compose with healthchecks (EXT-150)"
```

---

### Task 13: Эталон в репозитории, сравнение, контрактный тест тел запросов

**Files:**
- Create: `backend/test/fixtures/reference/` — `index-A.tsv` (A, 21), `index.tsv` (B–E, 45), `*.body` (66), `expectations.json`
- Create: `backend/scripts/compare-reference.ts`
- Test: `backend/src/common/reference-bodies.spec.ts`

**Interfaces:**
- Consumes: DTO-классы, `AppValidationPipe`, стенд Task 12.
- Produces: `npm run compare:reference -- <baseUrl> [fixturesDir]` → таблица, `compare-reference-report.md`, код выхода 1 при расхождении.

- [ ] **Step 1: Скопировать эталон**

Run:
```bash
SRC=/c/Users/POiB/Documents/ai-native-dev/ext150-step0/ref
cp "$SRC"/index-A.tsv "$SRC"/index.tsv "$SRC"/*.body test/fixtures/reference/
# HTTP headers end lines with CRLF; new repository files are LF (CLAUDE.md), so they are converted on copy.
for f in "$SRC"/*.headers; do sed 's/\r$//' "$f" > "test/fixtures/reference/$(basename "$f")"; done
ls test/fixtures/reference | wc -l
ls test/fixtures/reference/*.headers | wc -l
wc -l test/fixtures/reference/index-A.tsv test/fixtures/reference/index.tsv
file test/fixtures/reference/* | grep -c CRLF || true
```
Expected: 134 файла (`index-A.tsv`, `index.tsv`, 66 `.body`, 66 `.headers`; плюс `swagger.json` из Task 11 — 135); 66 `.headers`; 21 и 45 строк — всего 66 эталонных запросов; `0` с CRLF (иначе — стоп, доклад). `.headers` — часть эталона: `Allow` (A20), CORS (A18, A19), `Content-Type` (скрипт проверяет, что JSON-ответы остались JSON), `Location`.

Формат обоих индексов одинаков (TAB): `id, method, path, status, size, SELECT=, WRITE=, ct=, loc=, req=`. Поле `req=`: `-` — без тела; `header:Имя=Значение` или `headers:Имя=Значение;Имя=Значение` — заголовки запроса без тела (группа A); иначе — тело JSON. `index-A.tsv` восстановлен агентом соседней сессии из вывода съёма шага 0 — исправление собственной ошибки съёма (размеры сверены с телами).

`backend/test/fixtures/reference/expectations.json` — ожидаемый ответ нового API по spec (`compare: "data"` — сравнивать данные после нормализации; `"status"` — только код; `"skip"` — не отправлять):
```json
{
  "A01-get-conferences": { "status": 200, "compare": "data" },
  "A02-get-conference-2": { "status": 200, "compare": "data" },
  "A03-get-conference-999": { "status": 404, "compare": "status" },
  "A04-get-conference-abc": { "status": 400, "compare": "status", "note": "was 404 (CORR-7, spec 5.6)" },
  "A05-get-conference-neg": { "status": 400, "compare": "status", "note": "invalid id (spec 5.4)" },
  "A06-get-sessions-2": { "status": 200, "compare": "data", "note": "{data} wrapper removed (spec 5.1)" },
  "A07-get-sessions-999": { "status": 404, "compare": "status", "note": "was 200 {data:[]} (CORR-7)" },
  "A08-get-registrations-2-empty": { "status": 200, "compare": "data" },
  "A09-get-registrations-999": { "status": 404, "compare": "status", "note": "was 200 [] (CORR-7)" },
  "A10-get-session-4": { "status": 200, "compare": "data" },
  "A11-get-session-999": { "status": 404, "compare": "status" },
  "A12-get-session-abc": { "status": 400, "compare": "status", "note": "invalid id" },
  "A13-get-speakers": { "status": 200, "compare": "data" },
  "A14-get-unknown-route": { "status": 404, "compare": "status" },
  "A15-get-with-json-ct": { "status": 200, "compare": "data" },
  "A16-swagger-ui": { "status": 200, "compare": "status", "note": "if 404: PR line, spec 5.8" },
  "A17-swagger-json": { "status": 200, "compare": "status" },
  "A18-cors-preflight": { "status": 204, "compare": "status", "headers": { "access-control-allow-origin": "http://localhost:5173" }, "note": "was * (SEC-4)" },
  "A19-cors-evil-get": { "status": 200, "compare": "status", "headers": { "access-control-allow-origin": null }, "note": "was * (SEC-4)" },
  "A20-method-not-allowed": { "status": 405, "compare": "status", "headers": { "allow": "GET, PUT" } },
  "A21-delete-registration-fe": { "status": 404, "compare": "status" },
  "B01-post-conference": { "status": 201, "compare": "data", "note": "dates moved by run day - capture day, so UPCOMING stays valid" },
  "B02-post-conference-no-ct": { "status": 415, "compare": "status" },
  "B03-post-conference-empty-body": { "status": 400, "compare": "status", "note": "was 500" },
  "B04-post-conference-malformed": { "status": 400, "compare": "status", "note": "was 500" },
  "B05-post-conference-empty-obj": { "status": 400, "compare": "status", "note": "was 200 with an empty conference" },
  "B06-post-conference-status-lower": { "status": 400, "compare": "status", "note": "exact enum (CORR-9)" },
  "B07-post-conference-wrong-types": { "status": 400, "compare": "status", "note": "was 500" },
  "B08-post-conference-dates-tz": { "status": 400, "compare": "status", "note": "offsets rejected (spec 5.5)" },
  "B09-post-conference-end-before-start": { "status": 400, "compare": "status" },
  "B10-put-conference-full": { "status": 400, "compare": "status", "note": "status \"active\" (CORR-9)" },
  "B11-put-conference-partial": { "status": 400, "compare": "status", "note": "full replacement (CORR-5)" },
  "B12-put-conference-999": { "status": 404, "compare": "status", "note": "valid body (dates moved like B01) for a missing conference" },
  "B13-put-conference-abc": { "status": 400, "compare": "status" },
  "B14-put-conference-status-null": { "status": 400, "compare": "status", "note": "was 500 + partial write (CORR-6)" },
  "B15-get-conference-6-after-crash": { "status": 404, "compare": "status", "note": "conference 6 was never created" },
  "B16-post-conference-mass-assign": { "status": 400, "compare": "status", "note": "SEC-3" },
  "C01-post-session": { "status": 201, "compare": "status" },
  "C02-post-session-empty-obj": { "status": 400, "compare": "status" },
  "C03-post-session-no-ct": { "status": 415, "compare": "status" },
  "C04-put-session-full": { "status": 200, "compare": "data" },
  "C05-put-session-invalid-values": { "status": 400, "compare": "status" },
  "C06-put-session-partial": { "status": 400, "compare": "status" },
  "C07-put-session-999": { "status": 404, "compare": "status" },
  "C08-put-session-move-conf": { "status": 400, "compare": "status", "note": "conferenceId is not part of the body" },
  "C09-get-sessions-2-after": { "status": 200, "compare": "status", "note": "data differ: the old API stored the invalid writes C02, C05, C06" },
  "C10-post-session-bad-speaker": { "status": 422, "compare": "status", "note": "was 500 (REL-2)" },
  "C11-post-speaker-after-poison": { "status": 201, "compare": "status", "note": "was 500 (REL-2)" },
  "C12-get-after-poison": { "status": 200, "compare": "status" },
  "D01-post-speaker": { "status": 201, "compare": "status" },
  "D02-post-speaker-empty-obj": { "status": 400, "compare": "status" },
  "D03-post-speaker-bad-email": { "status": 400, "compare": "status" },
  "D04-register-modal-shape": { "status": 201, "compare": "status" },
  "D05-register-page-shape": { "status": 201, "compare": "status" },
  "D06-register-modal-with-session": { "status": 201, "compare": "status" },
  "D07-register-duplicate": { "status": 409, "compare": "status" },
  "D08-register-other-name": { "status": 409, "compare": "status" },
  "D09-register-email-case": { "status": 409, "compare": "status" },
  "D10-register-empty-obj": { "status": 400, "compare": "status" },
  "D11-register-completed-conf": { "status": 409, "compare": "status" },
  "D12-register-no-ct": { "status": 415, "compare": "status" },
  "D13-get-registrations-2": { "status": 200, "compare": "status", "note": "data differ: the old API stored duplicates" },
  "D14-get-conference-2-with-regs": { "status": 200, "compare": "status" },
  "D15-get-conferences-with-regs": { "status": 200, "compare": "status" },
  "D16-register-conf-9999": { "status": 404, "compare": "status", "note": "was 500 + orphan attendee (REL-5)" },
  "E01-dev-post-empty-body": { "status": 0, "compare": "skip", "note": "Development stack trace of the old API; covered by the error-format tests" }
}
```

- [ ] **Step 2: Контрактный тест тел запросов (spec 5.4, решение D3)**

`backend/src/common/reference-bodies.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CreateConferenceDto, UpdateConferenceDto } from '../conferences/conference.dto';
import { RegisterAttendeeDto } from '../registrations/register.dto';
import { CreateSessionDto, UpdateSessionDto } from '../sessions/session.dto';
import { CreateSpeakerDto } from '../speakers/speaker.dto';
import { ApiError } from './errors';
import { AppValidationPipe } from './validation';

// Request bodies captured from the .NET API (ext150-step0/ref, index.tsv, column "req=").
const bodies = Object.fromEntries(
  readFileSync(join(__dirname, '../../test/fixtures/reference/index.tsv'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const columns = line.split('\t');
      return [columns[0], columns[columns.length - 1].replace(/^req=/, '')];
    }),
) as Record<string, string>;

const pipe = new AppValidationPipe();
const check = (id: string, metatype: new () => object) => pipe.transform(JSON.parse(bodies[id]) as object, { type: 'body', metatype });

describe('bodies the frontend and the reference send are accepted field by field', () => {
  it.each([
    ['B01-post-conference', CreateConferenceDto],
    ['B12-put-conference-999', UpdateConferenceDto],
    ['C01-post-session', CreateSessionDto],
    ['C04-put-session-full', UpdateSessionDto],
    ['D01-post-speaker', CreateSpeakerDto],
    ['D04-register-modal-shape', RegisterAttendeeDto],
    ['D05-register-page-shape', RegisterAttendeeDto],
    ['D06-register-modal-with-session', RegisterAttendeeDto],
  ] as const)('%s', async (id, metatype) => {
    await expect(check(id, metatype)).resolves.toBeInstanceOf(metatype);
  });
});

describe('bodies with unknown or invalid fields are rejected naming them', () => {
  it.each([
    ['B16-post-conference-mass-assign', CreateConferenceDto, ['id', 'registrations', 'sessions']],
    ['C08-put-session-move-conf', UpdateSessionDto, ['conferenceId', 'description']],
    ['B10-put-conference-full', UpdateConferenceDto, ['status']],
  ] as const)('%s', async (id, metatype, fields) => {
    const error = (await check(id, metatype).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.errors?.map((e) => e.field)).toEqual(expect.arrayContaining([...fields]));
  });
});
```
Run: `npm test -- reference-bodies` → Expected: PASS (если падает — какой-то DTO не принимает поле, которое шлёт фронтенд или эталон: исправить DTO, не тест).

- [ ] **Step 3: Скрипт сравнения**

`backend/scripts/compare-reference.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// Replays the requests captured from the .NET API (spec 11.4) against the new API and compares answers.
// Only the documented differences are normalised; anything else is a mismatch.
// Usage: node dist/scripts/compare-reference.js [baseUrl] [fixturesDir]   (fresh, seeded database expected)

interface Expectation { status: number; compare: 'data' | 'status' | 'skip'; headers?: Record<string, string | null>; note?: string }
interface Call { id: string; method: string; path: string; body?: string; headers: Record<string, string> }

const BASE = process.argv[2] ?? 'http://127.0.0.1:5098';
const DIR = process.argv[3] ?? join(__dirname, '../../test/fixtures/reference');
const NO_CONTENT_TYPE = new Set(['B02-post-conference-no-ct', 'C03-post-session-no-ct', 'D12-register-no-ct']);
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const RELATIONS = new Set(['sessions', 'registrations', 'conference', 'speaker', 'room', 'attendee']);
const DATES = new Set(['startDate', 'endDate', 'startTime', 'endTime']);

const expectations = JSON.parse(readFileSync(join(DIR, 'expectations.json'), 'utf8')) as Record<string, Expectation>;
// Index format: id, method, path, status, size, SELECT=, WRITE=, ct=, loc=, req=. "req=" is "-" (no body),
// "header:Name=Value" / "headers:Name=Value;Name=Value" (request headers, group A) or a JSON body.
function readIndex(file: string): Call[] {
  return readFileSync(join(DIR, file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line): Call => {
      const col = line.split('\t');
      const req = col[col.length - 1].replace(/^req=/, '');
      const headerList = /^headers?:(.*)$/.exec(req);
      if (headerList) {
        const headers = Object.fromEntries(
          headerList[1].split(';').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
        );
        return { id: col[0], method: col[1], path: col[2], headers };
      }
      const writes = col[1] === 'POST' || col[1] === 'PUT';
      return {
        id: col[0], method: col[1], path: col[2],
        body: req === '-' ? undefined : req,
        headers: writes && !NO_CONTENT_TYPE.has(col[0]) ? { 'Content-Type': 'application/json' } : {},
      };
    });
}
const calls = [...readIndex('index-A.tsv'), ...readIndex('index.tsv')]; // 21 + 45 = 66 reference requests

// The API derives statuses from the real "now" (spec 6.1), so request dates are moved to keep their distance from "now"
// as on the capture day; otherwise the comparison would change its verdict with the calendar (e.g. B01 sends
// status UPCOMING for 2026-11-12, which stops matching on that day, and B12 would turn from 404 into 400).
// - dates inside the reference days of demo conferences 2 and 3 move with the seeded conference (spec 7.5);
// - every other date moves by (run day - capture day). Values with Z or an offset (B08) are not matched and stay as sent.
const CAPTURE_DAY = '2026-10-05'; // Date: header of the reference responses
const REFERENCE_DAYS: Record<number, string> = { 2: '2025-03-05', 3: '2025-06-18' };
const DAY_MS = 86_400_000;
let shifts: { from: number; to: number; delta: number }[] = [];
let runDelta = 0;

async function loadShifts(): Promise<void> {
  shifts = [];
  for (const [id, day] of Object.entries(REFERENCE_DAYS)) {
    const conference = (await (await fetch(`${BASE}/api/conferences/${id}`)).json()) as { startDate: string };
    const from = Date.parse(`${day}T00:00:00Z`);
    shifts.push({ from, to: from + 2 * DAY_MS, delta: Date.parse(`${conference.startDate}Z`) - from });
  }
  const today = new Date();
  runDelta = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(`${CAPTURE_DAY}T00:00:00Z`);
}

function shiftBody(body: string | undefined): string | undefined {
  return body?.replace(/"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"/g, (_match, value: string) => {
    const t = Date.parse(`${value}Z`);
    const delta = shifts.find((s) => t >= s.from && t < s.to)?.delta ?? runDelta;
    return `"${new Date(t + delta).toISOString().slice(0, 19)}"`;
  });
}

function referenceContentType(id: string): string {
  const line = readFileSync(join(DIR, `${id}.headers`), 'utf8')
    .split(/\r?\n/)
    .find((l) => /^content-type:/i.test(l));
  return line ? line.slice(line.indexOf(':') + 1).trim().toLowerCase() : '';
}

function normalize(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (depth === 0 && Object.keys(record).length === 1 && 'data' in record) return normalize(record.data, depth); // {data} removed (spec 5.1)
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (depth >= 1 && RELATIONS.has(key)) continue; // service fields of nested records (spec 5.2)
    if (key === 'emailPublic') continue; // new field (spec 5.3)
    if (key === 'email' && 'firstName' in record && !('bio' in record)) continue; // attendee email is never returned (spec 5.3)
    if (DATES.has(key)) out[key] = typeof item === 'string' && WALL.test(item) ? '<wall-clock>' : item;
    else if (key === 'registeredAt') out[key] = '<instant>';
    else if (key === 'status' && 'startDate' in record) out[key] = '<derived status>';
    else out[key] = normalize(item, RELATIONS.has(key) ? depth + 1 : depth);
  }
  return out;
}

async function run(): Promise<void> {
  await loadShifts();
  const rows: string[] = ['| id | expected | got | result | note |', '|---|---|---|---|---|'];
  let failures = 0;
  for (const call of calls) {
    const expected = expectations[call.id];
    if (!expected) throw new Error(`No expectation for ${call.id}`);
    if (expected.compare === 'skip') {
      rows.push(`| ${call.id} | skip | - | skipped | ${expected.note ?? ''} |`);
      continue;
    }
    const res = await fetch(`${BASE}${call.path}`, { method: call.method, headers: call.headers, body: shiftBody(call.body) });
    const text = await res.text();
    const problems: string[] = [];
    if (res.status !== expected.status) problems.push(`status ${res.status}`);
    for (const [name, value] of Object.entries(expected.headers ?? {})) {
      if (res.headers.get(name) !== value) problems.push(`${name}: ${res.headers.get(name) ?? 'absent'}`);
    }
    // A successful JSON answer of the reference must stay JSON (the frontend calls res.json()).
    const contentType = res.headers.get('content-type') ?? '';
    if (res.status < 300 && referenceContentType(call.id).startsWith('application/json') && !contentType.startsWith('application/json')) {
      problems.push(`content-type: ${contentType || 'absent'}`);
    }
    if (expected.compare === 'data' && problems.length === 0) {
      const reference = JSON.parse(readFileSync(join(DIR, `${call.id}.body`), 'utf8')) as unknown;
      if (!isDeepStrictEqual(normalize(reference), normalize(JSON.parse(text) as unknown))) problems.push('data differ');
    }
    if (problems.length > 0) failures += 1;
    rows.push(`| ${call.id} | ${expected.status} | ${res.status} | ${problems.length ? `MISMATCH: ${problems.join('; ')}` : 'ok'} | ${expected.note ?? ''} |`);
  }
  const report = `# compare-reference against ${BASE}\n\nMasked: wall-clock values, registeredAt, derived conference status, nested service fields, attendee email, emailPublic.\n\n${rows.join('\n')}\n`;
  writeFileSync('compare-reference-report.md', report);
  console.log(report);
  if (failures > 0) {
    console.error(`${failures} mismatch(es)`);
    process.exit(1);
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Прогон на чистом стенде**

Run (тайм-аут 15 мин):
```bash
npm run build && bash scripts/stand.sh build && bash scripts/stand.sh up
npm run compare:reference -- http://127.0.0.1:5098
bash scripts/stand.sh down
```
Expected: все строки `ok` или `skipped`, код выхода 0. Расхождение `data differ` — стоп и доклад с обоими телами (не править ожидания молча). `A16` не 200 — допустимо по spec 5.8: изменить ожидание на 404 с пометкой и строкой в PR.

- [ ] **Step 5: Commit (после «ок»)**

```bash
git add backend/test/fixtures backend/scripts/compare-reference.ts backend/src/common/reference-bodies.spec.ts
git status && git diff --cached --stat
git commit -m "test: add reference fixtures, request-body contract test and compare-reference script (EXT-150)"
```

---

### Task 14: CI и удаление .NET

**Files:**
- Modify: `.github/workflows/ci.yml` (job `backend` заменяется)
- Delete: `backend/BrownEvents.Api/`, `backend/BrownEvents.Tests/`, `backend/BrownEvents.sln`

**Interfaces:**
- Consumes: npm-скрипты; `swagger:generate`; `Dockerfile`.
- Produces: job `backend` (Node 24, postgres:14) и артефакт `swagger-json`.

- [ ] **Step 1: Версия upload-artifact — на утверждение**

Run: `gh api repos/actions/upload-artifact/releases/latest --jq .tag_name`
Expected: тег вида `v<N>.<x>.<y>`. Пользователю: «использовать `actions/upload-artifact@v<N>`?» — ждать ответа (Global Constraints: новые зависимости).

- [ ] **Step 2: Job backend**

В `.github/workflows/ci.yml` заменить job `backend` целиком (job `frontend` не трогать):
```yaml
  backend:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_DB: brownevents_test
          POSTGRES_USER: brown
          POSTGRES_PASSWORD: brown123
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -h 127.0.0.1 -U brown -d brownevents_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 12
    env:
      DATABASE_URL: postgresql://brown:brown123@127.0.0.1:5432/brownevents_test
      TEST_DATABASE_URL: postgresql://brown:brown123@127.0.0.1:5432/brownevents_test
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - name: Versions
        run: |
          node --version
          npm --version

      - name: Install
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Apply migrations
        run: npx prisma migrate deploy

      - name: Build
        run: npm run build

      # Wall-clock formatting must not depend on the machine time zone (spec 5.5); Node honours TZ on Linux only.
      - name: Unit tests (three time zones)
        run: |
          for tz in UTC Asia/Bishkek America/Los_Angeles; do
            echo "TZ=$tz"
            TZ=$tz npm test -- --ci
          done

      - name: Integration tests
        run: npm run test:int -- --ci

      - name: Generate OpenAPI document
        run: npm run swagger:generate -- swagger.json

      - uses: actions/upload-artifact@v<N>
        with:
          name: swagger-json
          path: backend/swagger.json
          if-no-files-found: error

      - name: Docker build (migrator and runtime)
        run: |
          docker build --target migrator -t brownevents-migrator:ci .
          docker build --target runtime -t brownevents-api:ci .
```
(`v<N>` — версия, утверждённая в Step 1.)

- [ ] **Step 3: actionlint**

Run: `"$LOCALAPPDATA/Microsoft/WinGet/Links/actionlint.exe" .github/workflows/ci.yml`
Expected: пустой вывод, код 0. Если файла нет — сказать пользователю, где ожидался actionlint (шаг 0: установлен, но не в PATH), и спросить путь.

- [ ] **Step 4: Удалить .NET**

Run:
```bash
git rm -r -q backend/BrownEvents.Api backend/BrownEvents.Tests backend/BrownEvents.sln
grep -rn "BrownEvents.Api\|BrownEvents.Tests\|dotnet" --include=*.yml --include=*.json --include=*.ts --include=Dockerfile . | grep -v node_modules || echo "no references"
```
Expected: `no references` (README, CLAUDE.md и docs правятся в Task 15).

- [ ] **Step 5: Полный локальный прогон и commit (после «ок»)**

Run: `cd backend && npm ci && npx prisma generate && npm run lint && npm run typecheck && npm run build && npm test && bash scripts/test-db.sh up && npm run test:int; bash scripts/test-db.sh down`
Expected: всё зелёное.
```bash
git add .github/workflows/ci.yml
git status && git diff --cached --stat
git commit -m "ci: build and test the NestJS backend, remove the .NET backend (EXT-150)"
```

---

### Task 15: Документация

**Files:**
- Modify: `README.md` (CRLF сохранить), `CLAUDE.md`, `docs/architecture.md`, `docs/tech-debt-audit.md`

- [ ] **Step 1: Постоянные ссылки на `e95142d`**

Переводятся ссылки на удалённые .NET-файлы (решение D18) **и на `docker-compose.yml`** — его строки переписаны в Task 12, якоря `#Lnn` иначе указывали бы не туда (расширение решения D18; подтвердить на ревью плана). Ссылки на `frontend/` не трогаются.

Run:
```bash
SHA=$(git rev-parse e95142d)
node -e '
const fs = require("fs");
const sha = process.argv[1];
for (const file of ["docs/tech-debt-audit.md", "docs/architecture.md"]) {
  const before = fs.readFileSync(file, "utf8");
  let count = 0;
  const after = before.replace(/\]\(\.\.\/(backend\/[^)#\s]*|docker-compose\.yml)(#L\d+(?:-L\d+)?)?\)/g, (m, path, anchor = "") => {
    count += 1;
    const kind = path.endsWith("/") ? "tree" : "blob";
    return `](https://github.com/mirlanbeck/brown-events-pilot/${kind}/${sha}/${path}${anchor})`;
  });
  fs.writeFileSync(file, after);
  console.log(file, count);
}' "$SHA"
git diff --stat docs/
grep -c '](\.\./backend\|](\.\./docker-compose' docs/tech-debt-audit.md docs/architecture.md
```
Expected: `docs/tech-debt-audit.md 98`, `docs/architecture.md 16` (92+6 и 15+1 по подсчёту при планировании); в `--stat` только эти два файла и не «весь файл»; последний `grep` — `0` и `0`.

- [ ] **Step 2: Пометка в architecture.md**

Вставить после заголовка первого уровня `docs/architecture.md`:
```markdown
> **Историческая карта.** Документ описывает .NET-версию бэкенда до EXT-150 (коммит
> [`e95142d`](https://github.com/mirlanbeck/brown-events-pilot/tree/e95142d)); ссылки на код ведут на этот коммит.
> Текущий бэкенд — NestJS + Prisma, см. [спецификацию EXT-150](superpowers/specs/2026-10-05-ext150-nestjs-migration-design.md) и README.
```

- [ ] **Step 3: README (CRLF)**

Заменить содержимое `README.md` начиная с заголовка (блок «Тестовое задание» сохранить без изменений) на:
````markdown
# BrownEvents

> **Тестовое задание:** правила, маршрут тасок и сайд-квесты — в репозитории
> [rolling-scopes-school/ai-native](https://github.com/rolling-scopes-school/ai-native/tree/main/test-task).
> Здесь — только код.

Conference management application — the BrownEvents brownfield reference project.

**Stack:** NestJS 12 · Prisma 7 · PostgreSQL 14 · Node 24 · React 18 · Vite. The backend was migrated from ASP.NET Core in EXT-150
([spec](docs/superpowers/specs/2026-10-05-ext150-nestjs-migration-design.md)); the .NET version is commit `e95142d`.

---

## Quick Start

```bash
docker-compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000/api |
| Swagger UI | http://localhost:5000/swagger (OpenAPI JSON: `/swagger/v1/swagger.json`) |
| Health | http://localhost:5000/health |

Compose runs `migrate` once (Prisma migrations + demo seed), then the API, then the frontend. The demo data has 3 conferences,
7 sessions, 3 speakers, 4 rooms; two conferences start 30 and 90 days after the first start, so registration works on the demo.
The seed runs only on an empty database: on an old volume the demo dates age — recreate the volume to refresh them.

Swagger is on in compose (`SWAGGER_ENABLED=true`) because it is a demo stack; do not set it in production.

**Upgrading from the .NET version:** the old volume `<project>_postgres_data` is no longer used and its data is not migrated;
compose creates `postgres_data_v2`. Remove the old one with `docker volume rm <project>_postgres_data` (`<project>` is the directory name).

Passwords: compose defaults are for the local demo only. Copy `.env.example` to `.env` to set your own.
The database port is not published; for host access (port 5433):
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.

---

## Development Setup

### Backend

Requirements: Node.js 22.12+ (CI and the image use Node 24), Docker (for PostgreSQL).

```bash
cd backend
npm ci
npx prisma generate

# database: compose with the dev override, or any PostgreSQL 14
export DATABASE_URL=postgresql://brown:brown123@localhost:5433/brownevents
npm run db:migrate          # prisma migrate deploy
npm run build
npm run db:seed             # idempotent demo data
SWAGGER_ENABLED=true CORS_ORIGINS=http://localhost:5173 PORT=5000 npm start

npm run lint && npm run typecheck
npm test                    # unit tests
bash scripts/test-db.sh up  # throwaway PostgreSQL on 127.0.0.1:55432
npm run test:int            # integration tests (real PostgreSQL)
bash scripts/test-db.sh down
```

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | `postgresql://…` |
| `PORT` | `80` | HTTP port |
| `CORS_ORIGINS` | empty | comma-separated allowed origins |
| `SWAGGER_ENABLED` | off | only the exact value `true` turns `/swagger` on |
| `LOG_SQL` / `LOG_SQL_PARAMS` | off | SQL in the log / with parameter values (contain personal data; dev only) |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | statement timeout of the application's queries |

### Frontend

Requirements: Node.js 18+

```bash
cd frontend
npm install
npm run dev   # proxies /api to localhost:5000
```

---

## Project Structure

```
backend/
  src/
    conferences/ sessions/ registrations/ speakers/   ← one module per aggregate (controller, service, DTOs)
    representation/         ← Prisma selects → response DTOs
    common/                 ← errors, validation, dates, status, middleware
    prisma/ health/ swagger/ config/
  prisma/                   ← schema, migrations, seed
  test/                     ← integration tests, reference fixtures
  scripts/                  ← test database, stand, Swagger export, reference comparison

frontend/
  src/
    pages/                  ← React page components
    components/             ← shared UI components
    api.js                  ← HTTP client
```
````
Сохранение CRLF: инструмент записи пишет LF, поэтому после записи —
`node -e "const fs=require('fs');fs.writeFileSync('README.md',fs.readFileSync('README.md','utf8').replace(/\r?\n/g,'\r\n'))"`,
затем `file README.md` (ожидается `with CRLF line terminators`) и сравнить `git diff --stat README.md` с `git diff --ignore-cr-at-eol --stat README.md` — числа одинаковые (нет смены окончаний во всём файле).

- [ ] **Step 4: CLAUDE.md**

Заменить разделы «Проект» и «Команды»:
```markdown
## Проект
- Бэкенд: `backend/` — NestJS 12 + Prisma 7 + PostgreSQL 14 (TypeScript 6; Node 24 в образе и CI, локально ≥ 22.12).
  До EXT-150 — ASP.NET Core 6 (коммит `e95142d`); `docs/architecture.md` описывает ту версию.
- Фронтенд: `frontend/` — React + Vite, ходит на API по `http://localhost:5000` (api.js).
- Документы: `docs/architecture.md` (карта .NET-версии), `docs/tech-debt-audit.md` (54 находки и «Как воспроизвести»),
  `docs/devlog.md` (журнал задач), `docs/superpowers/specs|plans/` (spec и план spec-driven задач).

## Команды
- Бэкенд: `cd backend && npm ci && npx prisma generate && npm run lint && npm run typecheck && npm run build && npm test`.
  Интеграционные тесты: `bash scripts/test-db.sh up` → `npm run test:int` → `bash scripts/test-db.sh down`
  (одноразовый Postgres 127.0.0.1:55432). Изолированный стенд из образов: `bash scripts/stand.sh build|up|down` (порт 5098).
- Фронтенд: `cd frontend && npm ci && npm run build`.
- CI: `.github/workflows/ci.yml` (backend + frontend). Workflow проверять `actionlint`.
```

- [ ] **Step 5: Проверка и commit (после «ок»)**

Run: `git diff --stat && git ls-files --eol README.md CLAUDE.md docs/architecture.md docs/tech-debt-audit.md`
Expected: 4 файла; окончания как были (`README.md` — `w/crlf`, остальные — `w/lf`).
```bash
git add README.md CLAUDE.md docs/architecture.md docs/tech-debt-audit.md
git status && git diff --cached --stat
git commit -m "docs: update README, CLAUDE.md and pin .NET links to e95142d (EXT-150)"
```

---

### Task 16: Финальная проверка, compose, браузер, PR

**Files:**
- Modify: `docs/devlog.md` (CRLF) — черновик записи на утверждение
- Read: `.github/pull_request_template.md`

- [ ] **Step 1: Полный прогон и сравнение с эталоном**

Run: `cd backend && npm run lint && npm run typecheck && npm run build && npm test && bash scripts/test-db.sh up && npm run test:int && bash scripts/test-db.sh down`, затем Task 13, Step 4 (стенд + `compare:reference`).
Expected: всё зелёное; отчёт — в PR.

- [ ] **Step 2: «Как воспроизвести» из аудита против нового API**

На стенде (`bash scripts/stand.sh up`), `URL=http://127.0.0.1:5098`, SQL — `bash scripts/stand.sh psql -tAc "<запрос>"`, перезапуск — `bash scripts/stand.sh restart`. Ожидание — противоположное аудиту:

| Шаг | Проверка | Ожидание |
|---|---|---|
| 1 PERF-1, SEC-1 | 3 GET страницы конференции; число SELECT по `bash scripts/stand.sh pglog` до/после | постоянное малое число SELECT; в `/api/conferences/2/registrations` нет email; email спикеров виден — у демо-спикеров `emailPublic = true` (оговорка в PR) |
| 2 REL-1 | 3 раунда «рестарт + 3 параллельных GET» | 3/3 по три `200` |
| 3 SEC-4 | preflight с `https://evil.example` и с `http://localhost:5173` | без `Access-Control-Allow-Origin` / с ним и `Access-Control-Max-Age: 600` |
| 4 SEC-3 | POST с вложенными `registrations`/`sessions` | `400`; SQL по `"Status"='VIP'`, `"FirstName"='Fake'`, `"Title"='Injected'` — пусто |
| 5 CORR-1/3 | как в аудите, но даты `2027-01-01`/`2027-01-02` (даты аудита `2026-01-01` уже в прошлом → была бы проверка «закрыто», а не лимита) | `201`, затем три `409`; в БД одна регистрация, имя `Dup` |
| 6 REL-2/5 | регистрация на 9999, затем POST спикера | `404`; `orphan@x.example` — 0 строк; спикер `201` |
| 7 CFG-2 | `STAND_ENV="LOG_SQL=true" bash scripts/stand.sh up`, запрос, `bash scripts/stand.sh logs` | SQL в логе с `requestId`; без `LOG_SQL` — SQL нет; `LOG_SQL_PARAMS` не задан — параметров нет |

Результаты — таблицей в PR. `bash scripts/stand.sh down`.

- [ ] **Step 3: `docker-compose up --build` на стеке пользователя (разрешено пользователем)**

Run (тайм-аут 20 мин):
```bash
docker volume ls --format '{{.Name}}' | grep postgres_data
docker compose stop
docker-compose up --build -d
docker compose ps -a
docker compose logs migrate
curl -s -o NUL -w '%{http_code}\n' http://localhost:5000/health
curl -s -o NUL -w '%{http_code}\n' http://localhost:5173/
docker volume ls --format '{{.Name}}' | grep postgres_data
```
Expected: старый стек остановлен (`stop`, без `down -v`); `migrate` — `Exited (0)` с `1 migration applied` и `Demo data seeded`; `backend` — `healthy`; `200` и `200`; тома `brown-events-pilot_postgres_data` (старый, не тронут) и `brown-events-pilot_postgres_data_v2` (новый). `node:18-alpine` и `nginx:alpine` для фронтенда скачиваются при сборке — разрешено пользователем.

- [ ] **Step 4: Чек-лист для пользователя в браузере (продакшн-сборка, http://localhost:5173)**

Пользователю — список; результат он присылает, агент вносит в devlog:
1. Список конференций: 3 карточки, даты и статусы (.NET Summit — COMPLETED, две — UPCOMING).
2. Страница CloudOps Days: DevTools → Network — три запроса `/api/conferences/2`, `/sessions`, `/registrations` — `200`, в Console нет ошибок CORS; сессии с временем 10:00–11:00 и 14:00–15:00.
3. Страница сессии: имя и email спикера видны.
4. Регистрация через модалку («Register Now») на CloudOps Days → успех; в списке регистраций после перезагрузки — имя, вместо email «—».
5. Регистрация со страницы `/conferences/3/register` (форма с phone/company) → успех.
6. Повтор той же регистрации → сообщение об ошибке (JSON `409` — ожидаемо, spec 5.6).
7. Регистрация на .NET Summit → JSON `409` «Registration is closed».
8. Даты на страницах совпадают с тем, что показывал старый API для тех же значений (смещения на пояс браузера нет).

- [ ] **Step 5: Что делать со стеком после проверки — вопрос пользователю**

Варианты: оставить новый стек запущенным; `docker compose down` (без `-v`) и вернуть старый с `main`. Ждать ответа.

- [ ] **Step 6: Сверка с DoD, тексты PR и devlog**

- Прочитать `.github/pull_request_template.md`; черновик PR: по шаблону; раздел DoD — 13 пунктов (spec 1) со ссылками на тесты/шаги; таблица 54 находок (spec 12); изменения контракта (spec 13) + PascalCase-ключи (Review Focus 2); таблица переноса .NET-тестов (spec 11.3); отчёт compare-reference; результаты шагов аудита; отступления: FE-3/FE-5/SEC-1/SEC-6/SEC-7/CORR-4/CORR-8 частично, `/swagger/index.html` (если 404), `405` (если 404), ASCII-email, микросекунды, ±14 ч, «стареющее» демо, ноль диффа в `frontend/` (`git diff --stat main -- frontend/` пусто).
- Черновик записи в `docs/devlog.md` (CRLF; формат CLAUDE.md: «Что сделали и что получилось», «Решения агента», «Где вмешался руками», «Освоенные уроки», «Что сделал бы иначе»; мнения пользователя — `<!-- ваше -->`) — показать, записать после «ок», коммит `docs: add EXT-150 devlog entry`.
- Push и PR — только после «ок». После PR — CI: зелёный и по логу: `node --version` = v24.*, сервис `postgres:14`, число тестов unit/integration, отсутствие предупреждений.

---

## Решения по ревью плана (2026-10-05)

1. **Ссылки на `docker-compose.yml`** в аудите и карте (7 шт.) тоже переводятся на `e95142d` (Task 15, Step 1) — подтверждено: Task 12 переписывает файл, якоря `#Lnn` иначе укажут не на те строки.
2. **Эталон — 66 запросов:** группа A (21) — `ext150-step0/ref/index-A.tsv`, B–E (45) — `index.tsv`. `index-A.tsv` восстановлен агентом соседней сессии из вывода съёма — исправление собственной ошибки шага 0 (при съёме повторный `source capture.sh` обнулил `index.tsv`; сводка исправлена). Task 13 использует его, реконструкция по именам файлов не нужна.
3. **Nest 12 — ESM-пакеты.** План следует шаблону Nest 12 (`ts`: CommonJS-проект, Jest с `--experimental-vm-modules`); Task 1 проверяет, нужен ли флаг — принято.
4. **Коммиты** — подтверждение на каждую задачу (как в Global Constraints).
5. **Версия `actions/upload-artifact`** — на утверждение в Task 14, Step 1.
6. **Зависимости** из Global Constraints утверждены пользователем.
