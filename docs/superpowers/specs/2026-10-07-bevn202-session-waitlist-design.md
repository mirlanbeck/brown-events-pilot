# BEVN-202 — список ожидания на сессию (Session Waitlist): спецификация

- Задача: [issue #9](https://github.com/mirlanbeck/brown-events-pilot/issues/9), первоисточник —
  `rolling-scopes-school/ai-native`, `test-task/tasks/BEVN-202-session-waitlist.md` (тексты совпадают, шаг 0).
- Ветка: `BEVN-202-session-waitlist` (от `main` после EXT-151, `0f19def`).
- Входы: spec EXT-150 (разделы 5.5, 5.6, 6.1, 6.2, 8), аудит BEVN-003, issues BEVN-203 (#10) и BEVN-205 (#11) — на них
  проверена совместимость решений; EXT-151 (#19) — `ApiError` и правило статуса на фронтенде.
- Статус: утверждён пользователем 2026-10-07.

Обозначения: **[подтверждено]** — чтением кода, запуском или тестом; **[предполагаю]** — проверка названа в разделе 10.

## 1. Цель и Definition of Done

Если сессия заполнена, участник может встать в список ожидания. Когда подтверждённая запись отменяется, первый из списка автоматически получает место, и это пишется в лог. Страница сессии показывает число записанных, вместимость и длину списка.

| Пункт DoD (issue #9)                                                             | Где в spec |
| -------------------------------------------------------------------------------- | ---------- |
| `POST /api/sessions/{id}/waitlist` adds an attendee to the waitlist              | 4.1, 4.2   |
| Registering for a session at capacity returns 409 — does not auto-waitlist       | 4.2        |
| Cancelling a confirmed registration triggers automatic promotion                 | 4.3, 5.2   |
| Promotion is logged at INFO level with attendee ID and session ID                | 5.3        |
| `GET /api/sessions/{id}` includes `registeredCount`, `capacity`, `waitlistCount` | 4.1        |
| Session detail page shows capacity and waitlist count                            | 6          |
| Unit tests cover: join waitlist, cancel triggers promotion, waitlist ordering    | 7          |

Дополнительный DoD пилота (журнал оператора по шагам) выполняется в `docs/devlog.md`, не в коде.

## 2. Модель предметной области

- **Запись на сессию** — отдельная сущность, а не поле регистрации на конференцию. Участник может записаться на несколько сессий одной конференции (сессии бывают подряд).
- Записаться на сессию или встать в её список ожидания можно только при **подтверждённой регистрации на конференцию** этой сессии.
- Статусы записи: `CONFIRMED` (место), `WAITLISTED` (список ожидания), `CANCELLED` (мягкая отмена: строка остаётся).
- **Два независимых уровня вместимости:** `maxAttendees` конференции ограничивает регистрации на конференцию (как сейчас, списка ожидания конференции нет); `capacity` сессии ограничивает подтверждённые записи на сессию, список ожидания — у каждой сессии свой. Проверок, связывающих уровни, нет.
- **Нет пересекающихся сессий у участника** в пределах одной конференции: интервалы `[startTime, endTime)` (встык — можно), учитываются записи `CONFIRMED` и `WAITLISTED`. Между конференциями не проверяется: время хранится без пояса (spec EXT-150, 5.5),
  сравнение разных площадок было бы неверным.
- **Инвариант:** пока запись на сессию открыта (4.4), список ожидания не пуст ⇒ сессия заполнена. Освободившееся место в той же транзакции занимает первый из списка.
- Порядок списка ожидания — `(CreatedAt, Id)` по возрастанию; при равном времени раньше меньший `Id`.

## 3. Данные

### 3.1 Таблица `session_registrations`

Стиль — как у таблиц EXT-150 (имена колонок PascalCase, `IDENTITY ALWAYS`, именованные ограничения).

| Колонка      | Тип                                    | Ограничения                                                                                           |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Id`         | `INTEGER GENERATED ALWAYS AS IDENTITY` | `PK_session_registrations`                                                                            |
| `SessionId`  | `INTEGER NOT NULL`                     | `FK_session_registrations_sessions_SessionId` → `sessions`, `ON DELETE RESTRICT ON UPDATE CASCADE`    |
| `AttendeeId` | `INTEGER NOT NULL`                     | `FK_session_registrations_attendees_AttendeeId` → `attendees`, `ON DELETE RESTRICT ON UPDATE CASCADE` |
| `Status`     | `VARCHAR(20) NOT NULL`                 | `CK_session_registrations_Status`: `IN ('CONFIRMED','WAITLISTED','CANCELLED')`                        |
| `CreatedAt`  | `TIMESTAMPTZ(3) NOT NULL`              | момент записи, из `Clock`                                                                             |

Имя `CreatedAt`, а не `RegisteredAt` (как в `registrations`): для записи в списке ожидания «зарегистрирован» неверно.

Индексы:

- `UQ_session_registrations_SessionId_AttendeeId_Active` — `UNIQUE ("SessionId", "AttendeeId") WHERE "Status" <> 'CANCELLED'`:
  одна активная запись участника на сессию; после отмены — новая строка.
- `IX_session_registrations_SessionId_Status_CreatedAt` — `("SessionId", "Status", "CreatedAt", "Id")`: счётчики и первый в списке.
- `IX_session_registrations_AttendeeId` — внешний ключ и поиск пересечений.

### 3.2 Решения по данным

- Таблица `registrations` **не меняется**. Ссылки `RegistrationId` нет: регистрация на конференцию проверяется в коде под блокировкой (5.1) по `Status = 'CONFIRMED'` — ссылка гарантировала бы только существование строки, но не её статус, и дублировала бы участника и конференцию. Проверка по статусу готова к BEVN-203, где у регистраций появится `CANCELLED`.
- Счётчики **вычисляются** (`COUNT`), а не хранятся: хранимый счётчик может разойтись со строками.
- Отдельной колонки «время продвижения» нет: факт и время продвижения — в логе (5.3).
- Новые связи в моделях Prisma (`Session`, `Attendee`) не попадают в ответы: все ответы собираются явным `select` ([подтверждено] `src/representation/selects.ts`).

### 3.3 Prisma и миграция

- `schema.prisma`: модель `SessionRegistration`; в `generator client` — `previewFeatures = ["partialIndexes"]`; частичный индекс описан в схеме: `@@unique([sessionId, attendeeId], map: "UQ_session_registrations_SessionId_AttendeeId_Active", where: raw("(\"Status\")::text <> 'CANCELLED'::text"))`. [подтверждено] Prisma 7.10.0 содержит preview `partialIndexes` и синтаксис `where: raw(...)` (строки схемного движка). Условие записано в той форме, в какой Postgres хранит его в `pg_indexes`: Prisma сравнивает условие как текст, и запись `"Status" <> 'CANCELLED'` давала дрейф в `migrate diff` ([подтверждено] Task 1 плана, 2026-10-08). В миграции условие записано обычным SQL.
  Запись spec EXT-150 (6.2) «частичный unique Prisma-схема не выражает» для 7.10 неверна.
- Только сырой SQL без описания в схеме не годится: тест расхождения `schema.e2e-spec.ts` (`prisma migrate diff --exit-code`) засчитал бы индекс как дрейф ([подтверждено] чтением теста).
- Миграция `prisma/migrations/20261007000000_bevn202_session_registrations/migration.sql`: таблица, `CHECK`, индексы, внешние ключи.
- Побочный эффект: compose применит миграцию к dev-базе при следующем `up` (сервис `migrate`); данные не теряются.

## 4. HTTP API

### 4.1 Эндпоинты

Тело трёх `POST` — `SessionAttendeeDto`: `{ "email": string }` с теми же декораторами, что у `RegisterAttendeeDto.email` (`NormalizeEmail`, `IsAsciiEmail`); лишние поля → `400` (строгий `ValidationPipe`, spec EXT-150, 5.4).

| Запрос                             | Успех | Тело ответа                                                                      |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `POST /api/sessions/{id}/register` | `201` | `SessionRegistrationResponse` со `status: "CONFIRMED"`                           |
| `POST /api/sessions/{id}/waitlist` | `201` | то же, `status: "WAITLISTED"`                                                    |
| `POST /api/sessions/{id}/cancel`   | `200` | то же, `status: "CANCELLED"`                                                     |
| `GET /api/sessions/{id}`           | `200` | `SessionDetailResponse` = `SessionResponse` + `registeredCount`, `waitlistCount` |

- `SessionRegistrationResponse`: `{ id, sessionId, attendeeId, status, createdAt }`, `createdAt` — ISO-момент (`formatInstant`).
  Имён и email нет (SEC-1). `Location` не отдаётся — как у `POST /api/conferences/{id}/register`.
- `registeredCount` — число `CONFIRMED`, `waitlistCount` — число `WAITLISTED`; `capacity` в ответе уже есть.
- `SessionDetailResponse` возвращает **только** `GET /api/sessions/{id}`. `PUT /api/sessions/{id}`, `POST /api/conferences/{id}/sessions`
  и список `GET /api/conferences/{id}/sessions` отвечают прежним `SessionResponse` (тест списка сверяет точный набор полей —
  [подтверждено] `sessions.e2e-spec.ts:29`).
- Неверный id и неверное тело дают `400` раньше `404` (пайпы Nest до сервиса) — как во всём API.

### 4.2 Register и waitlist: порядок проверок

Одна транзакция под блокировкой конференции (5.1). Ответ — первая нарушенная проверка:

1. Сессии нет → `404`.
2. Запись закрыта (4.4: конференция не `UPCOMING`/`ACTIVE` или сессия началась) → `409 REGISTRATION_CLOSED`.
3. Нет участника с таким email или нет его регистрации `CONFIRMED` на конференцию сессии → `409 CONFERENCE_REGISTRATION_REQUIRED` (неизвестный email — тот же ответ).
4. Есть активная запись на эту сессию → `409 ALREADY_REGISTERED`; `message` различает «записан» и «в списке ожидания».
5. Пересечение с активной записью участника на другую сессию той же конференции → `409 SESSION_OVERLAP`.
6. Места: register при `registeredCount >= capacity` → `409 SESSION_FULL` (в список ожидания автоматически не ставится); waitlist при `registeredCount < capacity` → `409 SEATS_AVAILABLE`.

Успех: вставка строки со статусом `CONFIRMED` или `WAITLISTED`, `CreatedAt = clock.now()`.

### 4.3 Cancel

1. Сессии нет → `404`.
2. Запись закрыта (как в 4.2, п. 2) → `409 REGISTRATION_CLOSED`. Отмена на конференции `CANCELLED`/`COMPLETED` тоже `409` —
   сознательно: изменения записей закрытой конференции не нужны.
3. Нет активной записи этого email на эту сессию → `404` (неизвестный email — тот же ответ). Повторная отмена → `404`.
4. `Status = 'CANCELLED'`. Если запись была `CONFIRMED` — продвижение (5.2) в той же транзакции.

Регистрацию на конференцию отмена не проверяет.

### 4.4 Когда запись открыта

Запись (register, waitlist, cancel) открыта, если `isRegistrationOpen(computeStatus(...))` конференции истинно **и** `clock.now() < session.startTime`. Сравнение — по правилу spec EXT-150, 6.1: время сессии без пояса трактуется как UTC. Следствие: закрытие сдвинуто на смещение пояса площадки **в обе стороны** — восточнее UTC позже (Амстердам: на 1–2 ч, можно записаться на идущую сессию), западнее раньше (Нью-Йорк: на 4–5 ч до начала).

### 4.5 `PUT /api/sessions/{id}`

В существующей транзакции (уже блокирует конференцию):

- новая `capacity` < `registeredCount` → `422`, поле `capacity`: `capacity must not be below the number of confirmed registrations (N)`. Вместе с проверкой зала (`capacity must not exceed the room capacity`) — в одном массиве `errors` (как собирает `checkRules`);
- `capacity` выросла и запись открыта (4.4) → продвижение (5.2) с `trigger: capacity`. После начала сессии продвижения нет — на странице возможны свободные места при непустом списке ожидания; это ожидаемо.
- Перенос времени сессии пересечения у записанных **не перепроверяет** (ограничение, 9).

### 4.6 Поле `reason` в ошибке

- Тело ошибки (spec EXT-150, 5.6) получает необязательное поле: `{ statusCode, error, message, requestId, reason?, errors? }`.
- Значения: `REGISTRATION_CLOSED`, `CONFERENCE_REGISTRATION_REQUIRED`, `ALREADY_REGISTERED`, `SESSION_OVERLAP`, `SESSION_FULL`, `SEATS_AVAILABLE`. Его получают только новые `409` из 4.2–4.3; существующие `409` регистрации на конференцию не меняются.
- Реализация: `ApiError` (`src/common/errors.ts`) и `ErrorSpec` получают `reason?`; `conflict(message, reason?)`; фильтр ошибок передаёт `reason`; `errorBody` (`src/common/write-error.ts`) добавляет поле только если оно задано.
- Нарушение частичного уникального индекса под блокировкой невозможно; если случится — существующий `mapDbError` вернёт общий `409` без `reason`.

### 4.7 Маршруты и Swagger

- `API_ROUTES` (`src/common/http-middleware.ts`): три пути `POST` — `/api/sessions/{id}/register`, `/waitlist`, `/cancel`; `GET` на них → `405`.
- Swagger: операции `Sessions_Register`, `Sessions_JoinWaitlist`, `Sessions_Cancel` с summary, примерами тела и примерами ошибок; у каждой — свои примеры `409` с `reason` (общий пример `409` в `api-errors.decorator.ts` описывает регистрацию на конференцию). `ErrorResponse` — поле `reason` со списком значений. `SessionDetailResponse` — для `Sessions_GetById`.

## 5. Конкурентность, продвижение, лог

### 5.1 Транзакции и блокировка

- Register, waitlist, cancel и `PUT` сессии: до транзакции читается **только** `conferenceId` сессии (у сессии он не меняется, `PUT` его не принимает). Затем — транзакция: `lockConference` → **повторное чтение сессии** → проверки → запись.
  Чтение `capacity`/времени до блокировки дало бы гонку с параллельным `PUT`.
- Решение опирается на уровень изоляции READ COMMITTED (в коде не задан — действует умолчание Postgres; [предполагаю], что `default_transaction_isolation` на сервере не изменён): после получения блокировки каждый запрос видит зафиксированное предыдущим владельцем.
- Одна блокировка на транзакцию — взаимных блокировок нет. Все записи в пределах конференции идут по очереди: регистрация на конференцию, `PUT` конференции и сессии берут ту же блокировку.
- Тайм-ауты прежние: `lock_timeout` 2 с → `503` + `Retry-After`; транзакция `maxWait` 2 с, `timeout` 5 с; `statement_timeout`.

### 5.2 Продвижение

`promoteFromWaitlist(tx, session)` в `promotion.ts`: пока `registeredCount < capacity` и список ожидания не пуст — первый по `(CreatedAt, Id)` получает `CONFIRMED`. Возвращает список продвинутых `{ registrationId, attendeeId, sessionId }`. Вызывается из cancel и из `PUT`
сессии; BEVN-203 вызовет её из каскадной отмены конференции.

- Если продвижение падает — откатывается и отмена: состояния «отменили, но не продвинули» нет.
- Пересечения при продвижении не перепроверяются: место в списке уже участвовало в проверке (4.2, п. 5). Исключение — перенос
  времени сессии (4.5), см. ограничения.

### 5.3 Лог продвижения

- Пишется **после** фиксации транзакции: транзакция возвращает список продвинутых, сервис логирует его. Откат не оставляет записи о продвижении, которого не было.
- Одна функция `logPromotions(promoted, trigger)` в `promotion.ts` для cancel и `PUT`:
  `new Logger('Waitlist').log({ event: 'waitlist.promoted', requestId, sessionId, attendeeId, registrationId, trigger })`, `trigger` — `cancel` или `capacity`; `requestId` — из `requestContext` (как в SQL-логе `prisma.service.ts`).
- **INFO = уровень `log` Nest.** У Nest нет уровня `info`; [подтверждено] запуском: `ConsoleLogger({ json: true })` пишет `"level":"log"`. Формат логгера не меняется (иначе изменится уровень всех существующих логов).
- Email и имена в лог не попадают (SEC-1).

## 6. Фронтенд

### 6.1 API-клиент (`frontend/src/api.js`)

`registerForSession(id, email)`, `joinWaitlist(id, email)`, `cancelSessionRegistration(id, email)` поверх `request()`; ошибки — `ApiError` из EXT-151, причина — `err.body?.reason`.

### 6.2 Страница сессии (`SessionDetailPage.jsx`)

- Шапка: «👥 {registeredCount} / {capacity} registered» и «⏳ Waitlist: {waitlistCount}»; `0` выводится (проверка `!= null`, не `&&`, FE-7). Заменяет «Capacity: N».
- Загрузка вынесена в `loadSession()`: ошибка сбрасывается перед загрузкой; устаревшие ответы (смена `sessionId`) отбрасываются (FE-4).
  Спиннер и экран ошибки — только при первой загрузке; после действия — **тихое обновление**: данные остаются на экране, при неудаче —
  уведомление в панели.
- Нижняя кнопка регистрации на конференцию (правило EXT-151) переименована в **«Register for conference»**.

### 6.3 `components/SessionRegistrationPanel.jsx`

- Видна, только если `isRegistrationOpen(session.conference.status)` (`conferenceStatus.js`). Время начала сессии фронт не проверяет (браузер трактовал бы время без пояса иначе, чем бэкенд, 4.4) — после начала бэкенд ответит `409 REGISTRATION_CLOSED`.
- Поле email: `<label htmlFor>`, `type="email" required` (FE-12).
- Кнопки: **Register for session** при `registeredCount < capacity`, иначе **Join waitlist**; **Cancel my registration** — всегда.
  На время запроса все кнопки неактивны.
- Ответы:

| Ответ                              | Сообщение                                                                                 | Действие                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| успех register                     | «You are registered for this session.»                                                    | тихое обновление                   |
| успех waitlist                     | «You are on the waitlist.»                                                                | тихое обновление                   |
| успех cancel                       | «Your registration or waitlist place is cancelled.»                                       | тихое обновление                   |
| `CONFERENCE_REGISTRATION_REQUIRED` | `message` + кнопки **Register for conference** (`/conferences/{id}/register`) и **Close** | Close убирает сообщение            |
| `SESSION_FULL`, `SEATS_AVAILABLE`  | `message`                                                                                 | тихое обновление — кнопка сменится |
| прочие ошибки                      | `message` (`ApiError`)                                                                    | —                                  |

- Успех — `role="status"`, ошибка — `role="alert"`. Email остаётся в поле.

## 7. Тесты

### 7.1 Unit (`npm test`, без БД)

- `src/session-registrations/waitlist.spec.ts`: пересечение `[start, end)` (встык — нет); решение register/waitlist — каждый `reason` и порядок проверок; число мест для заполнения; следующий в списке — `(createdAt, id)`, равное время; решение cancel —
  `CONFIRMED` продвигает, `WAITLISTED` нет.
- `exception.filter.spec.ts` и тест `errorBody`: `reason` попадает в тело; без `reason` поля нет.

### 7.2 Интеграционные (`npm run test:int`, `test/integration/session-registrations.e2e-spec.ts`, `FixedClock`)

- Успехи трёх эндпоинтов; счётчики в `GET /api/sessions/{id}`.
- Все шесть `409` с `reason`; `404` (нет сессии; нет активной записи); `400` (неверный email, лишнее поле).
- Отмена → `CONFIRMED` получает первый в списке; лог (`CapturingLogger`, как `logging.e2e-spec.ts`): `level` `log`, `attendeeId`, `sessionId`, `trigger`.
- `PUT`: `capacity` ниже `registeredCount` → `422`; рост → продвижение, `trigger: capacity`.
- Закрытие: `FixedClock` после `startTime`; конференция `COMPLETED` и `CANCELLED`.
- Повторная запись после отмены — новая строка.
- **Гонки** — приёмом `whileTableLocked` (`registrations.e2e-spec.ts`: тестовая транзакция держит блокировку таблицы `session_registrations`, пропускающую чтение и задерживающую вставку): последнее место — ровно один `201`; один участник, пересекающиеся сессии — проходит одна запись. **Мутационная проверка:** без `lockConference` тесты гонок красные.
- Не покрыто тестом: «откат транзакции → нет записи в логе» (нужен искусственный сбой); обеспечено структурой (5.3), проверяется ревью.

### 7.3 Защитные тесты EXT-150 — осознанные изменения

| Тест                                                             | Изменение                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `swagger.e2e-spec` «exactly the operations of the .NET document» | ожидание: операции .NET-документа + список трёх новых; эталонный `swagger.json` не трогается |
| `swagger.e2e-spec`, сверка с 405                                 | через `API_ROUTES` (4.7)                                                                     |
| `swagger.e2e-spec`, примеры                                      | новые операции проходят «summary, примеры ошибок, примеры тела»                              |
| `schema.e2e-spec`                                                | новая таблица в списке `GENERATED ALWAYS`; новые имена ограничений и индексов; дрейф — 0     |
| `query-count.e2e-spec`                                           | `GET /api/sessions/{id}` и новые эндпоинты — число запросов не зависит от объёма данных      |
| `scripts/compare-reference.ts`                                   | ожидаемое отличие в A10 (новые поля); в CI не запускается ([подтверждено] `ci.yml`)          |

### 7.4 Фронтенд (Vitest, модуль `../api` мокается)

Счётчики, включая `0`; выбор кнопки; кнопки неактивны во время запроса; тихое обновление после успеха и уведомление при его неудаче; отбрасывание устаревшего ответа; нейтральное сообщение отмены; `CONFERENCE_REGISTRATION_REQUIRED` — две кнопки, Close убирает сообщение; `SESSION_FULL` — обновление; закрытая конференция — панели нет; «Register for conference». `api.test.js` — URL, метод и тело трёх функций. Существующие моки `./api` (`registrationVisibility.test.jsx` и др.) дополняются новыми функциями.

### 7.5 DoD → подтверждение

| Пункт DoD                                              | Unit               | Интеграционные                      | Фронтенд-тесты |
| ------------------------------------------------------ | ------------------ | ----------------------------------- | -------------- |
| waitlist добавляет в список                            | решение waitlist   | успех и отказы                      | —              |
| register при заполненной → 409, без авто-списка        | решение register   | `SESSION_FULL`, список не изменился | —              |
| отмена продвигает следующего                           | решение cancel     | первый в списке → `CONFIRMED`       | —              |
| лог INFO с attendeeId и sessionId                      | —                  | `CapturingLogger`                   | —              |
| `GET` с `registeredCount`, `capacity`, `waitlistCount` | —                  | ✔                                   | —              |
| страница показывает вместимость и список               | —                  | —                                   | ✔              |
| unit: вход в список, отмена → продвижение, порядок     | `waitlist.spec.ts` | —                                   | —              |

Проверку в браузере (продакшн-сборка, изолированный стенд) проводит пользователь на шаге плана, где агент останавливается и даёт команды и чек-лист.

## 8. Структура кода

```
backend/src/session-registrations/
  waitlist.ts                          чистые функции: пересечение, решения register/waitlist/cancel, места, порядок
  waitlist.spec.ts
  promotion.ts                         promoteFromWaitlist(tx, session), logPromotions(promoted, trigger)
  session-registrations.service.ts     транзакции: чтение состояния → чистые функции → запись → лог
  session-registrations.controller.ts  POST sessions/:id/register | waitlist | cancel
  session-registrations.module.ts
  session-attendee.dto.ts
backend/src/sessions/                  get → SessionDetailResponse; update → проверка capacity и продвижение
backend/src/representation/            SessionDetailResponse, SessionRegistrationResponse, ErrorResponse.reason, маппер
backend/src/common/                    ApiError/ErrorSpec/errorBody: reason; API_ROUTES
frontend/src/                          api.js, pages/SessionDetailPage.jsx, components/SessionRegistrationPanel.jsx
```

`promotion.ts` — функции, а не метод сервиса: `SessionsService` вызывает их из `PUT` без циклической зависимости модулей.

## 9. Известные ограничения

- Аутентификации нет (SEC-2): отменить чужую запись может любой, кто знает email. `ALREADY_REGISTERED` и `attendeeId` в ответе раскрывают столько же, сколько уже раскрывает регистрация на конференцию.
- Перенос времени сессии (`PUT`) не перепроверяет пересечения у записанных; продвижение их тоже не проверяет — в редком случае участник получит пересекающиеся записи.
- Пересечения между разными конференциями не проверяются.
- Закрытие записи сдвинуто на пояс площадки в обе стороны (4.4).
- Рост `capacity` после начала сессии не продвигает список ожидания.
- Отмена конференции (`CANCELLED`) записи на сессии не трогает.
- Лог продвижения может потеряться при падении процесса сразу после фиксации транзакции.
- `partialIndexes` — preview-функция Prisma, может измениться при обновлении; текст условия в схеме привязан к форме, в которой его хранит Postgres 14 — при обновлении Postgres или Prisma тест дрейфа может покраснеть.
- Не в этой задаче: `sessionId` модалки регистрации по-прежнему «принимается, не сохраняется»; счётчиков нет в списке сессий;
  FE-13; email спикера на странице сессии.

## 10. Вне задачи и проверки на старте реализации

- Вне задачи: каскадная отмена конференции — BEVN-203 (требование: снимать записи на сессии **до** продвижения); уведомления участникам; номер места в списке ожидания.
- Для BEVN-205 (заготовка, ничего не делается): e2e-сценарий «заполнить сессию» может уменьшить `capacity` через `PUT` (в seed — около 200).
- Первым шагом плана: [подтверждено] с уточнением: `prisma migrate diff` создаёт и сравнивает частичный индекс для Postgres без дрейфа — при условии в форме Postgres (3.3), проверено на тестовой базе (`backend/scripts/test-db.sh`) в Task 1 плана 2026-10-08.
- [предполагаю] Vitest падает на импорте функции, отсутствующей в моке модуля, — проверяется первым запуском фронтенд-тестов.
