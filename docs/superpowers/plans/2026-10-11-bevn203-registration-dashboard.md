# BEVN-203 Attendee Registration Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Выбрано пользователем (2026-10-11):** subagent-driven — исполнитель и ревьюер на каждую задачу (Sonnet), в конце ревью
> всей ветки. Коммит — в конце каждой задачи после одобрения ревьюера и «ок» пользователя (П8). Task 11 (браузер) ведёт координатор: даёт
> пользователю команды и чек-лист и ждёт. Решение, которого нет в плане, — остановка и вопрос пользователю, не решение исполнителя.

**Goal:** участник по email видит все свои регистрации на конференции (`GET /api/attendees/{email}/registrations`, страница
`/dashboard`) и отменяет `CONFIRMED`-регистрацию (`POST …/registrations/{id}/cancel`); отмена каскадом снимает его записи на сессии
конференции и отдаёт освободившиеся места списку ожидания (логика BEVN-202).

**Architecture:** миграция расширяет CHECK статуса регистрации до `CONFIRMED | CANCELLED`. В модуле `registrations` — чистые
функции решений (`registration-rules.ts`), новый `AttendeesController` и методы сервиса `listForAttendee` / `cancelForAttendee`
(транзакция под блокировкой конференции: отмена → `updateMany` записей на сессии → `promoteConference` из BEVN-202), оживление
отменённой строки в `register`. Email в пути проходит `ParseEmailPipe` (те же декораторы, что в DTO) и маскируется в логе запросов.
Фронтенд — две функции `api.js`, общий `Navbar`, страница `DashboardPage`.

**Tech Stack:** NestJS 12, Prisma 7.10 (adapter-pg), PostgreSQL 14, class-validator 0.15, Jest 30 + supertest; React 18,
react-router-dom 6.30, Vitest 0.34, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-10-bevn203-registration-dashboard-design.md` (коммит `0b56c1e`). «spec 4.3» — раздел
этого документа; «spec BEVN-202 x.y» и «spec EXT-150 x.y» — разделы их spec.

## Global Constraints

- Ничего не устанавливать (пакеты, CLI, образы); новых зависимостей в плане нет. `jq` в системе нет — скрипты без него.
- Команды бэкенда — из `backend/`: `npm run lint`, `npm run typecheck`, `npm test -- <шаблон>`, `npm run test:int -- <шаблон>`
  (база: `bash scripts/test-db.sh up` → 127.0.0.1:15432; в конце `bash scripts/test-db.sh down`). `npx jest <файл>` в этом
  ESM-проекте не работает (урок BEVN-202). Фронтенд — из `frontend/`: `npm test`, `npm run build`.
- Интеграционные тесты — с тайм-аутом 600 000 мс. Две проверки подряд с одной причиной — остановиться и доложить.
- Lint бэкенда: `require-await` (async без await запрещён — возвращать `Promise.resolve(...)`), `no-floating-promises`,
  неиспользуемые аргументы — с префиксом `_`. Приведение типа в тестах вместо расширения интерфейса ломало lint (BEVN-202 Task 4).
- Compose-стек и dev-базу не трогать. Браузер — изолированный стенд из образов + продакшн-сборка фронтенда (`vite preview`).
- Процессы останавливать только по PID, который запустил сам.
- Новые файлы — LF; `docs/devlog.md` — CRLF; `report/` не индексировать; массовых правок нет.
- Коммиты (П8): исполнители не коммитят. Коммит задачи делает координатор после одобрения ревьюера и «ок» пользователя;
  формат `<type>: <что сделано> (BEVN-203)`, тело заканчивается `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  `git stash`, `reset`, `checkout`, amend и rebase без согласования не применять. Push и PR — только после отдельного «ок».
- Имена: миграция `20261010000000_bevn203_registration_cancel`, ограничение `CK_registrations_Status` (прежнее имя),
  статусы регистрации ровно `CONFIRMED`, `CANCELLED`; `reason` — `REGISTRATION_CLOSED`, `ALREADY_CANCELLED`;
  `PromotionTrigger` += `'conference-cancel'`; событие лога `registration.cancelled { requestId, registrationId, attendeeId,
  conferenceId, sessionEntriesCancelled }`; email и имена в лог не попадают (SEC-1).
- Ответ `AttendeeRegistrationResponse`: ровно `id`, `status`, `registeredAt`, `conference` (`ConferenceSummaryResponse`) —
  без `attendeeId`, `conferenceId`, email.
- Тексты фронтенда (spec 6): ссылка **My registrations** → `/dashboard`; `<label>` **Email**; кнопка **Show registrations**;
  «No registrations found for {email}.»; 400 → «Enter a valid email address»; кнопка **Cancel registration** с
  `aria-label="Cancel registration for {title}"`; «You can view or cancel it under My registrations.» (ссылка на `/dashboard`).

## Решения плана, которых нет в spec (все приняты пользователем 2026-10-11)

| № | Вопрос | Предлагаю | Побочные эффекты |
| --- | --- | --- | --- |
| П1 | `GET`: spec 4.2 — «участник по email, затем регистрации» | **Один** `registration.findMany({ where: { attendee: { email } } })`: неизвестный email и участник без регистраций и так дают `[]`, отдельный запрос участника ничего не решает. Число запросов фиксировано (PERF-1) — проверяет тест Task 7 | Отступление от буквы spec 4.2; в devlog — как решение плана |
| П2 | Тело `cancel` (spec 4.1: «тела не принимает», фронтенд шлёт `{}`) | Пустой `CancelRegistrationDto` под общим `AppValidationPipe`: `{}` — 200, `{"foo":1}` — 400 «property foo should not exist», не объект — 400 (SEC-3 «для каждого тела без исключений»). Swagger получает пример тела `{}` (тест Swagger требует примеры у каждого POST) и 413 | Клиент, шлющий в `cancel` поля, получит 400. Допущение «`{}` проходит пустой DTO» подтверждено чтением кода: Nest задаёт `forbidUnknownValues: false` (`validation.pipe.js:31`), whitelist отклоняет любые поля; закрепляется тестом |
| П3 | Тексты ошибок | 404 — `Registration {id} not found for this email` (spec); 409 `REGISTRATION_CLOSED` — `Registration is closed: the conference is {COMPLETED\|CANCELLED}` (как в BEVN-202); 409 `ALREADY_CANCELLED` — `The registration is already cancelled`; 400 пайпа — `Invalid email` + `errors: [{ field: 'email', messages }]` (как `Invalid id` у `ParseIdPipe`) | — |
| П4 | «Общая функция» проверки email (spec 4.4) | `ParseEmailPipe` прогоняет значение через класс из одного поля с теми же `@NormalizeEmail() @IsAsciiEmail()` (`plainToInstance` + `validateSync`). Правила и тексты сообщений — буквально те же декораторы; `validation.ts` и DTO не меняются | Пайп зависит от class-transformer/class-validator (уже в зависимостях) |
| П5 | Порядок и контекст записей лога | `registration.cancelled` (контекст `Registrations`) — первым, затем `waitlist.promoted` (контекст `Waitlist`, как в BEVN-202): сначала причина, потом следствие | — |
| П6 | Маска пути (spec 4.8) | Регулярное выражение без учёта регистра: Express сопоставляет маршруты без учёта регистра, `/API/Attendees/x@y/registrations` даёт 200 и без `i` попал бы в лог. Query-строка сохраняется как есть (spec: `[^/?]+` останавливается на `?`); email в query ни один эндпоинт не принимает | Email, переданный клиентом в query, в лог попадёт — как и для любого другого пути |
| П7 | `console.log` в страницах | spec 6.1 удаляет только `console.log` в `api.js` и заглушки `vi.spyOn(console, 'log')` в 5 тестах. Но `ConferenceDetailPage.jsx` (6 вызовов, строки 49, 53, 88, 101, 122, 129) и `RegistrationPage.jsx:49` пишут в консоль браузера данные формы **с email**. **Удаляем и их** (тот же FE-6): иначе после снятия заглушек вывод тестов зашумлён, а email остаётся в консоли | +7 удалённых строк в двух страницах |
| П8 | Выполнение и коммиты | Subagent-driven (исполнитель + ревьюер на задачу, Sonnet). **Коммит после каждой задачи**: после одобрения ревьюера координатор показывает `git diff --cached --stat` и сообщение, коммит — после «ок» пользователя. Исправления ранее закоммиченных задач — новыми `fix:`-коммитами, без amend и rebase | Ревьюер следующей задачи смотрит `git diff HEAD`; откат попытки и мутантов — `git restore` до `HEAD` |
| П9 | Как вызвать сбой в тестах отката и утечки email (spec 7.2) | Откат: временный триггер `BEFORE UPDATE ON session_registrations FOR EACH STATEMENT` с `RAISE EXCEPTION` (срабатывает на шаге 5 — после `registration.update`). Утечка: временное `ALTER TABLE "attendees" RENAME` — запрос `GET` с фильтром по email падает в Prisma. Оба снимаются в `finally` | Тесты на время меняют схему тестовой базы (только одноразовая база, `--runInBand`) |
| П10 | Тексты дашборда, которых нет в spec | Заголовок **My registrations**; подсказка «Enter the email you registered with to see your conference registrations.»; подтверждение «Cancel your registration for {title}?»; успех «Your registration for {title} is cancelled.»; подсказка у неактивной кнопки «Registration is closed for this conference, so it can no longer be cancelled.»; статус конференции — «Conference CANCELLED» / «Conference COMPLETED»; сбой перечитывания — «The list could not be refreshed: {message}. Search again to see it.»; даты — «March 5, 2027 — March 6, 2027» (формат страницы конференции) | — |
| П11 | Бейдж статуса регистрации в двух местах | Общая функция `frontend/src/registrationStatus.js` → `registrationBadgeClass(status)` для дашборда и страницы конференции | — |
| П12 | `aria-current` у «Conferences» | `NavLink to="/" end`: текущей ссылка считается только на `/`, на `/conferences/2` — ни одна | — |
| П13 | Скрипт демо-данных (spec 7.4) | `backend/scripts/bevn203-demo-data.sh` создаёт через API **свои** 4 конференции (открытая с двумя сессиями и очередью; отменённая организатором; прошедшая — даты перенесены в прошлое `PUT`; с отменённой регистрацией). Seed-конференции не трогает; id из ответов — `sed`, без `jq` | Скрипт в репозитории, запускается только на стенде |
| П14 | Проверка атомарности миграции (spec 10, [предполагаю]) | Проба, не тест: на одноразовой базе `migrate deploy` с временной сломанной миграцией (`DROP CONSTRAINT` + `SELECT 1/0`) → ограничение на месте. Временный каталог удаляется сразу, `git status` чистый | — |

## Review Focus

1. **Email в пути с заглавными, пробелами, `+`, `/`** (`%20Ann+Tag%2Fx%40Example.COM%20`) — находит того же участника, что
   `ann+tag/x@example.com`; фронтенд кодирует `encodeURIComponent`. Тесты: Task 5 (API), Task 8 (`api.js`).
2. **Путь в другом регистре** (`/API/Attendees/ann%40example.com/registrations`) — маршрут отвечает, а email в лог не попадает
   (П6). Тесты: Task 4 (unit), Task 7 (лог).
3. **Записи на сессии другой конференции и других участников** — каскад их не трогает. Тест: Task 6.
4. **Отмена регистрации одновременно с записью на сессию** того же участника — после обеих нет активной записи без
   `CONFIRMED`-регистрации (инвариант spec 2). Тест: Task 7.
5. **Отмена завершилась после нового поиска на дашборде** — новый список и сообщения не перезаписываются ответом старой
   отмены. Тест: Task 9.

Дополнительно (не в пятёрке): битое percent-кодирование в пути (`%E0%A4%A`) — 4xx в JSON, не 500 (Task 7; [предполагаю],
при другом ответе — остановиться и доложить, это поведение всех маршрутов с параметрами).

## File Structure

```
backend/
  prisma/migrations/20261010000000_bevn203_registration_cancel/migration.sql   Task 1 — CHECK статуса
  src/registrations/
    registration-rules.ts (+ .spec.ts)   Task 2 — REGISTRATION_STATUSES, decideCancelRegistration, decideRegister, тексты
    registrations.service.ts             Task 3 — оживление в register; Task 5 — listForAttendee; Task 6 — cancelForAttendee
    attendees.controller.ts              Task 5 — GET; Task 6 — cancel
    cancel-registration.dto.ts           Task 6 — пустое тело (П2)
    registrations.module.ts              Task 5 — + AttendeesController
  src/common/
    errors.ts                            Task 2 — ALREADY_CANCELLED
    parse-email.pipe.ts (+ .spec.ts)     Task 4
    request-context.ts (+ .spec.ts)      Task 4 — maskPath
    http-middleware.ts                   Task 5, 6 — API_ROUTES
  src/session-registrations/promotion.ts Task 6 — 'conference-cancel'
  src/representation/responses.ts, mappers.ts, selects.ts   Task 2, 3, 5
  src/swagger/api-errors.decorator.ts    Task 2 — пример ALREADY_CANCELLED
  scripts/bevn203-demo-data.sh           Task 11
  test/integration/
    attendees.e2e-spec.ts                Task 5, 6, 7 (новый)
    registrations.e2e-spec.ts            Task 3
    session-registrations.e2e-spec.ts    Task 3 (находка 6 критика)
    schema.e2e-spec.ts                   Task 1
    swagger.e2e-spec.ts                  Task 2, 5, 6
    query-count.e2e-spec.ts              Task 7
    logging.e2e-spec.ts                  Task 7
frontend/src/
  api.js, api.test.js                    Task 8
  registrationStatus.js                  Task 8
  components/Navbar.jsx (+ .test.jsx)    Task 8
  pages/ConferenceListPage.jsx, ConferenceDetailPage.jsx, RegistrationPage.jsx, SessionDetailPage.jsx   Task 8
  pages/*.test.jsx, registrationVisibility.test.jsx   Task 8 — снять заглушки console
  pages/DashboardPage.jsx (+ .test.jsx), App.jsx       Task 9
docs/devlog.md                           Task 12
```

---

### Task 0: Проверка старта

- [ ] **Step 1:** Run (корень): `git status --short && git branch --show-current && git log --oneline -1`
  Expected: пусто; `BEVN-203-registration-dashboard`; последний коммит — коммит этого плана (или `0b56c1e`, если план ещё не закоммичен).
- [ ] **Step 2:** Run (из `backend/`): `bash scripts/test-db.sh up && npm ci && npx prisma generate` (тайм-аут 600 000 мс)
  Expected: `test db ready on 127.0.0.1:15432`.

---

### Task 1: Миграция статуса `CANCELLED`

**Files:**
- Create: `backend/prisma/migrations/20261010000000_bevn203_registration_cancel/migration.sql`
- Modify: `backend/test/integration/schema.e2e-spec.ts`

**Interfaces:**
- Produces: в БД `registrations.Status ∈ {'CONFIRMED','CANCELLED'}`; `schema.prisma` не меняется.

- [ ] **Step 1: Тест** — в `schema.e2e-spec.ts` вынести `dbErrorOf` из теста BEVN-202 на уровень модуля (тест BEVN-202
  использует её же) и добавить тест в конец `describe`:

```ts
async function dbErrorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return inspectDbError(error);
  }
  throw new Error('expected a database error');
}
```

```ts
  it('allows CONFIRMED and CANCELLED conference registrations and nothing else (BEVN-203 spec 3.1)', async () => {
    await resetDb(prisma);
    const conference = await makeConference(prisma);
    const ann = await makeAttendee(prisma);
    const bob = await makeAttendee(prisma, { email: 'bob@example.com' });
    const row = (attendeeId: number, status: string) => prisma.registration.create({ data: { conferenceId: conference.id, attendeeId, registeredAt: new Date(), status } });
    await row(ann.id, 'CANCELLED');
    expect(await dbErrorOf(row(bob.id, 'FOO'))).toMatchObject({ pgCode: '23514' });
    await resetDb(prisma);
  });
```

- [ ] **Step 2: RED** — Run: `npm run test:int -- schema` → FAIL в новом тесте: вставка `CANCELLED` падает с 23514.
- [ ] **Step 3: Миграция**

```sql
-- BEVN-203 (spec 3.1): a conference registration can be cancelled. The row stays (soft cancel) and comes back to
-- CONFIRMED on a new registration, so the full unique index on (ConferenceId, AttendeeId) is kept as it is.
-- One ALTER TABLE statement: Postgres applies its actions atomically, while prisma migrate deploy (7.10) does not roll
-- back the earlier statements of a migration when a later one fails (BEVN-203 spec 3.1, checked by a probe).
ALTER TABLE "registrations"
    DROP CONSTRAINT "CK_registrations_Status",
    ADD CONSTRAINT "CK_registrations_Status" CHECK ("Status" IN ('CONFIRMED', 'CANCELLED'));
```

  **Поправка 2026-10-11 (решение пользователя):** первая проба (Step 5) показала, что две отдельные инструкции не атомарны
  (`DROP` не откатился после сбоя следующей инструкции) — миграция переписана одной инструкцией, вторая проба
  (`DROP …, ADD … CHECK ("Status" IN ('CANCELLED'))` при строке `CONFIRMED` → 23514) подтвердила откат `DROP`.

- [ ] **Step 4: GREEN** — Run: `npm run test:int -- schema` → PASS (новый тест, «no drift», список ограничений с `CK_registrations_Status`).
  `global-setup` применяет миграции к тестовой базе — если новая миграция не применилась, остановиться и доложить.
- [ ] **Step 5: Проба атомарности (П14)** — не тест, результат записать для отчёта.
  1. `mkdir prisma/migrations/29990101000000_bevn203_atomic_probe` и в нём `migration.sql`:
     `ALTER TABLE "registrations" DROP CONSTRAINT "CK_registrations_Status";` + `SELECT 1/0;`
  2. Run: `bash scripts/test-db.sh psql -c 'CREATE DATABASE bevn203_probe'`, затем
     `DATABASE_URL=postgresql://brown:brown123@127.0.0.1:15432/bevn203_probe npx prisma migrate deploy` → ошибка `division by zero`.
  3. Run: `bash scripts/test-db.sh psql -d bevn203_probe -tAc "SELECT count(*) FROM pg_constraint WHERE conname = 'CK_registrations_Status'"`
     Expected: `1` — откат всей миграции подтверждён. `0` — **остановиться и доложить** (миграция spec 3.1 не атомарна).
  4. Уборка (обязательно, даже при сбое): `rm -r prisma/migrations/29990101000000_bevn203_atomic_probe`,
     `bash scripts/test-db.sh psql -c 'DROP DATABASE bevn203_probe'`; `git status --short` — только файлы Task 1.
  (Если `test-db.sh psql` не принимает `-d`/`-c` — посмотреть его ветку `psql` и передать аргументы так, как она ожидает.)
- [ ] **Step 6: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: allow cancelled conference registrations (BEVN-203)"` (`git add backend/prisma/migrations/20261010000000_bevn203_registration_cancel backend/test/integration/schema.e2e-spec.ts`).

---

### Task 2: Чистые функции, `ALREADY_CANCELLED`, `enum` статуса

**Files:**
- Create: `backend/src/registrations/registration-rules.ts`, `backend/src/registrations/registration-rules.spec.ts`
- Modify: `backend/src/common/errors.ts`, `backend/src/representation/responses.ts`, `backend/src/representation/mappers.ts`,
  `backend/src/swagger/api-errors.decorator.ts`, `backend/test/integration/swagger.e2e-spec.ts`

**Interfaces:**
- Produces (`registration-rules.ts`):
  - `REGISTRATION_STATUSES = ['CONFIRMED', 'CANCELLED'] as const`, `type RegistrationStatus`
  - `REGISTRATION_MESSAGES = { alreadyCancelled, alreadyRegistered, noSeats, notFound(id) }`
  - `decideCancelRegistration({ status: RegistrationStatus; conferenceStatus: ConferenceStatus }): CancelDecision`,
    `CancelDecision = { ok: true } | { ok: false; reason: ConflictReason; message: string }`
  - `decideRegister({ existing: RegistrationStatus | null; taken: number; maxAttendees: number | null }): RegisterDecision`,
    `RegisterDecision = { ok: true; action: 'create' | 'reactivate' } | { ok: false; message: string }`
- `ConflictReason` += `'ALREADY_CANCELLED'`; `RegistrationSummaryResponse.status: RegistrationStatus` (Swagger `enum`).

- [ ] **Step 1: Unit-тесты** `registration-rules.spec.ts`:

```ts
import { decideCancelRegistration, decideRegister } from './registration-rules';

describe('decideCancelRegistration (spec 4.3)', () => {
  it.each(['UPCOMING', 'ACTIVE'] as const)('cancels a CONFIRMED registration while the conference is %s', (conferenceStatus) => {
    expect(decideCancelRegistration({ status: 'CONFIRMED', conferenceStatus })).toEqual({ ok: true });
  });
  it.each(['COMPLETED', 'CANCELLED'] as const)('answers REGISTRATION_CLOSED for a %s conference, before ALREADY_CANCELLED', (conferenceStatus) => {
    for (const status of ['CONFIRMED', 'CANCELLED'] as const) {
      expect(decideCancelRegistration({ status, conferenceStatus })).toEqual({
        ok: false,
        reason: 'REGISTRATION_CLOSED',
        message: `Registration is closed: the conference is ${conferenceStatus}`,
      });
    }
  });
  it('answers ALREADY_CANCELLED for a cancelled registration of an open conference', () => {
    expect(decideCancelRegistration({ status: 'CANCELLED', conferenceStatus: 'UPCOMING' })).toEqual({
      ok: false,
      reason: 'ALREADY_CANCELLED',
      message: 'The registration is already cancelled',
    });
  });
});

describe('decideRegister (spec 4.5)', () => {
  it('creates without a row and reactivates a cancelled row', () => {
    expect(decideRegister({ existing: null, taken: 0, maxAttendees: null })).toEqual({ ok: true, action: 'create' });
    expect(decideRegister({ existing: 'CANCELLED', taken: 0, maxAttendees: null })).toEqual({ ok: true, action: 'reactivate' });
  });
  it('refuses a CONFIRMED row with the old message, even when the conference is full', () => {
    expect(decideRegister({ existing: 'CONFIRMED', taken: 5, maxAttendees: 5 })).toEqual({ ok: false, message: 'Attendee is already registered for this conference' });
  });
  it('checks the seats for a new and for a cancelled row alike', () => {
    for (const existing of [null, 'CANCELLED'] as const) {
      expect(decideRegister({ existing, taken: 2, maxAttendees: 2 })).toEqual({ ok: false, message: 'No seats left' });
      expect(decideRegister({ existing, taken: 1, maxAttendees: 2 }).ok).toBe(true);
    }
  });
  it('has no seat limit without maxAttendees', () => {
    expect(decideRegister({ existing: null, taken: 1000, maxAttendees: null }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: RED** — Run: `npm test -- registration-rules` → FAIL: модуль `./registration-rules` не найден.
- [ ] **Step 3: Реализация** `registration-rules.ts`:

```ts
import type { ConflictReason } from '../common/errors';
import { isRegistrationOpen, type ConferenceStatus } from '../common/status';
import { closedMessage } from '../session-registrations/waitlist';

// BEVN-203 (spec 2, 5.4): statuses of a conference registration and the decisions of cancel and register as pure
// functions. The service reads the state under the conference lock, these decide.
export const REGISTRATION_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_MESSAGES = {
  alreadyCancelled: 'The registration is already cancelled',
  alreadyRegistered: 'Attendee is already registered for this conference',
  noSeats: 'No seats left',
  // One message for an unknown id and for a registration of another email; the email is not repeated (spec 4.3).
  notFound: (id: number) => `Registration ${id} not found for this email`,
} as const;

export type CancelDecision = { ok: true } | { ok: false; reason: ConflictReason; message: string };

// The first failed check answers (spec 4.3): a closed conference before an already cancelled registration.
export function decideCancelRegistration(s: { status: RegistrationStatus; conferenceStatus: ConferenceStatus }): CancelDecision {
  if (!isRegistrationOpen(s.conferenceStatus)) {
    return { ok: false, reason: 'REGISTRATION_CLOSED', message: closedMessage(`the conference is ${s.conferenceStatus}`) };
  }
  if (s.status === 'CANCELLED') return { ok: false, reason: 'ALREADY_CANCELLED', message: REGISTRATION_MESSAGES.alreadyCancelled };
  return { ok: true };
}

export type RegisterDecision = { ok: true; action: 'create' | 'reactivate' } | { ok: false; message: string };

// Spec 4.5: a cancelled row comes back to CONFIRMED after the same seat check as a new one. Whether registration is open
// is checked before, as for a new registration. taken counts CONFIRMED rows only.
export function decideRegister(s: { existing: RegistrationStatus | null; taken: number; maxAttendees: number | null }): RegisterDecision {
  if (s.existing === 'CONFIRMED') return { ok: false, message: REGISTRATION_MESSAGES.alreadyRegistered };
  if (s.maxAttendees !== null && s.taken >= s.maxAttendees) return { ok: false, message: REGISTRATION_MESSAGES.noSeats };
  return { ok: true, action: s.existing === 'CANCELLED' ? 'reactivate' : 'create' };
}
```

- [ ] **Step 4: `ALREADY_CANCELLED` и `enum`**
  - `errors.ts`: в `CONFLICT_REASONS` добавить `'ALREADY_CANCELLED'` последним; комментарий: `// Machine-readable cause of a 409 of the session registration endpoints (BEVN-202 spec 4.6) and of the registration cancel (BEVN-203 spec 4.6). Other 409s have none.`
  - `responses.ts`: `import { REGISTRATION_STATUSES, type RegistrationStatus } from '../registrations/registration-rules';`;
    в `RegistrationSummaryResponse`: `@ApiProperty({ enum: REGISTRATION_STATUSES, example: 'CONFIRMED' }) status!: RegistrationStatus;`;
    в `ErrorResponse.reason` описание: `'Only on 409 of the session registration endpoints and of the registration cancel'`.
  - `mappers.ts` `toRegistrationSummary`: `status: r.status as RegistrationStatus` с комментарием `// The CHECK constraint keeps Status within REGISTRATION_STATUSES.`
  - `api-errors.decorator.ts`: в `CONFLICT_EXAMPLES` — `ALREADY_CANCELLED: REGISTRATION_MESSAGES.alreadyCancelled` (импорт из `../registrations/registration-rules`).
- [ ] **Step 5: Swagger-тест** — в `swagger.e2e-spec.ts` расширить интерфейс `Doc` (не приведением типа):
  `components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> };` и добавить тест:

```ts
  it('lists ALREADY_CANCELLED among the reasons and the registration statuses as an enum (BEVN-203 spec 4.1, 4.6)', () => {
    expect(doc.components.schemas.ErrorResponse.properties?.reason.enum).toContain('ALREADY_CANCELLED');
    expect(doc.components.schemas.RegistrationSummaryResponse.properties?.status.enum).toEqual(['CONFIRMED', 'CANCELLED']);
  });
```

- [ ] **Step 6: GREEN** — Run: `npm test -- registration-rules && npm run lint && npm run typecheck && npm run test:int -- swagger registrations` → PASS.
- [ ] **Step 7: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: add registration cancel and register rules (BEVN-203)"`.

---

### Task 3: Оживление отменённой регистрации и отменённые в существующих ответах

**Files:**
- Modify: `backend/src/registrations/registrations.service.ts:27-51`, `backend/test/integration/registrations.e2e-spec.ts`,
  `backend/test/integration/session-registrations.e2e-spec.ts`

**Interfaces:**
- Consumes: `decideRegister`, `RegistrationStatus` (Task 2).
- Produces: `POST /api/conferences/{id}/register` при `CANCELLED`-строке → `201`, та же строка (`id`), `status: 'CONFIRMED'`, `registeredAt = now`.

- [ ] **Step 1: Тесты** — в `registrations.e2e-spec.ts`: в `beforeEach` добавить `t.clock.set(new Date('2026-10-05T12:00:00.000Z'))`
  (тесты ниже двигают часы), импорт `makeSession`, `makeSessionRegistration`; новый `describe`:

```ts
describe('registering again after a cancel (BEVN-203 spec 3.2, 4.5)', () => {
  const cancelRow = (id: number) => t.prisma.registration.update({ where: { id }, data: { status: 'CANCELLED' } });

  it('brings the same row back to CONFIRMED with the new registeredAt and the stored name', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    await cancelRow(1);
    t.clock.set(new Date('2026-10-06T08:00:00.000Z'));
    const res = await register(1, { ...MODAL, firstName: 'Other', email: '  MARIA.KOWALSKA@example.com ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, status: 'CONFIRMED', registeredAt: '2026-10-06T08:00:00.000Z', attendee: { firstName: 'Maria' } });
    expect(await t.prisma.registration.count()).toBe(1);
  });

  it('does not restore the session entries', async () => {
    await makeConference(t.prisma);
    const session = await makeSession(t.prisma, 1);
    await register(1, MODAL);
    await makeSessionRegistration(t.prisma, session.id, 1, 'CANCELLED');
    await cancelRow(1);
    expect((await register(1, MODAL)).status).toBe(201);
    expect(await t.prisma.sessionRegistration.findMany({ select: { status: true } })).toEqual([{ status: 'CANCELLED' }]);
  });

  it('checks the seats as for a new registration; a cancelled row does not take a seat', async () => {
    await makeConference(t.prisma, { maxAttendees: 1 });
    await register(1, MODAL);
    await cancelRow(1);
    expect((await register(1, PAGE)).status).toBe(201);
    const again = await register(1, MODAL);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('No seats left');
    expect(await t.prisma.registration.findUnique({ where: { id: 1 }, select: { status: true } })).toEqual({ status: 'CANCELLED' });
  });

  it('refuses a closed conference before reactivating', async () => {
    await makeConference(t.prisma, { status: 'CANCELLED' });
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, 1, attendee.id);
    await cancelRow(1);
    expect((await register(1, MODAL)).status).toBe(409);
    expect(await t.prisma.registration.findUnique({ where: { id: 1 }, select: { status: true } })).toEqual({ status: 'CANCELLED' });
  });

  it('lists cancelled registrations with their status in both conference answers (spec 4.7)', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    await register(1, PAGE);
    await cancelRow(1);
    const list = await t.http().get('/api/conferences/1/registrations');
    expect(list.body.map((r: { id: number; status: string }) => [r.id, r.status])).toEqual([[1, 'CANCELLED'], [2, 'CONFIRMED']]);
    const conference = await t.http().get('/api/conferences/1');
    expect(conference.body.registrations.map((r: { status: string }) => r.status)).toEqual(['CANCELLED', 'CONFIRMED']);
  });
});
```

  В `session-registrations.e2e-spec.ts`, в `describe('POST /api/sessions/:id/register and /waitlist …')`:

```ts
  it('answers CONFERENCE_REGISTRATION_REQUIRED for a cancelled conference registration (BEVN-203 spec 2; BEVN-202 critic 6)', async () => {
    await t.prisma.registration.update({ where: { id: 1 }, data: { status: 'CANCELLED' } });
    const res = await post(1, 'register', A);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('CONFERENCE_REGISTRATION_REQUIRED');
  });
```

- [ ] **Step 2: RED** — Run: `npm run test:int -- registrations session-registrations` → FAIL: оживление даёт 409
  «already registered». (Тест находки 6 может пройти сразу — `readJoinState` уже ищет `CONFIRMED`; это ожидаемо, он закрепляет поведение.)
- [ ] **Step 3: Реализация** — в `register` заменить строки 42-48:

```ts
      const existing = await tx.registration.findUnique({ where: { conferenceId_attendeeId: { conferenceId, attendeeId: attendee.id } }, select: { id: true, status: true } });
      const taken = conference.maxAttendees === null ? 0 : await tx.registration.count({ where: { conferenceId, status: 'CONFIRMED' } });
      // The CHECK constraint keeps Status within REGISTRATION_STATUSES.
      const decision = decideRegister({ existing: existing ? (existing.status as RegistrationStatus) : null, taken, maxAttendees: conference.maxAttendees });
      if (!decision.ok) throw conflict(decision.message);
      // A cancelled row comes back (spec 4.5): one row per conference and attendee, the unique index is unchanged.
      if (decision.action === 'reactivate' && existing) {
        return tx.registration.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', registeredAt: now }, select: registrationWithRelations });
      }
      return tx.registration.create({ data: { conferenceId, attendeeId: attendee.id, registeredAt: now }, select: registrationWithRelations });
```

  Импорт: `import { decideRegister, type RegistrationStatus } from './registration-rules';`.
- [ ] **Step 4: GREEN** — Run: `npm run lint && npm run typecheck && npm run test:int -- registrations session-registrations query-count` → PASS
  (query-count: число запросов `register` для 2 и 40 сессий по-прежнему равно).
- [ ] **Step 5: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: reactivate a cancelled conference registration (BEVN-203)"`.

---

### Task 4: `ParseEmailPipe` и маска пути в логе

**Files:**
- Create: `backend/src/common/parse-email.pipe.ts`, `backend/src/common/parse-email.pipe.spec.ts`, `backend/src/common/request-context.spec.ts`
- Modify: `backend/src/common/request-context.ts:20`

**Interfaces:**
- Produces: `ParseEmailPipe implements PipeTransform<string, string>` (нормализованный email или `ApiError` 400);
  `maskPath(url: string): string`.

- [ ] **Step 1: Unit-тесты** `parse-email.pipe.spec.ts`:

```ts
import { ApiError } from './errors';
import { ParseEmailPipe } from './parse-email.pipe';

describe('ParseEmailPipe (BEVN-203 spec 4.4)', () => {
  const pipe = new ParseEmailPipe();
  it.each([
    ['ann@example.com', 'ann@example.com'],
    ['  Ann.Kowalska@Example.COM ', 'ann.kowalska@example.com'],
    ['ann+tag@example.com', 'ann+tag@example.com'],
  ])('accepts %p as %p', (raw, email) => {
    expect(pipe.transform(raw)).toBe(email);
  });
  it.each(['', 'ann', 'ann@example', 'ann maria@example.com', 'анна@example.com', `${'a'.repeat(243)}@example.com`])('rejects %p with 400 on the email field', (raw) => {
    try {
      pipe.transform(raw);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(400);
      expect(e.message).toBe('Invalid email');
      expect(e.errors?.map((f) => f.field)).toEqual(['email']);
      if (raw.trim()) expect(JSON.stringify(e)).not.toContain(raw.trim());
    }
  });
  it('uses the messages of the registration body', () => {
    let error: ApiError | undefined;
    try {
      pipe.transform('ann');
    } catch (e) {
      error = e as ApiError;
    }
    expect(error?.errors).toEqual([{ field: 'email', messages: ['email must be an email address'] }]);
  });
});
```

  (`'a'.repeat(243) + '@example.com'` = 255 символов > 254.) `request-context.spec.ts`:

```ts
import { maskPath } from './request-context';

describe('maskPath (BEVN-203 spec 4.8)', () => {
  it.each([
    ['/api/attendees/ann%40example.com/registrations', '/api/attendees/***/registrations'],
    ['/api/attendees/ann@example.com/registrations/7/cancel', '/api/attendees/***/registrations/7/cancel'],
    ['/api/attendees/ann%40example.com/unknown/tail', '/api/attendees/***/unknown/tail'],
    ['/api/attendees/ann%40example.com/registrations?q=1', '/api/attendees/***/registrations?q=1'],
    ['/api/attendees/ann%40example.com', '/api/attendees/***'],
    ['/API/Attendees/ann%40example.com/registrations', '/API/Attendees/***/registrations'],
  ])('masks %s', (url, masked) => {
    expect(maskPath(url)).toBe(masked);
  });
  it.each(['/api/conferences/2', '/api/attendees', '/api/attendees/', '/health'])('leaves %s as it is', (url) => {
    expect(maskPath(url)).toBe(url);
  });
});
```

- [ ] **Step 2: RED** — Run: `npm test -- parse-email request-context` → FAIL: модулей/экспорта нет.
- [ ] **Step 3: Реализация** `parse-email.pipe.ts`:

```ts
import { Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { badRequest } from './errors';
import { flattenValidationErrors, IsAsciiEmail, NormalizeEmail } from './validation';

// The decorators of the request bodies, so the path and the body accept exactly the same addresses (spec 4.4).
class EmailParam {
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;
}

// Email is the only string path parameter of the API (BEVN-203). Express has already decoded it: %40 -> @, + stays +.
@Injectable()
export class ParseEmailPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const param = plainToInstance(EmailParam, { email: value });
    const errors = validateSync(param, { validationError: { target: false, value: false } });
    if (errors.length > 0) throw badRequest('Invalid email', flattenValidationErrors(errors));
    return param.email;
  }
}
```

  `request-context.ts` — функция и её вызов в строке 20 (`path: maskPath(req.originalUrl)`):

```ts
// SEC-1 (BEVN-203 spec 4.8): the attendee email in the path never reaches the request log, whatever follows it and
// whatever the status. Express matches routes case-insensitively, so the mask does too (plan decision 6).
const ATTENDEE_SEGMENT = /^(\/api\/attendees\/)[^/?]+/i;

export function maskPath(url: string): string {
  return url.replace(ATTENDEE_SEGMENT, '$1***');
}
```

- [ ] **Step 4: GREEN** — Run: `npm test -- parse-email request-context && TZ=America/Los_Angeles npm test -- parse-email && npm run lint && npm run typecheck` → PASS.
  Если сообщения для `''` или `анна@…` отличаются от ожидаемых в тесте только набором (например, два сообщения) — тест
  проверяет поле и отсутствие значения, а не точный набор; точный текст закреплён только для `ann`.
- [ ] **Step 5: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: validate and mask the attendee email in the path (BEVN-203)"`.

---

### Task 5: `GET /api/attendees/{email}/registrations`

**Files:**
- Create: `backend/src/registrations/attendees.controller.ts`, `backend/test/integration/attendees.e2e-spec.ts`
- Modify: `registrations.service.ts`, `registrations.module.ts`, `representation/selects.ts`, `representation/mappers.ts`,
  `representation/responses.ts`, `common/http-middleware.ts`, `test/integration/swagger.e2e-spec.ts`

**Interfaces:**
- Consumes: `ParseEmailPipe` (Task 4), `RegistrationStatus` (Task 2).
- Produces: `attendeeRegistrationFields` (select), `AttendeeRegistrationRow`, `toAttendeeRegistration(row, now): AttendeeRegistrationResponse`,
  `class AttendeeRegistrationResponse { id; status: RegistrationStatus; registeredAt; conference: ConferenceSummaryResponse }`,
  `RegistrationsService.listForAttendee(email: string): Promise<AttendeeRegistrationResponse[]>`,
  `AttendeesController` (`@Controller('attendees')`, тег Swagger `Attendees`).

- [ ] **Step 1: Тесты** — новый `attendees.e2e-spec.ts` (шапка используется и в Task 6, 7):

```ts
import { Logger, type LoggerService } from '@nestjs/common';
import { makeAttendee, makeConference, makeRegistration, makeSession, makeSessionRegistration } from './fixtures';
import { createTestApp, DEFAULT_NOW, resetDb, whileTableLocked, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: DEFAULT_NOW });
});
afterAll(() => t.close());
beforeEach(async () => {
  t.clock.set(new Date(DEFAULT_NOW));
  await resetDb(t.prisma);
});

const ANN = 'ann@example.com';
const BOB = 'bob@example.com';
const path = (email: string) => `/api/attendees/${encodeURIComponent(email)}/registrations`;
const list = (email: string) => t.http().get(path(email));
const cancel = (email: string, id: number | string, body: unknown = {}) =>
  t.http().post(`${path(email)}/${id}/cancel`).set('Content-Type', 'application/json').send(body as object);

describe('GET /api/attendees/:email/registrations (spec 4.1, 4.2)', () => {
  it('lists CONFIRMED and CANCELLED registrations by conference start date with the conference, without ids or email', async () => {
    const ann = await makeAttendee(t.prisma, { email: ANN });
    const late = await makeConference(t.prisma, { title: 'Late', startDate: '2027-05-01T00:00:00', endDate: '2027-05-02T00:00:00' });
    const early = await makeConference(t.prisma, { title: 'Early', startDate: '2027-02-01T00:00:00', endDate: '2027-02-01T00:00:00' });
    const sameDay = await makeConference(t.prisma, { title: 'Same day', startDate: '2027-05-01T00:00:00', endDate: '2027-05-01T00:00:00' });
    await makeRegistration(t.prisma, late.id, ann.id); // id 1
    await makeRegistration(t.prisma, early.id, ann.id); // id 2
    await makeRegistration(t.prisma, sameDay.id, ann.id); // id 3
    await t.prisma.registration.update({ where: { id: 2 }, data: { status: 'CANCELLED' } });
    const res = await list(ANN);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: number; status: string; conference: { title: string } }) => [r.id, r.status, r.conference.title])).toEqual([
      [2, 'CANCELLED', 'Early'],
      [1, 'CONFIRMED', 'Late'],
      [3, 'CONFIRMED', 'Same day'],
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['conference', 'id', 'registeredAt', 'status']);
    expect(res.body[0]).toMatchObject({ registeredAt: '2026-10-01T09:00:00.000Z', conference: { id: 2, startDate: '2027-02-01T00:00:00', status: 'UPCOMING' } });
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('answers 200 [] for an unknown email and for an attendee without registrations', async () => {
    await makeAttendee(t.prisma, { email: ANN });
    for (const email of [ANN, 'nobody@example.com']) {
      const res = await list(email);
      expect([res.status, res.body]).toEqual([200, []]);
    }
  });

  it('shows only the registrations of this email', async () => {
    const conference = await makeConference(t.prisma);
    const bob = await makeAttendee(t.prisma, { email: BOB });
    await makeRegistration(t.prisma, conference.id, bob.id);
    expect((await list(ANN)).body).toEqual([]);
  });

  it('finds the attendee whatever the case, spaces, + and / of the email (Review Focus 1)', async () => {
    const conference = await makeConference(t.prisma);
    const ann = await makeAttendee(t.prisma, { email: 'ann+tag/x@example.com' });
    await makeRegistration(t.prisma, conference.id, ann.id);
    const res = await list('  Ann+Tag/X@Example.COM ');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it.each(['ann', 'ann@example', 'анна@example.com'])('answers 400 on the email field for %p, without the value', async (email) => {
    const res = await list(email);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: 'Invalid email', errors: [{ field: 'email' }] });
    expect(JSON.stringify(res.body)).not.toContain(email);
  });

  it('answers 405 with Allow: GET for other methods', async () => {
    const res = await t.http().delete(path(ANN));
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
  });
});
```

  В `swagger.e2e-spec.ts` в `ADDED` добавить `'GET /api/attendees/{email}/registrations Attendees_GetRegistrations'`.
- [ ] **Step 2: RED** — Run: `npm run test:int -- attendees swagger` → FAIL: 404 Route not found; лишних операций нет.
- [ ] **Step 3: Реализация**
  - `selects.ts`:

```ts
// The attendee dashboard (BEVN-203 spec 4.1): the registration with its conference, no attendee and no ids beside them.
export const attendeeRegistrationFields = { id: true, status: true, registeredAt: true, conference: { select: conferenceFields } } satisfies Prisma.RegistrationSelect;
export type AttendeeRegistrationRow = Prisma.RegistrationGetPayload<{ select: typeof attendeeRegistrationFields }>;
```

  - `responses.ts` (после `RegistrationResponse`):

```ts
export class AttendeeRegistrationResponse {
  @ApiProperty({ example: 7 }) id!: number;
  @ApiProperty({ enum: REGISTRATION_STATUSES, example: 'CONFIRMED' }) status!: RegistrationStatus;
  @ApiProperty({ example: '2026-10-10T09:00:00.000Z', description: 'UTC instant with Z; the time of the last (re)registration' }) registeredAt!: string;
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
}
```

  - `mappers.ts`:

```ts
export function toAttendeeRegistration(r: AttendeeRegistrationRow, now: Date): AttendeeRegistrationResponse {
  // The CHECK constraint keeps Status within REGISTRATION_STATUSES.
  return { id: r.id, status: r.status as RegistrationStatus, registeredAt: formatInstant(r.registeredAt), conference: toConferenceSummary(r.conference, now) };
}
```

  - `registrations.service.ts` (П1):

```ts
  // One query whatever the number of registrations (PERF-1): an unknown email and an attendee without registrations
  // both give [] (spec 4.2), so the attendee is not looked up separately (plan decision 1).
  async listForAttendee(email: string): Promise<AttendeeRegistrationResponse[]> {
    const rows = await this.prisma.registration.findMany({
      where: { attendee: { email } },
      select: attendeeRegistrationFields,
      orderBy: [{ conference: { startDate: 'asc' } }, { id: 'asc' }],
    });
    const now = this.clock.now();
    return rows.map((row) => toAttendeeRegistration(row, now));
  }
```

  - `attendees.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ParseEmailPipe } from '../common/parse-email.pipe';
import { AttendeeRegistrationResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { RegistrationsService } from './registrations.service';

const EMAIL_PARAM = { name: 'email', example: 'maria.kowalska@example.com', description: 'URL-encoded; trimmed and lower-cased like the email of the registration body' };

// The attendee dashboard (BEVN-203). The email is the identity, without verification (SEC-2, spec 9).
@ApiTags('Attendees')
@Controller('attendees')
export class AttendeesController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get(':email/registrations')
  @ApiOperation({
    operationId: 'Attendees_GetRegistrations',
    summary: 'List the conference registrations of an attendee',
    description: 'CONFIRMED and CANCELLED, ordered by conference start date. An unknown email gives []. The email is never returned (SEC-1).',
  })
  @ApiParam(EMAIL_PARAM)
  @ApiOkResponse({ type: [AttendeeRegistrationResponse] })
  @ApiErrors(400, 503)
  list(@Param('email', ParseEmailPipe) email: string): Promise<AttendeeRegistrationResponse[]> {
    return this.registrations.listForAttendee(email);
  }
}
```

  - `registrations.module.ts`: `controllers: [RegistrationsController, AttendeesController]`.
  - `http-middleware.ts` `API_ROUTES` (после `/api/speakers`):
    `{ path: '/api/attendees/{email}/registrations', pattern: /^\/api\/attendees\/[^/]+\/registrations\/?$/, methods: ['GET'] },`
- [ ] **Step 4: GREEN** — Run: `npm run lint && npm run typecheck && npm run test:int -- attendees swagger http` → PASS.
  Если Swagger называет параметр не `{email}` или тест «agrees with the 405 route table» падает — остановиться и доложить.
- [ ] **Step 5: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: list the registrations of an attendee (BEVN-203)"`.

---

### Task 6: `POST …/registrations/{id}/cancel`, каскад и продвижение

**Files:**
- Create: `backend/src/registrations/cancel-registration.dto.ts`
- Modify: `attendees.controller.ts`, `registrations.service.ts`, `session-registrations/promotion.ts:28`, `common/http-middleware.ts`,
  `test/integration/attendees.e2e-spec.ts`, `test/integration/swagger.e2e-spec.ts`

**Interfaces:**
- Consumes: `decideCancelRegistration`, `REGISTRATION_MESSAGES` (Task 2), `promoteConference`, `logPromotions` (BEVN-202),
  `lockConference`, `ACTIVE_STATUSES`.
- Produces: `RegistrationsService.cancelForAttendee(email: string, registrationId: number): Promise<AttendeeRegistrationResponse>`;
  `PromotionTrigger = 'cancel' | 'session-update' | 'conference-update' | 'conference-cancel'`.

- [ ] **Step 1: Тесты** — в `attendees.e2e-spec.ts` добавить логгер (как в `session-registrations.e2e-spec.ts`) и `describe`:

```ts
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
const events = (entries: LevelLogger['entries'], event: string) => entries.filter((e) => e.message.event === event);
const snapshot = async () => ({
  registrations: await t.prisma.registration.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true } }),
  entries: await t.prisma.sessionRegistration.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true } }),
});

// Conference 1 (2027-01-10..11): s1 10:00 (1 seat), s2 11:00 (1 seat), s3 12:00 (1 seat). Ann, Bob, Carol, Dan are registered
// (registrations 1-4). s1: Ann seat (e1), Bob waits (e2); s2: Ann seat (e3), Carol waits (e4); s3: Dan seat (e5), Ann waits (e6).
// Conference 2: Ann registered (registration 5) with a seat in s4 (e7).
async function seedCascade(): Promise<void> {
  const c1 = await makeConference(t.prisma);
  const s1 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 1 });
  const s2 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T11:00:00', endTime: '2027-01-10T12:00:00', capacity: 1 });
  const s3 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T12:00:00', endTime: '2027-01-10T13:00:00', capacity: 1 });
  const people: number[] = [];
  for (const email of [ANN, BOB, 'carol@example.com', 'dan@example.com']) {
    const attendee = await makeAttendee(t.prisma, { email });
    await makeRegistration(t.prisma, c1.id, attendee.id);
    people.push(attendee.id);
  }
  const [a, b, c, d] = people;
  await makeSessionRegistration(t.prisma, s1.id, a, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s1.id, b, 'WAITLISTED');
  await makeSessionRegistration(t.prisma, s2.id, a, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s2.id, c, 'WAITLISTED');
  await makeSessionRegistration(t.prisma, s3.id, d, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s3.id, a, 'WAITLISTED');
  const c2 = await makeConference(t.prisma, { title: 'Other', startDate: '2027-02-10T00:00:00', endDate: '2027-02-10T00:00:00' });
  const s4 = await makeSession(t.prisma, c2.id, { startTime: '2027-02-10T10:00:00', endTime: '2027-02-10T11:00:00' });
  await makeRegistration(t.prisma, c2.id, a);
  await makeSessionRegistration(t.prisma, s4.id, a, 'CONFIRMED');
}
```

```ts
describe('POST /api/attendees/:email/registrations/:id/cancel (spec 4.3, 5)', () => {
  it('cancels the registration and every active session entry of the conference, also on a started session; promotes only where registration is open (DoD)', async () => {
    await seedCascade();
    t.clock.set(new Date('2027-01-10T10:30:00.000Z')); // conference ACTIVE, s1 started, s2 and s3 open
    const { result: res, entries } = await captureLogs(() => cancel(ANN, 1));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, status: 'CANCELLED', registeredAt: '2026-10-01T09:00:00.000Z', conference: { id: 1, status: 'ACTIVE' } });
    expect(Object.keys(res.body).sort()).toEqual(['conference', 'id', 'registeredAt', 'status']);
    expect((await snapshot()).entries).toEqual([
      { id: 1, status: 'CANCELLED' }, // Ann, s1 (started)
      { id: 2, status: 'WAITLISTED' }, // Bob stays: s1 has started
      { id: 3, status: 'CANCELLED' }, // Ann, s2
      { id: 4, status: 'CONFIRMED' }, // Carol promoted
      { id: 5, status: 'CONFIRMED' }, // Dan
      { id: 6, status: 'CANCELLED' }, // Ann's waitlist place, s3
      { id: 7, status: 'CONFIRMED' }, // Ann in the other conference (Review Focus 3)
    ]);
    expect((await snapshot()).registrations).toEqual([
      { id: 1, status: 'CANCELLED' }, { id: 2, status: 'CONFIRMED' }, { id: 3, status: 'CONFIRMED' }, { id: 4, status: 'CONFIRMED' }, { id: 5, status: 'CONFIRMED' },
    ]);
    const requestId = res.headers['x-request-id'];
    expect(events(entries, 'registration.cancelled')).toEqual([
      { level: 'log', context: 'Registrations', message: { event: 'registration.cancelled', requestId, registrationId: 1, attendeeId: 1, conferenceId: 1, sessionEntriesCancelled: 3 } },
    ]);
    expect(events(entries, 'waitlist.promoted')).toEqual([
      { level: 'log', context: 'Waitlist', message: { event: 'waitlist.promoted', requestId, sessionId: 2, attendeeId: 3, registrationId: 4, trigger: 'conference-cancel' } },
    ]);
    const order = entries.map((e) => e.message.event).filter(Boolean);
    expect(order.indexOf('registration.cancelled')).toBeLessThan(order.indexOf('waitlist.promoted'));
    expect(JSON.stringify(entries)).not.toContain('@');
  });

  it('leaves the attendee without active entries in the conference (spec 2 invariant)', async () => {
    await seedCascade();
    expect((await cancel(ANN, 1)).status).toBe(200);
    const active = await t.prisma.sessionRegistration.count({ where: { attendeeId: 1, status: { in: ['CONFIRMED', 'WAITLISTED'] }, session: { conferenceId: 1 } } });
    expect(active).toBe(0);
  });

  it('answers the same 404 for a registration of another email, an unknown id and an unknown email; nothing changes', async () => {
    await seedCascade();
    const before = await snapshot();
    for (const [email, id] of [[BOB, 1], [ANN, 999], ['nobody@example.com', 1]] as const) {
      const res = await cancel(email, id);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Registration ${id} not found for this email`);
      expect(JSON.stringify(res.body)).not.toContain('@');
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['CANCELLED', () => t.prisma.conference.update({ where: { id: 1 }, data: { status: 'CANCELLED' } })],
    ['COMPLETED', () => Promise.resolve(t.clock.set(new Date('2027-01-12T00:00:00.000Z')))],
  ] as const)('answers 409 REGISTRATION_CLOSED for a %s conference, also for a cancelled registration; nothing changes', async (status, close) => {
    await seedCascade();
    await t.prisma.registration.update({ where: { id: 2 }, data: { status: 'CANCELLED' } });
    await close();
    const before = await snapshot();
    for (const [email, id] of [[ANN, 1], [BOB, 2]] as const) {
      const res = await cancel(email, id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ reason: 'REGISTRATION_CLOSED', message: `Registration is closed: the conference is ${status}` });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('answers 409 ALREADY_CANCELLED to a repeated cancel without changes or log entries', async () => {
    await seedCascade();
    await cancel(ANN, 1);
    const before = await snapshot();
    const { result: res, entries } = await captureLogs(() => cancel(`  ${ANN.toUpperCase()} `, 1));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'ALREADY_CANCELLED', message: 'The registration is already cancelled' });
    expect(await snapshot()).toEqual(before);
    expect([...events(entries, 'registration.cancelled'), ...events(entries, 'waitlist.promoted')]).toEqual([]);
  });

  it('answers 400 for a bad email or id and for a body with fields or not an object (plan decision 2)', async () => {
    await seedCascade();
    expect((await cancel('ann', 1)).body.errors).toEqual([{ field: 'email', messages: ['email must be an email address'] }]);
    expect((await cancel(ANN, 'abc')).body.errors).toEqual([{ field: 'id', messages: ['id must be an integer between 1 and 2147483647'] }]);
    const extra = await cancel(ANN, 1, { reason: 'x' });
    expect(extra.status).toBe(400);
    expect(extra.body.errors).toEqual([{ field: 'reason', messages: ['property reason should not exist'] }]);
    expect((await cancel(ANN, 1, [])).status).toBe(400);
    expect((await snapshot()).registrations[0]).toEqual({ id: 1, status: 'CONFIRMED' });
  });

  it('answers 415 without Content-Type and 405 for GET', async () => {
    await seedCascade();
    expect((await t.http().post(`${path(ANN)}/1/cancel`)).status).toBe(415);
    const res = await t.http().get(`${path(ANN)}/1/cancel`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
```

  В `swagger.e2e-spec.ts` в `ADDED` добавить `'POST /api/attendees/{email}/registrations/{id}/cancel Attendees_CancelRegistration'`.
- [ ] **Step 2: RED** — Run: `npm run test:int -- attendees swagger` → FAIL: 404/405 на новом пути, операции нет.
- [ ] **Step 3: Реализация**
  - `promotion.ts:28`: `export type PromotionTrigger = 'cancel' | 'session-update' | 'conference-update' | 'conference-cancel';`
  - `cancel-registration.dto.ts`:

```ts
// No fields (spec 4.1): the cancel takes no body, but a POST under /api/ needs Content-Type: application/json, so the
// frontend sends {}. Validated like every body (whitelist + forbidNonWhitelisted): any field is a 400 (plan decision 2).
export class CancelRegistrationDto {}
```

  - `registrations.service.ts` — метод и логгер (импорты: `Logger`, `computeStatus`, `lockConference`, `ACTIVE_STATUSES`
    из `../session-registrations/waitlist`, `logPromotions`, `promoteConference` из `../session-registrations/promotion`,
    `requestContext`, `decideCancelRegistration`, `REGISTRATION_MESSAGES`):

```ts
const logger = new Logger('Registrations');
```

```ts
  // Spec 5.1. A registration never moves between conferences and is never deleted, and the email of an attendee never
  // changes, so its conference is safe to read before the lock (as conferenceOf in BEVN-202).
  async cancelForAttendee(email: string, registrationId: number): Promise<AttendeeRegistrationResponse> {
    const found = await this.prisma.registration.findFirst({ where: { id: registrationId, attendee: { email } }, select: { conferenceId: true, attendeeId: true } });
    if (!found) throw notFound(REGISTRATION_MESSAGES.notFound(registrationId));
    const { conferenceId, attendeeId } = found;
    const now = this.clock.now();
    const { row, promoted, sessionEntriesCancelled } = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(REGISTRATION_MESSAGES.notFound(registrationId));
      const current = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { status: true } });
      const decision = decideCancelRegistration({
        status: current.status as RegistrationStatus, // the CHECK constraint keeps Status within REGISTRATION_STATUSES
        conferenceStatus: computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now),
      });
      if (!decision.ok) throw conflict(decision.message, decision.reason);
      const row = await tx.registration.update({ where: { id: registrationId }, data: { status: 'CANCELLED' }, select: attendeeRegistrationFields });
      // First take the attendee's places in every session of the conference, started ones included (spec 2)...
      const { count } = await tx.sessionRegistration.updateMany({
        where: { attendeeId, status: { in: ACTIVE_STATUSES }, session: { conferenceId } },
        data: { status: 'CANCELLED' },
      });
      // ...then give the free seats to the waitlists of the sessions with open registration (spec 5.2).
      const promoted = await promoteConference(tx, conference, now);
      return { row, promoted, sessionEntriesCancelled: count };
    });
    // After the commit (spec 5.3): cause first, then the promotions (plan decision 5). No email or names (SEC-1).
    logger.log({ event: 'registration.cancelled', requestId: requestContext.getStore()?.requestId, registrationId, attendeeId, conferenceId, sessionEntriesCancelled });
    logPromotions(promoted, 'conference-cancel');
    return toAttendeeRegistration(row, now);
  }
```

  - `attendees.controller.ts` — метод (импорты `Body`, `HttpCode`, `Post`, `ApiBody`, `ApiConflicts`, `ParseIdPipe`, `CancelRegistrationDto`):

```ts
  @Post(':email/registrations/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'Attendees_CancelRegistration',
    summary: 'Cancel a conference registration',
    description:
      'Open while the conference is UPCOMING or ACTIVE. Also cancels every active session registration and waitlist place of the attendee in the conference ' +
      '(started sessions included); the free seats go to the waitlists of sessions with open registration in the same transaction. ' +
      'Takes no body, but needs Content-Type: application/json — send {}. 404 if the registration does not belong to this email.',
  })
  @ApiParam(EMAIL_PARAM)
  @ApiBody({ type: CancelRegistrationDto, examples: { empty: { value: {} } } })
  @ApiOkResponse({ type: AttendeeRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'ALREADY_CANCELLED')
  cancel(
    @Param('email', ParseEmailPipe) email: string,
    @Param('id', ParseIdPipe) id: number,
    @Body() _body: CancelRegistrationDto,
  ): Promise<AttendeeRegistrationResponse> {
    return this.registrations.cancelForAttendee(email, id);
  }
```

  - `API_ROUTES`: `{ path: '/api/attendees/{email}/registrations/{id}/cancel', pattern: /^\/api\/attendees\/[^/]+\/registrations\/[^/]+\/cancel\/?$/, methods: ['POST'] },`
- [ ] **Step 4: GREEN** — Run: `npm run lint && npm run typecheck && npm test && npm run test:int -- attendees swagger session-registrations` → PASS.
  Если `{}` отвечает 400 «an unknown value was passed to the validate function» — П2 не подтвердилось: остановиться и доложить.
- [ ] **Step 5: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: cancel a conference registration with the session cascade (BEVN-203)"`.

---

### Task 7: Откат, гонка, число запросов, утечки email в лог

**Files:**
- Modify: `backend/test/integration/attendees.e2e-spec.ts`, `query-count.e2e-spec.ts`, `logging.e2e-spec.ts`

**Interfaces:**
- Consumes: всё из Task 5–6. Новых экспортов нет. Код приложения в этой задаче **не меняется**: падение теста — остановиться
  и доложить (не чинить без решения пользователя).

- [ ] **Step 1: Откат (П9) и гонка (Review Focus 4)** — в `attendees.e2e-spec.ts`:

```ts
describe('the cancel transaction (spec 5.1)', () => {
  it('rolls back the registration and the session entries when a later step fails', async () => {
    await seedCascade();
    // Fires on the session entries update, after the registration update of the same transaction.
    await t.prisma.$executeRawUnsafe(`CREATE FUNCTION bevn203_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'bevn203 forced failure'; END $$`);
    await t.prisma.$executeRawUnsafe('CREATE TRIGGER bevn203_fail BEFORE UPDATE ON "session_registrations" FOR EACH STATEMENT EXECUTE FUNCTION bevn203_fail()');
    try {
      const before = await snapshot();
      const { result: res, entries } = await captureLogs(() => cancel(ANN, 1));
      expect(res.status).toBe(500);
      expect(await snapshot()).toEqual(before);
      expect([...events(entries, 'registration.cancelled'), ...events(entries, 'waitlist.promoted')]).toEqual([]);
    } finally {
      await t.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS bevn203_fail ON "session_registrations"');
      await t.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS bevn203_fail()');
    }
  });

  it.each([1, 2, 3, 4, 5])('round %d: a cancel and a session registration of the same attendee at once leave no active entry (Review Focus 4)', async () => {
    const conference = await makeConference(t.prisma);
    await makeSession(t.prisma, conference.id, { capacity: 5 });
    const ann = await makeAttendee(t.prisma, { email: ANN });
    await makeRegistration(t.prisma, conference.id, ann.id);
    let results: { status: number }[] = [];
    await whileTableLocked('registrations', async () => {
      results = await Promise.all([
        cancel(ANN, 1),
        t.http().post('/api/sessions/1/register').set('Content-Type', 'application/json').send({ email: ANN }),
      ]);
    });
    expect(results[0].status).toBe(200);
    expect([201, 409]).toContain(results[1].status);
    expect(await t.prisma.sessionRegistration.count({ where: { attendeeId: ann.id, status: { in: ['CONFIRMED', 'WAITLISTED'] } } })).toBe(0);
  });
});
```

- [ ] **Step 2: Email в логе ошибки 500 и битое кодирование** — там же:

```ts
describe('the email stays out of the log (SEC-1, spec 4.8, 9)', () => {
  it('does not log the email with the stack of a 500 in GET', async () => {
    await t.prisma.$executeRawUnsafe('ALTER TABLE "attendees" RENAME TO "attendees_bevn203"');
    try {
      const { result: res, entries } = await captureLogs(() => list('leak.check@example.com'));
      expect(res.status).toBe(500);
      expect(entries.some((e) => e.level === 'error')).toBe(true);
      expect(JSON.stringify(entries)).not.toMatch(/leak\.check/);
    } finally {
      await t.prisma.$executeRawUnsafe('ALTER TABLE "attendees_bevn203" RENAME TO "attendees"');
    }
  });

  it('answers a malformed percent-encoding with a JSON 4xx, not a 500 [assumption]', async () => {
    const res = await t.http().get('/api/attendees/%E0%A4%A/registrations');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toMatchObject({ statusCode: res.status });
  });
});
```

  Если первый тест падает (в стеке есть email) или второй даёт 500/HTML — **остановиться и доложить** (spec 7.2, 9).
- [ ] **Step 3: Маска в логе запросов** — в `logging.e2e-spec.ts`:

```ts
describe('attendee paths in the request log (BEVN-203 spec 4.8, Review Focus 2)', () => {
  it('masks the email for 200, 400, 404 on an unknown tail, 405, a query string and another letter case', async () => {
    const t = await createTestApp();
    await resetDb(t.prisma);
    const logger = new CapturingLogger();
    Logger.overrideLogger(logger);
    try {
      const calls: [string, () => Promise<{ status: number }>][] = [
        ['/api/attendees/***/registrations', () => t.http().get('/api/attendees/ann%40example.com/registrations')],
        ['/api/attendees/***/registrations', () => t.http().get('/api/attendees/ann%40example/registrations')],
        ['/api/attendees/***/unknown', () => t.http().get('/api/attendees/ann%40example.com/unknown')],
        ['/api/attendees/***/registrations', () => t.http().delete('/api/attendees/ann%40example.com/registrations')],
        ['/api/attendees/***/registrations?q=1', () => t.http().get('/api/attendees/ann%40example.com/registrations?q=1')],
        ['/API/Attendees/***/registrations', () => t.http().get('/API/Attendees/ann%40example.com/registrations')],
      ];
      const statuses: number[] = [];
      for (const [, call] of calls) statuses.push((await call()).status);
      expect(statuses).toEqual([200, 400, 404, 405, 200, 200]);
      const http = logger.entries.filter((e) => 'path' in e);
      expect(http.map((e) => e.path)).toEqual(calls.map(([p]) => p));
      expect(JSON.stringify(logger.entries)).not.toMatch(/ann/);
    } finally {
      Logger.overrideLogger(false);
      await t.close();
    }
  });
});
```

  Ожидание `200` для `/API/Attendees/…` — [предполагаю] (Express без учёта регистра). Если другой статус — путь всё равно
  должен быть замаскирован; поправить только ожидаемый статус в тесте и записать факт для отчёта.
- [ ] **Step 4: Число запросов** — в `query-count.e2e-spec.ts`:

```ts
describe('BEVN-203: attendee endpoints do not depend on the number of registrations and sessions (spec 4.2, 5.1)', () => {
  // Ann is registered for k conferences; in conference 1 she holds the only seat of k sessions and Bob waits in each.
  async function seedAttendee(k: number): Promise<void> {
    await resetDb(t.prisma);
    const ann = await makeAttendee(t.prisma, { email: 'ann@example.com' });
    const bob = await makeAttendee(t.prisma, { email: 'bob@example.com' });
    for (let i = 0; i < k; i += 1) {
      const conference = await makeConference(t.prisma, { title: `Conference ${i}` });
      await makeRegistration(t.prisma, conference.id, ann.id);
    }
    for (let i = 0; i < k; i += 1) {
      const session = await makeSession(t.prisma, 1, { title: `Talk ${i}`, capacity: 1 });
      await makeSessionRegistration(t.prisma, session.id, ann.id, 'CONFIRMED');
      await makeSessionRegistration(t.prisma, session.id, bob.id, 'WAITLISTED');
    }
  }
  const ATTENDEE_CASES: Record<string, () => Promise<{ status: number }>> = {
    'GET /api/attendees/{email}/registrations': () => t.http().get('/api/attendees/ann%40example.com/registrations'),
    'POST /api/attendees/{email}/registrations/{id}/cancel, everyone waiting promoted': () => send('post', '/api/attendees/ann%40example.com/registrations/1/cancel', {}),
  };
  it.each(Object.keys(ATTENDEE_CASES))('%s runs as many queries with 10 as with 2', async (name) => {
    const counts: number[] = [];
    for (const k of [2, 10]) {
      await seedAttendee(k);
      let queries = 0;
      const stop = t.prisma.onQuery(() => {
        queries += 1;
      });
      const res = await ATTENDEE_CASES[name]();
      stop();
      expect(res.status).toBe(200);
      counts.push(queries);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
  it('promotes everyone waiting after the cancel', async () => {
    await seedAttendee(10);
    await send('post', '/api/attendees/ann%40example.com/registrations/1/cancel', {});
    expect(await t.prisma.sessionRegistration.count({ where: { status: 'WAITLISTED' } })).toBe(0);
  });
});
```

  Если число запросов `cancel` растёт с `k` — запасной путь spec 7.2 (прочитать id сессий конференции, +1 запрос) —
  только после решения пользователя.
- [ ] **Step 5: Run** — `npm run lint && npm run typecheck && npm run test:int -- attendees query-count logging` → PASS.
- [ ] **Step 6: Мутационная проверка** (как в BEVN-202, только рабочее дерево, после — `git restore` файлов кода до `HEAD`):
  по одному мутанту, каждый должен «убить» хотя бы один тест:
  M1 убрать `session: { conferenceId }` из `updateMany`; M2 убрать `status: { in: ACTIVE_STATUSES }`; M3 убрать вызов
  `promoteConference`; M4 поменять местами проверки в `decideCancelRegistration`; M5 `maskPath` без флага `i`;
  M6 `orderBy` только по `id`; M7 в `register` всегда `create`. Выживший мутант — остановиться и доложить.
  Run для каждого: `npm test && npm run test:int -- attendees registrations logging` (тайм-аут 600 000 мс).
- [ ] **Step 7: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "test: cover cancel rollback, races, query count and log masking (BEVN-203)"`.

---

### Task 8: Фронтенд — `api.js`, `Navbar`, бейдж, тексты, консоль

**Files:**
- Create: `frontend/src/components/Navbar.jsx`, `frontend/src/components/Navbar.test.jsx`, `frontend/src/registrationStatus.js`
- Modify: `frontend/src/api.js`, `frontend/src/api.test.js`, `frontend/src/pages/ConferenceListPage.jsx`,
  `ConferenceDetailPage.jsx`, `RegistrationPage.jsx`, `SessionDetailPage.jsx`, `pages/ConferenceDetailPage.test.jsx`,
  `pages/RegistrationPage.test.jsx`, `pages/SessionDetailPage.test.jsx`, `registrationVisibility.test.jsx`

**Interfaces:**
- Produces: `getAttendeeRegistrations(email) → Promise<AttendeeRegistration[]>`, `cancelRegistration(email, id) → Promise<AttendeeRegistration>`;
  `registrationBadgeClass(status) → string`; `<Navbar />` без пропсов. `deleteRegistration` удалён.

- [ ] **Step 1: Тесты**
  - `api.test.js` — импорт `cancelRegistration, getAttendeeRegistrations`; убрать `vi.spyOn(console, 'log')…` из `beforeEach`; добавить:

```js
describe('attendee registrations (BEVN-203 spec 6.1)', () => {
  it('puts the encoded email into the path of the list (Review Focus 1)', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getAttendeeRegistrations('ann+tag/x@example.com')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5000/api/attendees/ann%2Btag%2Fx%40example.com/registrations')
    expect(init.method).toBeUndefined()
  })

  it('cancels with POST and an empty JSON object', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 7, status: 'CANCELLED' }))
    await cancelRegistration('ann@example.com', 7)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5000/api/attendees/ann%40example.com/registrations/7/cancel')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('does not log requests and has no deleteRegistration (FE-6)', async () => {
    const log = vi.spyOn(console, 'log')
    fetchMock.mockResolvedValue(json(200, []))
    await getAttendeeRegistrations('ann@example.com')
    expect(log).not.toHaveBeenCalled()
    expect(await import('./api')).not.toHaveProperty('deleteRegistration')
  })
})
```

  - `components/Navbar.test.jsx`:

```jsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Navbar from './Navbar'

afterEach(cleanup)

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>)
const link = (name) => screen.getByRole('link', { name })

describe('Navbar (BEVN-203 spec 6.3)', () => {
  it('links the brand and Conferences to / and My registrations to /dashboard', () => {
    renderAt('/')
    expect(link('BrownEvents').getAttribute('href')).toBe('/')
    expect(link('Conferences').getAttribute('href')).toBe('/')
    expect(link('My registrations').getAttribute('href')).toBe('/dashboard')
  })

  it.each([
    ['/', 'Conferences'],
    ['/dashboard', 'My registrations'],
    ['/conferences/2', null],
  ])('marks the current page on %s', (path, current) => {
    renderAt(path)
    for (const name of ['Conferences', 'My registrations']) {
      expect(link(name).getAttribute('aria-current')).toBe(name === current ? 'page' : null)
    }
    expect(link('BrownEvents').getAttribute('aria-current')).toBeNull()
  })
})
```

  - `ConferenceDetailPage.test.jsx` — убрать заглушку `console.log`; добавить тест бейджа и текста успеха:

```jsx
describe('registrations list and success text (BEVN-203 spec 6.4)', () => {
  it('shows the stored status of each registration with its own badge, without a CONFIRMED default', async () => {
    api.getConferenceRegistrations.mockResolvedValue([
      { id: 1, status: 'CONFIRMED', attendee: { id: 1, firstName: 'Ann', lastName: 'Lee' } },
      { id: 2, status: 'CANCELLED', attendee: { id: 2, firstName: 'Bob', lastName: 'Ray' } },
    ])
    await renderPage()
    const confirmed = await screen.findByText('CONFIRMED')
    expect(confirmed.className).toBe('badge badge--active')
    expect(screen.getByText('CANCELLED').className).toBe('badge badge--cancelled')
  })

  it('points to My registrations after registering instead of promising an email', async () => {
    api.registerAttendee.mockResolvedValue({ id: 1 })
    await renderPage()
    openModal()
    fillForm(VALUES)
    submitForm()
    await screen.findByText(SUCCESS)
    expect(screen.queryByText(/confirmation/i)).toBeNull()
    // The Navbar has a link with the same name, so the one in the success text is looked up inside the modal.
    expect(within(modal()).getByRole('link', { name: 'My registrations' }).getAttribute('href')).toBe('/dashboard')
  })
})
```

  (`within` добавить в импорт из `@testing-library/react`.)
  - `RegistrationPage.test.jsx` — убрать заглушку; добавить проверку текста успеха (по образцу существующего теста успеха
    файла): после успешной отправки нет `/confirmation email/i`, есть ссылка «My registrations» внутри `.success-box` на `/dashboard`.
  - `SessionDetailPage.test.jsx`, `registrationVisibility.test.jsx` — убрать заглушку `console.log` (П7).
- [ ] **Step 2: RED** — Run (из `frontend/`): `npm test` → FAIL: нет `Navbar`, функций API, бейдж `badge--upcoming`, текст про email.
- [ ] **Step 3: Реализация**
  - `api.js`: удалить строку `console.log('API request:', path, options)` и `deleteRegistration`; добавить после `registerAttendee`:

```js
// BEVN-203: the email is the attendee's identity (no sign-in, SEC-2); encoded because it may hold + / ? # and spaces.
export const getAttendeeRegistrations = (email) =>
  request(`/api/attendees/${encodeURIComponent(email)}/registrations`)

// The cancel takes no body, but every POST to the API must be JSON, so an empty object is sent.
export const cancelRegistration = (email, id) =>
  request(`/api/attendees/${encodeURIComponent(email)}/registrations/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) })
```

  - `registrationStatus.js`:

```js
// Badge of a conference registration status (BEVN-203 spec 6.2): the dashboard and the conference page show it alike.
const BADGES = { CONFIRMED: 'badge badge--active', CANCELLED: 'badge badge--cancelled' }

export const registrationBadgeClass = (status) => BADGES[status] ?? 'badge badge--upcoming'
```

  - `components/Navbar.jsx`:

```jsx
import { Link, NavLink } from 'react-router-dom'

// One header for every page (BEVN-203 spec 6.3). NavLink sets aria-current="page"; `end` keeps Conferences current
// only on the list itself.
export default function Navbar() {
  return (
    <nav className="navbar">
      <Link to="/" className="navbar__brand">BrownEvents</Link>
      <NavLink to="/" end className="navbar__link">Conferences</NavLink>
      <NavLink to="/dashboard" className="navbar__link">My registrations</NavLink>
    </nav>
  )
}
```

  - Страницы: каждую из 9 копий `<nav className="navbar">…</nav>` заменить на `<Navbar />` (`import Navbar from '../components/Navbar'`):
    `ConferenceListPage.jsx` (1), `ConferenceDetailPage.jsx` (3), `SessionDetailPage.jsx` (3), `RegistrationPage.jsx`
    (строка 63 и константа `navbar` в строках 77-82 — константу удалить, `{navbar}` заменить на `<Navbar />`). Импорт `Link`
    удалить там, где он больше не используется (проверить `grep -n "Link" <файл>`).
  - `ConferenceDetailPage.jsx:281`: `<span><span className={registrationBadgeClass(reg.status)}>{reg.status}</span></span>`.
  - `ConferenceDetailPage.jsx:319`: `<p>You've been registered. You can view or cancel it under <Link to="/dashboard">My registrations</Link>.</p>`
  - `RegistrationPage.jsx:67`: `<p>You are now registered. You can view or cancel it under <Link to="/dashboard">My registrations</Link>.</p>`
  - П7: удалить `console.log(...)` в `ConferenceDetailPage.jsx` строки 49, 53, 88, 101, 122, 129 и `RegistrationPage.jsx:49`
    (если вызов — единственная инструкция в стрелочной функции/ветке, оставить корректный синтаксис; `grep -n "console" src -r` → пусто).
- [ ] **Step 4: GREEN** — Run: `npm test && npm run build` → PASS; число тестов = 73 + новые, все зелёные; вывод тестов без `API request:`.
- [ ] **Step 5: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: add the shared navbar and attendee registration API calls (BEVN-203)"`.

---

### Task 9: Страница `/dashboard`

**Files:**
- Create: `frontend/src/pages/DashboardPage.jsx`, `frontend/src/pages/DashboardPage.test.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `getAttendeeRegistrations`, `cancelRegistration`, `registrationBadgeClass`, `Navbar` (Task 8), `isRegistrationOpen` (`conferenceStatus.js`).
- Produces: маршрут `/dashboard` → `<DashboardPage />`.

- [ ] **Step 1: Тесты** `DashboardPage.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import * as api from '../api'

vi.mock('../api', () => ({ getAttendeeRegistrations: vi.fn(), cancelRegistration: vi.fn() }))

const EMAIL = 'ann@x.example'
const conf = (id, title, status, startDate = '2027-03-05T00:00:00', endDate = '2027-03-06T00:00:00') => ({ id, title, status, startDate, endDate })
const OPEN = { id: 7, status: 'CONFIRMED', registeredAt: '2026-10-10T09:00:00.000Z', conference: conf(2, 'CloudOps Days', 'UPCOMING') }
const CLOSED = { id: 8, status: 'CONFIRMED', registeredAt: '2026-10-10T09:00:00.000Z', conference: conf(3, 'Data & AI Forum', 'CANCELLED') }
const GONE = { id: 9, status: 'CANCELLED', registeredAt: '2026-10-01T09:00:00.000Z', conference: conf(1, '.NET Summit 2024', 'COMPLETED', '2024-10-14T00:00:00', '2024-10-16T00:00:00') }
const CANCELLED_OPEN = { ...OPEN, status: 'CANCELLED' }

// What api.js throws for a non-2xx answer (ApiError): message plus status and body.
const apiError = (status, message, reason) => Object.assign(new Error(message), { status, body: { statusCode: status, message, reason } })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search + location.hash}</output>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<><DashboardPage /><Location /></>} />
      </Routes>
    </MemoryRouter>
  )
}

function search(email = EMAIL) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Show registrations' }))
}

const row = (title) => screen.getByRole('link', { name: title }).closest('li')
const cancelButton = (title) => screen.getByRole('button', { name: `Cancel registration for ${title}` })

async function showList(registrations = [OPEN, CLOSED, GONE]) {
  api.getAttendeeRegistrations.mockResolvedValueOnce(registrations)
  search()
  await screen.findByRole('list', { name: 'Registrations' })
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  api.getAttendeeRegistrations.mockReset()
  api.cancelRegistration.mockReset()
})

describe('looking up registrations (spec 6.2)', () => {
  it('starts with a hint and both live regions mounted', () => {
    expect(screen.getByText('Enter the email you registered with to see your conference registrations.')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
  })

  it('looks up the trimmed email and shows the empty state', async () => {
    api.getAttendeeRegistrations.mockResolvedValueOnce([])
    search('  ann@x.example ')
    expect(await screen.findByText('No registrations found for ann@x.example.')).toBeTruthy()
    expect(api.getAttendeeRegistrations).toHaveBeenCalledWith('ann@x.example')
  })

  it('shows conference link, dates, registration badge and the conference status only when closed', async () => {
    await showList()
    const open = row('CloudOps Days')
    expect(within(open).getByRole('link', { name: 'CloudOps Days' }).getAttribute('href')).toBe('/conferences/2')
    expect(within(open).getByText('📅 March 5, 2027 — March 6, 2027')).toBeTruthy()
    expect(within(open).getByText('CONFIRMED').className).toBe('badge badge--active')
    expect(within(open).queryByText(/^Conference /)).toBeNull()
    expect(within(row('Data & AI Forum')).getByText('Conference CANCELLED')).toBeTruthy()
    const gone = row('.NET Summit 2024')
    expect(within(gone).getByText('CANCELLED').className).toBe('badge badge--cancelled')
    expect(within(gone).getByText('Conference COMPLETED')).toBeTruthy()
  })

  it('offers cancel on every CONFIRMED registration: enabled while open, disabled with a linked hint when closed; none on CANCELLED', async () => {
    await showList()
    expect(cancelButton('CloudOps Days').disabled).toBe(false)
    const closed = cancelButton('Data & AI Forum')
    expect(closed.disabled).toBe(true)
    const hint = document.getElementById(closed.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('Registration is closed for this conference, so it can no longer be cancelled.')
    expect(within(row('.NET Summit 2024')).queryByRole('button')).toBeNull()
  })

  it('says "Enter a valid email address" for a 400 and the API message otherwise', async () => {
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(400, 'email must be an email address'))
    search('ann@x')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address'))
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    search()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The database is busy, retry the request'))
  })

  it('ignores the answer of an older search', async () => {
    const first = deferred()
    const second = deferred()
    api.getAttendeeRegistrations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    search('old@x.example')
    search('new@x.example')
    await act(async () => { second.resolve([]) })
    await act(async () => { first.resolve([OPEN]) })
    expect(screen.getByText('No registrations found for new@x.example.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
  })

  it('keeps the email out of the address', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await screen.findByText('Your registration for CloudOps Days is cancelled.')
    expect(screen.getByTestId('location').textContent).toBe('/dashboard')
  })
})

describe('cancelling (spec 6.2)', () => {
  it('does nothing when the confirmation is declined', async () => {
    await showList()
    window.confirm.mockReturnValueOnce(false)
    fireEvent.click(cancelButton('CloudOps Days'))
    expect(window.confirm).toHaveBeenCalledWith('Cancel your registration for CloudOps Days?')
    expect(api.cancelRegistration).not.toHaveBeenCalled()
  })

  it('cancels, refreshes the list and announces it in the status region', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Your registration for CloudOps Days is cancelled.'))
    expect(api.cancelRegistration).toHaveBeenCalledWith(EMAIL, 7)
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(within(row('CloudOps Days')).queryByRole('button')).toBeNull())
  })

  it.each([
    ['ALREADY_CANCELLED', 'The registration is already cancelled'],
    ['REGISTRATION_CLOSED', 'Registration is closed: the conference is CANCELLED'],
  ])('shows a 409 %s in the alert region and refreshes the list', async (reason, message) => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(409, message, reason))
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message))
    await waitFor(() => expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2))
  })

  it('does not refresh after another error', async () => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The database is busy, retry the request'))
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(1)
    expect(cancelButton('CloudOps Days').disabled).toBe(false)
  })

  it('keeps the list and says so when the refresh after a cancel fails', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'The list could not be refreshed: The database is busy, retry the request. Search again to see it.'))
    expect(screen.getByRole('list', { name: 'Registrations' })).toBeTruthy()
  })

  it('locks the row button while its request runs and sends one request for a double click', async () => {
    await showList()
    const pending = deferred()
    api.cancelRegistration.mockReturnValueOnce(pending.promise)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(cancelButton('CloudOps Days').disabled).toBe(true))
    expect(api.cancelRegistration).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(CANCELLED_OPEN) })
  })

  it('leaves a newer search alone when an older cancel finishes (Review Focus 5)', async () => {
    await showList()
    const pending = deferred()
    api.cancelRegistration.mockReturnValueOnce(pending.promise)
    fireEvent.click(cancelButton('CloudOps Days'))
    api.getAttendeeRegistrations.mockResolvedValueOnce([])
    search('other@x.example')
    await screen.findByText('No registrations found for other@x.example.')
    await act(async () => { pending.resolve(CANCELLED_OPEN) })
    expect(screen.getByText('No registrations found for other@x.example.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2)
  })

  it('clears the list and messages on a new search', async () => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(503, 'busy'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('busy'))
    const pending = deferred()
    api.getAttendeeRegistrations.mockReturnValueOnce(pending.promise)
    search()
    expect(screen.getByRole('alert').textContent).toBe('')
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
    await act(async () => { pending.resolve([]) })
  })
})
```

- [ ] **Step 2: RED** — Run: `npm test -- DashboardPage` → FAIL: модуль `./DashboardPage` не найден.
- [ ] **Step 3: Реализация** `DashboardPage.jsx`:

```jsx
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelRegistration, getAttendeeRegistrations } from '../api'
import Navbar from '../components/Navbar'
import { isRegistrationOpen } from '../conferenceStatus'
import { registrationBadgeClass } from '../registrationStatus'

// Dates come without a zone and are parsed as local time, so the day shown is the venue's day, as on the conference page.
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// The conference status is shown only when it explains why a registration can no longer change (spec 6.2).
const SHOWN_CONFERENCE_STATUSES = ['CANCELLED', 'COMPLETED']

function RegistrationRow({ reg, busy, onCancel }) {
  const { conference } = reg
  const open = isRegistrationOpen(conference.status)
  const hintId = `cancel-hint-${reg.id}`
  return (
    <li className="card" style={{ marginBottom: '12px' }}>
      <div className="card__title"><Link to={`/conferences/${conference.id}`}>{conference.title}</Link></div>
      <p>📅 {formatDate(conference.startDate)} — {formatDate(conference.endDate)}</p>
      <p>
        <span className={registrationBadgeClass(reg.status)}>{reg.status}</span>
        {SHOWN_CONFERENCE_STATUSES.includes(conference.status) && (
          <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>Conference {conference.status}</span>
        )}
      </p>
      {reg.status === 'CONFIRMED' && (
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label={`Cancel registration for ${conference.title}`}
            aria-describedby={open ? undefined : hintId}
            disabled={!open || busy}
            onClick={() => onCancel(reg)}
          >
            Cancel registration
          </button>
          {!open && (
            <span id={hintId} style={{ marginLeft: '12px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Registration is closed for this conference, so it can no longer be cancelled.
            </span>
          )}
        </div>
      )}
    </li>
  )
}

export default function DashboardPage() {
  // The email lives only in state: never in the address or in storage (spec 6.2).
  const [email, setEmail] = useState('')
  const [lookup, setLookup] = useState(null) // { email, loading } | { email, registrations } | { email, error }
  const [notice, setNotice] = useState(null) // { kind: 'success' | 'error', text, refreshError? }
  const [busyIds, setBusyIds] = useState([])
  const searchNo = useRef(0) // every search: answers that belong to an older search are dropped
  const loadNo = useRef(0) // every load: an older answer never replaces a newer list
  const inFlight = useRef(new Set()) // cancels running now; a ref, so a double click sees the first click at once

  async function fetchList(forEmail, search, { quiet }) {
    const load = ++loadNo.current
    const current = () => search === searchNo.current && load === loadNo.current
    try {
      const registrations = await getAttendeeRegistrations(forEmail)
      if (current()) setLookup({ email: forEmail, registrations })
    } catch (err) {
      if (!current()) return
      if (quiet) setNotice(n => ({ ...n, refreshError: `The list could not be refreshed: ${err.message}. Search again to see it.` }))
      else setLookup({ email: forEmail, error: err.status === 400 ? 'Enter a valid email address' : err.message })
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const forEmail = email.trim()
    searchNo.current += 1
    inFlight.current.clear()
    setBusyIds([])
    setNotice(null)
    setLookup({ email: forEmail, loading: true })
    fetchList(forEmail, searchNo.current, { quiet: false })
  }

  async function handleCancel(reg) {
    if (inFlight.current.has(reg.id)) return
    if (!window.confirm(`Cancel your registration for ${reg.conference.title}?`)) return
    const search = searchNo.current
    const forEmail = lookup.email
    inFlight.current.add(reg.id)
    setBusyIds(ids => [...ids, reg.id])
    setNotice(null)
    let next
    let refresh
    try {
      await cancelRegistration(forEmail, reg.id)
      next = { kind: 'success', text: `Your registration for ${reg.conference.title} is cancelled.` }
      refresh = true
    } catch (err) {
      next = { kind: 'error', text: err.message }
      // A 409 means the list is out of date (already cancelled, or the conference closed meanwhile).
      refresh = err.status === 409
    }
    if (search !== searchNo.current) return
    setNotice(next)
    if (refresh) await fetchList(forEmail, search, { quiet: true })
    if (search !== searchNo.current) return
    inFlight.current.delete(reg.id)
    setBusyIds(ids => ids.filter(id => id !== reg.id))
  }

  const registrations = lookup?.registrations
  const alertText = lookup?.error ?? (notice?.kind === 'error' ? notice.text : null)

  return (
    <div>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1 className="page-header__title">My registrations</h1>
        </div>

        <form className="card" style={{ maxWidth: '600px', marginBottom: '16px' }} onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="dashboard-email">Email</label>
            <input id="dashboard-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <button type="submit" className="btn btn--primary">Show registrations</button>
        </form>

        {/* Both live regions stay mounted so screen readers announce what is put into them (BEVN-202 lesson). */}
        <div role="status">{notice?.kind === 'success' && <p>{notice.text}</p>}</div>
        <div role="alert">
          {alertText && <p>{alertText}</p>}
          {notice?.refreshError && <p>{notice.refreshError}</p>}
        </div>

        {!lookup && <p style={{ color: 'var(--text-muted)' }}>Enter the email you registered with to see your conference registrations.</p>}
        {lookup?.loading && (
          <div className="loading-container"><div className="spinner" /><p>Loading registrations...</p></div>
        )}
        {registrations?.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No registrations found for {lookup.email}.</p>}
        {registrations?.length > 0 && (
          <ul aria-label="Registrations" style={{ listStyle: 'none', padding: 0, marginTop: '16px' }}>
            {registrations.map(reg => (
              <RegistrationRow key={reg.id} reg={reg} busy={busyIds.includes(reg.id)} onCancel={handleCancel} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

  Тексты в live-областях: `textContent` региона в тестах сравнивается целиком, поэтому `alert` содержит только `<p>` с
  текстом (при сбое перечитывания после успеха — только строку `refreshError`, т. к. `notice.kind === 'success'`).
  `App.jsx`: `import DashboardPage from './pages/DashboardPage'` и `<Route path="/dashboard" element={<DashboardPage />} />`.
- [ ] **Step 4: GREEN** — Run: `npm test && npm run build` → PASS.
- [ ] **Step 5: Мутанты фронтенда** (рабочее дерево, затем `git restore` до `HEAD`): F1 убрать проверку `search !== searchNo.current`
  после `cancelRegistration`; F2 убрать `inFlight`; F3 `refresh = false` для 409; F4 всегда монтировать `alert` только при тексте.
  Каждый должен «убить» тест; выживший — остановиться и доложить.
- [ ] **Step 6: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "feat: add the attendee registration dashboard page (BEVN-203)"`.

---

### Task 10: Полная проверка как в CI

- [ ] **Step 1: Бэкенд** — Run (из `backend/`): `npm ci && npx prisma generate && npm run lint && npm run typecheck && npm run build && npm test && TZ=Asia/Bishkek npm test && TZ=America/Los_Angeles npm test && npm run test:int -- --ci` (тайм-аут 600 000 мс).
  Expected: всё зелёное; записать число тестов unit / integration.
- [ ] **Step 2: Swagger** — Run: `npm run swagger:generate -- <scratchpad>/swagger.json`; в нём операции
  `Attendees_GetRegistrations`, `Attendees_CancelRegistration`, `reason` с `ALREADY_CANCELLED`, `enum` статуса у
  `RegistrationSummaryResponse` и `AttendeeRegistrationResponse`.
- [ ] **Step 3: Фронтенд** — Run (из `frontend/`): `npm ci && npm test && npm run build` → PASS.
- [ ] **Step 4:** Run (из `backend/`): `bash scripts/test-db.sh down`.
- [ ] **Step 5: Чистота** — `git status && git diff --stat main...HEAD` — рабочее дерево чистое, в ветке только файлы из File Structure (+ spec, план), без `report/`,
  без диффа «весь файл»; `git ls-files --eol` для новых файлов — `i/lf`.

---

### Task 11: Проверка в браузере — ОСТАНОВКА для пользователя

Стенд из образов на порту 5000 (на него ходит `api.js`, FE-1), продакшн-сборка фронтенда через `vite preview` на 5173.

- [ ] **Step 1: Скрипт демо-данных (П13)** — создать `backend/scripts/bevn203-demo-data.sh` (LF):

```bash
#!/usr/bin/env bash
# Demo data for the BEVN-203 dashboard check on an isolated stand (spec 7.4): the seed has no attendees or registrations.
# Usage (from backend/, after `STAND_PORT=5000 bash scripts/stand.sh up`): bash scripts/bevn203-demo-data.sh [base URL]
# Creates its own conferences through the API, so the seeded ones stay as they are. Needs GNU date (Git Bash has it).
set -euo pipefail
BASE=${1:-http://127.0.0.1:5000}
ANN=ann.demo@example.com
BOB=bob.demo@example.com

day() { date -u -d "$1 days" +%Y-%m-%d; } # day 40 -> 40 days from today, day -30 -> 30 days ago

# call METHOD PATH [JSON]: prints the body; stops the script on a status other than 2xx.
call() {
  local out status
  if [ $# -ge 3 ]; then
    out=$(curl -s -m 10 -X "$1" "$BASE$2" -H 'Content-Type: application/json' --data "$3" -w $'\n%{http_code}')
  else
    out=$(curl -s -m 10 -X "$1" "$BASE$2" -w $'\n%{http_code}')
  fi
  status=${out##*$'\n'}
  echo "$1 $2 -> $status" >&2
  case "$status" in 2??) ;; *) echo "${out%$'\n'*}" >&2; exit 1 ;; esac
  printf '%s' "${out%$'\n'*}"
}
# Every answer used here starts with the id of the record: {"id":12,...}
id_of() { sed -n 's/^{"id":\([0-9]*\).*/\1/p'; }

conference() { call POST /api/conferences "{\"title\":\"$1\",\"startDate\":\"$2T00:00:00\",\"endDate\":\"$3T00:00:00\"}" | id_of; }
put_conference() { # id title start end status(JSON)
  call PUT "/api/conferences/$1" "{\"title\":\"$2\",\"description\":null,\"location\":null,\"venue\":null,\"startDate\":\"$3T00:00:00\",\"endDate\":\"$4T00:00:00\",\"status\":$5,\"maxAttendees\":null,\"organizerName\":null,\"website\":null}" >/dev/null
}
register() { call POST "/api/conferences/$1/register" "{\"firstName\":\"$2\",\"lastName\":\"Demo\",\"email\":\"$3\"}" | id_of; }
session() { call POST "/api/conferences/$1/sessions" "{\"title\":\"$2\",\"startTime\":\"$3T$4:00\",\"endTime\":\"$3T$5:00\",\"capacity\":$6}" | id_of; }
enrol() { call POST "/api/sessions/$1/$2" "{\"email\":\"$3\"}" >/dev/null; }

# Open: Ann holds the only seat of the first talk with Bob waiting, and a seat in the second talk.
d=$(day 40)
open=$(conference 'Dashboard Demo: Open' "$d" "$(day 41)")
one=$(session "$open" 'Demo talk: one seat' "$d" 10:00 11:00 1)
five=$(session "$open" 'Demo talk: five seats' "$d" 12:00 13:00 5)
register "$open" Ann "$ANN" >/dev/null
register "$open" Bob "$BOB" >/dev/null
enrol "$one" register "$ANN"
enrol "$one" waitlist "$BOB"
enrol "$five" register "$ANN"

# Cancelled by the organiser after Ann registered: her registration stays CONFIRMED, the cancel button is disabled.
closed=$(conference 'Dashboard Demo: Cancelled by organiser' "$(day 50)" "$(day 51)")
register "$closed" Ann "$ANN" >/dev/null
put_conference "$closed" 'Dashboard Demo: Cancelled by organiser' "$(day 50)" "$(day 51)" '"CANCELLED"'

# Past: registered while upcoming, then the dates moved 30 days back (COMPLETED).
past=$(conference 'Dashboard Demo: Past' "$(day 45)" "$(day 45)")
register "$past" Ann "$ANN" >/dev/null
put_conference "$past" 'Dashboard Demo: Past' "$(day -30)" "$(day -30)" null

# A registration Ann cancelled herself: read-only on the dashboard.
gone=$(conference 'Dashboard Demo: Cancelled registration' "$(day 60)" "$(day 61)")
reg=$(register "$gone" Ann "$ANN")
call POST "/api/attendees/ann.demo%40example.com/registrations/$reg/cancel" '{}' >/dev/null

echo "conferences: open=$open closed=$closed past=$past cancelled-registration=$gone; sessions of open: one seat=$one, five seats=$five"
```

- [ ] **Step 2: Порты свободны** — Run (Git Bash): `for p in 5000 5173; do curl -s -m 2 -o NUL -w "$p %{http_code}\n" http://127.0.0.1:$p/ || true; done`
  Любой ответ, кроме `000`, — порт занят (обычно compose). **Compose агент не трогает:** попросить пользователя остановить его и ждать.
- [ ] **Step 3: Стенд и данные** — Run (из `backend/`, тайм-аут 600 000 мс): `bash scripts/stand.sh build && STAND_PORT=5000 bash scripts/stand.sh up`
  → `stand up on http://127.0.0.1:5000 (container started …)` со свежим временем. Затем `bash scripts/bevn203-demo-data.sh`
  → все вызовы `2xx`, последняя строка с id (записать). Если автоматический классификатор прав не даёт занять порт 5000
  (как в BEVN-202 Task 16) — дать пользователю эти команды для Git Bash и ждать.
- [ ] **Step 4: Фронтенд** — Run (из `frontend/`): `npm run build`; затем (PowerShell, PID самого vite, не обёртки `npx`):

```powershell
$p = Start-Process node -ArgumentList 'node_modules/vite/bin/vite.js','preview','--port','5173','--strictPort' -WorkingDirectory frontend -PassThru -WindowStyle Hidden; $p.Id
```

  Записать PID; `curl -s -m 2 -o NUL -w '%{http_code}' http://localhost:5173/dashboard` → `200`.
- [ ] **Step 5: Чек-лист пользователю и ОСТАНОВКА** — Chrome, DevTools → Network открыть **до** первого пункта:
  1. `http://localhost:5173/` — в шапке **BrownEvents**, **Conferences**, **My registrations**; «Conferences» выделена как текущая
     (в Elements у ссылки `aria-current="page"`). Клик **My registrations** → `/dashboard`, текущей стала она.
  2. Обновить страницу на `http://localhost:5173/dashboard` (F5) — страница открылась, не 404.
  3. Подсказка «Enter the email you registered with…». Пустое поле → **Show registrations**: браузер не отправляет форму.
     Клик по подписи «Email» ставит курсор в поле.
  4. `nobody@example.com` → «No registrations found for nobody@example.com.» `ann@x` → «Enter a valid email address» (в Network — 400).
  5. ` Ann.Demo@Example.com ` → 4 строки по дате начала: Past (прошлое, бейдж CONFIRMED, «Conference COMPLETED», кнопка
     неактивна + подсказка), Open (CONFIRMED, кнопка активна), Cancelled by organiser («Conference CANCELLED», кнопка неактивна +
     подсказка), Cancelled registration (бейдж CANCELLED, кнопки нет). Даты — «Month D, YYYY — Month D, YYYY». В Network URL
     запроса содержит `%40`; адрес страницы остался `/dashboard`.
  6. **Cancel registration** у Open → в диалоге «Отмена» → запроса в Network нет. Снова → «ОК» → «Your registration for
     Dashboard Demo: Open is cancelled.», строка стала CANCELLED без кнопки. Тело POST в Network — `{}`.
  7. `http://localhost:5173/conferences/<open>/sessions/<one>` — «👥 1 / 1 registered», «⏳ Waitlist: 0» (Боб продвинут);
     сессия `<five>` — «👥 0 / 5».
  8. Две вкладки `/dashboard` с одним списком Ann (после повторной регистрации из п. 9 или с Open до п. 6 — порядок
     согласуем по ходу). Отменить во вкладке 1, затем во вкладке 2 (устаревшей) — сообщение «The registration is already
     cancelled», список обновился, кнопки нет.
  9. На странице конференции Open → **Register Now** с `ann.demo@example.com` → текст успеха без обещания письма, ссылка
     **My registrations** ведёт на `/dashboard`; на дашборде Open снова CONFIRMED; сессия `<five>` — «👥 0 / 5» (записи не восстановлены).
  10. На странице конференции Open в списке регистраций у Ann и Bob — свои бейджи (CONFIRMED зелёный, CANCELLED красный).

  Ждать ответа по каждому пункту. Неудача — разбирать по systematic-debugging, не чинить «на лету» без плана.
- [ ] **Step 6: После «ок» — лог и уборка** — Run: `bash scripts/stand.sh logs | grep -E 'registration\.cancelled|waitlist\.promoted'`
  → `registration.cancelled` с `sessionEntriesCancelled: 2` (п. 6) и `waitlist.promoted` с `trigger: "conference-cancel"`, `"level":"log"`.
  `bash scripts/stand.sh logs | grep -c 'demo%40\|demo@'` → `0`; `bash scripts/stand.sh logs | grep -m3 '/api/attendees/'` — пути с `***`.
  Остановить vite по записанному PID (`Stop-Process -Id <PID>`); `bash scripts/stand.sh down`. Compose пользователь поднимает сам.
- [ ] **Step 7: Коммит** (после одобрения ревьюера и «ок» пользователя): `git add` файлов задачи, показать `git status --short` и `git diff --cached --stat` (только файлы задачи), затем `git commit -m "chore: add the BEVN-203 demo data script (BEVN-203)"` (`git add backend/scripts/bevn203-demo-data.sh`).

---

### Task 12: Сверка с DoD, devlog, тексты коммита и PR

- [ ] **Step 1: Сверка с DoD issue #10** — таблица «пункт → тест/проверка → результат» по spec 7.5 с именами тестов и
  пунктами чек-листа браузера. Отдельно: допущения spec 10 (`updateMany` одним запросом / фиксированное число — Task 7 Step 4;
  `orderBy` по полю конференции — там же; атомарность миграции — Task 1 Step 5; `/dashboard` напрямую — Task 11 п. 2) —
  подтверждено/опровергнуто; мутанты Task 7 и 9; решения П1–П14 — как приняты.
- [ ] **Step 2: Черновик записей в `docs/devlog.md`** (CRLF; формат существующей записи BEVN-203: разделы `## plan`,
  `## implementation`, `## checks` с пунктами «Что сделал я, а не агент», «Что поймал / спросил / решил», «Стоимость…»)
  — показать на утверждение; мнения пользователя — `<!-- ваше -->`.
- [ ] **Step 3: Коммит devlog (после «ок»)** — `git diff --stat` только `docs/devlog.md` без диффа «весь файл» (CRLF сохранён);
  `git commit -m "docs: add BEVN-203 devlog entry"`. Коммиты задач уже сделаны в Task 1–11.
- [ ] **Step 4: Текст PR** по `.github/pull_request_template.md` (`Closes #10`, раздел DoD). Побочные эффекты в PR:
  compose применит миграцию к dev-базе при следующем `up`; отменённые регистрации появляются со статусом в
  `GET /api/conferences/{id}/registrations` и `GET /api/conferences/{id}` (spec 4.7); восстановленная регистрация остаётся на
  прежнем месте в этом списке (spec 3.2); email участника стоит в URL — в логе приложения маскируется, но попадёт в access-логи
  прокси (nginx продакшн-сборки проксирует `/api/`); на трёх экранах шапка получила две новые ссылки; SEC-2 — блокер продакшна
  (spec 9). Push и PR — только после подтверждения; после PR — CI по логу (версии, число тестов), не только по статусу.

---

## Self-Review (выполнено при написании)

- **Покрытие spec:** 3.1 → T1; 3.2 → T3; 4.1/4.2 → T5; 4.3 → T2, T6; 4.4 → T4, T5; 4.5 → T2, T3; 4.6 → T2; 4.7 → T3; 4.8 → T4, T7;
  5.1–5.3 → T6, T7; 5.4 → T2; 6.1 → T8; 6.2 → T9; 6.3/6.4 → T8, T9; 7.1 → T2, T4; 7.2 → T1, T3, T5–T7; 7.3 → T8, T9; 7.4 → T11;
  7.5 → T12; 10 → T0, T1, T7, T11. Отступление — П1 (один запрос вместо двух), на утверждение.
- **Типы:** `RegistrationStatus`, `decideRegister({ existing, taken, maxAttendees })`, `decideCancelRegistration({ status, conferenceStatus })`,
  `attendeeRegistrationFields`, `toAttendeeRegistration`, `cancelForAttendee(email, id)`, `getAttendeeRegistrations`, `cancelRegistration`,
  `registrationBadgeClass` — одинаковы во всех задачах.
- **Известные дефекты аудита, которые могут помешать проверкам:** FE-1 (фронтенд жёстко ходит на :5000) — стенд на 5000 в Task 11;
  SEC-2 — вне задачи; FE-6 частично закрывается (П7).
