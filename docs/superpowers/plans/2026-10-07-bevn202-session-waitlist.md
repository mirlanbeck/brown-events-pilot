# BEVN-202 Session Waitlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Выбрано пользователем (2026-10-08):** subagent-driven — исполнитель и ревьюер на каждую задачу, в конце ревью всей ветки.
> Исполнители не коммитят (вариант C, см. Global Constraints). Task 11 (браузер) ведёт координатор: даёт пользователю команды
> и чек-лист и ждёт. Решение, которого нет в плане, — остановка и вопрос пользователю, не решение исполнителя.

**Goal:** запись на сессию и список ожидания: `POST /api/sessions/{id}/register | waitlist | cancel`, автоматическое продвижение
из списка с логом INFO, счётчики в `GET /api/sessions/{id}` и на странице сессии.

**Architecture:** новая таблица `session_registrations` (Prisma-модель с частичным уникальным индексом через preview
`partialIndexes`); модуль `backend/src/session-registrations/` — чистые функции решений (`waitlist.ts`), продвижение и лог
(`promotion.ts`), сервис с транзакциями под блокировкой конференции; `SessionsService` получает счётчики и продвижение при
росте `capacity`. Фронтенд — три функции в `api.js`, панель `SessionRegistrationPanel` и тихое обновление страницы сессии.

**Tech Stack:** NestJS 12, Prisma 7.10 (adapter-pg), PostgreSQL 14, Jest 30 + supertest; React 18, Vitest 0.34, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-07-bevn202-session-waitlist-design.md` (утверждён 2026-10-07). Номера разделов
в плане («spec 4.2») — разделы этого документа; «spec EXT-150 x.y» — spec миграции на NestJS.

## Global Constraints

- Ничего не устанавливать (пакеты, CLI, образы); новых зависимостей в плане нет.
- Команды бэкенда — из `backend/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:int`
  (база: `bash scripts/test-db.sh up` → 127.0.0.1:15432; в конце `bash scripts/test-db.sh down`). Фронтенд — из `frontend/`: `npm test`, `npm run build`.
- Compose-стек и dev-базу не трогать. Проверка в браузере — изолированный стенд из образов + продакшн-сборка фронтенда.
- Долгие команды — с тайм-аутом (интеграционные тесты: 600 000 мс). Две проверки подряд с одной причиной — остановиться и доложить.
- Процессы останавливать только по PID, который запустил сам.
- **Коммиты — вариант C (решение пользователя 2026-10-08):** во время задач коммитов нет. Шаг «Контрольная точка» после
  одобрения ревьюера: `git add` файлов задачи. Индекс — проверенное состояние, рабочее дерево сверх индекса — текущая задача:
  ревьюер следующей задачи смотрит `git diff` (не индексированное), откат неудачной попытки — `git restore <файлы>` до индекса.
  `git stash`, `reset`, `checkout` без согласования не применять. Итоговый коммит — в Task 12 после «ок» пользователя.
  Формат `<type>: <что сделано> (BEVN-202)`. Новые файлы — LF; `report/` не индексировать.
- Имена таблицы, колонок, ограничений и индексов — точно как в spec 3.1 (`session_registrations`, `PK_…`, `FK_…`, `CK_…`, `UQ_…_Active`, `IX_…`).
- Значения `reason` — ровно: `REGISTRATION_CLOSED`, `CONFERENCE_REGISTRATION_REQUIRED`, `ALREADY_REGISTERED`, `SESSION_OVERLAP`, `SESSION_FULL`, `SEATS_AVAILABLE`.
- Лог продвижения: `new Logger('Waitlist').log({ event: 'waitlist.promoted', requestId, sessionId, attendeeId, registrationId, trigger })`, `trigger` — `cancel` | `capacity`; email и имена в лог не попадают (SEC-1).
- Тексты фронтенда (spec 6): «👥 {registeredCount} / {capacity} registered», «⏳ Waitlist: {waitlistCount}», **Register for session**,
  **Join waitlist**, **Cancel my registration**, **Register for conference**, **Close**; «You are registered for this session.»,
  «You are on the waitlist.», «Your registration or waitlist place is cancelled.»

## Решения плана, которых нет в spec (все приняты пользователем 2026-10-08)

1. **Тексты `message` новых ошибок** (spec задаёт только `reason`), в стиле существующих («Attendee is already registered for this conference»):

   | Ответ | `message` |
   | --- | --- |
   | 409 `REGISTRATION_CLOSED` | `Registration is closed: the conference is COMPLETED` / `…CANCELLED` / `Registration is closed: the session has started` |
   | 409 `CONFERENCE_REGISTRATION_REQUIRED` | `Register for the conference before registering for its sessions` |
   | 409 `ALREADY_REGISTERED` | `Attendee is already registered for this session` / `Attendee is already on the waitlist for this session` |
   | 409 `SESSION_OVERLAP` | `Attendee is registered or waitlisted for another session at the same time` |
   | 409 `SESSION_FULL` | `No seats left in this session; join the waitlist instead` |
   | 409 `SEATS_AVAILABLE` | `The session has free seats; register instead` |
   | 404 нет сессии | `Session {id} not found` (как сейчас в `SessionsService`) |
   | 404 нет активной записи | `No active registration or waitlist place for this email on this session` |

2. **`PUT` и продвижение (spec 4.5):** «запись открыта» проверяется по сессии **после** изменения (новое `startTime`);
   продвижение — только если новая `capacity` больше прежней (прочитанной под блокировкой). Перенос сессии в будущее без роста
   `capacity` список ожидания не трогает. Принято 2026-10-08.
3. **Две ошибки поля `capacity`** (зал и «ниже числа записанных») — один элемент `errors` с полем `capacity` и двумя
   сообщениями, как их собирает `flattenValidationErrors` для одного поля.
4. **Порядок списка ожидания проверяется чистой функцией:** продвижение читает весь список ожидания сессии одним запросом и выбирает
   `nextInLine` (сортировка `(createdAt, id)`), а не `ORDER BY … LIMIT` в SQL — так unit-тест порядка проверяет тот же код,
   что работает в продакшне. Число запросов от длины списка не зависит.
5. **`countEntries` живёт в `promotion.ts`** (spec 8 не называет место): им пользуются сервис записи, `SessionsService.get`/`update` и само продвижение.
6. **Swagger:** `409` новых операций описывается картой `examples` (по примеру на `reason`); тест «примеры ошибок» принимает
   `example` **или** `examples`. Список значений `reason` (`CONFLICT_REASONS`) объявлен в `src/common/errors.ts`.
   В `API_DESCRIPTION` — строка про `reason` в формате ошибки и абзац про запись на сессию.
7. **`whileTableLocked`** переносится из `registrations.e2e-spec.ts` в `test/integration/helpers.ts` (без изменения поведения), чтобы использовать его в тестах гонок BEVN-202.
8. **Фронтенд:** панель стоит сразу под шапкой сессии, заголовок «Session registration», подпись поля «Email»;
   уведомление о неудачном тихом обновлении (сообщение об успехе остаётся) — `The counts could not be refreshed: {message}. Reload the page to see them.`; кнопки неактивны до конца
   запроса **и** последующего обновления. Моки `../api` дополняются только там, где рендерится `SessionDetailPage`
   (`registrationVisibility.test.jsx`); `ConferenceDetailPage.test.jsx` и `RegistrationPage.test.jsx` её не импортируют.
9. **Данные для проверки в браузере** готовит скрипт в scratchpad через публичный API стенда (не в репозитории).
10. **`CreatedAt` = момент приёма запроса** (`clock.now()` до ожидания блокировки, как `RegisteredAt` в регистрации на
    конференцию). Порядок списка — порядок прихода запросов, а не порядок получения блокировки; расхождение — до 2 с (`lock_timeout`).
    Принято 2026-10-08.
11. **Unit-тест DoD «cancel triggers promotion»** — кроме `decideCancel` и интеграционного теста, unit-тест
    `promoteFromWaitlist` с заглушкой `Tx` (`findMany`, `count`, `updateMany`) без базы — Task 5, Step 1a. Принято 2026-10-08.

## Review Focus

1. Email с другим регистром и пробелами (`'  A@Example.COM '`) на всех трёх эндпоинтах находит того же участника — тест в Task 4 и Task 5.
2. Повторная отмена или отмена, когда у email только `CANCELLED`-строки, — `404`, без продвижения и без записи в лог — тест в Task 5.
3. `PUT` снижает `capacity` ровно до `registeredCount` — разрешено (граница `<`, не `<=`) — тест в Task 6.
4. Рост `capacity` сразу на несколько мест при списке короче свободных мест — продвигаются все из списка по порядку, по записи в логе на каждого, лишних мест не «занимает» — тест в Task 6.
5. Счётчики `0` и отсутствие счётчиков в ответе (старый мок/ответ) не ломают шапку: `0` виден, отсутствующие поля не выводятся — тест в Task 9.

---

## File Structure

| Файл | Ответственность |
| --- | --- |
| `backend/prisma/schema.prisma` | preview `partialIndexes`, модель `SessionRegistration`, обратные связи у `Session`, `Attendee` |
| `backend/prisma/migrations/20261007000000_bevn202_session_registrations/migration.sql` | таблица, `CHECK`, индексы, FK |
| `backend/src/common/errors.ts`, `db-error.ts`, `exception.filter.ts`, `write-error.ts` | поле `reason` в ошибке |
| `backend/src/common/limits.ts` | `session_registrations.Status: 20` |
| `backend/src/common/http-middleware.ts` | три маршрута в `API_ROUTES` |
| `backend/src/session-registrations/waitlist.ts` (+ `.spec.ts`) | чистые функции: статусы, пересечение, закрытие, решения, места, порядок |
| `backend/src/session-registrations/promotion.ts` | `countEntries`, `promoteFromWaitlist`, `logPromotions` |
| `backend/src/session-registrations/session-registrations.service.ts` | транзакции register / waitlist / cancel |
| `backend/src/session-registrations/session-registrations.controller.ts`, `.module.ts`, `session-attendee.dto.ts` | HTTP и Swagger |
| `backend/src/sessions/sessions.service.ts`, `sessions.controller.ts` | `GET` со счётчиками; `PUT`: проверка и продвижение |
| `backend/src/representation/responses.ts`, `mappers.ts`, `selects.ts` | `SessionRegistrationResponse`, `SessionDetailResponse`, `ErrorResponse.reason` |
| `backend/src/swagger/api-errors.decorator.ts`, `api-description.ts` | `ApiConflicts`, описание API |
| `backend/test/integration/session-registrations.e2e-spec.ts` | интеграционные тесты BEVN-202 |
| `backend/test/integration/{helpers,fixtures,schema,swagger,query-count,registrations}.e2e-spec.ts` / `.ts` | осознанные изменения защитных тестов (spec 7.3) |
| `frontend/src/api.js` (+ `api.test.js`) | три функции записи |
| `frontend/src/components/SessionRegistrationPanel.jsx` | панель записи |
| `frontend/src/pages/SessionDetailPage.jsx` (+ `SessionDetailPage.test.jsx`) | счётчики, `loadSession`, тихое обновление |
| `frontend/src/registrationVisibility.test.jsx` | мок `../api`, «Register for conference» |

---

### Task 1: Таблица `session_registrations` и проверка `partialIndexes` на тестовой базе

Первый шаг по spec 10: подтвердить, что `prisma migrate diff` воспроизводит частичный индекс без дрейфа. **Если дрейф есть —
остановиться и доложить с выводом команды; схему и миграцию не «подгонять».**

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20261007000000_bevn202_session_registrations/migration.sql`
- Modify: `backend/src/common/limits.ts`
- Modify: `backend/test/integration/helpers.ts:19-21` (`resetDb`)
- Modify: `backend/test/integration/fixtures.ts` (новая фабрика)
- Modify: `backend/test/integration/schema.e2e-spec.ts:27-54` (+ новый тест)

**Interfaces:**
- Produces: Prisma-делегат `prisma.sessionRegistration` / `tx.sessionRegistration` с полями `id, sessionId, attendeeId, status (string), createdAt (Date)`;
  типы `Prisma.SessionRegistrationSelect`, `Prisma.SessionRegistrationGetPayload`;
  `makeSessionRegistration(prisma, sessionId, attendeeId, status, createdAt?)` в `fixtures.ts`.

- [ ] **Step 1: Поднять тестовую базу**

Run (из `backend/`): `bash scripts/test-db.sh up`
Expected: `test db ready on 127.0.0.1:15432`

- [ ] **Step 2: Описать модель в `schema.prisma`**

В `generator client` добавить строку:

```prisma
  previewFeatures = ["partialIndexes"]
```

В модель `Session` после `room …` добавить `sessionRegistrations SessionRegistration[]`; в модель `Attendee` после
`registrations …` — `sessionRegistrations SessionRegistration[]`. В конец файла:

```prisma
model SessionRegistration {
  id         Int      @id(map: "PK_session_registrations") @default(autoincrement()) @map("Id")
  sessionId  Int      @map("SessionId")
  attendeeId Int      @map("AttendeeId")
  status     String   @map("Status") @db.VarChar(20)
  createdAt  DateTime @map("CreatedAt") @db.Timestamptz(3)
  session    Session  @relation(fields: [sessionId], references: [id], onDelete: Restrict, map: "FK_session_registrations_sessions_SessionId")
  attendee   Attendee @relation(fields: [attendeeId], references: [id], onDelete: Restrict, map: "FK_session_registrations_attendees_AttendeeId")

  // One active entry per attendee and session; a cancelled one stays as history (BEVN-202 spec 3.1).
  // The predicate is written as Postgres stores it in pg_indexes: Prisma compares it as text, and the migration's
  // "Status" <> 'CANCELLED' would show as drift in migrate diff (BEVN-202 Task 1, 2026-10-08).
  @@unique([sessionId, attendeeId], map: "UQ_session_registrations_SessionId_AttendeeId_Active", where: raw("(\"Status\")::text <> 'CANCELLED'::text"))
  @@index([sessionId, status, createdAt, id], map: "IX_session_registrations_SessionId_Status_CreatedAt")
  @@index([attendeeId], map: "IX_session_registrations_AttendeeId")
  @@map("session_registrations")
}
```

- [ ] **Step 3: Написать миграцию**

`backend/prisma/migrations/20261007000000_bevn202_session_registrations/migration.sql` (LF):

```sql
-- BEVN-202 (spec 3): session registrations and waitlists. Written by hand like the init migration:
-- the identity column and the CHECK constraint cannot be expressed in schema.prisma.

CREATE TABLE "session_registrations" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "SessionId" INTEGER NOT NULL,
    "AttendeeId" INTEGER NOT NULL,
    "Status" VARCHAR(20) NOT NULL,
    "CreatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PK_session_registrations" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_session_registrations_Status" CHECK ("Status" IN ('CONFIRMED', 'WAITLISTED', 'CANCELLED'))
);

CREATE UNIQUE INDEX "UQ_session_registrations_SessionId_AttendeeId_Active" ON "session_registrations"("SessionId", "AttendeeId") WHERE "Status" <> 'CANCELLED';
CREATE INDEX "IX_session_registrations_SessionId_Status_CreatedAt" ON "session_registrations"("SessionId", "Status", "CreatedAt", "Id");
CREATE INDEX "IX_session_registrations_AttendeeId" ON "session_registrations"("AttendeeId");

ALTER TABLE "session_registrations" ADD CONSTRAINT "FK_session_registrations_sessions_SessionId" FOREIGN KEY ("SessionId") REFERENCES "sessions"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_registrations" ADD CONSTRAINT "FK_session_registrations_attendees_AttendeeId" FOREIGN KEY ("AttendeeId") REFERENCES "attendees"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Сгенерировать клиент и проверить типы**

Run: `npx prisma generate && npm run typecheck`
Expected: генерация без ошибок про `previewFeatures`/`where`; typecheck — 0 ошибок.

- [ ] **Step 5: Посмотреть, какой SQL индекса Prisma строит из схемы (для отчёта)**

Run: `DATABASE_URL=postgresql://brown:brown123@127.0.0.1:15432/brownevents_test npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
Без `DATABASE_URL` команда выводит пустой SQL (в `prisma.config.ts` нет datasource) — уточнено 2026-10-08.
Expected: в выводе есть `CREATE UNIQUE INDEX "UQ_session_registrations_SessionId_AttendeeId_Active" … WHERE …`, условие показано в форме Postgres (`(("Status")::text <> 'CANCELLED'::text)` или похоже). Строку сохранить для отчёта.
Если флаги отличаются — сверить с `npx prisma migrate diff --help` (так же сделано в EXT-150).

- [ ] **Step 6: Проверка дрейфа на тестовой базе (главная точка Task 1)**

Run: `npm run test:int -- schema -t "no drift"` (тайм-аут 600 000 мс)
Expected: globalSetup применяет обе миграции; тест `has no drift between migrations and schema.prisma` — PASS.
**FAIL → остановиться**, доложить вывод `migrate diff` и строку из Step 5, ждать решения.

- [ ] **Step 6a: Проверить допущение spec 5.1 об уровне изоляции**

Run: `bash scripts/test-db.sh psql -tAc "SHOW default_transaction_isolation"`
Expected: `read committed` (на стенде — то же в Task 11). Иначе — остановиться: решение о блокировке опирается на READ COMMITTED.

- [ ] **Step 7: Обновить защитный тест схемы и `LIMITS`**

`backend/src/common/limits.ts` — в объект `LIMITS` после `registrations`:

```ts
  session_registrations: { Status: 20 },
```

`backend/test/integration/helpers.ts`, `resetDb`:

```ts
  await prisma.$executeRaw`TRUNCATE "session_registrations", "registrations", "attendees", "sessions", "speakers", "rooms", "conferences" RESTART IDENTITY CASCADE`;
```

`backend/test/integration/fixtures.ts` — в конец:

```ts
export function makeSessionRegistration(
  prisma: PrismaService,
  sessionId: number,
  attendeeId: number,
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED',
  createdAt = '2026-10-01T09:00:00.000Z',
) {
  return prisma.sessionRegistration.create({ data: { sessionId, attendeeId, status, createdAt: new Date(createdAt) } });
}
```

`backend/test/integration/schema.e2e-spec.ts`:
- импорты: `import { inspectDbError } from '../../src/common/db-error';`, `import { makeAttendee, makeConference, makeSession, makeSessionRegistration } from './fixtures';`, `resetDb` из `./helpers`;
- в тесте identity список: `['attendees', 'conferences', 'registrations', 'rooms', 'session_registrations', 'sessions', 'speakers']`;
- в список ограничений добавить `'CK_session_registrations_Status', 'FK_session_registrations_sessions_SessionId', 'FK_session_registrations_attendees_AttendeeId'`;
- в список индексов добавить `'UQ_session_registrations_SessionId_AttendeeId_Active', 'IX_session_registrations_SessionId_Status_CreatedAt', 'IX_session_registrations_AttendeeId'`;
- новый тест в конце `describe`:

```ts
  // Pins the behaviour of the partialIndexes preview (BEVN-202 spec 3.3, 9): a Prisma update must not turn it into a full unique index.
  it('allows one active session registration per attendee and session, any number of cancelled ones (BEVN-202 spec 3.1)', async () => {
    await resetDb(prisma);
    const conference = await makeConference(prisma);
    const session = await makeSession(prisma, conference.id);
    const attendee = await makeAttendee(prisma);
    const entry = (status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED') => makeSessionRegistration(prisma, session.id, attendee.id, status);
    async function dbErrorOf(promise: Promise<unknown>) {
      try {
        await promise;
      } catch (error) {
        return inspectDbError(error);
      }
      throw new Error('expected a database error');
    }
    await entry('CANCELLED');
    await entry('CANCELLED');
    await entry('CONFIRMED');
    expect(await dbErrorOf(entry('WAITLISTED'))).toMatchObject({ constraint: 'UQ_session_registrations_SessionId_AttendeeId_Active' });
    // Status is a plain String in Prisma, so only the CHECK constraint stops an unknown value.
    const bad = prisma.sessionRegistration.create({ data: { sessionId: session.id, attendeeId: attendee.id, status: 'PENDING', createdAt: new Date() } });
    expect(await dbErrorOf(bad)).toMatchObject({ pgCode: '23514' });
    await resetDb(prisma);
  });
```

- [ ] **Step 8: Прогнать тест схемы целиком**

Run: `npm run test:int -- schema`
Expected: PASS все тесты файла, включая новый.

- [ ] **Step 9: Полная проверка — ничего другого не сломано**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int` (тайм-аут 600 000 мс)
Expected: всё зелёное.

- [ ] **Step 10: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add prisma/schema.prisma prisma/migrations/20261007000000_bevn202_session_registrations src/common/limits.ts test/integration/helpers.ts test/integration/fixtures.ts test/integration/schema.e2e-spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add session_registrations table with partial unique index (BEVN-202)")
```

---

### Task 2: Поле `reason` в теле ошибки

**Files:**
- Modify: `backend/src/common/errors.ts`
- Modify: `backend/src/common/db-error.ts:4-11` (`ErrorSpec`)
- Modify: `backend/src/common/exception.filter.ts:10-12`
- Modify: `backend/src/common/write-error.ts:8-29`
- Modify: `backend/src/representation/responses.ts:87-93` (`ErrorResponse`)
- Modify: `backend/src/swagger/api-description.ts:24`
- Test: `backend/src/common/exception.filter.spec.ts`, Create: `backend/src/common/write-error.spec.ts`

**Interfaces:**
- Produces: `CONFLICT_REASONS` (readonly tuple), `type ConflictReason`, `conflict(message: string, reason?: ConflictReason): ApiError`,
  `ApiError.reason?: ConflictReason`, `ErrorSpec.reason?: ConflictReason`, `ErrorBody.reason?: ConflictReason`.

- [ ] **Step 1: Написать падающие тесты**

В `exception.filter.spec.ts` импорт `import { ApiError, conflict } from './errors';` и в первый `describe`:

```ts
  it('passes the reason of a 409 through (BEVN-202 spec 4.6)', () => {
    expect(toErrorSpec(conflict('No seats left in this session; join the waitlist instead', 'SESSION_FULL'))).toMatchObject({ status: 409, reason: 'SESSION_FULL' });
  });
```

Создать `backend/src/common/write-error.spec.ts`:

```ts
import { errorBody } from './write-error';

describe('errorBody (spec EXT-150 5.6, BEVN-202 spec 4.6)', () => {
  it('adds reason when it is set, after requestId', () => {
    const body = errorBody({ status: 409, message: 'No seats left in this session; join the waitlist instead', reason: 'SESSION_FULL' }, 'rid');
    expect(body).toEqual({ statusCode: 409, error: 'Conflict', message: 'No seats left in this session; join the waitlist instead', requestId: 'rid', reason: 'SESSION_FULL' });
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId', 'reason']);
  });
  it('has no reason key without a reason (existing 409s are unchanged)', () => {
    const body = errorBody({ status: 409, message: 'Attendee is already registered for this conference' }, 'rid');
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId']);
  });
  it('keeps errors last', () => {
    const body = errorBody({ status: 400, message: 'Validation failed', errors: [{ field: 'email', messages: ['x'] }] }, 'rid');
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId', 'errors']);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test -- exception.filter write-error`
Expected: FAIL — два новых теста падают на проверках (`reason` нет в `ErrorSpec` и в теле), прежние 8 проходят.
Ошибок типов (`conflict` принимает 1 аргумент; `reason` нет в `ErrorSpec`) jest не показывает: в `tsconfig.json`
`isolatedModules: true`, и ts-jest 29 собирает тесты через `transpileModule` без проверки типов; их показывает
`npm run typecheck` — уточнено 2026-10-08.

- [ ] **Step 3: Реализация**

`backend/src/common/errors.ts` — заменить класс и `conflict`:

```ts
// Machine-readable cause of a 409 of the session registration endpoints (BEVN-202 spec 4.6). Other 409s have none.
export const CONFLICT_REASONS = [
  'REGISTRATION_CLOSED',
  'CONFERENCE_REGISTRATION_REQUIRED',
  'ALREADY_REGISTERED',
  'SESSION_OVERLAP',
  'SESSION_FULL',
  'SEATS_AVAILABLE',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

// Thrown by services and pipes; AllExceptionsFilter turns it into the error body of spec 5.6.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
    readonly reason?: ConflictReason,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

```ts
export const conflict = (message: string, reason?: ConflictReason) => new ApiError(409, message, undefined, undefined, reason);
```

`backend/src/common/db-error.ts`: `import type { ConflictReason, FieldError } from './errors';` и в `ErrorSpec` после `headers?`:

```ts
  reason?: ConflictReason;
```

`backend/src/common/exception.filter.ts`, строка 11:

```ts
    return { status: exception.status, message: exception.message, errors: exception.errors, headers: exception.headers, reason: exception.reason };
```

`backend/src/common/write-error.ts`: `import type { ConflictReason, FieldError } from './errors';`; в `ErrorBody` перед `errors?` — `reason?: ConflictReason;`; в `errorBody`:

```ts
    requestId,
    ...(spec.reason ? { reason: spec.reason } : {}),
    ...(spec.errors ? { errors: spec.errors } : {}),
```

`backend/src/representation/responses.ts`: `import { CONFLICT_REASONS, type ConflictReason } from '../common/errors';`; в `ErrorResponse` перед `errors?`:

```ts
  @ApiProperty({ enum: CONFLICT_REASONS, required: false, description: 'Only on 409 of the session registration endpoints' }) reason?: ConflictReason;
```

`backend/src/swagger/api-description.ts`, строка про ошибки:

```
- **Errors** are JSON: \`{ statusCode, error, message, requestId, reason?, errors? }\`; \`errors\` lists failed fields for 400 and 422;
  \`reason\` is a code on the 409 answers of the session registration endpoints.
```

- [ ] **Step 4: Тесты проходят**

Run: `npm test -- exception.filter write-error && npm run lint && npm run typecheck`
Expected: PASS, 0 ошибок.

- [ ] **Step 5: Swagger и ошибки в интеграции не сломаны**

Run: `npm run test:int -- swagger http` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 6: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/common/errors.ts src/common/db-error.ts src/common/exception.filter.ts src/common/write-error.ts src/common/exception.filter.spec.ts src/common/write-error.spec.ts src/representation/responses.ts src/swagger/api-description.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add optional reason to API error body (BEVN-202)")
```

---

### Task 3: Чистые функции записи и списка ожидания (`waitlist.ts`) — unit-тесты DoD

**Files:**
- Create: `backend/src/session-registrations/waitlist.ts`
- Test: Create `backend/src/session-registrations/waitlist.spec.ts`

**Interfaces:**
- Consumes: `ConflictReason` (Task 2), `computeStatus`, `isRegistrationOpen` (`src/common/status.ts`).
- Produces:
  - `ENTRY_STATUSES`, `type EntryStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED'`, `type ActiveStatus`, `ACTIVE_STATUSES: ActiveStatus[]`
  - `overlaps(a: Interval, b: Interval): boolean`, `interface Interval { startTime: Date; endTime: Date }`
  - `closedReason(conference: { startDate: Date; endDate: Date; status: string | null }, session: { startTime: Date }, now: Date): string | null`
  - `closedMessage(why: string): string`, `MESSAGES` (тексты из таблицы «Решения плана», п. 1)
  - `type JoinKind = 'register' | 'waitlist'`, `interface JoinState`, `decideJoin(kind, state): JoinDecision`
  - `seatsToFill(capacity, registeredCount, waitlistCount): number`
  - `nextInLine<T extends { id: number; createdAt: Date }>(waitlist: T[], seats: number): T[]`
  - `decideCancel(current: ActiveStatus): { promote: boolean }`

- [ ] **Step 1: Написать падающие тесты**

`backend/src/session-registrations/waitlist.spec.ts`:

```ts
import { closedReason, decideCancel, decideJoin, MESSAGES, nextInLine, overlaps, seatsToFill, type JoinState } from './waitlist';

const at = (wall: string) => new Date(`${wall}Z`); // wall-clock digits in UTC fields, as in src/common/dates.ts

describe('overlaps: half-open [start, end) (spec 2)', () => {
  const s = (from: string, to: string) => ({ startTime: at(`2027-01-10T${from}:00`), endTime: at(`2027-01-10T${to}:00`) });
  it.each([
    ['same interval', s('10:00', '11:00'), s('10:00', '11:00'), true],
    ['partial overlap', s('10:00', '11:00'), s('10:30', '11:30'), true],
    ['one inside the other', s('10:00', '12:00'), s('10:30', '11:00'), true],
    ['back to back', s('10:00', '11:00'), s('11:00', '12:00'), false],
    ['back to back, reversed', s('11:00', '12:00'), s('10:00', '11:00'), false],
    ['apart', s('09:00', '10:00'), s('11:00', '12:00'), false],
  ])('%s -> %s', (_name, a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    expect(overlaps(b, a)).toBe(expected);
  });
});

describe('closedReason (spec 4.4)', () => {
  const conference = { startDate: at('2027-01-10T00:00:00'), endDate: at('2027-01-11T00:00:00'), status: null };
  const session = { startTime: at('2027-01-10T10:00:00') };
  it('is open before the session starts while the conference is UPCOMING or ACTIVE', () => {
    expect(closedReason(conference, session, new Date('2026-10-05T12:00:00.000Z'))).toBeNull();
    expect(closedReason(conference, session, new Date('2027-01-10T09:59:59.999Z'))).toBeNull();
  });
  it('closes at the session start, the start time read as UTC', () => {
    expect(closedReason(conference, session, new Date('2027-01-10T10:00:00.000Z'))).toBe('the session has started');
  });
  it('names the conference status when the conference is closed', () => {
    expect(closedReason({ ...conference, status: 'CANCELLED' }, session, new Date('2026-10-05T12:00:00.000Z'))).toBe('the conference is CANCELLED');
    expect(closedReason(conference, session, new Date('2027-01-12T00:00:00.000Z'))).toBe('the conference is COMPLETED');
  });
});

describe('decideJoin: check order of spec 4.2', () => {
  const OK: JoinState = { closed: null, attendeeId: 7, conferenceRegistered: true, current: null, overlapping: false, registeredCount: 1, capacity: 2 };
  const reasonOf = (kind: 'register' | 'waitlist', state: Partial<JoinState>) => {
    const d = decideJoin(kind, { ...OK, ...state });
    return d.ok ? d.status : d.reason;
  };

  it('register with a free seat -> CONFIRMED for the attendee', () => {
    expect(decideJoin('register', OK)).toEqual({ ok: true, status: 'CONFIRMED', attendeeId: 7 });
  });
  it('join waitlist on a full session -> WAITLISTED (DoD: join waitlist)', () => {
    expect(decideJoin('waitlist', { ...OK, registeredCount: 2 })).toEqual({ ok: true, status: 'WAITLISTED', attendeeId: 7 });
  });
  it('register on a full session -> SESSION_FULL, never an automatic waitlist place (DoD)', () => {
    const d = decideJoin('register', { ...OK, registeredCount: 2 });
    expect(d).toEqual({ ok: false, reason: 'SESSION_FULL', message: MESSAGES.full });
  });
  it('register when registeredCount is above capacity (capacity was lowered earlier) -> SESSION_FULL', () => {
    expect(reasonOf('register', { registeredCount: 3 })).toBe('SESSION_FULL');
  });
  it('join waitlist with a free seat -> SEATS_AVAILABLE', () => {
    expect(reasonOf('waitlist', { registeredCount: 1 })).toBe('SEATS_AVAILABLE');
  });
  it('unknown email and missing conference registration give the same answer', () => {
    expect(decideJoin('register', { ...OK, attendeeId: null, conferenceRegistered: false })).toEqual({ ok: false, reason: 'CONFERENCE_REGISTRATION_REQUIRED', message: MESSAGES.conferenceRegistrationRequired });
    expect(decideJoin('register', { ...OK, conferenceRegistered: false })).toEqual({ ok: false, reason: 'CONFERENCE_REGISTRATION_REQUIRED', message: MESSAGES.conferenceRegistrationRequired });
  });
  it('ALREADY_REGISTERED tells a seat from a waitlist place', () => {
    expect(decideJoin('register', { ...OK, current: 'CONFIRMED' })).toMatchObject({ reason: 'ALREADY_REGISTERED', message: MESSAGES.alreadyRegistered });
    expect(decideJoin('waitlist', { ...OK, current: 'WAITLISTED', registeredCount: 2 })).toMatchObject({ reason: 'ALREADY_REGISTERED', message: MESSAGES.alreadyWaitlisted });
  });
  it('closed answers REGISTRATION_CLOSED with the cause', () => {
    expect(decideJoin('register', { ...OK, closed: 'the session has started' })).toEqual({ ok: false, reason: 'REGISTRATION_CLOSED', message: 'Registration is closed: the session has started' });
  });
  it.each([
    ['closed before everything', { closed: 'the conference is CANCELLED', attendeeId: null, conferenceRegistered: false, current: 'CONFIRMED', overlapping: true, registeredCount: 9 }, 'REGISTRATION_CLOSED'],
    ['conference registration before duplicate', { conferenceRegistered: false, current: 'CONFIRMED', overlapping: true, registeredCount: 9 }, 'CONFERENCE_REGISTRATION_REQUIRED'],
    ['duplicate before overlap', { current: 'WAITLISTED', overlapping: true, registeredCount: 9 }, 'ALREADY_REGISTERED'],
    ['overlap before seats', { overlapping: true, registeredCount: 9 }, 'SESSION_OVERLAP'],
  ] as const)('%s', (_name, state, reason) => {
    expect(reasonOf('register', state as Partial<JoinState>)).toBe(reason);
  });
});

describe('seatsToFill (spec 5.2)', () => {
  it.each([
    [2, 1, 5, 1],
    [5, 1, 2, 2],
    [2, 2, 3, 0],
    [2, 3, 3, 0], // capacity below the count never gives negative seats
    [2, 0, 0, 0],
  ])('capacity %d, registered %d, waitlist %d -> %d', (capacity, registered, waitlist, expected) => {
    expect(seatsToFill(capacity, registered, waitlist)).toBe(expected);
  });
});

describe('nextInLine: waitlist order (createdAt, id) (DoD: waitlist ordering)', () => {
  const e = (id: number, createdAt: string) => ({ id, createdAt: new Date(createdAt) });
  it('takes the earliest entries first', () => {
    const list = [e(3, '2026-10-05T12:00:02.000Z'), e(1, '2026-10-05T12:00:01.000Z'), e(2, '2026-10-05T12:00:03.000Z')];
    expect(nextInLine(list, 2).map((x) => x.id)).toEqual([1, 3]);
  });
  it('orders equal times by the smaller id', () => {
    const list = [e(5, '2026-10-05T12:00:00.000Z'), e(4, '2026-10-05T12:00:00.000Z')];
    expect(nextInLine(list, 1).map((x) => x.id)).toEqual([4]);
  });
  it('a later time wins over a smaller id', () => {
    expect(nextInLine([e(9, '2026-10-05T12:00:00.000Z'), e(1, '2026-10-05T12:00:05.000Z')], 1).map((x) => x.id)).toEqual([9]);
  });
  it('returns nothing for zero seats and does not reorder the input', () => {
    const list = [e(2, '2026-10-05T12:00:00.000Z'), e(1, '2026-10-05T12:00:00.000Z')];
    expect(nextInLine(list, 0)).toEqual([]);
    expect(list.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe('decideCancel (spec 4.3; DoD: cancel triggers promotion)', () => {
  it('a cancelled seat promotes the waitlist', () => {
    expect(decideCancel('CONFIRMED')).toEqual({ promote: true });
  });
  it('a cancelled waitlist place does not', () => {
    expect(decideCancel('WAITLISTED')).toEqual({ promote: false });
  });
});
```

- [ ] **Step 2: Тесты падают**

Run: `npm test -- waitlist`
Expected: FAIL — `Cannot find module './waitlist'`.

- [ ] **Step 3: Реализация**

`backend/src/session-registrations/waitlist.ts`:

```ts
import type { ConflictReason } from '../common/errors';
import { computeStatus, isRegistrationOpen } from '../common/status';

// Decisions of BEVN-202 as pure functions (spec 8): the service reads the state under the conference lock, these decide.
export const ENTRY_STATUSES = ['CONFIRMED', 'WAITLISTED', 'CANCELLED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export type ActiveStatus = Exclude<EntryStatus, 'CANCELLED'>;
export const ACTIVE_STATUSES: ActiveStatus[] = ['CONFIRMED', 'WAITLISTED'];

export const MESSAGES = {
  conferenceRegistrationRequired: 'Register for the conference before registering for its sessions',
  alreadyRegistered: 'Attendee is already registered for this session',
  alreadyWaitlisted: 'Attendee is already on the waitlist for this session',
  overlap: 'Attendee is registered or waitlisted for another session at the same time',
  full: 'No seats left in this session; join the waitlist instead',
  seatsAvailable: 'The session has free seats; register instead',
  noActiveEntry: 'No active registration or waitlist place for this email on this session',
} as const;

export const closedMessage = (why: string) => `Registration is closed: ${why}`;

export interface Interval {
  startTime: Date;
  endTime: Date;
}

// Half-open [start, end): back-to-back sessions do not overlap (spec 2).
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime();
}

// Spec 4.4: open while the conference is UPCOMING or ACTIVE and the session has not started. The start time has no zone and
// is compared as UTC (spec EXT-150 6.1), so the closing moment is off by the venue's UTC offset in either direction.
export function closedReason(conference: { startDate: Date; endDate: Date; status: string | null }, session: { startTime: Date }, now: Date): string | null {
  const status = computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now);
  if (!isRegistrationOpen(status)) return `the conference is ${status}`;
  if (now.getTime() >= session.startTime.getTime()) return 'the session has started';
  return null;
}

export type JoinKind = 'register' | 'waitlist';

export interface JoinState {
  closed: string | null;
  attendeeId: number | null; // null: no attendee with this email
  conferenceRegistered: boolean; // a CONFIRMED registration for the session's conference
  current: ActiveStatus | null; // the attendee's active entry on this session
  overlapping: boolean; // an active entry on another session of the same conference overlaps this one
  registeredCount: number;
  capacity: number;
}

export type JoinDecision =
  | { ok: true; status: ActiveStatus; attendeeId: number }
  | { ok: false; reason: ConflictReason; message: string };

const refuse = (reason: ConflictReason, message: string): JoinDecision => ({ ok: false, reason, message });

// The first failed check answers (spec 4.2).
export function decideJoin(kind: JoinKind, s: JoinState): JoinDecision {
  if (s.closed !== null) return refuse('REGISTRATION_CLOSED', closedMessage(s.closed));
  if (s.attendeeId === null || !s.conferenceRegistered) return refuse('CONFERENCE_REGISTRATION_REQUIRED', MESSAGES.conferenceRegistrationRequired);
  if (s.current === 'CONFIRMED') return refuse('ALREADY_REGISTERED', MESSAGES.alreadyRegistered);
  if (s.current === 'WAITLISTED') return refuse('ALREADY_REGISTERED', MESSAGES.alreadyWaitlisted);
  if (s.overlapping) return refuse('SESSION_OVERLAP', MESSAGES.overlap);
  const full = s.registeredCount >= s.capacity;
  if (kind === 'register' && full) return refuse('SESSION_FULL', MESSAGES.full);
  if (kind === 'waitlist' && !full) return refuse('SEATS_AVAILABLE', MESSAGES.seatsAvailable);
  return { ok: true, status: kind === 'register' ? 'CONFIRMED' : 'WAITLISTED', attendeeId: s.attendeeId };
}

export function seatsToFill(capacity: number, registeredCount: number, waitlistCount: number): number {
  return Math.max(0, Math.min(capacity - registeredCount, waitlistCount));
}

// Waitlist order (spec 2): createdAt ascending, the smaller id first at equal times.
export function nextInLine<T extends { id: number; createdAt: Date }>(waitlist: T[], seats: number): T[] {
  return [...waitlist].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).slice(0, Math.max(0, seats));
}

export function decideCancel(current: ActiveStatus): { promote: boolean } {
  return { promote: current === 'CONFIRMED' };
}
```

- [ ] **Step 4: Тесты проходят (в трёх поясах, как в CI)**

Run: `npm test -- waitlist && TZ=America/Los_Angeles npm test -- waitlist && npm run lint && npm run typecheck`
Expected: PASS (на Windows `TZ` Node не учитывает — это отмечено в `ci.yml`; полноценная проверка поясов — в CI).

- [ ] **Step 5: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/session-registrations/waitlist.ts src/session-registrations/waitlist.spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add session registration and waitlist decisions (BEVN-202)")
```

---

### Task 4: `POST register` и `POST waitlist`, счётчики в `GET /api/sessions/{id}`

**Files:**
- Create: `backend/src/session-registrations/promotion.ts` (пока только `countEntries`)
- Create: `backend/src/session-registrations/session-attendee.dto.ts`
- Create: `backend/src/session-registrations/session-registrations.service.ts`
- Create: `backend/src/session-registrations/session-registrations.controller.ts`
- Create: `backend/src/session-registrations/session-registrations.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/representation/responses.ts`, `mappers.ts`, `selects.ts`
- Modify: `backend/src/sessions/sessions.service.ts:37-41`, `sessions.controller.ts:14-20`
- Modify: `backend/src/common/http-middleware.ts:8-16`
- Modify: `backend/src/swagger/api-errors.decorator.ts`, `api-description.ts`
- Modify: `backend/test/integration/swagger.e2e-spec.ts:26-28,39-41`
- Test: Create `backend/test/integration/session-registrations.e2e-spec.ts`

**Interfaces:**
- Consumes: `decideJoin`, `closedReason`, `overlaps`, `ACTIVE_STATUSES`, `ENTRY_STATUSES`, `type ActiveStatus`, `type EntryStatus`, `MESSAGES`, `closedMessage` (Task 3);
  `conflict(message, reason)` (Task 2); `lockConference`, `type Tx` (`src/common/locking.ts`).
- Produces:
  - `promotion.ts`: `interface EntryCounts { registeredCount: number; waitlistCount: number }`, `countEntries(db: Tx, sessionId: number): Promise<EntryCounts>`
  - `session-registrations.service.ts`: `lockSession(tx: Tx, conferenceId: number, sessionId: number): Promise<{ conference: LockedConference; session: LockedSession }>` (export),
    `interface LockedSession { id: number; startTime: Date; endTime: Date; capacity: number }`; класс `SessionRegistrationsService` с `register(id, dto)`, `joinWaitlist(id, dto)`, приватным `conferenceOf(id)`
  - `responses.ts`: `SessionRegistrationResponse { id, sessionId, attendeeId, status: EntryStatus, createdAt: string }`, `SessionDetailResponse extends SessionResponse { registeredCount; waitlistCount }`
  - `selects.ts`: `sessionRegistrationFields`, `type SessionRegistrationRow`
  - `mappers.ts`: `toSessionRegistration(row): SessionRegistrationResponse`, `toSessionDetail(row, counts, now): SessionDetailResponse`
  - `api-errors.decorator.ts`: `ApiConflicts(...reasons: ConflictReason[])`
  - тестовые хелперы внутри e2e-файла: `post(sessionId, action, body)`, `counts(sessionId)` — Task 5–7 дописывают тесты в этот же файл и пользуются ими.

- [ ] **Step 1: Написать падающие интеграционные тесты**

`backend/test/integration/session-registrations.e2e-spec.ts`:

```ts
import { makeAttendee, makeConference, makeRegistration, makeSession } from './fixtures';
import { createTestApp, DEFAULT_NOW, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: DEFAULT_NOW });
});
afterAll(() => t.close());

type Action = 'register' | 'waitlist' | 'cancel';
const post = (sessionId: number | string, action: Action, body: unknown) =>
  t.http().post(`/api/sessions/${sessionId}/${action}`).set('Content-Type', 'application/json').send(body as object);
const counts = async (sessionId = 1) => {
  const res = await t.http().get(`/api/sessions/${sessionId}`);
  return { registeredCount: res.body.registeredCount, capacity: res.body.capacity, waitlistCount: res.body.waitlistCount };
};

// Conference 1: 2027-01-10..11, UPCOMING at DEFAULT_NOW. Session 1 10:00-11:00 (1 seat), session 2 10:30-11:30 (overlaps 1),
// session 3 11:00-12:00 (back to back with 1). A, B, C are registered for the conference; D is an attendee without a registration.
const A = { email: 'a@example.com' };
const B = { email: 'b@example.com' };
const C = { email: 'c@example.com' };
const D = { email: 'd@example.com' };

beforeEach(async () => {
  t.clock.set(new Date(DEFAULT_NOW));
  await resetDb(t.prisma);
  const conference = await makeConference(t.prisma);
  await makeSession(t.prisma, conference.id, { capacity: 1 });
  await makeSession(t.prisma, conference.id, { startTime: '2027-01-10T10:30:00', endTime: '2027-01-10T11:30:00', capacity: 5 });
  await makeSession(t.prisma, conference.id, { startTime: '2027-01-10T11:00:00', endTime: '2027-01-10T12:00:00', capacity: 5 });
  for (const { email } of [A, B, C]) {
    const attendee = await makeAttendee(t.prisma, { email });
    await makeRegistration(t.prisma, conference.id, attendee.id);
  }
  await makeAttendee(t.prisma, D);
});

// Ways to close registration (spec 4.4). Plain functions returning a promise: an async function without await fails
// the lint rule require-await.
const CLOSERS: [string, () => Promise<unknown>, string][] = [
  ['the session has started', () => Promise.resolve(t.clock.set(new Date('2027-01-10T10:00:00.000Z'))), 'Registration is closed: the session has started'],
  ['the conference is CANCELLED', () => t.prisma.conference.update({ where: { id: 1 }, data: { status: 'CANCELLED' } }), 'Registration is closed: the conference is CANCELLED'],
  ['the conference is COMPLETED', () => Promise.resolve(t.clock.set(new Date('2027-01-12T00:00:00.000Z'))), 'Registration is closed: the conference is COMPLETED'],
];

describe('POST /api/sessions/:id/register and /waitlist (spec 4.1, 4.2)', () => {
  it('registers: 201, entry without names or email, no Location; GET shows the counts', async () => {
    const res = await post(1, 'register', A);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({ id: 1, sessionId: 1, attendeeId: 1, status: 'CONFIRMED', createdAt: '2026-10-05T12:00:00.000Z' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('GET /api/sessions/:id keeps the session fields and adds the two counts', async () => {
    const res = await t.http().get('/api/sessions/1');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['capacity', 'conference', 'conferenceId', 'description', 'endTime', 'id', 'registeredCount', 'room', 'roomId', 'speaker', 'speakerId', 'startTime', 'title', 'waitlistCount'],
    );
    expect(res.body).toMatchObject({ registeredCount: 0, waitlistCount: 0 });
  });

  it('finds the attendee whatever the case and spaces of the email (Review Focus 1)', async () => {
    expect((await post(1, 'register', { email: '  A@Example.COM ' })).body).toMatchObject({ attendeeId: 1, status: 'CONFIRMED' });
  });

  it('refuses a full session with 409 SESSION_FULL and does not put the attendee on the waitlist (DoD)', async () => {
    await post(1, 'register', A);
    const res = await post(1, 'register', B);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict', reason: 'SESSION_FULL', message: 'No seats left in this session; join the waitlist instead' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('adds to the waitlist of a full session: 201 WAITLISTED (DoD)', async () => {
    await post(1, 'register', A);
    const res = await post(1, 'waitlist', B);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sessionId: 1, attendeeId: 2, status: 'WAITLISTED' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
  });

  it('refuses the waitlist while seats are free: 409 SEATS_AVAILABLE', async () => {
    const res = await post(1, 'waitlist', A);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('SEATS_AVAILABLE');
    expect(await t.prisma.sessionRegistration.count()).toBe(0);
  });

  it('answers 409 CONFERENCE_REGISTRATION_REQUIRED the same way for an unregistered attendee and an unknown email', async () => {
    const unregistered = await post(1, 'register', D);
    const unknown = await post(1, 'register', { email: 'nobody@example.com' });
    for (const res of [unregistered, unknown]) {
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('CONFERENCE_REGISTRATION_REQUIRED');
    }
    const { requestId: _a, ...first } = unregistered.body;
    const { requestId: _b, ...second } = unknown.body;
    expect(first).toEqual(second);
    expect(await t.prisma.attendee.count()).toBe(4);
  });

  it('answers 409 ALREADY_REGISTERED with different messages for a seat and a waitlist place', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    expect((await post(1, 'register', A)).body).toMatchObject({ reason: 'ALREADY_REGISTERED', message: 'Attendee is already registered for this session' });
    expect((await post(1, 'waitlist', B)).body).toMatchObject({ reason: 'ALREADY_REGISTERED', message: 'Attendee is already on the waitlist for this session' });
  });

  it('refuses an overlapping session with 409 SESSION_OVERLAP, counting waitlist places, and allows back-to-back ones', async () => {
    await post(1, 'register', A);
    expect((await post(2, 'register', A)).body.reason).toBe('SESSION_OVERLAP');
    expect((await post(3, 'register', A)).status).toBe(201);
    await post(1, 'waitlist', B);
    expect((await post(2, 'register', B)).body.reason).toBe('SESSION_OVERLAP');
  });

  it.each(CLOSERS)('answers 409 REGISTRATION_CLOSED when %s, before any other check (spec 4.2, 4.4)', async (_name, close, message) => {
    await close();
    for (const res of [await post(1, 'register', A), await post(1, 'waitlist', { email: 'nobody@example.com' })]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ reason: 'REGISTRATION_CLOSED', message });
    }
  });

  it('is still open one second before the session starts', async () => {
    t.clock.set(new Date('2027-01-10T09:59:59.000Z'));
    expect((await post(1, 'register', A)).status).toBe(201);
  });

  it.each(['register', 'waitlist'] as const)('%s: 404 for a missing session, 400 for a bad id or body', async (action) => {
    expect((await post(999, action, A)).body).toMatchObject({ statusCode: 404, message: 'Session 999 not found' });
    expect((await post('abc', action, A)).status).toBe(400);
    const badEmail = await post(1, action, { email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.errors.map((e: { field: string }) => e.field)).toEqual(['email']);
    const extra = await post(1, action, { ...A, sessionId: 1 });
    expect(extra.status).toBe(400);
    expect(extra.body.errors.map((e: { field: string }) => e.field)).toEqual(['sessionId']);
  });

  it('answers 405 for GET on the new routes', async () => {
    const res = await t.http().get('/api/sessions/1/register');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
```

`makeSessionRegistration` (импорт) и хелпер `statuses` добавляются в Task 5 — там они впервые нужны (иначе lint: неиспользуемые).

- [ ] **Step 2: Тесты падают**

Run: `npm run test:int -- session-registrations` (тайм-аут 600 000 мс)
Expected: FAIL — `404 Route not found` вместо `201`; в `GET` нет `registeredCount`.

- [ ] **Step 3: Представление (selects, responses, mappers)**

`selects.ts` — после `registrationFields`:

```ts
export const sessionRegistrationFields = { id: true, sessionId: true, attendeeId: true, status: true, createdAt: true } satisfies Prisma.SessionRegistrationSelect;
```

и в конец:

```ts
export type SessionRegistrationRow = Prisma.SessionRegistrationGetPayload<{ select: typeof sessionRegistrationFields }>;
```

`responses.ts` — `import { ENTRY_STATUSES, type EntryStatus } from '../session-registrations/waitlist';` и после `SessionResponse`:

```ts
export class SessionDetailResponse extends SessionResponse {
  @ApiProperty({ example: 120, description: 'Confirmed session registrations (BEVN-202)' }) registeredCount!: number;
  @ApiProperty({ example: 0, description: 'Attendees on the waitlist of the session' }) waitlistCount!: number;
}

export class SessionRegistrationResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 4 }) sessionId!: number;
  @ApiProperty({ example: 1, description: 'No name or email (SEC-1)' }) attendeeId!: number;
  @ApiProperty({ enum: ENTRY_STATUSES, example: 'CONFIRMED' }) status!: EntryStatus;
  @ApiProperty({ example: '2026-10-07T09:00:00.000Z', description: 'UTC instant with Z; the waitlist is ordered by createdAt, then id' }) createdAt!: string;
}
```

`mappers.ts` — импорты `SessionDetailResponse`, `SessionRegistrationResponse`, `SessionRegistrationRow`, `import type { EntryCounts } from '../session-registrations/promotion';`, `import type { EntryStatus } from '../session-registrations/waitlist';`; в конец:

```ts
export function toSessionDetail(s: SessionWithRelationsRow, counts: EntryCounts, now: Date): SessionDetailResponse {
  return { ...toSession(s, now), registeredCount: counts.registeredCount, waitlistCount: counts.waitlistCount };
}

export function toSessionRegistration(r: SessionRegistrationRow): SessionRegistrationResponse {
  // The CHECK constraint keeps Status within ENTRY_STATUSES.
  return { id: r.id, sessionId: r.sessionId, attendeeId: r.attendeeId, status: r.status as EntryStatus, createdAt: formatInstant(r.createdAt) };
}
```

- [ ] **Step 4: `countEntries` и `GET /api/sessions/{id}`**

`backend/src/session-registrations/promotion.ts`:

```ts
import type { Tx } from '../common/locking';

export interface EntryCounts {
  registeredCount: number;
  waitlistCount: number;
}

// Counts are computed, not stored (spec 3.2): one grouped query for both.
export async function countEntries(db: Tx, sessionId: number): Promise<EntryCounts> {
  const groups = await db.sessionRegistration.groupBy({
    by: ['status'],
    where: { sessionId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
    _count: { _all: true },
  });
  const of = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { registeredCount: of('CONFIRMED'), waitlistCount: of('WAITLISTED') };
}
```

[предполагаю] `this.prisma` (`PrismaService extends PrismaClient`) подходит под `Tx` = `Omit<PrismaClient, ITXClientDenyList>`
(`src/generated/prisma/internal/prismaNamespace.ts:1293`), и `groupBy` с `_count: { _all: true }` типизируется без `orderBy`.
Проверяет `npm run typecheck` в Step 7. Если typecheck падает — тип параметра `db: Tx | PrismaService` или два запроса `count`;
выбор записать в отчёт.

`sessions.service.ts` — импорты `countEntries`, `toSessionDetail`, `SessionDetailResponse`; метод `get`:

```ts
  async get(id: number): Promise<SessionDetailResponse> {
    const row = await this.prisma.session.findUnique({ where: { id }, select: sessionWithRelations });
    if (!row) throw notFound(`Session ${id} not found`);
    return toSessionDetail(row, await countEntries(this.prisma, id), this.clock.now());
  }
```

`sessions.controller.ts`: `@ApiOkResponse({ type: SessionDetailResponse })` у `get`, тип возврата `Promise<SessionDetailResponse>`, импорт `SessionDetailResponse`.

- [ ] **Step 5: DTO, сервис, контроллер, модуль**

`backend/src/session-registrations/session-attendee.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsAsciiEmail, NormalizeEmail } from '../common/validation';

// Body of the three session registration endpoints (spec 4.1): the email only, same rules as RegisterAttendeeDto.email.
export class SessionAttendeeDto {
  @ApiProperty({ example: 'maria.kowalska@example.com', description: 'Email of an attendee registered for the conference. ASCII only; trimmed and lower-cased. Never returned.' })
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;
}
```

`backend/src/session-registrations/session-registrations.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { conflict, notFound } from '../common/errors';
import { lockConference, type LockedConference, type Tx } from '../common/locking';
import { PrismaService } from '../prisma/prisma.service';
import { toSessionRegistration } from '../representation/mappers';
import type { SessionRegistrationResponse } from '../representation/responses';
import { sessionRegistrationFields } from '../representation/selects';
import { countEntries } from './promotion';
import type { SessionAttendeeDto } from './session-attendee.dto';
import { ACTIVE_STATUSES, closedReason, decideJoin, overlaps, type ActiveStatus, type JoinKind, type JoinState } from './waitlist';

export interface LockedSession {
  id: number;
  startTime: Date;
  endTime: Date;
  capacity: number;
}

// Spec 5.1: lock the conference, then re-read the session — capacity and times read before the lock could be stale
// against a concurrent PUT of the session.
export async function lockSession(tx: Tx, conferenceId: number, sessionId: number): Promise<{ conference: LockedConference; session: LockedSession }> {
  const conference = await lockConference(tx, conferenceId);
  const session = await tx.session.findUnique({ where: { id: sessionId }, select: { id: true, startTime: true, endTime: true, capacity: true } });
  if (!conference || !session) throw notFound(`Session ${sessionId} not found`);
  return { conference, session };
}

async function readJoinState(tx: Tx, conferenceId: number, session: LockedSession, email: string): Promise<Omit<JoinState, 'closed' | 'capacity'>> {
  const attendee = await tx.attendee.findUnique({ where: { email }, select: { id: true } });
  if (!attendee) return { attendeeId: null, conferenceRegistered: false, current: null, overlapping: false, registeredCount: 0 };
  const registration = await tx.registration.findFirst({ where: { conferenceId, attendeeId: attendee.id, status: 'CONFIRMED' }, select: { id: true } });
  // Active entries of the attendee in this conference with their times: the own entry and the overlap check (spec 2).
  const entries = await tx.sessionRegistration.findMany({
    where: { attendeeId: attendee.id, status: { in: ACTIVE_STATUSES }, session: { conferenceId } },
    select: { sessionId: true, status: true, session: { select: { startTime: true, endTime: true } } },
  });
  const own = entries.find((e) => e.sessionId === session.id);
  const { registeredCount } = await countEntries(tx, session.id);
  return {
    attendeeId: attendee.id,
    conferenceRegistered: registration !== null,
    current: own ? (own.status as ActiveStatus) : null,
    overlapping: entries.some((e) => e.sessionId !== session.id && overlaps(e.session, session)),
    registeredCount,
  };
}

@Injectable()
export class SessionRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  register(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.join('register', sessionId, dto.email);
  }

  joinWaitlist(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.join('waitlist', sessionId, dto.email);
  }

  // A session never moves between conferences, so its conferenceId is safe to read before the lock (spec 5.1).
  private async conferenceOf(sessionId: number): Promise<number> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { conferenceId: true } });
    if (!session) throw notFound(`Session ${sessionId} not found`);
    return session.conferenceId;
  }

  private async join(kind: JoinKind, sessionId: number, email: string): Promise<SessionRegistrationResponse> {
    const conferenceId = await this.conferenceOf(sessionId);
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const { conference, session } = await lockSession(tx, conferenceId, sessionId);
      const state = await readJoinState(tx, conferenceId, session, email);
      const decision = decideJoin(kind, { ...state, closed: closedReason(conference, session, now), capacity: session.capacity });
      if (!decision.ok) throw conflict(decision.message, decision.reason);
      return tx.sessionRegistration.create({
        data: { sessionId, attendeeId: decision.attendeeId, status: decision.status, createdAt: now },
        select: sessionRegistrationFields,
      });
    });
    return toSessionRegistration(row);
  }
}
```

`backend/src/swagger/api-errors.decorator.ts` — импорты `import type { ConflictReason } from '../common/errors';`, `import { closedMessage, MESSAGES } from '../session-registrations/waitlist';`; в конец:

```ts
const CONFLICT_EXAMPLES: Record<ConflictReason, string> = {
  REGISTRATION_CLOSED: closedMessage('the session has started'),
  CONFERENCE_REGISTRATION_REQUIRED: MESSAGES.conferenceRegistrationRequired,
  ALREADY_REGISTERED: MESSAGES.alreadyRegistered,
  SESSION_OVERLAP: MESSAGES.overlap,
  SESSION_FULL: MESSAGES.full,
  SEATS_AVAILABLE: MESSAGES.seatsAvailable,
};

// 409 of the session registration endpoints: one example per reason (BEVN-202 spec 4.7). The shared 409 example of
// ApiErrors describes the conference registration, so these operations do not list 409 there.
export function ApiConflicts(...reasons: ConflictReason[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponse),
    ApiResponse({
      status: 409,
      description: `${STATUS_CODES[409]}; reason: ${reasons.join(', ')}`,
      content: {
        'application/json': {
          schema: { $ref: getSchemaPath(ErrorResponse) },
          examples: Object.fromEntries(
            reasons.map((reason) => [
              reason,
              { value: { statusCode: 409, error: STATUS_CODES[409], message: CONFLICT_EXAMPLES[reason], requestId: '3f1c2a7e-8b4d-4c1e-9a55-2d6f0b9e7c11', reason } },
            ]),
          ),
        },
      },
    }),
  );
}
```

`backend/src/session-registrations/session-registrations.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { SessionRegistrationResponse } from '../representation/responses';
import { ApiConflicts, ApiErrors } from '../swagger/api-errors.decorator';
import { SessionAttendeeDto } from './session-attendee.dto';
import { SessionRegistrationsService } from './session-registrations.service';

const BODY_EXAMPLES = { attendee: { value: { email: 'maria.kowalska@example.com' } } };

@ApiTags('Sessions')
@Controller('sessions')
export class SessionRegistrationsController {
  constructor(private readonly registrations: SessionRegistrationsService) {}

  @Post(':id/register')
  @ApiOperation({
    operationId: 'Sessions_Register',
    summary: 'Register an attendee for a session',
    description: 'Needs a confirmed conference registration. A full session is 409 SESSION_FULL: the attendee is not put on the waitlist. No Location header.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'CONFERENCE_REGISTRATION_REQUIRED', 'ALREADY_REGISTERED', 'SESSION_OVERLAP', 'SESSION_FULL')
  register(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.register(id, dto);
  }

  @Post(':id/waitlist')
  @ApiOperation({
    operationId: 'Sessions_JoinWaitlist',
    summary: 'Put an attendee on the waitlist of a full session',
    description: 'Only when the session is full (otherwise 409 SEATS_AVAILABLE). Places are taken in order of createdAt, then id.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'CONFERENCE_REGISTRATION_REQUIRED', 'ALREADY_REGISTERED', 'SESSION_OVERLAP', 'SEATS_AVAILABLE')
  joinWaitlist(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.joinWaitlist(id, dto);
  }
}
```

`backend/src/session-registrations/session-registrations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SessionRegistrationsController } from './session-registrations.controller';
import { SessionRegistrationsService } from './session-registrations.service';

@Module({ controllers: [SessionRegistrationsController], providers: [SessionRegistrationsService] })
export class SessionRegistrationsModule {}
```

`app.module.ts`: импорт и `SessionRegistrationsModule` после `RegistrationsModule` в `imports`.

- [ ] **Step 6: Маршруты 405 и защитный тест Swagger**

`http-middleware.ts`, в `API_ROUTES` после `/api/sessions/{id}`:

```ts
  { path: '/api/sessions/{id}/register', pattern: /^\/api\/sessions\/[^/]+\/register\/?$/, methods: ['POST'] },
  { path: '/api/sessions/{id}/waitlist', pattern: /^\/api\/sessions\/[^/]+\/waitlist\/?$/, methods: ['POST'] },
```

`swagger.e2e-spec.ts` — первый тест:

```ts
  // Operations added after the .NET document (spec 7.3 of BEVN-202); the reference swagger.json is not changed.
  const ADDED = ['POST /api/sessions/{id}/register Sessions_Register', 'POST /api/sessions/{id}/waitlist Sessions_JoinWaitlist'];
  it('has the operations of the .NET document plus the added ones', () => {
    expect(operations(doc)).toEqual([...operations(reference), ...ADDED].sort());
  });
```

в `interface Doc` (строка 6) тип ответа — `content?: Record<string, { example?: unknown; examples?: object }>`, и в тесте
примеров (строки 39–41) — без приведения типа: каст `as { example?: unknown; examples?: object } | undefined` давал ошибку
lint `@typescript-eslint/no-unnecessary-type-assertion` — уточнено 2026-10-08:

```ts
        for (const [code, response] of Object.entries(op.responses).filter(([c]) => Number(c) >= 400)) {
          const media = response.content?.['application/json'];
          expect({ path, method, code, example: media?.example ?? media?.examples }).toMatchObject({ example: expect.anything() });
        }
```

`api-description.ts` — после пункта **Sessions**:

```
- **Session registration.** \`POST /api/sessions/{id}/register\`, \`/waitlist\` and \`/cancel\` take \`{ email }\` of an attendee with a
  confirmed conference registration. Registering for a full session is **409** \`SESSION_FULL\` (no automatic waitlist place); the
  waitlist accepts attendees only while the session is full. Cancelling a confirmed place gives it to the first on the waitlist
  (by \`createdAt\`, then \`id\`). Open while the conference is UPCOMING or ACTIVE and the session has not started (its start time is
  compared as UTC). An attendee cannot hold overlapping sessions of one conference. \`GET /api/sessions/{id}\` adds
  \`registeredCount\` and \`waitlistCount\`.
```

- [ ] **Step 7: Тесты проходят**

Run: `npm run lint && npm run typecheck && npm run test:int -- session-registrations swagger sessions` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 8: Полный прогон**

Run: `npm test && npm run test:int` (тайм-аут 600 000 мс)
Expected: PASS (включая `query-count` — у `GET /api/sessions/{id}` число запросов по-прежнему не зависит от числа сессий).

- [ ] **Step 9: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/session-registrations src/app.module.ts src/representation src/sessions src/common/http-middleware.ts src/swagger test/integration/session-registrations.e2e-spec.ts test/integration/swagger.e2e-spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add session register and waitlist endpoints with counts (BEVN-202)")
```

---

### Task 5: `POST cancel`, продвижение из списка и лог

**Files:**
- Modify: `backend/src/session-registrations/promotion.ts`
- Modify: `backend/src/session-registrations/session-registrations.service.ts`, `session-registrations.controller.ts`
- Modify: `backend/src/common/http-middleware.ts`, `backend/test/integration/swagger.e2e-spec.ts` (`ADDED`)
- Test: `backend/test/integration/session-registrations.e2e-spec.ts`
- Test: Create `backend/src/session-registrations/promotion.spec.ts`

**Interfaces:**
- Consumes: `countEntries`, `lockSession`, `type LockedSession` (Task 4); `decideCancel`, `nextInLine`, `seatsToFill`, `closedReason`, `closedMessage`, `MESSAGES` (Task 3).
- Produces (`promotion.ts`):
  - `interface Promoted { registrationId: number; attendeeId: number; sessionId: number }`, `type PromotionTrigger = 'cancel' | 'capacity'`
  - `promoteFromWaitlist(tx: Tx, session: { id: number; capacity: number }): Promise<Promoted[]>`
  - `logPromotions(promoted: Promoted[], trigger: PromotionTrigger): void`
  - сервис: `cancel(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse>`
  - в e2e-файле: `captureLogs(run)` и `promotions(entries)` (Task 6 использует).

- [ ] **Step 1: Написать падающие тесты**

В `session-registrations.e2e-spec.ts`: импорты `import { Logger, type LoggerService } from '@nestjs/common';`, `makeSessionRegistration`; хелперы после `counts`:

```ts
const statuses = () => t.prisma.sessionRegistration.findMany({ orderBy: { id: 'asc' }, select: { id: true, attendeeId: true, status: true } });

// Records the Nest level (the method called) and the context of each structured log entry.
class LevelLogger implements LoggerService {
  readonly entries: { level: string; context?: string; message: Record<string, unknown> }[] = [];
  private push(level: string, message: unknown, context: unknown): void {
    if (message !== null && typeof message === 'object') {
      this.entries.push({ level, context: typeof context === 'string' ? context : undefined, message: message as Record<string, unknown> });
    }
  }
  log(message: unknown, context?: unknown): void {
    this.push('log', message, context);
  }
  error(message: unknown, context?: unknown): void {
    this.push('error', message, context);
  }
  warn(message: unknown, context?: unknown): void {
    this.push('warn', message, context);
  }
}

async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; entries: LevelLogger['entries'] }> {
  const logger = new LevelLogger();
  Logger.overrideLogger(logger);
  try {
    return { result: await run(), entries: logger.entries };
  } finally {
    Logger.overrideLogger(false);
  }
}
const promotions = (entries: LevelLogger['entries']) => entries.filter((e) => e.message.event === 'waitlist.promoted');
```

Тесты:

```ts
describe('POST /api/sessions/:id/cancel (spec 4.3, 5.2, 5.3)', () => {
  it('cancels a seat: 200 with the CANCELLED entry; the first on the waitlist gets the seat and the promotion is logged at INFO (DoD)', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    const { result: res, entries } = await captureLogs(() => post(1, 'cancel', A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, sessionId: 1, attendeeId: 1, status: 'CANCELLED', createdAt: '2026-10-05T12:00:00.000Z' });
    // B and C joined at the same FixedClock instant: the smaller id goes first (spec 2).
    expect(await statuses()).toEqual([
      { id: 1, attendeeId: 1, status: 'CANCELLED' },
      { id: 2, attendeeId: 2, status: 'CONFIRMED' },
      { id: 3, attendeeId: 3, status: 'WAITLISTED' },
    ]);
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    const logged = promotions(entries);
    expect(logged).toEqual([
      {
        level: 'log',
        context: 'Waitlist',
        message: { event: 'waitlist.promoted', requestId: res.headers['x-request-id'], sessionId: 1, attendeeId: 2, registrationId: 2, trigger: 'cancel' },
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain('@');
  });

  it('promotes by createdAt before id (DoD: waitlist ordering)', async () => {
    const [a, b, c] = [1, 2, 3];
    await makeSessionRegistration(t.prisma, 1, a, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, b, 'WAITLISTED', '2026-10-01T09:00:02.000Z');
    await makeSessionRegistration(t.prisma, 1, c, 'WAITLISTED', '2026-10-01T09:00:01.000Z');
    await post(1, 'cancel', A);
    expect((await statuses()).map((s) => s.status)).toEqual(['CANCELLED', 'WAITLISTED', 'CONFIRMED']);
  });

  it('promotes from the waitlist of the cancelled session only; entries of other sessions neither fill nor take its seat', async () => {
    // Session 4 (another day) is full and has its own, earlier waitlist place; its seat must not count for session 1 either.
    const other = await makeSession(t.prisma, 1, { startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 1 });
    await makeSessionRegistration(t.prisma, 1, 1, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, 3, 'WAITLISTED', '2026-10-01T09:00:02.000Z');
    await makeSessionRegistration(t.prisma, other.id, 3, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, other.id, 2, 'WAITLISTED', '2026-10-01T09:00:01.000Z');
    const { entries } = await captureLogs(() => post(1, 'cancel', A));
    expect(await statuses()).toEqual([
      { id: 1, attendeeId: 1, status: 'CANCELLED' },
      { id: 2, attendeeId: 3, status: 'CONFIRMED' },
      { id: 3, attendeeId: 3, status: 'CONFIRMED' },
      { id: 4, attendeeId: 2, status: 'WAITLISTED' },
    ]);
    expect(await counts(other.id)).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    expect(promotions(entries).map((e) => [e.message.sessionId, e.message.attendeeId, e.message.registrationId])).toEqual([[1, 3, 2]]);
  });

  it('cancels a waitlist place without promoting anyone and without a log entry', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    const { result: res, entries } = await captureLogs(() => post(1, 'cancel', B));
    expect(res.body.status).toBe('CANCELLED');
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    expect(promotions(entries)).toEqual([]);
  });

  it('answers 404 without an active entry, for a repeated cancel and for an unknown email; nothing is promoted (Review Focus 2)', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'cancel', A); // B promoted
    const { result, entries } = await captureLogs(async () => [await post(1, 'cancel', A), await post(1, 'cancel', C), await post(1, 'cancel', { email: 'nobody@example.com' })]);
    for (const res of result) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('No active registration or waitlist place for this email on this session');
    }
    expect(promotions(entries)).toEqual([]);
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('finds the entry whatever the case and spaces of the email (Review Focus 1)', async () => {
    await post(1, 'register', A);
    expect((await post(1, 'cancel', { email: ' A@EXAMPLE.com' })).status).toBe(200);
  });

  it.each(CLOSERS)('answers 409 REGISTRATION_CLOSED when %s and keeps the entry', async (_name, close) => {
    await post(1, 'register', A);
    await close();
    const res = await post(1, 'cancel', A);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('REGISTRATION_CLOSED');
    expect((await statuses())[0].status).toBe('CONFIRMED');
  });

  it('404 for a missing session, 400 for a bad id or body', async () => {
    expect((await post(999, 'cancel', A)).body.message).toBe('Session 999 not found');
    expect((await post('abc', 'cancel', A)).status).toBe(400);
    expect((await post(1, 'cancel', { email: 'x' })).status).toBe(400);
    expect((await post(1, 'cancel', { ...A, reason: 'x' })).status).toBe(400);
  });

  it('registers again after a cancel as a new row; a new waitlist place goes to the end (spec 3.1)', async () => {
    await post(1, 'register', A);
    await post(1, 'cancel', A);
    const again = await post(1, 'register', A);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: 2, status: 'CONFIRMED' });
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    await post(1, 'cancel', B);
    t.clock.set(new Date('2026-10-05T12:00:01.000Z'));
    await post(1, 'waitlist', B);
    await post(1, 'cancel', A);
    expect((await statuses()).map((s) => [s.attendeeId, s.status])).toEqual([
      [1, 'CANCELLED'], [1, 'CANCELLED'], [2, 'CANCELLED'], [3, 'CONFIRMED'], [2, 'WAITLISTED'],
    ]);
  });
});
```

- [ ] **Step 1a: Unit-тест продвижения без базы (DoD «cancel triggers promotion», решение 11)**

`backend/src/session-registrations/promotion.spec.ts`:

```ts
import type { Tx } from '../common/locking';
import { promoteFromWaitlist } from './promotion';

interface Entry {
  id: number;
  attendeeId: number;
  createdAt: Date;
}

// Only the three calls promoteFromWaitlist makes; the rest of the transaction client is not needed.
function fakeTx(waitlist: Entry[], registeredCount: number) {
  const findMany = jest.fn().mockResolvedValue(waitlist);
  const count = jest.fn().mockResolvedValue(registeredCount);
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = { sessionRegistration: { findMany, count, updateMany } } as unknown as Tx;
  return { tx, count, updateMany };
}

const at = (second: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, second));
const WAITLIST: Entry[] = [
  { id: 12, attendeeId: 3, createdAt: at(2) },
  { id: 13, attendeeId: 4, createdAt: at(5) },
  { id: 11, attendeeId: 2, createdAt: at(2) },
];

describe('promoteFromWaitlist (spec 5.2; DoD: cancel triggers promotion, waitlist ordering)', () => {
  it('gives the seat freed by a cancel to the first by (createdAt, id)', async () => {
    const { tx, updateMany } = fakeTx(WAITLIST, 1);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([{ registrationId: 11, attendeeId: 2, sessionId: 7 }]);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: [11] } }, data: { status: 'CONFIRMED' } });
  });

  it('fills every free seat in waitlist order', async () => {
    const { tx } = fakeTx(WAITLIST, 1);
    expect((await promoteFromWaitlist(tx, { id: 7, capacity: 10 })).map((p) => p.registrationId)).toEqual([11, 12, 13]);
  });

  it('changes nothing while the session is full', async () => {
    const { tx, updateMany } = fakeTx(WAITLIST, 2);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not count seats for an empty waitlist', async () => {
    const { tx, count, updateMany } = fakeTx([], 0);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([]);
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Тесты падают**

Run: `npm test -- promotion` → FAIL: `promoteFromWaitlist` не экспортируется — ошибка выполнения (`… is not a function`),
не компиляции: ts-jest не проверяет типы (см. Task 2 Step 2, уточнено 2026-10-08).
Run: `npm run test:int -- session-registrations` (тайм-аут 600 000 мс)
Expected: FAIL — `/cancel` отвечает `404 Route not found`.

Тест «promotes from the waitlist of the cancelled session only» добавлен 2026-10-09, после реализации: без него мутации
`promoteFromWaitlist` (без `sessionId` в `findMany` или в `count`) проходили все тесты. Его RED — эти две мутации
(копия файла, правка, прогон, возврат и `cmp`): с каждой тест красный, на коде плана — зелёный.

- [ ] **Step 3: Продвижение и лог**

`promotion.ts` — дописать (импорты `Logger` из `@nestjs/common`, `requestContext` из `../common/request-context`, `nextInLine`, `seatsToFill` из `./waitlist`):

```ts
export interface Promoted {
  registrationId: number;
  attendeeId: number;
  sessionId: number;
}

export type PromotionTrigger = 'cancel' | 'capacity';

// Spec 5.2: while seats are free and the waitlist is not empty, the first in line gets CONFIRMED. Runs in the caller's
// transaction under the conference lock; a failure rolls back the cancel or the PUT too. Overlaps are not re-checked:
// the waitlist place passed that check already (spec 5.2, limitations in 9).
export async function promoteFromWaitlist(tx: Tx, session: { id: number; capacity: number }): Promise<Promoted[]> {
  const waitlist = await tx.sessionRegistration.findMany({
    where: { sessionId: session.id, status: 'WAITLISTED' },
    select: { id: true, attendeeId: true, createdAt: true },
  });
  if (waitlist.length === 0) return [];
  const registeredCount = await tx.sessionRegistration.count({ where: { sessionId: session.id, status: 'CONFIRMED' } });
  const chosen = nextInLine(waitlist, seatsToFill(session.capacity, registeredCount, waitlist.length));
  if (chosen.length === 0) return [];
  await tx.sessionRegistration.updateMany({ where: { id: { in: chosen.map((e) => e.id) } }, data: { status: 'CONFIRMED' } });
  return chosen.map((e) => ({ registrationId: e.id, attendeeId: e.attendeeId, sessionId: session.id }));
}

const logger = new Logger('Waitlist');

// Called after the commit (spec 5.3): a rolled-back transaction leaves no entry about a promotion that did not happen.
// Nest has no "info" level; log is its INFO (spec 5.3). No email or names (SEC-1).
export function logPromotions(promoted: Promoted[], trigger: PromotionTrigger): void {
  const requestId = requestContext.getStore()?.requestId;
  for (const p of promoted) {
    logger.log({ event: 'waitlist.promoted', requestId, sessionId: p.sessionId, attendeeId: p.attendeeId, registrationId: p.registrationId, trigger });
  }
}
```

- [ ] **Step 4: `cancel` в сервисе и контроллере**

`session-registrations.service.ts` — импорты `logPromotions`, `promoteFromWaitlist`; `closedMessage`, `decideCancel`, `MESSAGES` из `./waitlist`; метод в классе:

```ts
  async cancel(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    const conferenceId = await this.conferenceOf(sessionId);
    const now = this.clock.now();
    const { row, promoted } = await this.prisma.$transaction(async (tx) => {
      const { conference, session } = await lockSession(tx, conferenceId, sessionId);
      const closed = closedReason(conference, session, now);
      if (closed !== null) throw conflict(closedMessage(closed), 'REGISTRATION_CLOSED');
      // An unknown email and an email without an active entry give the same 404 (spec 4.3).
      const entry = await tx.sessionRegistration.findFirst({
        where: { sessionId, status: { in: ACTIVE_STATUSES }, attendee: { email: dto.email } },
        select: { id: true, status: true },
      });
      if (!entry) throw notFound(MESSAGES.noActiveEntry);
      const cancelled = await tx.sessionRegistration.update({ where: { id: entry.id }, data: { status: 'CANCELLED' }, select: sessionRegistrationFields });
      const promoted = decideCancel(entry.status as ActiveStatus).promote ? await promoteFromWaitlist(tx, session) : [];
      return { row: cancelled, promoted };
    });
    logPromotions(promoted, 'cancel');
    return toSessionRegistration(row);
  }
```

`session-registrations.controller.ts` — импорты `HttpCode`, `ApiOkResponse`; метод:

```ts
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'Sessions_Cancel',
    summary: 'Cancel a session registration or waitlist place',
    description: 'A cancelled confirmed place goes to the first on the waitlist in the same transaction. 404 if the email has no active entry on the session.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiOkResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED')
  cancel(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.cancel(id, dto);
  }
```

`http-middleware.ts` — после маршрута `/waitlist`:

```ts
  { path: '/api/sessions/{id}/cancel', pattern: /^\/api\/sessions\/[^/]+\/cancel\/?$/, methods: ['POST'] },
```

`swagger.e2e-spec.ts` — в `ADDED` добавить `'POST /api/sessions/{id}/cancel Sessions_Cancel'`.

- [ ] **Step 5: Тесты проходят**

Run: `npm run lint && npm run typecheck && npm test -- promotion waitlist && npm run test:int -- session-registrations swagger` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 6: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/session-registrations src/common/http-middleware.ts test/integration/session-registrations.e2e-spec.ts test/integration/swagger.e2e-spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add session cancel with waitlist promotion and log (BEVN-202)")
```

---

### Task 6: `PUT /api/sessions/{id}` — `capacity` ниже записанных и продвижение при росте

**Files:**
- Modify: `backend/src/sessions/sessions.service.ts:56-93`
- Test: `backend/test/integration/session-registrations.e2e-spec.ts`

**Interfaces:**
- Consumes: `countEntries`, `promoteFromWaitlist`, `logPromotions` (Tasks 4–5), `closedReason` (Task 3); в тестах — `captureLogs`, `promotions`, `counts`, `statuses` (Tasks 4–5).
- Produces: `checkRules(tx, conference, data, registeredCount = 0)` (внутренняя функция `sessions.service.ts`).

- [ ] **Step 1: Написать падающие тесты**

В конец `session-registrations.e2e-spec.ts`:

```ts
describe('PUT /api/sessions/:id with registrations (spec 4.5)', () => {
  const SESSION_1 = { title: 'Talk', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', speakerId: null, roomId: null };
  const put = (body: object) => t.http().put('/api/sessions/1').set('Content-Type', 'application/json').send(body);
  async function fillSession1(confirmed: number[], waitlisted: number[]): Promise<void> {
    for (const id of confirmed) await makeSessionRegistration(t.prisma, 1, id, 'CONFIRMED');
    for (const [i, id] of waitlisted.entries()) await makeSessionRegistration(t.prisma, 1, id, 'WAITLISTED', `2026-10-01T10:00:0${i}.000Z`);
  }

  it('refuses capacity below the confirmed count with 422 on capacity', async () => {
    await fillSession1([1, 2], []);
    const res = await put({ ...SESSION_1, capacity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ field: 'capacity', messages: ['capacity must not be below the number of confirmed registrations (2)'] }]);
  });

  it('allows capacity equal to the confirmed count (Review Focus 3)', async () => {
    await fillSession1([1, 2], []);
    expect((await put({ ...SESSION_1, capacity: 2 })).status).toBe(200);
  });

  it('reports the room and the confirmed-count errors together under capacity', async () => {
    await t.prisma.room.create({ data: { name: 'Small', capacity: 1 } });
    await fillSession1([1, 2, 3], []);
    const res = await put({ ...SESSION_1, capacity: 2, roomId: 1 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'capacity', messages: ['capacity must not exceed the room capacity (1)', 'capacity must not be below the number of confirmed registrations (3)'] },
    ]);
  });

  it('promotes the waitlist in order when capacity grows, one INFO entry per attendee with trigger capacity (Review Focus 4)', async () => {
    await fillSession1([1], [3, 2]);
    const { result: res, entries } = await captureLogs(() => put({ ...SESSION_1, capacity: 5 }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).not.toContain('registeredCount'); // PUT keeps SessionResponse (spec 4.1)
    expect(await counts()).toEqual({ registeredCount: 3, capacity: 5, waitlistCount: 0 });
    expect(promotions(entries).map((e) => [e.level, e.message.attendeeId, e.message.trigger])).toEqual([
      ['log', 3, 'capacity'],
      ['log', 2, 'capacity'],
    ]);
  });

  it('promotes only as many as the new seats', async () => {
    await fillSession1([1], [2, 3]);
    await put({ ...SESSION_1, capacity: 2 });
    expect(await counts()).toEqual({ registeredCount: 2, capacity: 2, waitlistCount: 1 });
  });

  it('does not promote after the session has started (spec 4.5, 9)', async () => {
    await fillSession1([1], [2]);
    t.clock.set(new Date('2027-01-10T10:30:00.000Z'));
    const { entries } = await captureLogs(() => put({ ...SESSION_1, capacity: 5 }));
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 5, waitlistCount: 1 });
    expect(promotions(entries)).toEqual([]);
  });
});
```

- [ ] **Step 2: Тесты падают**

Run: `npm run test:int -- session-registrations -t "PUT"` (тайм-аут 600 000 мс)
Expected: FAIL — `PUT` отвечает 200 на `capacity: 1`; продвижения нет.

- [ ] **Step 3: Реализация**

`sessions.service.ts` — импорты `countEntries`, `logPromotions`, `promoteFromWaitlist` из `../session-registrations/promotion`, `closedReason` из `../session-registrations/waitlist`. Метод `update`:

```ts
  async update(id: number, dto: UpdateSessionDto): Promise<SessionResponse> {
    const data = toSessionData(dto);
    const current = await this.prisma.session.findUnique({ where: { id }, select: { conferenceId: true } });
    if (!current) throw notFound(`Session ${id} not found`);
    // Same lock as create: the rules depend on the conference dates. conferenceId never changes, so reading it first is safe.
    // The capacity is re-read under the lock: session registrations change it from under a stale read (BEVN-202 spec 5.1).
    const { row, promoted } = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, current.conferenceId);
      if (!conference) throw notFound(`Conference ${current.conferenceId} not found`);
      const before = await tx.session.findUniqueOrThrow({ where: { id }, select: { capacity: true } });
      const { registeredCount } = await countEntries(tx, id);
      await checkRules(tx, conference, data, registeredCount);
      const row = await tx.session.update({ where: { id }, data, select: sessionWithRelations });
      // Raised capacity fills the new seats from the waitlist while registration is open (spec 4.5).
      const grows = data.capacity > before.capacity && closedReason(conference, row, this.clock.now()) === null;
      return { row, promoted: grows ? await promoteFromWaitlist(tx, row) : [] };
    });
    logPromotions(promoted, 'capacity');
    return toSession(row, this.clock.now());
  }
```

`checkRules`:

```ts
async function checkRules(tx: Tx, conference: LockedConference, data: SessionData, registeredCount = 0): Promise<void> {
  const errors: FieldError[] = [];
  // One entry per field with all its messages, like flattenValidationErrors.
  const fail = (field: string, message: string) => {
    const existing = errors.find((e) => e.field === field);
    if (existing) existing.messages.push(message);
    else errors.push({ field, messages: [message] });
  };
  if (!isWithinDays(data.startTime, data.endTime, conference.startDate, conference.endDate)) {
    fail('startTime', 'the session must take place within the conference days');
  }
  if (data.roomId !== null) {
    const room = await tx.room.findUnique({ where: { id: data.roomId }, select: { capacity: true } });
    if (room && data.capacity > room.capacity) fail('capacity', `capacity must not exceed the room capacity (${room.capacity})`);
  }
  if (data.capacity < registeredCount) fail('capacity', `capacity must not be below the number of confirmed registrations (${registeredCount})`);
  if (errors.length > 0) throw unprocessable('Session violates conference rules', errors);
}
```

- [ ] **Step 4: Тесты проходят**

Run: `npm run lint && npm run typecheck && npm run test:int -- session-registrations sessions ported-dotnet blank-strings` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 5: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/sessions/sessions.service.ts test/integration/session-registrations.e2e-spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: check and promote session waitlist on capacity change (BEVN-202)")
```

---

### Task 7: Гонки под блокировкой, мутационная проверка, число запросов

**Files:**
- Modify: `backend/test/integration/helpers.ts` (перенос `whileTableLocked`)
- Modify: `backend/test/integration/registrations.e2e-spec.ts:106-122` (импорт вместо локальной функции)
- Modify: `backend/test/integration/session-registrations.e2e-spec.ts`
- Modify: `backend/test/integration/query-count.e2e-spec.ts`

**Interfaces:**
- Produces: `whileTableLocked(table: 'registrations' | 'attendees' | 'session_registrations', run: () => Promise<void>): Promise<void>` в `helpers.ts`.

- [ ] **Step 1: Перенести `whileTableLocked` в `helpers.ts`**

В конец `helpers.ts`:

```ts
// The race window between the checks and the insert is milliseconds, so plain parallel requests almost never overlap.
// A test transaction holds a table lock that lets reads through but makes inserts and updates wait: every request
// reaches its checks while the lock is held. Without the conference row lock they would all pass and all write.
export async function whileTableLocked(table: 'registrations' | 'attendees' | 'session_registrations', run: () => Promise<void>): Promise<void> {
  const holder = newPrisma();
  const held = holder.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN SHARE ROW EXCLUSIVE MODE`); // table is one of three literals
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
    { timeout: 10000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  await Promise.all([run(), held]);
  await holder.$disconnect();
}
```

В `registrations.e2e-spec.ts` удалить комментарий и функцию (строки 106–122), импорт: `import { createTestApp, newPrisma, resetDb, whileTableLocked, type TestApp } from './helpers';`.

Run: `npm run test:int -- registrations.e2e` (тайм-аут 600 000 мс) → PASS (поведение не изменилось).

- [ ] **Step 2: Тесты гонок BEVN-202**

В `session-registrations.e2e-spec.ts` импорт `whileTableLocked` и:

```ts
describe('races under the conference lock (spec 5.1)', () => {
  it('gives the last seat to exactly one of ten parallel requests', async () => {
    const session = await makeSession(t.prisma, 1, { startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 3 });
    await makeSessionRegistration(t.prisma, session.id, 1, 'CONFIRMED');
    await makeSessionRegistration(t.prisma, session.id, 2, 'CONFIRMED');
    for (let i = 0; i < 10; i += 1) {
      const racer = await makeAttendee(t.prisma, { email: `racer${i}@example.com` });
      await makeRegistration(t.prisma, 1, racer.id);
    }
    let results: { status: number; body: { reason?: string } }[] = [];
    await whileTableLocked('session_registrations', async () => {
      results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(session.id, 'register', { email: `racer${i}@example.com` })));
    });
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.reason === 'SESSION_FULL')).toBe(true);
    expect(await t.prisma.sessionRegistration.count({ where: { sessionId: session.id, status: 'CONFIRMED' } })).toBe(3);
  });

  it('lets one attendee into only one of two overlapping sessions requested at once', async () => {
    let results: { status: number; body: { reason?: string } }[] = [];
    await whileTableLocked('session_registrations', async () => {
      results = await Promise.all([post(1, 'register', A), post(2, 'register', A)]);
    });
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.reason).toBe('SESSION_OVERLAP');
    expect(await t.prisma.sessionRegistration.count({ where: { attendeeId: 1 } })).toBe(1);
  });
});
```

Run: `npm run test:int -- session-registrations -t "races"` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 3: Мутационная проверка (spec 7.2) — без `lockConference` тесты гонок красные**

Сначала сохранить копию: `cp src/session-registrations/session-registrations.service.ts <scratchpad>/service.before.ts`.
Временно в `lockSession` (`session-registrations.service.ts`) заменить строку
`const conference = await lockConference(tx, conferenceId);` на

```ts
  const conference = await tx.conference.findUnique({ where: { id: conferenceId }, select: { id: true, startDate: true, endDate: true, status: true, maxAttendees: true } });
```

Run: `npm run test:int -- session-registrations -t "races"` (тайм-аут 600 000 мс)
Expected: оба теста **FAIL** (несколько `201` / оба `201`). Сохранить вывод для отчёта.
Вернуть исходную строку правкой; `cmp src/session-registrations/session-registrations.service.ts <scratchpad>/service.before.ts`
— без вывода (сверка с копией, а не с `git diff`: коммит Task 5 может ещё ждать «ок»). Повторить прогон → PASS. **Если мутант зелёный — остановиться и доложить:** тест не ловит гонку.

- [ ] **Step 4: Число запросов не зависит от объёма данных (spec 7.3)**

В `query-count.e2e-spec.ts` импорт `makeSessionRegistration` и новый `describe` в конец:

```ts
describe('BEVN-202: session registration endpoints do not depend on the number of entries', () => {
  // Session 1 (09:00-10:00) is full with n-1 attendees waiting; they hold seats in session 2 (10:00-11:00, back to back).
  async function seedEntries(n: number): Promise<void> {
    await resetDb(t.prisma);
    await makeConference(t.prisma);
    const full = await makeSession(t.prisma, 1, { startTime: '2027-01-10T09:00:00', endTime: '2027-01-10T10:00:00', capacity: 1 });
    const open = await makeSession(t.prisma, 1, { startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 1000 });
    for (let i = 0; i < n; i += 1) {
      const attendee = await makeAttendee(t.prisma, { email: `attendee${i}@example.com` });
      await makeRegistration(t.prisma, 1, attendee.id);
      await makeSessionRegistration(t.prisma, full.id, attendee.id, i === 0 ? 'CONFIRMED' : 'WAITLISTED');
      if (i > 0) await makeSessionRegistration(t.prisma, open.id, attendee.id, 'CONFIRMED');
    }
    const fresh = await makeAttendee(t.prisma, { email: 'fresh@example.com' });
    await makeRegistration(t.prisma, 1, fresh.id);
  }
  const ENTRY_CASES: Record<string, () => Promise<{ status: number }>> = {
    'GET /api/sessions/{id}': () => t.http().get('/api/sessions/1'),
    'POST /api/sessions/{id}/register': () => send('post', '/api/sessions/2/register', { email: 'fresh@example.com' }),
    'POST /api/sessions/{id}/waitlist': () => send('post', '/api/sessions/1/waitlist', { email: 'fresh@example.com' }),
    'POST /api/sessions/{id}/cancel, one promoted': () => send('post', '/api/sessions/1/cancel', { email: 'attendee0@example.com' }),
    'PUT /api/sessions/{id}, the whole waitlist promoted': () =>
      send('put', '/api/sessions/1', { title: 'Talk', description: null, startTime: '2027-01-10T09:00:00', endTime: '2027-01-10T10:00:00', capacity: 1000, speakerId: null, roomId: null }),
  };
  it.each(Object.keys(ENTRY_CASES))('%s runs as many queries with 40 entries as with 3', async (name) => {
    const counts: number[] = [];
    for (const n of [3, 40]) {
      await seedEntries(n);
      let queries = 0;
      const stop = t.prisma.onQuery(() => {
        queries += 1;
      });
      const res = await ENTRY_CASES[name]();
      stop();
      expect(res.status).toBeLessThan(300);
      counts.push(queries);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
});
```

Run: `npm run test:int -- query-count` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 5: Полный прогон**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int` (тайм-аут 600 000 мс)
Expected: PASS.

- [ ] **Step 6: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add test/integration/helpers.ts test/integration/registrations.e2e-spec.ts test/integration/session-registrations.e2e-spec.ts test/integration/query-count.e2e-spec.ts
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "test: cover session registration races and query counts (BEVN-202)")
```

---

### Task 8: Фронтенд — функции API

**Files:**
- Modify: `frontend/src/api.js`
- Test: `frontend/src/api.test.js`

**Interfaces:**
- Produces: `registerForSession(id, email)`, `joinWaitlist(id, email)`, `cancelSessionRegistration(id, email)` — `Promise` с телом ответа; ошибка — `ApiError` с `body.reason`.

- [ ] **Step 1: Написать падающие тесты**

В `api.test.js` дополнить импорт `cancelSessionRegistration, joinWaitlist, registerForSession` и в конец:

```js
describe('session registration (BEVN-202)', () => {
  for (const [name, call, action] of [
    ['registerForSession', registerForSession, 'register'],
    ['joinWaitlist', joinWaitlist, 'waitlist'],
    ['cancelSessionRegistration', cancelSessionRegistration, 'cancel'],
  ]) {
    it(`${name} posts the email only to /api/sessions/{id}/${action}`, async () => {
      fetchMock.mockResolvedValue(json(201, { id: 1 }))
      await call(4, 'ann@x.example')

      expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:5000/api/sessions/4/${action}`)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"email":"ann@x.example"}' })
    })
  }

  it('keeps the reason of a 409 in err.body', async () => {
    fetchMock.mockResolvedValue(json(409, {
      statusCode: 409, error: 'Conflict', message: 'No seats left in this session; join the waitlist instead', requestId: REQUEST_ID, reason: 'SESSION_FULL',
    }))
    const err = await errorOf(registerForSession(4, 'ann@x.example'))

    expect(err.message).toBe('No seats left in this session; join the waitlist instead')
    expect(err.body.reason).toBe('SESSION_FULL')
  })
})
```

- [ ] **Step 2: Тесты падают**

Run (из `frontend/`): `npm test -- src/api.test.js`
Expected: FAIL — `registerForSession is not a function`.

- [ ] **Step 3: Реализация** — в `api.js` после `getSession`:

```js
export const registerForSession = (id, email) =>
  request(`/api/sessions/${id}/register`, { method: 'POST', body: JSON.stringify({ email }) })

export const joinWaitlist = (id, email) =>
  request(`/api/sessions/${id}/waitlist`, { method: 'POST', body: JSON.stringify({ email }) })

export const cancelSessionRegistration = (id, email) =>
  request(`/api/sessions/${id}/cancel`, { method: 'POST', body: JSON.stringify({ email }) })
```

- [ ] **Step 4: Тесты проходят**

Run: `npm test -- src/api.test.js` → PASS.

- [ ] **Step 5: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/api.js src/api.test.js
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: add session registration calls to frontend API (BEVN-202)")
```

---

### Task 9: Фронтенд — счётчики, панель записи, тихое обновление

**Files:**
- Create: `frontend/src/components/SessionRegistrationPanel.jsx`
- Modify: `frontend/src/pages/SessionDetailPage.jsx`
- Test: Create `frontend/src/pages/SessionDetailPage.test.jsx`
- Modify: `frontend/src/registrationVisibility.test.jsx:9-15,80-108`

**Interfaces:**
- Consumes: `getSession`, `registerForSession`, `joinWaitlist`, `cancelSessionRegistration` (Task 8), `isRegistrationOpen` (`conferenceStatus.js`).
- Produces: `<SessionRegistrationPanel session conferenceId onChanged />`, где `onChanged(): Promise` перечитывает сессию и
  отклоняется при неудаче.

- [ ] **Step 1: Написать падающие тесты страницы**

`frontend/src/pages/SessionDetailPage.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import SessionDetailPage from './SessionDetailPage'
import * as api from '../api'

vi.mock('../api', () => ({
  getSession: vi.fn(),
  registerForSession: vi.fn(),
  joinWaitlist: vi.fn(),
  cancelSessionRegistration: vi.fn(),
}))

const SESSION = {
  id: 4, title: 'Kubernetes for .NET Developers', description: null, startTime: '2026-11-06T10:00:00', endTime: '2026-11-06T11:00:00',
  capacity: 2, registeredCount: 1, waitlistCount: 0, conference: { id: 2, status: 'UPCOMING' }, speaker: null, room: null,
}
const EMAIL = 'ann@x.example'

// What api.js throws for a non-2xx answer (ApiError): message plus the parsed body.
const apiError = (status, reason, message) => Object.assign(new Error(message), { status, body: { statusCode: status, message, reason } })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/conferences/2/sessions/4']}>
      <Routes>
        <Route
          path="/conferences/:id/sessions/:sessionId"
          element={<><SessionDetailPage /><Link to="/conferences/2/sessions/5">next session</Link><Link to="/conferences/2/sessions/4">previous session</Link></>}
        />
      </Routes>
    </MemoryRouter>
  )
}

async function renderReady(session = SESSION) {
  api.getSession.mockResolvedValueOnce(session)
  renderPage()
  await screen.findByRole('heading', { level: 1, name: session.title })
}

const button = (name) => screen.getByRole('button', { name })
function submit(name, email = EMAIL) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(button(name))
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('session header', () => {
  it('shows registered / capacity and the waitlist, including zeros (FE-7)', async () => {
    await renderReady({ ...SESSION, registeredCount: 0, waitlistCount: 0 })
    expect(screen.getByText('👥 0 / 2 registered')).toBeTruthy()
    expect(screen.getByText('⏳ Waitlist: 0')).toBeTruthy()
    expect(screen.queryByText(/Capacity:/)).toBeNull()
  })

  it('leaves out counts the answer does not have (Review Focus 5)', async () => {
    const { registeredCount: _r, waitlistCount: _w, ...old } = SESSION
    await renderReady(old)
    expect(screen.queryByText(/registered$/)).toBeNull()
    expect(screen.queryByText(/Waitlist:/)).toBeNull()
  })
})

describe('session registration panel', () => {
  it('has a labelled required email field', async () => {
    await renderReady()
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('type')).toBe('email')
    expect(input.required).toBe(true)
  })

  it('offers Register for session while seats are free, Join waitlist when full, Cancel always', async () => {
    await renderReady()
    expect(button('Register for session')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join waitlist' })).toBeNull()
    expect(button('Cancel my registration')).toBeTruthy()
    cleanup()
    await renderReady({ ...SESSION, registeredCount: 2 })
    expect(button('Join waitlist')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Register for session' })).toBeNull()
  })

  it('disables all buttons while the request runs', async () => {
    await renderReady()
    api.registerForSession.mockReturnValue(new Promise(() => {}))
    submit('Register for session')
    expect(button('Register for session').disabled).toBe(true)
    expect(button('Cancel my registration').disabled).toBe(true)
  })

  it('keeps the buttons disabled until the refresh ends (decision 8)', async () => {
    await renderReady()
    const refresh = deferred()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockReturnValueOnce(refresh.promise)
    submit('Register for session')
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2))
    expect(button('Register for session').disabled).toBe(true)
    expect(button('Cancel my registration').disabled).toBe(true)
    await act(async () => { refresh.resolve({ ...SESSION, registeredCount: 2 }) })
    expect(button('Join waitlist').disabled).toBe(false)
    expect(button('Cancel my registration').disabled).toBe(false)
  })

  it('registers, shows the status message and refreshes the counts without the loading screen', async () => {
    await renderReady()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 2 })
    submit('Register for session')

    expect((await screen.findByRole('status')).textContent).toBe('You are registered for this session.')
    expect(api.registerForSession).toHaveBeenCalledWith(4, EMAIL)
    expect(screen.getByText('👥 2 / 2 registered')).toBeTruthy()
    expect(button('Join waitlist')).toBeTruthy()
    expect(screen.getByLabelText('Email').value).toBe(EMAIL)
    expect(screen.queryByText('Loading session...')).toBeNull()
  })

  it('joins the waitlist of a full session', async () => {
    await renderReady({ ...SESSION, registeredCount: 2 })
    api.joinWaitlist.mockResolvedValue({ id: 2, status: 'WAITLISTED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 2, waitlistCount: 1 })
    submit('Join waitlist')

    expect((await screen.findByRole('status')).textContent).toBe('You are on the waitlist.')
    expect(api.joinWaitlist).toHaveBeenCalledWith(4, EMAIL)
    expect(screen.getByText('⏳ Waitlist: 1')).toBeTruthy()
  })

  it('cancels with a neutral message', async () => {
    await renderReady()
    api.cancelSessionRegistration.mockResolvedValue({ id: 1, status: 'CANCELLED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 0 })
    submit('Cancel my registration')

    expect((await screen.findByRole('status')).textContent).toBe('Your registration or waitlist place is cancelled.')
    expect(api.cancelSessionRegistration).toHaveBeenCalledWith(4, EMAIL)
  })

  it('keeps the page and reports a failed refresh in the panel', async () => {
    await renderReady()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockRejectedValueOnce(new Error('HTTP 502'))
    submit('Register for session')

    expect(await screen.findByText('The counts could not be refreshed: HTTP 502. Reload the page to see them.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: SESSION.title })).toBeTruthy()
    expect(screen.queryByText('Failed to load session')).toBeNull()
  })

  it('on CONFERENCE_REGISTRATION_REQUIRED offers Register for conference and Close; Close removes the message', async () => {
    await renderReady()
    api.registerForSession.mockRejectedValue(apiError(409, 'CONFERENCE_REGISTRATION_REQUIRED', 'Register for the conference before registering for its sessions'))
    submit('Register for session')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Register for the conference before registering for its sessions')).toBeTruthy()
    expect(within(alert).getByRole('link', { name: 'Register for conference' }).getAttribute('href')).toBe('/conferences/2/register')
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })

  for (const [reason, message, label, after] of [
    ['SESSION_FULL', 'No seats left in this session; join the waitlist instead', 'Register for session', 'Join waitlist'],
    ['SEATS_AVAILABLE', 'The session has free seats; register instead', 'Join waitlist', 'Register for session'],
  ]) {
    it(`on ${reason} shows the message and refreshes, so the button changes`, async () => {
      const stale = reason === 'SESSION_FULL' ? SESSION : { ...SESSION, registeredCount: 2 }
      const fresh = reason === 'SESSION_FULL' ? { ...SESSION, registeredCount: 2 } : { ...SESSION, registeredCount: 1 }
      await renderReady(stale)
      const call = reason === 'SESSION_FULL' ? api.registerForSession : api.joinWaitlist
      call.mockRejectedValue(apiError(409, reason, message))
      api.getSession.mockResolvedValueOnce(fresh)
      submit(label)

      expect((await screen.findByRole('alert')).textContent).toContain(message)
      expect(await screen.findByRole('button', { name: after })).toBeTruthy()
    })
  }

  it('shows other errors as they are, without a refresh', async () => {
    await renderReady()
    api.registerForSession.mockRejectedValue(apiError(409, 'ALREADY_REGISTERED', 'Attendee is already registered for this session'))
    submit('Register for session')

    expect((await screen.findByRole('alert')).textContent).toBe('Attendee is already registered for this session')
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })

  for (const status of ['COMPLETED', 'CANCELLED']) {
    it(`is not shown for a ${status} conference`, async () => {
      await renderReady({ ...SESSION, conference: { id: 2, status } })
      expect(screen.queryByLabelText('Email')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Cancel my registration' })).toBeNull()
    })
  }
})

describe('loading (FE-4)', () => {
  it('ignores the answer for a session the user has already left', async () => {
    const slow = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? slow.promise : Promise.resolve({ ...SESSION, id: 5, title: 'OpenTelemetry End-to-End' })))
    renderPage()
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await screen.findByRole('heading', { level: 1, name: 'OpenTelemetry End-to-End' })
    await act(async () => { slow.resolve(SESSION) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OpenTelemetry End-to-End')
  })

  it('does not reload the session the user has left when an action on it completes', async () => {
    const registration = deferred()
    const next = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? Promise.resolve(SESSION) : next.promise))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    await act(async () => { next.resolve({ ...SESSION, id: 5, title: 'OpenTelemetry End-to-End' }) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OpenTelemetry End-to-End')
    expect(api.getSession).toHaveBeenCalledTimes(2)
  })

  it('is not left loading when the user comes back and a reload from the earlier visit fails', async () => {
    const registration = deferred()
    const back = deferred()
    const reload = deferred()
    const answers = [Promise.resolve(SESSION), back.promise, reload.promise]
    api.getSession.mockImplementation((id) => (String(id) === '4' ? answers.shift() : new Promise(() => {})))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    fireEvent.click(screen.getByRole('link', { name: 'previous session' }))
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    await act(async () => { back.resolve(SESSION) })
    await act(async () => { reload.reject(new Error('HTTP 502')) })
    expect(screen.getByRole('heading', { level: 1, name: SESSION.title })).toBeTruthy()
    expect(screen.queryByText('Loading session...')).toBeNull()
  })

  it('keeps the error screen of the current session when an action on the left one completes', async () => {
    const registration = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? Promise.resolve(SESSION) : Promise.reject(new Error('HTTP 500'))))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await screen.findByText('Failed to load session')
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    expect(screen.getByText('Failed to load session')).toBeTruthy()
    expect(api.getSession).toHaveBeenCalledTimes(2)
  })
})
```

> **Поправка 2026-10-09 (ревью Task 9, решение пользователя — вариант 1):** первоначальный `loadSession` отбрасывал ответы по
> счётчику запросов, а `onChanged` панели держал `loadSession` прежней сессии. Действие на сессии A, завершившееся после перехода
> на B, запускало тихое обновление A: оно делало ответ B устаревшим, и на странице B показывалась A; при возврате A → B → A и
> неудаче этого обновления спиннер оставался навсегда. Подтверждено временными тестами. Теперь ответ применяется, только если он
> для текущего `sessionId` (spec 6.2: «устаревшие ответы (смена `sessionId`) отбрасываются»), а тихое обновление сессии, с
> которой ушли, не запускается. Три последних теста блока FE-4 и ссылка «previous session» в `renderPage` добавлены этой поправкой.
> Там же (мутационная проверка): тест «keeps the buttons disabled until the refresh ends (decision 8)» и импорт `waitFor` —
> без него перенос `setBusy(false)` перед обновлением (решение 8) не ловил ни один тест.

- [ ] **Step 2: Тесты падают**

Run (из `frontend/`): `npm test -- src/pages/SessionDetailPage.test.jsx`
Expected: FAIL — нет «👥 0 / 2 registered», нет поля Email.

- [ ] **Step 3: Панель**

`frontend/src/components/SessionRegistrationPanel.jsx`:

```jsx
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelSessionRegistration, joinWaitlist, registerForSession } from '../api'

const ACTIONS = {
  register: { call: registerForSession, success: 'You are registered for this session.' },
  waitlist: { call: joinWaitlist, success: 'You are on the waitlist.' },
  cancel: { call: cancelSessionRegistration, success: 'Your registration or waitlist place is cancelled.' },
}

// These refusals mean the counts on the page are out of date: a refresh switches the button (spec 6.3).
const REFRESH_ON = ['SESSION_FULL', 'SEATS_AVAILABLE']

export default function SessionRegistrationPanel({ session, conferenceId, onChanged }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const action = useRef('register')
  const full = session.registeredCount >= session.capacity

  async function handleSubmit(e) {
    e.preventDefault()
    const { call, success } = ACTIONS[action.current]
    setBusy(true)
    setNotice(null)
    let next
    let refresh
    try {
      await call(session.id, email)
      next = { kind: 'success', text: success }
      refresh = true
    } catch (err) {
      const reason = err.body?.reason
      next = { kind: 'error', text: err.message, reason }
      refresh = REFRESH_ON.includes(reason)
    }
    if (refresh) {
      try {
        await onChanged()
      } catch (err) {
        next = { ...next, refreshError: `The counts could not be refreshed: ${err.message}. Reload the page to see them.` }
      }
    }
    setNotice(next)
    setBusy(false)
  }

  const choose = (name) => () => { action.current = name }

  return (
    <div className="detail-section">
      <h2 className="detail-section__title">Session registration</h2>
      <form className="card" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="session-email">Email</label>
          <input id="session-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        {full ? (
          <button type="submit" className="btn btn--primary" disabled={busy} onClick={choose('waitlist')}>Join waitlist</button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={busy} onClick={choose('register')}>Register for session</button>
        )}
        <button type="submit" className="btn btn--ghost" style={{ marginLeft: '12px' }} disabled={busy} onClick={choose('cancel')}>
          Cancel my registration
        </button>
        {notice?.kind === 'success' && <p role="status" style={{ marginTop: '12px' }}>{notice.text}</p>}
        {notice?.kind === 'error' && (
          <div role="alert" style={{ marginTop: '12px' }}>
            <p>{notice.text}</p>
            {notice.reason === 'CONFERENCE_REGISTRATION_REQUIRED' && (
              <div style={{ marginTop: '8px' }}>
                <Link to={`/conferences/${conferenceId}/register`} className="btn btn--primary">Register for conference</Link>
                <button type="button" className="btn btn--ghost" style={{ marginLeft: '12px' }} onClick={() => setNotice(null)}>Close</button>
              </div>
            )}
          </div>
        )}
        {notice?.refreshError && <p role="alert" style={{ marginTop: '8px' }}>{notice.refreshError}</p>}
      </form>
    </div>
  )
}
```

Примечание к тесту «other errors»: `textContent` alert — только текст сообщения (кнопок нет).

- [ ] **Step 4: Страница сессии**

`frontend/src/pages/SessionDetailPage.jsx`:
- импорты: `import { useCallback, useEffect, useRef, useState } from 'react'`, `import SessionRegistrationPanel from '../components/SessionRegistrationPanel'`;
- заменить `useEffect` загрузки на:

```jsx
  const current = useRef(sessionId)
  useEffect(() => { current.current = sessionId }, [sessionId])

  // Only answers for the session on screen are applied (FE-4): a late answer for a session the user has left is dropped,
  // and a silent reload for it is not started. The first load shows the spinner and the error screen; a silent reload
  // after an action keeps the page and lets the caller report the failure.
  const loadSession = useCallback(({ silent = false } = {}) => {
    const isCurrent = () => sessionId === current.current
    if (silent && !isCurrent()) return Promise.resolve()
    setError(null)
    if (!silent) setLoading(true)
    return getSession(sessionId).then(
      data => {
        if (!isCurrent()) return
        setSession(data.data || data)
        setLoading(false)
      },
      err => {
        if (!isCurrent()) return
        if (silent) throw err
        setError(err.message || 'Failed to load session')
        setLoading(false)
      },
    )
  }, [sessionId])

  useEffect(() => { loadSession() }, [loadSession])
```

- в `detail-header__meta` заменить строку `{session?.capacity && …Capacity…}` на:

```jsx
            {session?.registeredCount != null && session?.capacity != null && (
              <span>{`👥 ${session.registeredCount} / ${session.capacity} registered`}</span>
            )}
            {session?.waitlistCount != null && <span>{`⏳ Waitlist: ${session.waitlistCount}`}</span>}
```

- сразу после закрывающего `</div>` блока `detail-header`:

```jsx
        {isRegistrationOpen(session?.conference?.status) && (
          <SessionRegistrationPanel session={session} conferenceId={id} onChanged={() => loadSession({ silent: true })} />
        )}
```

- нижнюю ссылку `Register` переименовать в `Register for conference`.

- [ ] **Step 5: Тесты страницы проходят**

Run: `npm test -- src/pages/SessionDetailPage.test.jsx` → PASS.

- [ ] **Step 6: Проверка допущения spec 10 о моках Vitest, затем правка `registrationVisibility.test.jsx`**

Run (до правки мока): `npm test -- src/registrationVisibility.test.jsx`
Записать для отчёта, что произошло: падение при импорте модуля, при обращении к функции или тесты зелёные
(функции мока панель вызывает только по клику). Это закрывает «[предполагаю]» spec 10.

Затем в `registrationVisibility.test.jsx`:
- в `vi.mock('./api', …)` добавить `registerForSession: vi.fn(), joinWaitlist: vi.fn(), cancelSessionRegistration: vi.fn(),`;
- в блоке `describe('session page')`: заголовки и проверки `Register` → `Register for conference`:

```jsx
  for (const status of OPEN) {
    it(`shows Register for conference for ${status}`, async () => {
      await renderPage({ id: 1, status })
      expect(screen.getByRole('link', { name: 'Register for conference' })).toBeTruthy()
    })
  }

  for (const status of CLOSED) {
    it(`hides Register for conference for ${status}`, async () => {
      await renderPage({ id: 1, status })
      expect(screen.queryByRole('link', { name: 'Register for conference' })).toBeNull()
    })
  }

  it('hides Register for conference when the session has no conference', async () => {
    await renderPage(undefined)
    expect(screen.queryByRole('link', { name: 'Register for conference' })).toBeNull()
  })
```

- [ ] **Step 7: Все фронтенд-тесты и сборка**

Run: `npm test && npm run build`
Expected: PASS; сборка без ошибок.

- [ ] **Step 8: Контрольная точка — `git add` без коммита (вариант C)**

```bash
git add src/components/SessionRegistrationPanel.jsx src/pages/SessionDetailPage.jsx src/pages/SessionDetailPage.test.jsx src/registrationVisibility.test.jsx
# без коммита: изменения задачи — в индексе; итоговый коммит — Task 12 (черновик сообщения задачи: "feat: show session counts and registration panel on session page (BEVN-202)")
```

---

### Task 10: Полная проверка как в CI

- [ ] **Step 1: Бэкенд целиком**

Run (из `backend/`): `npm ci && npx prisma generate && npm run lint && npm run typecheck && npm run build && npm test && npm run test:int` (тайм-аут 600 000 мс)
Expected: всё зелёное; записать число тестов (unit / integration) для отчёта.

- [ ] **Step 2: Swagger-документ генерируется**

Run: `npm run swagger:generate -- <scratchpad>/swagger.json` и проверить, что в нём три операции `Sessions_Register`,
`Sessions_JoinWaitlist`, `Sessions_Cancel`, поле `reason` в `ErrorResponse`, `SessionDetailResponse` у `Sessions_GetById`.

- [ ] **Step 3: Фронтенд целиком**

Run (из `frontend/`): `npm ci && npm test && npm run build` → PASS.

- [ ] **Step 4: Остановить тестовую базу**

Run (из `backend/`): `bash scripts/test-db.sh down`

- [ ] **Step 5: Чистота диффа**

Run: `git status && git diff --stat main...HEAD` — только файлы из File Structure + план; `report/` не в индексе;
`git ls-files --eol` для новых файлов — `i/lf`.

---

### Task 11: Проверка в браузере — ОСТАНОВКА для пользователя

Стенд из образов на порту 5000 (на него ходит `api.js`), продакшн-сборка фронтенда через `vite preview` на 5173 (этот
origin разрешён в `CORS_ORIGINS` стенда) — как в проверке EXT-151.

- [ ] **Step 1: Порт 5000 свободен**

Run (Git Bash; `curl.exe` не понимает `/dev/null`, как учтено в `stand.sh`):
`for p in 5000 5173; do curl -s -m 2 -o NUL -w "$p %{http_code}\n" http://127.0.0.1:$p/ || true; done`
Любой ответ, кроме `000`, — порт занят (обычно compose: бэкенд 5000, фронтенд 5173). **Compose агент не трогает:**
попросить пользователя остановить его и подождать.

- [ ] **Step 2: Стенд и данные**

Run (из `backend/`, тайм-аут 600 000 мс): `bash scripts/stand.sh build && STAND_PORT=5000 bash scripts/stand.sh up`
Expected: `stand up on http://127.0.0.1:5000 (container started …)` — время старта свежее.
Run: `bash scripts/stand.sh psql -tAc "SHOW default_transaction_isolation"` → `read committed`.

Скрипт `<scratchpad>/bevn202-browser-prep.mjs` (не в репозитории), запуск `node <scratchpad>/bevn202-browser-prep.mjs`:

```js
// Demo data for the BEVN-202 browser check on the stand (seed: conference 2 CloudOps Days, session 4 at 10:00-11:00).
const base = 'http://127.0.0.1:5000'
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) })
  const json = await res.json()
  console.log(method, path, res.status, json.id ?? json.message)
  return json
}
const s = await call('/api/sessions/4')
await call('/api/sessions/4', 'PUT', { title: s.title, description: s.description, startTime: s.startTime, endTime: s.endTime, capacity: 1, speakerId: s.speakerId, roomId: s.roomId })
for (const [firstName, email] of [['Ann', 'ann@example.com'], ['Bob', 'bob@example.com']]) {
  await call('/api/conferences/2/register', 'POST', { firstName, lastName: 'Test', email })
}
await call('/api/conferences/2/sessions', 'POST', {
  title: 'Overlap check', startTime: s.startTime.replace('T10:00', 'T10:30'), endTime: s.endTime.replace('T11:00', 'T11:30'), capacity: 10,
})
```

Ожидается: `PUT … 200`, две регистрации `201`, новая сессия `201` (её id — для пункта 6 чек-листа).

- [ ] **Step 3: Фронтенд**

Run (из `frontend/`): `npm run build`. Затем запустить vite напрямую через `node` — тогда PID принадлежит самому серверу,
а не обёртке `npx`, которая на Windows не завершает дочерний процесс (PowerShell, локальный vite, ничего не устанавливается):

```powershell
$p = Start-Process node -ArgumentList 'node_modules/vite/bin/vite.js','preview','--port','5173','--strictPort' -WorkingDirectory frontend -PassThru -WindowStyle Hidden; $p.Id
```

Записать PID; проверить `curl -s -m 2 -o NUL -w '%{http_code}' http://localhost:5173/` → `200`.

- [ ] **Step 4: Передать пользователю чек-лист и ОСТАНОВИТЬСЯ**

Chrome, `http://localhost:5173/conferences/2/sessions/4`, DevTools → Network:

1. Шапка: «👥 0 / 1 registered», «⏳ Waitlist: 0»; кнопки **Register for session** и **Cancel my registration**; внизу **Register for conference**.
2. Пустое поле → **Register for session**: браузер не отправляет форму. Клик по подписи «Email» ставит курсор в поле.
3. `carol@example.com` → **Register for session**: сообщение про регистрацию на конференцию + **Register for conference** и **Close**; Close убирает сообщение.
4. `ann@example.com` → **Register for session**: «You are registered for this session.», шапка «1 / 1», кнопка сменилась на **Join waitlist**, спиннера нет, email остался в поле. В Network тело запроса — только `{"email": …}`.
5. `bob@example.com` → **Join waitlist**: «You are on the waitlist.», «Waitlist: 1».
6. `ann@example.com` → **Cancel my registration**: «Your registration or waitlist place is cancelled.»; шапка «1 / 1», «Waitlist: 0» (Bob продвинут).
7. Открыть `http://localhost:5173/conferences/2/sessions/<id «Overlap check» из Step 2>`: `bob@example.com` → **Register for session** → сообщение о пересечении (409, в ответе `reason: SESSION_OVERLAP`).
8. Две вкладки сессии 4. Во вкладке 1 `bob@example.com` → **Cancel my registration** («0 / 1»). Во вкладке 2 (устаревшая, «1 / 1») `ann@example.com` → **Join waitlist**: сообщение «The session has free seats; register instead», кнопка сменилась на **Register for session**.
9. Сессия прошедшей конференции `http://localhost:5173/conferences/1/sessions/1`: панели и **Register for conference** нет; счётчики «0 / 300», «Waitlist: 0».

Ждать ответа пользователя по каждому пункту. Неудача — разбирать по systematic-debugging, не чинить «на лету» без плана.

- [ ] **Step 5: После «ок» пользователя — лог и уборка**

Run: `bash scripts/stand.sh logs | grep waitlist.promoted` — запись из пункта 6: `"level":"log"`, `context` `Waitlist`,
`attendeeId` Боба, `sessionId: 4`, `trigger: "cancel"`, без email. Остановить `vite preview` по записанному PID
(`Stop-Process -Id <PID>`);
`bash scripts/stand.sh down`. Compose пользователь поднимает сам.

---

### Task 12: Сверка с DoD, devlog, тексты коммита и PR

- [ ] **Step 1: Сверка с каждым пунктом DoD issue #9** — таблица «пункт → тест/проверка → результат» по spec 7.5 с
  именами тестов и ссылкой на пункт чек-листа браузера (страница). Отдельно: мутационная проверка (Task 7), допущения
  spec 10 (Task 1 Step 6, Task 9 Step 6) — подтверждено/опровергнуто.
- [ ] **Step 2: Черновик записи `## implementation` в `docs/devlog.md`** (CRLF, формат файла: «Что сделал я, а не агент»,
  «Что поймал / спросил / решил», «Стоимость на конец шага» по журналу сессии) — показать на утверждение; мнения пользователя — `<!-- ваше -->`.
- [ ] **Step 3: Итоговый коммит (вариант C)** — показать `git status` и `git diff --cached --stat` (только файлы из File
  Structure, без `report/`, без диффа «весь файл»), предложить сообщение `feat: add session registration and waitlist (BEVN-202)`
  с перечнем задач 1–9 в теле; коммит — после «ок». Запись devlog — отдельным коммитом `docs: add BEVN-202 devlog entry`.
- [ ] **Step 4: Текст PR** по `.github/pull_request_template.md` с разделом DoD.
  В PR указать побочные эффекты: compose применит миграцию к dev-базе при следующем `up` (spec 3.3); `compare:reference`
  даст ожидаемое отличие в A10 (`registeredCount`, `waitlistCount`; в CI не запускается, spec 7.3); `partialIndexes` — preview Prisma;
  push и PR — только после подтверждения; после PR — проверить CI по логу (версии, число тестов), не только по статусу.
