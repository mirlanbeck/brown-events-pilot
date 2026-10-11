# BEVN-203 — дашборд регистраций участника (Attendee Registration Dashboard): спецификация

- Задача: [issue #10](https://github.com/mirlanbeck/brown-events-pilot/issues/10), первоисточник —
  `rolling-scopes-school/ai-native`, `test-task/tasks/BEVN-203-registration-dashboard.md` (тексты совпадают, `diff` на шаге 0).
- Ветка: `BEVN-203-registration-dashboard` (от `main` после BEVN-202, `e76d67a`).
- Входы: решения шага 0 (`docs/devlog.md`, запись BEVN-203 «ticket»), spec BEVN-202 (разделы 2, 4.3, 4.6, 5), spec EXT-150
  (5.5, 5.6, 6.2), аудит BEVN-003 (SEC-1, SEC-2, CORR-3, PERF-1, FE-1, FE-6), issues BEVN-205 (#11) и EXT-152 (#21).
- Статус: черновик на ревью пользователя, 2026-10-10.

Обозначения: **[подтверждено]** — чтением кода, запуском или тестом; **[предполагаю]** — проверка названа в разделе 7.

## 1. Цель и Definition of Done

Участник видит все свои регистрации на конференции в одном месте: название конференции, даты, статус и кнопку отмены.
Отмена запускает ту же логику продвижения из списка ожидания, что и BEVN-202.

| Пункт DoD (issue #10)                                                                           | Где в spec |
| ----------------------------------------------------------------------------------------------- | ---------- |
| `GET /api/attendees/{email}/registrations` returns all registrations with conference context    | 4.1, 4.2   |
| Dashboard page accessible at `/dashboard` with an email input to look up registrations          | 6.2        |
| Each registration shows conference name, dates, status                                          | 6.2        |
| Confirmed registrations have a cancel button; cancelled ones are read-only                      | 4.3, 6.2   |
| Cancellation refreshes the list                                                                 | 6.2        |
| Empty state shown when no registrations found for the email                                     | 6.2        |
| (текст задачи) Cancellation triggers the same waitlist promotion logic as BEVN-202               | 2, 5.2     |

Дополнительный DoD пилота (журнал оператора по шагам) выполняется в `docs/devlog.md`, не в коде.

## 2. Модель предметной области

- **Регистрация на конференцию** получает второй статус: `CONFIRMED` | `CANCELLED`. Отмена мягкая: строка остаётся.
- **Одна строка на пару «конференция — участник»** (уникальный индекс не меняется). Повторная регистрация после отмены
  возвращает ту же строку в `CONFIRMED` (4.5); на дашборде одна строка на конференцию.
- **У конференции нет списка ожидания** (как в BEVN-202, раздел 2). «Та же логика продвижения» — это каскад на сессии:
  отмена регистрации на конференцию снимает все активные записи участника (`CONFIRMED`, `WAITLISTED`) на сессии этой
  конференции, **включая уже начавшиеся сессии**; затем в каждой сессии, где запись открыта (spec BEVN-202, 4.4),
  освободившиеся места занимает очередь. Сначала снять, потом продвигать.
- **Новый инвариант:** активная запись на сессию ⇒ у участника `CONFIRMED`-регистрация на конференцию этой сессии.
  Держат его два места под одной блокировкой конференции: каскад отмены (5.2) и проверка `readJoinState` при записи
  на сессию (BEVN-202, ищет только `status: 'CONFIRMED'` **[подтверждено]**). Инвариант BEVN-202 («очередь не пуста ⇒
  сессия заполнена, пока запись открыта») сохраняется: продвижение идёт в той же транзакции.
- **Отменять можно**, пока конференция `UPCOMING` или `ACTIVE` (`isRegistrationOpen`, как у регистрации).
  На `COMPLETED` и `CANCELLED` — `409 REGISTRATION_CLOSED`.
- **Личность = email без подтверждения**, как во всём API (SEC-2). Это блокер продакшна, раздел 9.

## 3. Данные

### 3.1 Миграция `20261010000000_bevn203_registration_cancel`

```sql
ALTER TABLE "registrations"
    DROP CONSTRAINT "CK_registrations_Status",
    ADD CONSTRAINT "CK_registrations_Status" CHECK ("Status" IN ('CONFIRMED', 'CANCELLED'));
```

Одна инструкция `ALTER TABLE`, а не две (поправка 2026-10-11): `prisma migrate deploy` 7.10 на PostgreSQL 14 не откатывает
выполненные инструкции миграции, если следующая падает **[подтверждено пробой]** — две инструкции оставили бы таблицу без CHECK
при сбое `ADD`. Действия одной инструкции Postgres применяет атомарно **[подтверждено пробой]**.

Больше ничего не меняется:

- полный уникальный индекс `UQ_registrations_ConferenceId_AttendeeId` остаётся — на пару одна строка, её и оживляем;
  частичный индекс не нужен;
- `IX_registrations_AttendeeId` уже есть — им идёт поиск по участнику **[подтверждено]**;
- `schema.prisma` не меняется (CHECK в Prisma не описывается); `migrate diff` после миграции — без дрейфа.

Имя ограничения прежнее: тест набора ограничений (`schema.e2e-spec.ts`) его находит.

### 3.2 Решения по данным

- `RegisteredAt` при оживлении = момент повторной регистрации (`Clock`), не первой.
- Имя участника при повторной регистрации не меняется (CORR-3, как для существующего участника сейчас).
- Записи на сессии при оживлении не восстанавливаются: участник записывается заново.
- Побочный эффект: в `GET /api/conferences/{id}/registrations` (сортировка по `id`) восстановленная строка остаётся
  на прежнем месте, а не в конце.

## 4. HTTP API

### 4.1 Эндпоинты

| Метод и путь                                              | Успех                                        | Ошибки             |
| --------------------------------------------------------- | -------------------------------------------- | ------------------ |
| `GET /api/attendees/{email}/registrations`                 | `200 AttendeeRegistrationResponse[]`         | 400, 503           |
| `POST /api/attendees/{email}/registrations/{id}/cancel`    | `200 AttendeeRegistrationResponse`           | 400, 404, 409, 415, 503 |

`AttendeeRegistrationResponse`:

```json
{ "id": 7, "status": "CONFIRMED", "registeredAt": "2026-10-10T09:00:00.000Z",
  "conference": { "id": 2, "title": "CloudOps Days", "startDate": "2027-03-05T00:00:00", "endDate": "2027-03-06T00:00:00",
                  "status": "UPCOMING", "...": "остальные поля ConferenceSummaryResponse" } }
```

- Без `attendeeId`, `conferenceId` (есть в `conference.id`) и без email (SEC-1).
- `status` — `enum ['CONFIRMED', 'CANCELLED']`; тот же `enum` получает `status` в `RegistrationSummaryResponse`.
- `cancel` тела не принимает, но требует `Content-Type: application/json`, как любой `POST` под `/api/`
  (`contentTypeMiddleware`, иначе `415` **[подтверждено чтением]**); фронтенд шлёт `{}`. В Swagger это сказано в описании.
- Маршруты добавляются в `API_ROUTES` (`/api/attendees/{email}/registrations` — `GET`;
  `/api/attendees/{email}/registrations/{id}/cancel` — `POST`): `405` с `Allow` работает для них, как для остальных.

### 4.2 `GET`

- Неизвестный email и участник без регистраций — `200 []`; неверный email — `400` (поле `email`, 4.4).
- Сортировка: `conference.startDate` по возрастанию, при равенстве — `id`.
- Возвращаются и `CONFIRMED`, и `CANCELLED`.
- Два запроса при любом числе регистраций: участник по email, затем регистрации с конференциями (PERF-1).

### 4.3 `cancel`: порядок проверок

Первая не пройденная проверка отвечает:

1. `404` — регистрации с этим `id` нет или она принадлежит другому email; одно сообщение на оба случая
   (`Registration {id} not found for this email`, без email в тексте).
2. `409 REGISTRATION_CLOSED` — конференция не `UPCOMING`/`ACTIVE`.
3. `409 ALREADY_CANCELLED` — регистрация уже `CANCELLED`. Повторная отмена ничего не меняет: каскада, продвижения
   и строк лога нет.
4. Отмена, каскад, продвижение (5.2); ответ `200` с регистрацией в статусе `CANCELLED`.

### 4.4 Email в пути: `ParseEmailPipe`

Email — первый строковый параметр пути в API (остальные — id через `ParseIdPipe`), поэтому свой пайп:

- та же нормализация и проверка, что `NormalizeEmail` + `IsAsciiEmail` в DTO: общая функция, правила не копируются;
  длина ≤ 254 (`LIMITS.attendees.Email`);
- Express уже декодировал параметр: `%40` → `@`; `+` в пути остаётся `+` (не пробел);
- ошибка — `400` в формате spec EXT-150 5.6, `errors: [{ field: 'email', messages: [...] }]`; значение email
  в сообщении не повторяется.

### 4.5 `POST /api/conferences/{id}/register` — оживление

- Нет строки — как сейчас (новая регистрация).
- `CONFIRMED` — `409`, как сейчас.
- `CANCELLED` — те же проверки, что у новой (регистрация открыта, места по `maxAttendees` среди `CONFIRMED`), затем
  `update({ status: 'CONFIRMED', registeredAt: now })`. Ответ `201` с тем же `RegistrationResponse`, что у новой.

### 4.6 Поле `reason`

`CONFLICT_REASONS` дополняется `ALREADY_CANCELLED`. Описание поля в Swagger: «только на 409 эндпоинтов записи
на сессию и отмены регистрации». Остальные 409 (`register` конференции) по-прежнему без `reason`.

### 4.7 Отменённые регистрации в существующих ответах

`GET /api/conferences/{id}/registrations` и поле `registrations` в `GET /api/conferences/{id}` возвращают и
`CANCELLED` со статусом. Контракт (набор полей) не меняется.

### 4.8 Маскирование email в логе запросов

Лог запросов пишет `path: req.originalUrl` (`request-context.ts`) **[подтверждено]** — закодированный путь с query.
Перед записью каждый сегмент пути и каждая часть query-строки, где есть `@` или `%40`, заменяются на `***`
(`/[^/?]*(?:@|%40)[^/?]*/g`), независимо от префикса, хвоста и статуса: под маску попадают 200, 400, 404 на неизвестном
хвосте, 405, query-строка и искажённые пути (`//`, `%2F`, опечатка в `attendees`).
Ответ «Route not found» путь не повторяет **[подтверждено]**.

Поправка 2026-10-11 (финальное ревью ветки, решение пользователя): исходная маска по префиксу `^/api/attendees/[^/?]+`
пропускала в лог email на путях `/api/attendees//…`, `/api//attendees/…`, `/api/attendees%2F…`, `/api/attendee/…` (ответ 404)
и в `?email=…` **[подтверждено на стенде]**; исправлено в `c269d81`. Побочный эффект: query-строка с `@`/`%40` в логе
тоже маскируется.

## 5. Конкурентность, каскад, лог

### 5.1 Транзакция `cancel`

1. Вне транзакции: `registration.findFirst({ id, attendee: { email } })` → `conferenceId` или `404`. Регистрация
   не переезжает между конференциями, email участника не меняется, удаления регистраций нет — читать до блокировки
   безопасно (как `conferenceOf` в BEVN-202).
2. `lockConference` → перечитать регистрацию под блокировкой (статус).
3. Решение `decideCancelRegistration` (5.4) → `409` или продолжение.
4. `registration.update → CANCELLED`.
5. `sessionRegistration.updateMany({ attendeeId, status in ACTIVE, session: { conferenceId } } → CANCELLED)` —
   один запрос **[предполагаю]**; число снятых записей — в лог (5.3).
6. `promoteConference(tx, conference, now)` (BEVN-202): пропускает закрытые сессии, фиксированное число запросов.
7. После коммита — лог (5.3).

Сбой на любом шаге откатывает всё: регистрацию, записи на сессии, продвижения. Порядок блокировок прежний —
сначала строка конференции, как у `register`, записи на сессию, `PUT` сессии и конференции: новых дедлоков нет
**[подтверждено чтением]**.

### 5.2 Продвижение при каскаде

`promoteConference` читает очереди всей конференции, а не только затронутых сессий. По инварианту BEVN-202 в остальных
открытых сессиях свободных мест при непустой очереди нет, поэтому продвижение фактически идёт только там, где места
освободились. Если инвариант где-то был нарушен, продвижение исправит и ту сессию — это корректно; в лог она попадёт
с триггером `conference-cancel`.

Начавшиеся сессии: записи снимаются, места не заполняются (запись закрыта, как в BEVN-202).

### 5.3 Лог

После коммита, уровень INFO (`Logger.log`), без email и имён (SEC-1):

- `waitlist.promoted` — существующее событие BEVN-202; `PromotionTrigger` дополняется `'conference-cancel'`;
- новое `registration.cancelled { requestId, registrationId, attendeeId, conferenceId, sessionEntriesCancelled }`.

### 5.4 Чистые функции

По образцу `waitlist.ts`: сервис читает состояние под блокировкой, решают функции без БД.

- `decideCancelRegistration({ status, conferenceStatus }) → { ok: true } | { ok: false, reason, message }`;
- `decideRegister({ existing: null | 'CONFIRMED' | 'CANCELLED', taken, maxAttendees }) → 'create' | 'reactivate' | 409`.

## 6. Фронтенд

### 6.1 `api.js`

- `getAttendeeRegistrations(email)` → `GET /api/attendees/${encodeURIComponent(email)}/registrations`;
- `cancelRegistration(email, id)` → `POST …/registrations/${id}/cancel` с телом `{}`;
- удалить мёртвый `deleteRegistration` (на бэкенде такого маршрута нет **[подтверждено]**);
- удалить `console.log('API request:', …)` (FE-6) и заглушки `vi.spyOn(console, 'log')` в 5 тестовых файлах.

### 6.2 `/dashboard` — `pages/DashboardPage.jsx`

- Форма: `<label>` «Email», `input type="email"`, кнопка «Show registrations», отправка по Enter. Email живёт только
  в state: не в URL, не в `localStorage`.
- Состояния: начальное (подсказка), загрузка, ошибка (`ApiError` → текст по правилу EXT-151; `400` — «Enter a valid
  email address»), пусто («No registrations found for <email>.»), список.
- Список — `<ul aria-label="Registrations">`, в `<li>`:
  - название конференции — ссылка на `/conferences/{id}`;
  - даты `startDate`–`endDate`, только дата, стенное время без пересчёта поясов (как на странице конференции);
  - бейдж статуса регистрации: `CONFIRMED` → `badge--active`, `CANCELLED` → `badge--cancelled`;
  - статус конференции — только если `CANCELLED` или `COMPLETED`.
- Кнопка «Cancel registration», `aria-label="Cancel registration for <title>"`, есть у каждой `CONFIRMED`.
  Если `!isRegistrationOpen(conference.status)` — `disabled`, рядом видимая подсказка, связанная `aria-describedby`.
  У `CANCELLED` кнопки нет.
- Отмена: `window.confirm` → `cancelRegistration` → после успеха и после `409` (`ALREADY_CANCELLED`,
  `REGISTRATION_CLOSED`) список перечитывается. Сообщение — в `role="status"`, ошибка — в `role="alert"`; обе
  live-области смонтированы всегда (урок BEVN-202). Кнопка строки заблокирована, пока идёт её запрос.
- Новый поиск сбрасывает список и сообщения; ответ на устаревший запрос игнорируется (счётчик запросов, как защита
  от устаревшего state в BEVN-115).

### 6.3 `components/Navbar.jsx`

Ссылки «BrownEvents» → `/`, «Conferences» → `/`, «My registrations» → `/dashboard`; `NavLink` даёт `aria-current="page"`.
Заменяет 9 разных копий шапки в 4 страницах (в 3 — только «BrownEvents»). Побочно: на этих 3 экранах появятся две
ссылки. Замена проверена на копии фронтенда на шаге 0: 73/73 тестов, сборка зелёная.

### 6.4 Прочие правки

- `ConferenceDetailPage`: статус регистрации без подстановки `reg.status || 'CONFIRMED'`, класс бейджа по статусу (6.2).
- Ложное обещание письма (писем никогда не было: .NET-документация — «No confirmation e-mail is sent»
  **[подтверждено]**) в `RegistrationPage.jsx:67` и модалке `ConferenceDetailPage.jsx:319` заменяется на
  «You can view or cancel it under My registrations.» со ссылкой на `/dashboard`.
- `App.jsx`: маршрут `/dashboard`. `vite preview` отдаёт `index.html` на `/dashboard` (шаг 0, код vite 4.5.14);
  nginx продакшн-сборки — `try_files $uri $uri/ /index.html` (`frontend/nginx.conf:9`) **[подтверждено чтением]**;
  открытие `/dashboard` напрямую — на стенде.

## 7. Тесты

### 7.1 Unit (`npm test`, без БД)

- `decideCancelRegistration` — порядок 4.3; `decideRegister` — все ветки 4.5.
- `ParseEmailPipe` — `%40` (через тест маршрута), `+`, регистр, пробелы, не-ASCII, длина > 254, пусто.
- Маскирование пути — 200, 400, 404 на хвосте, 405, `%40`, query-строка.

### 7.2 Интеграционные (`npm run test:int`, `FixedClock`)

`test/integration/attendees.e2e-spec.ts` (новый) и дополнения к существующим:

- `GET`: сортировка, `[]` для неизвестного email, `400`, набор полей без `attendeeId` и email.
- `cancel`: регистрация → `CANCELLED`; все активные записи на сессии конференции → `CANCELLED`, включая начавшуюся;
  продвижение только в открытых сессиях; в логе `waitlist.promoted` с `trigger: 'conference-cancel'` и
  `registration.cancelled`, без `@`.
- Инвариант: после отмены у участника 0 активных записей в конференции.
- Чужой email → `404`; закрытая конференция → `409 REGISTRATION_CLOSED`; повтор → `409 ALREADY_CANCELLED`
  без изменений в БД и без `waitlist.promoted`.
- Откат: сбой после `registration.update` → регистрация и записи на сессии не изменились.
- Оживление: та же строка, `registeredAt = now`, имя прежнее, записи на сессии не восстановлены, проверка мест.
- Находка 6 критика BEVN-202: `CANCELLED`-регистрация → запись на сессию → `409 CONFERENCE_REGISTRATION_REQUIRED`.
- Схема: CHECK пропускает `CANCELLED`, отклоняет `FOO`; `migrate diff` без дрейфа.
- `query-count.e2e-spec.ts`: одинаковое число запросов у `GET` и `cancel` при 2 и 10 сессиях и регистрациях —
  подтверждает 5.1 п. 5 и сортировку одним запросом **[предполагаю]**; если `updateMany` со связанным фильтром
  окажется не одним запросом — запасной путь: прочитать id сессий конференции (+1 запрос, фиксированно).
- Утечка email в стеке `500`: принудительная ошибка Prisma в `GET` по email → в логе нет email. Если есть —
  остановиться и доложить, не чинить без решения пользователя.
- `405` для новых путей; `415` у `cancel` без `Content-Type`; Swagger: `ALREADY_CANCELLED`, `enum` статуса.
- Миграция атомарна: опровергнуто для нескольких инструкций (Prisma не оборачивает миграцию в транзакцию), подтверждено для
  одной инструкции `ALTER TABLE` — пробы на одноразовой БД (поправка 2026-10-11, 3.1).

### 7.3 Фронтенд (Vitest + Testing Library, модуль `../api` мокается)

- `DashboardPage`: начальное, пусто, список, ошибка `400`; кнопка у `CONFIRMED`, `disabled` с подсказкой на закрытой,
  нет кнопки у `CANCELLED`.
- Отмена: `confirm` отклонён → запроса нет; успех и `409` → список перечитан, сообщение в live-области.
- Устаревший ответ игнорируется; двойной клик блокирован; email не попадает в URL.
- `Navbar`: ссылки, `aria-current`. `api.js`: `encodeURIComponent`, тело `{}`. Бейдж статуса на странице конференции.
- 73 существующих теста зелёные.

### 7.4 Проверка на стенде

- Изолированный стенд (`scripts/stand.sh`), фронтенд — продакшн-сборка.
- Seed не содержит участников и регистраций **[подтверждено на шаге 0]** → скрипт данных
  `backend/scripts/bevn203-demo-data.sh` через API: участник с регистрациями в открытой, закрытой и отменённой
  конференции, записи на сессии с очередью.
- API на порту 5000 (FE-1) для браузерной проверки поднимает пользователь; шаги проверки — в плане.

### 7.5 DoD → подтверждение

| Пункт DoD                                          | Подтверждение                                         |
| -------------------------------------------------- | ----------------------------------------------------- |
| `GET …/registrations` с контекстом конференции      | 7.2 `GET`; Swagger                                    |
| `/dashboard` с полем email                          | 7.3 `DashboardPage`; стенд                            |
| Название, даты, статус                              | 7.3 список; стенд                                     |
| Кнопка у `CONFIRMED`, `CANCELLED` только для чтения | 7.3 кнопки; 7.2 `ALREADY_CANCELLED`                   |
| Отмена обновляет список                             | 7.3 отмена; стенд                                     |
| Пустое состояние                                    | 7.3 пусто; стенд                                      |
| Продвижение как в BEVN-202                          | 7.2 `cancel`, лог `conference-cancel`                 |

## 8. Структура кода

```
backend/
  prisma/migrations/20261010000000_bevn203_registration_cancel/migration.sql
  src/registrations/
    attendees.controller.ts            новый: GET и cancel под /api/attendees
    registration-rules.ts (+ .spec)    decideCancelRegistration, decideRegister
    registrations.service.ts           listForAttendee, cancel, оживление в register
  src/common/
    parse-email.pipe.ts (+ .spec)      ParseEmailPipe
    email.ts / validation.ts           общая проверка email для DTO и пайпа
    request-context.ts                 маскирование пути
    http-middleware.ts                 API_ROUTES
    errors.ts                          ALREADY_CANCELLED
  src/session-registrations/promotion.ts   PromotionTrigger + 'conference-cancel'
  src/representation/                  AttendeeRegistrationResponse, enum статуса, select
  scripts/bevn203-demo-data.sh
  test/integration/attendees.e2e-spec.ts (+ правки schema, query-count, registrations, session-registrations, logging)
frontend/src/
  components/Navbar.jsx (+ test)
  pages/DashboardPage.jsx (+ test)
  App.jsx, api.js, pages/*.jsx (Navbar, тексты, бейдж)
```

`AttendeesController` — в модуле `registrations` (тот же сервис, общая логика регистрации); отдельный модуль не нужен.

## 9. Известные ограничения

- **Блокер продакшна: нет аутентификации и авторизации (SEC-2).**
  - Участник: личность = email без подтверждения. Кто знает email, видит регистрации человека (`GET` подтверждает факт
    регистрации, хотя email не возвращает) и отменяет их. Так же открыты отмена записи на сессию (BEVN-202) и регистрация
    чужого email на конференцию. Защищать по отдельности бессмысленно: нужна проверка владения email (одноразовая
    ссылка по почте) для всех действий участника.
  - Организатор: создание и правка конференций, сессий и спикеров анонимны; нужны аккаунты и роли.
  - Решение пользователя 2026-10-10/11: в пилоте не делается — ни в BEVN-203, ни отдельными задачами.
- Стек ошибки `500` пишется в лог целиком (`exception.filter.ts`); у ошибок Prisma в тексте бывают аргументы запроса —
  проверяется тестом (7.2).
- Повторная регистрация не восстанавливает записи на сессии; восстановленная строка остаётся на старом месте
  в списке регистраций конференции (3.2).
- Каскад снимает записи на начавшиеся сессии, места в них не заполняются (5.2).
- `promoteConference` читает очереди всей конференции, а не только затронутых сессий (5.2).
- Лог отмены и продвижения может потеряться при падении процесса сразу после фиксации (как в BEVN-202).
- Не в этой задаче: SEC-2 (выше), отправка писем; FE-1; EXT-152.

## 10. Вне задачи и проверки на старте реализации

- Перед кодом: `git status` чистый, ветка `BEVN-203-registration-dashboard` — командой, не по снимку сессии.
- [предполагаю] `updateMany` со связанным фильтром — один `UPDATE … WHERE … IN (SELECT …)`; `orderBy` по полю
  конференции — один запрос. Проверки — 7.2. Миграция в транзакции — опровергнуто (3.1).
- Прямое открытие `/dashboard` в продакшн-сборке (nginx, 6.4) — на стенде.
- Совместимость с BEVN-205: роли и подписи из 6.2; демо-данные из 7.4 пригодятся для e2e.
