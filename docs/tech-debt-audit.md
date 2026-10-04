# Аудит технического долга (BEVN-003)

Аудит бэкенда (`backend/`) и фронтенда (`frontend/`) BrownEvents на коммите `4648408`. Код в рамках задачи не менялся. Находки — вход для этапа стабилизации и для миграции бэкенда на NestJS (EXT-150), поэтому исправления сформулированы так, чтобы их можно было применить в новой реализации; где полезно, дана подсказка для NestJS.

**Как читать**

- **Severity.**
  **High** — порча/потеря данных, утечка персональных данных, отказ сервиса (ошибки `500` до перезапуска, оборванные ответы), сбои при обычной нагрузке, дыра, доступная анонимно.
  **Medium** — неверное поведение в реальном сценарии без порчи данных, заметная деградация производительности, нарушение контракта, ломающее клиента.
  **Low** — несогласованность, мёртвый код, удобство разработки, документация.
- **Проверка** — откуда известно, что проблема есть:
  - `✔ запрос` — воспроизведено запросом к API на изолированном стенде (см. [«Как проверялось»](#как-проверялось));
  - `✔ BEVN-002` — воспроизведено запросами при документировании API (раздел «Known issues» в [ApiDocumentation.cs](../backend/BrownEvents.Api/Swagger/ApiDocumentation.cs#L48-L58) и запись BEVN-002 в [devlog](devlog.md));
  - `✔ код` — видно непосредственно в коде/конфигурации, runtime не нужен;
  - `~ вывод` — следует из кода, но не воспроизводилось; рядом сказано, почему так считается.
- Ссылки `файл#Lnn` ведут на строки в текущем коде.

## Сводка

54 находки: **8 High, 29 Medium, 17 Low**. Бэкенд и инфраструктура — 41, фронтенд — 13. Три находки и несколько дополнений к существующим пришли из слепого аудита (см. [«Как проверялось»](#как-проверялось)).

| ID | Sev | Кратко | Где | Проверка |
|---|---|---|---|---|
| [REL-1](#rel-1) | High | `DbContext` — Singleton: параллельные запросы падают с `500` | Program.cs:15 | ✔ запрос |
| [REL-2](#rel-2) | High | После одной ошибки записи все записи — `500` до перезапуска | Program.cs:15 | ✔ запрос, ✔ BEVN-002 |
| [REL-3](#rel-3) | High | Ответ обрывается после `200 OK` (граф глубже 32) | Program.cs:29-33 | ✔ BEVN-002 |
| [REL-4](#rel-4) | Medium | Данные, изменённые мимо API, не видны до перезапуска | Program.cs:15 | ✔ запрос, ✔ BEVN-002 |
| [REL-5](#rel-5) | Medium | Регистрация без транзакции: остаются «осиротевшие» участники | RegistrationService.cs:22-42 | ✔ запрос |
| [PERF-1](#perf-1) | High | Lazy loading при сериализации: N+1 и вся БД в каждом ответе | Program.cs:19 | ✔ запрос |
| [PERF-2](#perf-2) | Medium | Трекер изменений копит все прочитанные сущности (рост памяти) | ConferenceService.cs:18 | ✔ код, ~ вывод |
| [PERF-3](#perf-3) | Medium | Списки без пагинации и ограничений | ConferenceService.cs:16-19 | ✔ код |
| [ASYNC-1](#async-1) | Medium | `.FindAsync(id).Result` — блокировка потока в «async»-методах | ConferenceService.cs:23 | ✔ код |
| [ASYNC-2](#async-2) | Medium | Синхронный `FirstOrDefault` в async-методе регистрации | RegistrationService.cs:19 | ✔ код |
| [ASYNC-3](#async-3) | Medium | Ленивая загрузка — синхронный I/O внутри JSON-сериализации | Program.cs:19 | ✔ запрос |
| [ASYNC-4](#async-4) | Low | Синхронные вызовы БД при старте | Program.cs:91 | ✔ код |
| [ASYNC-5](#async-5) | Low | `CancellationToken` не передаётся: прерванные запросы продолжают работу | Controllers/, Services/ | ✔ код |
| [CORR-1](#corr-1) | High | Регистрация без проверок: дубли, лимит мест, несуществующая конференция | RegistrationService.cs:15-45 | ✔ запрос |
| [CORR-2](#corr-2) | Medium | Нет уникальных ограничений в БД (email, пара конференция–участник) | AppDbContext.cs:47-55 | ✔ запрос |
| [CORR-3](#corr-3) | Medium | Участник ищется по email с учётом регистра; новое имя игнорируется | RegistrationService.cs:19 | ✔ запрос |
| [CORR-4](#corr-4) | Medium | Нет валидации входных данных | ConferencesController.cs:11 | ✔ запрос |
| [CORR-5](#corr-5) | Medium | `PUT` молча обнуляет пропущенные поля | ConferenceService.cs:39-48 | ✔ BEVN-002 |
| [CORR-6](#corr-6) | Medium | `"status": null` → `500` и частично применённое изменение | ConferenceService.cs:45 | ✔ BEVN-002 |
| [CORR-7](#corr-7) | Medium | Ошибки клиента отдаются как `500`/`200 []` вместо `4xx` | ConferencesController.cs:131-135 | ✔ запрос |
| [CORR-8](#corr-8) | Medium | Даты без часового пояса, смешение UTC и времени сервера | Program.cs:10 | ✔ BEVN-002 |
| [CORR-9](#corr-9) | Low | `Status` — свободная строка, нормализуется непоследовательно | ConferenceService.cs:27-32 | ✔ запрос |
| [CORR-10](#corr-10) | Low | Статус конференции не зависит от дат; демо-данные устарели | DataSeeder.cs:50-65 | ✔ код |
| [SEC-1](#sec-1) | High | Утечка персональных данных (email) через публичные ответы | Program.cs:19 | ✔ запрос |
| [SEC-2](#sec-2) | High | Нет аутентификации и авторизации | Program.cs:84-85 | ✔ запрос |
| [SEC-3](#sec-3) | High | Mass assignment: клиент создаёт вложенные сущности и задаёт `id` | ConferencesController.cs:80 | ✔ запрос |
| [SEC-4](#sec-4) | Medium | CORS разрешает любой origin, метод и заголовок | Program.cs:35-44 | ✔ запрос |
| [SEC-5](#sec-5) | Low | Swagger UI открыт в Production | Program.cs:76-82 | ✔ запрос |
| [SEC-6](#sec-6) | Medium | Пароль БД в репозитории, порт БД опубликован на хост | appsettings.json:10 | ✔ код |
| [SEC-7](#sec-7) | Medium | Стек вне поддержки (.NET 6, Node 18), контейнеры от root | BrownEvents.Api.csproj:4 | ✔ код |
| [CFG-1](#cfg-1) | Medium | `EnsureCreated()` вместо миграций | Program.cs:91 | ✔ код |
| [CFG-2](#cfg-2) | Medium | Логирование EF не подключено; настройки логов мёртвые | Program.cs:15-22 | ✔ запрос |
| [CFG-3](#cfg-3) | Medium | Нет единой обработки ошибок | Program.cs:73-95 | ✔ запрос, ✔ BEVN-002 |
| [CFG-4](#cfg-4) | Medium | CI описан для GitLab, в GitHub-репозитории не работает | .gitlab-ci.yml | ✔ код |
| [CFG-5](#cfg-5) | Low | Сидинг демо-данных при каждом старте в любом окружении | Program.cs:87-93 | ✔ код |
| [CFG-6](#cfg-6) | Low | Нет `.dockerignore`; compose без healthcheck бэкенда | backend/BrownEvents.Api/Dockerfile:11 | ✔ код, ~ вывод |
| [MNT-1](#mnt-1) | Medium | Сущности EF — одновременно API-контракт (корень SEC-1/SEC-3/PERF-1) | Models/ | ✔ код |
| [MNT-2](#mnt-2) | Medium | Несогласованная форма ответов (`{data}` только у сессий, `200` на создание) | ConferencesController.cs:134 | ✔ код |
| [MNT-3](#mnt-3) | Low | Мелкие проблемы структуры: пустой комментарий, лишние пакеты, документация багов | RegistrationService.cs:17 | ✔ код |
| [TEST-1](#test-1) | Medium | Тесты на EF InMemory не воспроизводят прод | ConferenceServiceTests.cs:11-17 | ✔ код |
| [TEST-2](#test-2) | Medium | Регистрация, спикеры, контроллеры и фронтенд без тестов | BrownEvents.Tests/ | ✔ код |
| [FE-1](#fe-1) | Medium | Адрес API захардкожен; прокси nginx/Vite — мёртвая конфигурация | frontend/src/api.js:1 | ✔ код |
| [FE-2](#fe-2) | Medium | `request()`: заголовки затираются, `json()` на пустом теле, сырой текст ошибки | frontend/src/api.js:3-14 | ✔ код |
| [FE-3](#fe-3) | Medium | Модалка регистрации: поля теряются, список не обновляется, обещано письмо | ConferenceDetailPage.jsx:106-123 | ✔ код |
| [FE-4](#fe-4) | Low | Эффекты без отмены: гонки ответов, «залипшая» ошибка | SessionDetailPage.jsx:11-22 | ✔ код, ~ вывод |
| [FE-5](#fe-5) | Medium | Email участников и спикеров показываются в публичном UI | ConferenceDetailPage.jsx:263 | ✔ код |
| [FE-6](#fe-6) | Low | PII в `console.log` | frontend/src/api.js:4 | ✔ код |
| [FE-7](#fe-7) | Low | Ошибки рендеринга: `0` вместо скрытия, объект как текст | SessionCard.jsx:15-17 | ✔ код |
| [FE-8](#fe-8) | Low | Мёртвый/неверный код в `api.js` (`DELETE` несуществующего маршрута) | frontend/src/api.js:36-37 | ✔ код |
| [FE-9](#fe-9) | Low | Дублирование кода и раздутый компонент страницы | ConferenceDetailPage.jsx | ✔ код |
| [FE-10](#fe-10) | Low | Доступность: метки без связи с полями, кликабельный `div` | ConferenceDetailPage.jsx:313 | ✔ код |
| [FE-11](#fe-11) | Low | Нет маршрута 404 | App.jsx:10-15 | ✔ код |
| [FE-12](#fe-12) | Low | Нет линтера, тестов, проверки типов | frontend/package.json:6-10 | ✔ код |
| [FE-13](#fe-13) | Low | Страница сессии не проверяет, что сессия из конференции в URL | SessionDetailPage.jsx:6-22 | ✔ код |

## Обязательные области (Pilot focus)

### Блокирующие вызовы в async-коде — найдено 5 проблем

Проверены все `async`-методы бэкенда (поиск `.Result`, `.Wait()`, `GetAwaiter().GetResult()` и синхронных материализаторов LINQ/EF: `FirstOrDefault`, `Any`, `ToList`, `Find`, `SaveChanges`, `EnsureCreated`).

- [ASYNC-1](#async-1): `.FindAsync(id).Result` в трёх методах, обёрнутых в `Task.FromResult` — сигнатура async, исполнение синхронное.
- [ASYNC-2](#async-2): синхронный `FirstOrDefault` в `RegistrationService.RegisterAttendeeAsync`.
- [ASYNC-3](#async-3): самая массовая блокировка не видна в коде сервисов: ленивая загрузка EF выполняется синхронно, во время сериализации ответа — 19–22 синхронных SQL-запроса на один GET (замер).
- [ASYNC-4](#async-4): синхронные вызовы при старте (влияние минимальное).
- [ASYNC-5](#async-5): `CancellationToken` нигде не передаётся — отменённый клиентом запрос дорабатывает до конца.

Взаимной блокировки (deadlock) от `.Result` в ASP.NET Core нет — у него нет `SynchronizationContext`; цена — занятые потоки пула и риск голодания пула под нагрузкой (~ вывод, нагрузочный тест не проводился). Отдельно: блокирующие вызовы выполняются на общем Singleton-контексте, и параллельные запросы падают уже сейчас ([REL-1](#rel-1), ✔ запрос), независимо от голодания пула.

### Эффективность загрузки связанных данных ORM — найдено 3 проблемы (+ 2 связанные)

Как EF фактически грузит связи (замер по логу Postgres на свежем процессе, демо-данные: 3 конференции, 7 сессий, 3 спикера, 4 зала):

| Запрос | SELECT | Размер ответа |
|---|---|---|
| `GET /api/conferences/2/sessions` (2 сессии) | 22 | 199 КБ |
| `GET /api/sessions/4` | 22 | 97 КБ |
| `GET /api/conferences/2` | 21 | 129 КБ |
| `GET /api/conferences` | 19 | 338 КБ |
| `GET /api/speakers` (3 спикера) | 19 | 376 КБ |

Явной загрузки связей (`Include`, проекций) нет нигде; всё, что видит клиент, приходит через ленивые прокси во время сериализации: один основной запрос + по запросу на каждую связь, пока не обойдена вся база. В ответе на 2 сессии — 438 объектов-конференций и сессий (подсчёт по полю `title`), это 10 различных записей, то есть все конференции и сессии базы, многократно повторённые; спикер Alice повторён 72 раза. Каждый ленивый запрос открывает соединение из пула заново (в логе Postgres столько же `DISCARD ALL`, сколько `SELECT`).

- [PERF-1](#perf-1): N+1 и сериализация всего графа.
- [PERF-2](#perf-2): все чтения отслеживаются трекером Singleton-контекста.
- [PERF-3](#perf-3): нет пагинации.
- Связанные: [REL-3](#rel-3) (обрыв ответа на глубине > 32), [ASYNC-3](#async-3) (ленивая загрузка синхронна).

Индексы по внешним ключам EF создал сам (`IX_sessions_ConferenceId`, `IX_registrations_*` и др. — ✔ запрос `\di`), здесь проблем нет. Нет индекса по `attendees.Email`, по которому ищется участник при каждой регистрации, — учтено в [CORR-2](#corr-2).

### Конфигурация CORS — найдено 2 проблемы (+ 1 связанная)

Политика `AllowAll`: `AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()`, одна для всех окружений ([Program.cs:35-44](../backend/BrownEvents.Api/Program.cs#L35-L44)). Preflight с `Origin: https://evil.example` на `POST /api/conferences/2/register` → `204`, `Access-Control-Allow-Origin: *`, разрешены запрошенные метод и заголовки, в том числе `authorization` (✔ запрос).

Что **в порядке**: `AllowCredentials()` не включён, а с `*` его нельзя совместить — поэтому сейчас чужой сайт не может отправить запрос от имени пользователя с его cookie; порядок middleware корректен (`UseCors` до `MapControllers`).

- [SEC-4](#sec-4): политика слишком широкая и не зависит от окружения; при добавлении аутентификации станет дырой.
- [FE-1](#fe-1): CORS вообще не был бы нужен — фронтенд мог бы ходить через свой origin (прокси в nginx и Vite уже настроены), но `api.js` обращается к `http://localhost:5000` напрямую.
- Связанное (Low, в [FE-2](#fe-2)): `Content-Type: application/json` ставится и на `GET`, поэтому каждый запрос — с preflight; `Access-Control-Max-Age` не задан (✔ запрос: заголовка нет), preflight не кешируется. ✔ браузер: открытие страницы конференции — 3 preflight-запроса (`204`) перед 3 GET.
- Связанное ([CFG-3](#cfg-3)): ответ `500` приходит без CORS-заголовков, и фронтенд видит его как сетевую ошибку («Failed to fetch»), а не как код ошибки (✔ браузер).

## Надёжность и конкурентность

### REL-1
**High · `AppDbContext` зарегистрирован как Singleton — параллельные запросы падают с `500`**

- **Где:** [Program.cs:15-22](../backend/BrownEvents.Api/Program.cs#L15-L22); сервисы при этом Scoped ([Program.cs:24-27](../backend/BrownEvents.Api/Program.cs#L24-L27)).
- **Проверка:** ✔ запрос. На свежем процессе ровно 3 параллельных запроса, как шлёт `ConferenceDetailPage` (`/conferences/2`, `/conferences/2/sessions`, `/conferences/2/registrations`): 6 раундов из 6 — два ответа `500` (падают `GetById` и `GetSessions`), в логе `InvalidOperationException: A second operation was started on this context instance before a previous operation completed`. 30 параллельных запросов — около 50 % `500`. На «прогретом» процессе окно для гонки меньше — поиск по id (`FindAsync`) и уже загруженные связи отдаются из трекера без БД ([REL-4](#rel-4)), — но списки (`ToListAsync` у сессий и регистраций) обращаются к БД всегда, поэтому ошибка возможна при любом открытии страницы. ✔ браузер, compose-стек: после `docker compose restart backend` первое открытие `/conferences/2` — блок сессий «Failed to load sessions / Failed to fetch» (в логе бэкенда исключение в `GetSessionsAsync`); повторное открытие (F5, процесс уже прогрет) — блок регистраций «Failed to fetch» (исключение в `GetRegistrationsAsync`). Какой из запросов упадёт, зависит от гонки.
- **Что:** `DbContext` не потокобезопасен и задуман как единица работы на один запрос. Один экземпляр на всё приложение делит соединение, трекер изменений и состояние ошибок между всеми пользователями; это корень также [REL-2](#rel-2), [REL-4](#rel-4), [PERF-2](#perf-2).
- **Fix:** единица работы (контекст/трекер/транзакция) — строго на запрос; глобальным может быть только потокобезопасный пул соединений. В NestJS: `TypeOrmModule`/`DataSource` с репозиториями (без собственного глобального identity map) или `PrismaService` — оба stateless поверх пула; транзакции через `dataSource.transaction()` / `prisma.$transaction()` в рамках запроса. Для .NET-патча до миграции: `AddDbContext<AppDbContext>(...)` (Scoped).

### REL-2
**High · После одной неудачной записи все последующие записи отвечают `500` до перезапуска**

- **Где:** [Program.cs:15](../backend/BrownEvents.Api/Program.cs#L15) (Singleton) + любые `SaveChangesAsync` в сервисах.
- **Проверка:** ✔ запрос, ✔ BEVN-002. `POST /api/conferences/9999/register` → `500` (FK `23503`); затем валидные `POST /api/speakers` и `POST /api/conferences/2/register` → `500`, спикер в БД не появился; `GET` продолжает работать.
- **Что:** наблюдаемое — после одной ошибки FK все записи падают до перезапуска. Механизм (~ вывод, в трекер не заглядывали): сущность, не прошедшая `SaveChanges`, остаётся в трекере общего контекста в состоянии `Added`, и каждый следующий `SaveChanges` пытается вставить её снова. Сервис «ломается» для всех пользователей одним запросом — фактически анонимный DoS ([SEC-2](#sec-2)).
- **Fix:** контекст на запрос ([REL-1](#rel-1)); проверять ссылки до вставки и отвечать `404`/`422` ([CORR-7](#corr-7)); все записи одного действия — в одной транзакции с откатом при ошибке.

### REL-3
**High · Ответы с сущностями обрываются после `200 OK`**

- **Где:** [Program.cs:29-33](../backend/BrownEvents.Api/Program.cs#L29-L33) (`IgnoreCycles`, максимальная глубина по умолчанию 32) + ленивые прокси ([PERF-1](#perf-1)).
- **Проверка:** ✔ BEVN-002: уже при 4 конференциях, 8 сессиях, 4 спикерах и 1 регистрации `GET /api/conferences/{id}` и `GET /api/sessions/{id}` обрывались, один — после 66 МБ.
- **Что:** глубина графа растёт с данными; когда превышает 32, сериализатор бросает исключение, но статус и часть тела уже отправлены — клиент получает обрыв соединения и битый JSON вместо кода ошибки.
- **Fix:** отдавать явные response-DTO фиксированной формы ([MNT-1](#mnt-1)); вложенность ограничена схемой ответа, а не данными. В NestJS: DTO-классы + `ClassSerializerInterceptor`/ручной маппинг, связи загружаются явно.

### REL-4
**Medium · Изменения в БД мимо API не видны до перезапуска**

- **Где:** [Program.cs:15](../backend/BrownEvents.Api/Program.cs#L15); `FindAsync` сначала смотрит в трекер ([ConferenceService.cs:23](../backend/BrownEvents.Api/Services/ConferenceService.cs#L23), [SessionService.cs:18](../backend/BrownEvents.Api/Services/SessionService.cs#L18)).
- **Проверка:** ✔ BEVN-002; ✔ запрос: после первого прохода по графу `GET /api/conferences/2` отработал с 0 SQL-запросами — ответ целиком из памяти.
- **Что:** отслеживаемые сущности живут всё время процесса и не перечитываются; второй экземпляр API, миграция, ручная правка, даже другой процесс сидинга — не видны.
- **Fix:** см. [REL-1](#rel-1); чтения — без отслеживания.

### REL-5
**Medium · Регистрация не атомарна: при ошибке остаётся «осиротевший» участник**

- **Где:** [RegistrationService.cs:22-42](../backend/BrownEvents.Api/Services/RegistrationService.cs#L22-L42) — два отдельных `SaveChangesAsync`.
- **Проверка:** ✔ запрос: `POST /api/conferences/9999/register` → `500`, но строка `attendees` с `orphan@x.example` создана.
- **Fix:** создание участника и регистрации — одна транзакция; существование конференции проверять до записи ([CORR-1](#corr-1)).

## Производительность и загрузка данных

### PERF-1
**High · Ленивая загрузка при сериализации: N+1 и вся база в каждом ответе**

- **Где:** [Program.cs:19](../backend/BrownEvents.Api/Program.cs#L19) (`UseLazyLoadingProxies`), `virtual`-навигации во всех [Models/](../backend/BrownEvents.Api/Models/), контроллеры отдают сущности как есть (например, [ConferencesController.cs:131-135](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L131-L135)).
- **Проверка:** ✔ браузер (compose-стек, dev-данные): `sessions` — 213 КБ на 2 сессии, конференция — 139 КБ. ✔ запрос — таблица в [Pilot focus](#эффективность-загрузки-связанных-данных-orm--найдено-3-проблемы--2-связанные): 19–22 SELECT на один GET, до 376 КБ на демо-данных; ответ на 2 сессии содержит всю БД.
- **Что:** сериализатор читает каждую навигацию, каждое чтение — отдельный SQL; `IgnoreCycles` обрывает только циклы на текущем пути, поэтому обходится весь достижимый граф. Объём ответа растёт с размером базы, а не с запросом. Фронтенд при этом опирается на эти «побочные» данные (`speaker`, `room`, `attendee`) — при отключении lazy loading без замены UI опустеет (см. [architecture.md](architecture.md#наблюдения-для-будущих-задач)). Задача BEVN-101 (N+1 на странице сессий) — частный случай.
- **Fix:** отключить ленивую загрузку; для каждого эндпоинта явно загружать ровно нужные связи одним запросом (join/`IN`) и отдавать DTO. Контракт для фронтенда зафиксировать: сессия → `speaker {id, firstName, lastName, bio}`, `room {id, name, location, capacity}`; регистрация → минимальные данные участника (с учётом [SEC-1](#sec-1)). В NestJS: TypeORM `relations`/`QueryBuilder.leftJoinAndSelect` или Prisma `include`/`select`; lazy relations TypeORM не использовать.

### PERF-2
**Medium · Все прочитанные сущности остаются в трекере (неограниченный рост памяти)**

- **Где:** все чтения без `AsNoTracking`: [ConferenceService.cs:18](../backend/BrownEvents.Api/Services/ConferenceService.cs#L18), [:56-58](../backend/BrownEvents.Api/Services/ConferenceService.cs#L56-L58), [:71-73](../backend/BrownEvents.Api/Services/ConferenceService.cs#L71-L73), [SpeakerService.cs:18](../backend/BrownEvents.Api/Services/SpeakerService.cs#L18).
- **Проверка:** ✔ код; удержание сущностей подтверждено косвенно (0 SQL на повторный GET, [REL-4](#rel-4)); рост памяти не измерялся — ~ вывод.
- **Что:** вместе с Singleton-контекстом в памяти процесса со временем оказывается вся база.
- **Fix:** чтения без отслеживания и с проекцией в DTO; трекер — только в рамках запроса на запись.

### PERF-3
**Medium · Списки без пагинации и ограничений**

- **Где:** [ConferenceService.cs:16-19](../backend/BrownEvents.Api/Services/ConferenceService.cs#L16-L19), [:54-59](../backend/BrownEvents.Api/Services/ConferenceService.cs#L54-L59), [:69-74](../backend/BrownEvents.Api/Services/ConferenceService.cs#L69-L74), [SpeakerService.cs:16-19](../backend/BrownEvents.Api/Services/SpeakerService.cs#L16-L19).
- **Проверка:** ✔ код.
- **Fix:** `limit/offset` или курсор с максимальным размером страницы и метаданными (`total`/`next`) в едином конверте ответа ([MNT-2](#mnt-2)).

## Блокирующие вызовы в async-коде

### ASYNC-1
**Medium · `.FindAsync(id).Result` в методах с async-сигнатурой**

- **Где:** [ConferenceService.cs:21-25](../backend/BrownEvents.Api/Services/ConferenceService.cs#L21-L25) (`GetByIdAsync`), [ConferenceService.cs:36](../backend/BrownEvents.Api/Services/ConferenceService.cs#L36) (`UpdateAsync`), [SessionService.cs:16-20](../backend/BrownEvents.Api/Services/SessionService.cs#L16-L20) (`GetByIdAsync`).
- **Проверка:** ✔ код; в стеке ошибок [REL-1](#rel-1) — `ConferenceService.GetByIdAsync`. Голодание пула под нагрузкой — ~ вывод.
- **Что:** поток запроса блокируется до ответа БД; метод притворяется асинхронным (`Task.FromResult`); исключения приходят обёрнутыми в `AggregateException`. Severity Medium: deadlock в ASP.NET Core не возникает, но под нагрузкой — High.
- **Fix:** везде `await`; запретить `.Result`/`.Wait()` линтером. В NestJS: правило `@typescript-eslint/no-floating-promises` и `require-await`; синхронных драйверов БД в Node нет, но та же ошибка в TS — забытый `await` или `void`-промис.

### ASYNC-2
**Medium · Синхронный запрос в `RegisterAttendeeAsync`**

- **Где:** [RegistrationService.cs:19](../backend/BrownEvents.Api/Services/RegistrationService.cs#L19) — `_context.Attendees.FirstOrDefault(...)`.
- **Проверка:** ✔ код.
- **Fix:** асинхронный запрос; лучше — `INSERT ... ON CONFLICT` по уникальному email ([CORR-2](#corr-2)), без отдельного поиска.

### ASYNC-3
**Medium · Ленивая загрузка — синхронный I/O внутри сериализации ответа**

- **Где:** [Program.cs:19](../backend/BrownEvents.Api/Program.cs#L19).
- **Проверка:** ✔ запрос: 19–22 SQL выполняются во время сериализации одного ответа; ленивая загрузка через прокси синхронна по устройству: она срабатывает в геттере навигационного свойства, а геттер не может быть асинхронным (прокси вызывает синхронный `ILazyLoader.Load`).
- **Что:** самая массовая блокировка в приложении не видна в коде сервисов.
- **Fix:** см. [PERF-1](#perf-1) — явная загрузка до сериализации.

### ASYNC-4
**Low · Синхронные вызовы БД при старте**

- **Где:** [Program.cs:91](../backend/BrownEvents.Api/Program.cs#L91) (`EnsureCreated()`), [DataSeeder.cs:9](../backend/BrownEvents.Api/Data/DataSeeder.cs#L9) (`Conferences.Any()` в async-методе).
- **Проверка:** ✔ код. Влияет только на старт.
- **Fix:** async-варианты; инициализацию БД вынести из старта приложения ([CFG-1](#cfg-1), [CFG-5](#cfg-5)).

### ASYNC-5
**Low · `CancellationToken` не передаётся**

- **Где:** ни один action контроллеров и ни один метод сервисов не принимает токен отмены и не передаёт его в `*Async`-вызовы EF ([Controllers/](../backend/BrownEvents.Api/Controllers/), [Services/](../backend/BrownEvents.Api/Services/)).
- **Проверка:** ✔ код (поиск `CancellationToken` по бэкенду — 0 вхождений). Найдено слепым аудитом.
- **Что:** если клиент закрыл страницу или оборвал запрос, запросы к БД всё равно выполняются до конца; при тяжёлых ответах ([PERF-1](#perf-1)) это лишняя нагрузка.
- **Fix:** протянуть токен отмены запроса от контроллера до драйвера БД. В NestJS/Node: `AbortSignal` запроса там, где драйвер его поддерживает, и тайм-ауты на запросы (`statement_timeout`).

## Корректность и бизнес-правила

### CORR-1
**High · Регистрация ничего не проверяет**

- **Где:** [RegistrationService.cs:15-45](../backend/BrownEvents.Api/Services/RegistrationService.cs#L15-L45); на месте проверок — пустой комментарий `//` ([:17](../backend/BrownEvents.Api/Services/RegistrationService.cs#L17)).
- **Проверка:** ✔ запрос: конференция с `maxAttendees: 1` — 4 регистрации одного и того же участника, все `200`; несуществующая конференция → `500` + [REL-2](#rel-2).
- **Что:** не проверяются существование конференции, её статус (`COMPLETED`/`CANCELLED`), повторная регистрация, лимит `MaxAttendees`.
- **Fix:** в одной транзакции: конференция существует (`404`) и открыта для регистрации (`409`/`422`); нет активной регистрации этого участника (`409`, плюс уникальный индекс — [CORR-2](#corr-2)); число регистраций < лимита — с блокировкой строки конференции (`SELECT ... FOR UPDATE`) или атомарным счётчиком, иначе гонка превысит лимит. Эти правила понадобятся и для waitlist (BEVN-202).

### CORR-2
**Medium · Нет ограничений целостности в БД**

- **Где:** [AppDbContext.cs:47-55](../backend/BrownEvents.Api/Data/AppDbContext.cs#L47-L55).
- **Проверка:** ✔ запрос: в `\di` только PK и индексы FK; нет уникальности `attendees.Email`, `(ConferenceId, AttendeeId)`; дубли созданы (см. [CORR-1](#corr-1)).
- **Что:** даже с проверками в коде два одновременных запроса создадут дубликаты; поиск по `Email` идёт без индекса.
- **Fix:** уникальный индекс по нормализованному email, уникальный `(ConferenceId, AttendeeId)`; нарушение → `409`. Заодно — ограничения длины строк: сейчас все строковые колонки `text` без лимита (✔ запрос `\d attendees`; дополнение слепого аудита).

### CORR-3
**Medium · Идентификация участника по email: регистрозависимо, имя из формы игнорируется**

- **Где:** [RegistrationService.cs:19](../backend/BrownEvents.Api/Services/RegistrationService.cs#L19), [:28-31](../backend/BrownEvents.Api/Services/RegistrationService.cs#L28-L31).
- **Проверка:** ✔ запрос: `DUP@x.example` создал второго участника рядом с `dup@x.example`; регистрация с тем же email и другим именем вернула `200`, имя в БД осталось старым.
- **Fix:** нормализовать email (trim + lower) при записи и поиске; явно определить политику для существующего участника (обновлять имя или сообщать клиенту).

### CORR-4
**Medium · Нет валидации входных данных**

- **Где:** нет `[ApiController]` ([ConferencesController.cs:11](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L11), [SessionsController.cs:10](../backend/BrownEvents.Api/Controllers/SessionsController.cs#L10), [SpeakersController.cs:10](../backend/BrownEvents.Api/Controllers/SpeakersController.cs#L10)), нет атрибутов валидации в [Models/](../backend/BrownEvents.Api/Models/), нет проверок в сервисах.
- **Проверка:** ✔ запрос: `PUT /api/sessions/4` с `endTime` < `startTime` и `capacity: -5` → `200`; регистрация с `{}` → `200`, в БД участник с пустым email.
- **Что:** не проверяются обязательные поля, формат email/URL, `EndDate ≥ StartDate`, сессия в пределах дат конференции, неотрицательная вместимость, вместимость сессии ≤ вместимости зала, пересечение сессий в одном зале.
- **Fix:** валидация входных DTO на границе (`400` с описанием полей) + доменные правила в сервисе (`409`/`422`). В NestJS: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` + `class-validator`, доменные проверки — в сервисе.

### CORR-5
**Medium · `PUT` — полная замена: пропущенные поля молча обнуляются**

- **Где:** [ConferenceService.cs:39-48](../backend/BrownEvents.Api/Services/ConferenceService.cs#L39-L48), [SessionService.cs:27-33](../backend/BrownEvents.Api/Services/SessionService.cs#L27-L33).
- **Проверка:** ✔ BEVN-002: без `status` статус конференции становится `UPCOMING`, строки → `null`/`""`, даты → `0001-01-01`.
- **Fix:** либо `PUT` с обязательными всеми полями (иначе `400`), либо `PATCH` с частичным обновлением только переданных полей. Выбрать одно и описать в контракте.

### CORR-6
**Medium · `"status": null` → `500`, изменения применяются частично**

- **Где:** [ConferenceService.cs:45](../backend/BrownEvents.Api/Services/ConferenceService.cs#L45) — `updated.Status.ToUpper()` после копирования предыдущих полей.
- **Проверка:** ✔ BEVN-002: `NullReferenceException` → `500`; уже скопированные поля видны в последующих `GET` (объект в трекере изменён — [REL-4](#rel-4)).
- **Fix:** валидировать вход до изменения сущности; изменять — в транзакции на запрос.

### CORR-7
**Medium · Ошибки клиента отдаются как `500` или как успех**

- **Где:** нарушения FK в [ConferenceService.cs:61-67](../backend/BrownEvents.Api/Services/ConferenceService.cs#L61-L67), [SessionService.cs:32-35](../backend/BrownEvents.Api/Services/SessionService.cs#L32-L35), [RegistrationService.cs:33-42](../backend/BrownEvents.Api/Services/RegistrationService.cs#L33-L42); списки — [ConferencesController.cs:131-135](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L131-L135), [:178-182](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L178-L182); маршруты `{id}` без ограничения типа.
- **Проверка:** ✔ запрос: `GET /api/conferences/999/sessions` → `200 {"data":[]}`; `GET /api/conferences/abc` → `404` (нечисловой id становится `0`); пустое тело `POST` → `500`.
- **Fix:** несуществующий родитель → `404`; несуществующие `speakerId`/`roomId` → `422`; невалидный id → `400`; пустое/битое тело → `400`. Единый формат ошибки — [CFG-3](#cfg-3) (задача BEVN-104).

### CORR-8
**Medium · Даты без часового пояса**

- **Где:** [Program.cs:10](../backend/BrownEvents.Api/Program.cs#L10) (`Npgsql.EnableLegacyTimestampBehavior`), колонки `timestamp without time zone`; [RegistrationService.cs:37](../backend/BrownEvents.Api/Services/RegistrationService.cs#L37) пишет UTC в ту же модель.
- **Проверка:** ✔ BEVN-002: значение с `Z` хранится «как есть», с другим смещением — переводится во время **сервера**; в ответах встречаются три формата. Фронтенд парсит их `new Date(...)` в часовом поясе браузера ([SessionCard.jsx:4-8](../frontend/src/components/SessionCard.jsx#L4-L8), [ConferenceDetailPage.jsx:264](../frontend/src/pages/ConferenceDetailPage.jsx#L264)) — ~ вывод: время одной и той же сессии может отображаться по-разному.
- **Fix:** хранить моменты времени в UTC (`timestamptz`), у конференции — поле часового пояса (IANA); API отдаёт ISO 8601 с `Z`; фронтенд форматирует в поясе конференции. Даты начала/конца конференции как календарные даты — тип `date`.

### CORR-9
**Low · `Status` — свободная строка, нормализуется непоследовательно**

- **Где:** [Conference.cs:38](../backend/BrownEvents.Api/Models/Conference.cs#L38), [Registration.cs:16](../backend/BrownEvents.Api/Models/Registration.cs#L16); `CreateAsync` сохраняет как есть ([ConferenceService.cs:27-32](../backend/BrownEvents.Api/Services/ConferenceService.cs#L27-L32)), `UpdateAsync` — в верхнем регистре ([:45](../backend/BrownEvents.Api/Services/ConferenceService.cs#L45)).
- **Проверка:** ✔ запрос: `POST` с `"status":"active"` → сохранено `active`.
- **Fix:** enum (`UPCOMING | ACTIVE | COMPLETED | CANCELLED`) в DTO и в БД (check constraint/enum-тип); значения вне списка → `400`.

### CORR-10
**Low · Статус конференции не зависит от дат; демо-данные устарели**

- **Где:** статус задаётся только вручную; в сидере конференции марта и июня 2025 года — `UPCOMING` ([DataSeeder.cs:50-52](../backend/BrownEvents.Api/Data/DataSeeder.cs#L50-L52), [:63-65](../backend/BrownEvents.Api/Data/DataSeeder.cs#L63-L65)).
- **Проверка:** ✔ код. Найдено слепым аудитом.
- **Что:** прошедшие конференции показываются как предстоящие, и на них открыта регистрация ([CORR-1](#corr-1)).
- **Fix:** вычислять `UPCOMING/ACTIVE/COMPLETED` из дат (в ответе или периодической задачей), вручную хранить только `CANCELLED`; обновить даты демо-данных.

## Безопасность

### SEC-1
**High · Утечка персональных данных через публичные ответы**

- **Где:** сериализация графа ([PERF-1](#perf-1)); `GET /api/conferences/{id}/registrations` ([ConferencesController.cs:178-182](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L178-L182)); `Speaker.Email` ([Speaker.cs:24](../backend/BrownEvents.Api/Models/Speaker.cs#L24)).
- **Проверка:** ✔ запрос: email всех спикеров — в `GET /api/speakers` и `GET /api/conferences/2/sessions`; после регистраций email участников попадают в любой ответ, достающий до конференции (BEVN-001, ✔ BEVN-002).
- **Fix:** response-DTO по белому списку полей; список участников с контактами — только организатору ([SEC-2](#sec-2)); email спикера — только если он явно публичный.

### SEC-2
**High · Нет аутентификации и авторизации**

- **Где:** [Program.cs:84-85](../backend/BrownEvents.Api/Program.cs#L84-L85) — нет `UseAuthentication/UseAuthorization`, ни одного `[Authorize]`.
- **Проверка:** ✔ запрос: все записи в этом аудите (создание конференций, правка сессий, создание спикеров) сделаны анонимно.
- **Что:** любой может менять расписание, читать список участников и одним запросом уронить запись для всех ([REL-2](#rel-2)).
- **Fix:** аутентификация (JWT/сессия) и роли: публичное чтение каталога, регистрация — для участника, изменения и списки участников — для организатора; rate limiting на публичную регистрацию. В NestJS: `@nestjs/passport` + guards, `@nestjs/throttler`.

### SEC-3
**High · Mass assignment: клиент создаёт вложенные сущности и задаёт `id`**

- **Где:** `[FromBody]` прямо в сущности EF: [ConferencesController.cs:80](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L80), [:111](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L111), [:160](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L160), [:208](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L208), [SessionsController.cs:65](../backend/BrownEvents.Api/Controllers/SessionsController.cs#L65), [SpeakersController.cs:51](../backend/BrownEvents.Api/Controllers/SpeakersController.cs#L51).
- **Проверка:** ✔ запрос: один `POST /api/conferences` с вложенными `registrations` и `sessions` создал регистрацию со статусом `VIP` (в обход `/register`), нового участника, сессию и нового спикера. `POST` с `"id": 50` создал конференцию с `id` 50: колонка `generated by default as identity`, поэтому последовательность позже дойдёт до 50 и вставка упадёт с `500` + [REL-2](#rel-2) (~ вывод для последней части).
- **Fix:** отдельные входные DTO по белому списку полей без `id` и навигаций; неизвестные поля → `400` (NestJS `whitelist` + `forbidNonWhitelisted`); первичные ключи — `generated always`.

### SEC-4
**Medium · CORS: любой origin, метод и заголовок**

- **Где:** [Program.cs:35-44](../backend/BrownEvents.Api/Program.cs#L35-L44), [Program.cs:84](../backend/BrownEvents.Api/Program.cs#L84).
- **Проверка:** ✔ запрос (см. [Pilot focus](#конфигурация-cors--найдено-2-проблемы--1-связанная)).
- **Что:** сейчас ущерб ограничен (нет cookie/credentials, а API и так открыт — [SEC-2](#sec-2)), поэтому Medium. Но политика одна на все окружения и не настраивается. При добавлении аутентификации её придётся переписывать: `AllowAnyOrigin` вместе с `AllowCredentials` ASP.NET не допускает, и типичный «обход» — отражать любой присланный origin вместе с credentials (`SetIsOriginAllowed(_ => true)`; в NestJS — `enableCors({ origin: true, credentials: true })`). Это и есть дыра: любой сайт делает запросы от имени вошедшего пользователя.
- **Fix:** явный список разрешённых origin из конфигурации окружения (не `*` и не `origin: true`), только нужные методы/заголовки, `maxAge` для preflight; лучше — один origin через reverse proxy ([FE-1](#fe-1)), тогда CORS в проде не нужен. В NestJS: `app.enableCors({ origin: config.get('CORS_ORIGINS').split(','), methods: [...] })`.

### SEC-5
**Low · Swagger UI открыт в Production**

- **Где:** [Program.cs:76-82](../backend/BrownEvents.Api/Program.cs#L76-L82) — без проверки окружения; в compose `ASPNETCORE_ENVIRONMENT=Production` ([docker-compose.yml:26](../docker-compose.yml#L26)).
- **Проверка:** ✔ запрос: `/swagger/index.html` → `200` в Production.
- **Fix:** включать документацию по флагу конфигурации или закрыть авторизацией; спецификацию публиковать как артефакт сборки.

### SEC-6
**Medium · Секреты в репозитории, порт БД опубликован**

- **Где:** [appsettings.json:10](../backend/BrownEvents.Api/appsettings.json#L10), [docker-compose.yml:8-10](../docker-compose.yml#L8-L10), [:27](../docker-compose.yml#L27); порт `5433` наружу — [docker-compose.yml:11-12](../docker-compose.yml#L11-L12).
- **Проверка:** ✔ код.
- **Дополнительно:** бэкенд тоже опубликован на хост (`5000:80`, [docker-compose.yml:28-29](../docker-compose.yml#L28-L29)) — в обход nginx; сейчас это нужно только из-за [FE-1](#fe-1).
- **Fix:** секреты — только из переменных окружения/secret store (`.env` вне git, `.env.example` в репозитории); не публиковать порты БД и API за пределами dev-профиля — наружу только фронтенд-прокси.

### SEC-7
**Medium · Стек вне поддержки, контейнеры от root**

- **Где:** `net6.0` ([BrownEvents.Api.csproj:4](../backend/BrownEvents.Api/BrownEvents.Api.csproj#L4), образы `sdk:6.0`/`aspnet:6.0` в [Dockerfile](../backend/BrownEvents.Api/Dockerfile#L3)), `node:18-alpine` ([frontend/Dockerfile:2](../frontend/Dockerfile#L2), [.gitlab-ci.yml:38](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L38)), `nginx:alpine` без версии ([frontend/Dockerfile:10](../frontend/Dockerfile#L10)), Vite 4 ([frontend/package.json:20](../frontend/package.json#L20)); ни в одном Dockerfile нет `USER`.
- **Проверка:** ✔ код (версии). Даты окончания поддержки (.NET 6 — ноябрь 2024, Node 18 — апрель 2025) — из публичных графиков поддержки, не проверялись в этой задаче.
- **Fix:** EXT-150 снимает вопрос с .NET; для Node — актуальная LTS, закреплённые версии образов, непривилегированный пользователь в контейнерах.

## Конфигурация и деплой

### CFG-1
**Medium · `EnsureCreated()` вместо миграций**

- **Где:** [Program.cs:91](../backend/BrownEvents.Api/Program.cs#L91); пакет `Microsoft.EntityFrameworkCore.Design` подключён, но миграций нет ([BrownEvents.Api.csproj:15-18](../backend/BrownEvents.Api/BrownEvents.Api.csproj#L15-L18)).
- **Проверка:** ✔ код.
- **Что:** изменение модели к существующей БД не применится; новые ограничения из этого аудита (уникальные индексы, enum) без миграций не выкатить.
- **Fix:** версионированные миграции, применяемые отдельным шагом деплоя (не на каждом старте). В NestJS: TypeORM migrations (`synchronize: false`) или `prisma migrate deploy`.

### CFG-2
**Medium · Логирование EF не подключено; настройки логов не работают**

- **Где:** контекст создаётся вручную без `ILoggerFactory` ([Program.cs:15-22](../backend/BrownEvents.Api/Program.cs#L15-L22)); [appsettings.Development.json:6](../backend/BrownEvents.Api/appsettings.Development.json#L6) включает логи SQL, [Program.cs:20](../backend/BrownEvents.Api/Program.cs#L20) — `EnableSensitiveDataLogging()` безусловно.
- **Проверка:** ✔ запрос: в Development (уровень `Debug`) на запрос с 22 SQL — 0 строк от EF в логе; в Production — тоже 0.
- **Что:** SQL не виден ни в одном окружении (N+1 нельзя заметить по логам). По одной конфигурации легко решить обратное — что SQL с параметрами (email) пишется в прод-логи; слепой аудит так и решил, замер это опровергает. `EnableSensitiveDataLogging` действует только на тексты исключений — значения параметров могут попасть туда в любом окружении (~ вывод, отдельно не воспроизводилось).
- **Fix:** логгер ORM через DI, уровень SQL-логов — из конфигурации окружения, значения параметров — только в dev; структурные логи с id запроса. В NestJS: `logging` TypeORM / `log` Prisma из `ConfigService`.

### CFG-3
**Medium · Нет единой обработки ошибок**

- **Где:** в [Program.cs:73-95](../backend/BrownEvents.Api/Program.cs#L73-L95) нет обработчика исключений и ProblemDetails.
- **Проверка:** ✔ запрос, ✔ BEVN-002: `500` с пустым телом в Production; в Development — stack trace текстом (`ArgumentNullException` на пустое тело `POST`). ✔ браузер: при `500` из-за [REL-1](#rel-1) DevTools → Network показывает `registrations 500`, а страница — «Failed to fetch»: `fetch` в JS был отклонён, хотя ответ пришёл. Console браузера: `Access to fetch at 'http://localhost:5000/api/conferences/2/registrations' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present` — ответ `500` приходит без CORS-заголовка, и браузер не отдаёт его странице (если бы заголовок был, `api.js` показал бы `HTTP 500`). Почему заголовка нет (~ вывод): при необработанном исключении сервер сбрасывает уже выставленные заголовки, в том числе CORS. Fix ниже это устраняет: ответ об ошибке формирует обработчик внутри конвейера, после CORS. Клиент не может отличить ошибку сервера от недоступности сети.
- **Fix:** глобальный обработчик: доменные ошибки → `4xx` в едином формате (RFC 7807 или согласованный в BEVN-104), неожиданные → `500` с id корреляции без деталей. В NestJS: глобальный `ExceptionFilter`.

### CFG-4
**Medium · CI не работает в репозитории**

- **Где:** [.gitlab-ci.yml](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml) — конфигурация GitLab, репозиторий на GitHub; Docker без TLS ([.gitlab-ci.yml:8-9](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L8-L9)); для фронтенда только сборка ([:36-47](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L36-L47)). Дополнения слепого аудита: пароль реестра передаётся через `docker login -p` ([:56](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L56), [:69](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L69)); кеш `~/.nuget/packages` вне каталога проекта GitLab не кеширует ([:21-24](https://github.com/mirlanbeck/brown-events-pilot/blob/717c5bb8a2daebe311309a7d7740d7cea7b18475/.gitlab-ci.yml#L21-L24)); артефакты сборки не переиспользуются тестами.
- **Проверка:** ✔ код.
- **Fix:** GitHub Actions: сборка + тесты бэкенда (с Postgres-сервисом для интеграционных тестов), lint/test/build фронтенда, обязательный статус для merge (задача EXT-110).

### CFG-5
**Low · Сидинг при каждом старте в любом окружении**

- **Где:** [Program.cs:87-93](../backend/BrownEvents.Api/Program.cs#L87-L93), [DataSeeder.cs:9](../backend/BrownEvents.Api/Data/DataSeeder.cs#L9).
- **Проверка:** ✔ код.
- **Fix:** сидинг — отдельная команда/скрипт только для dev и тестов.

### CFG-6
**Low · Сборка и compose: нет `.dockerignore`, нет healthcheck бэкенда, хост БД захардкожен**

- **Где:** `COPY . .` в [backend/BrownEvents.Api/Dockerfile:11](../backend/BrownEvents.Api/Dockerfile#L11) и [frontend/Dockerfile:6](../frontend/Dockerfile#L6) без `.dockerignore` (локальные `bin/`/`obj/`/`node_modules` уходят в контекст); у `backend` нет healthcheck, `frontend` ждёт только старта контейнера ([docker-compose.yml:21-40](../docker-compose.yml#L21-L40)); `Host=postgres` в [appsettings.json:10](../backend/BrownEvents.Api/appsettings.json#L10) — `dotnet run` вне Docker не стартует без переопределения.
- **Проверка:** ✔ код; что локальные `obj/` с Windows-путями ломают сборку — ~ вывод.
- **Fix:** `.dockerignore`; эндпоинт `/health` и healthcheck; конфигурация БД целиком из окружения с dev-значениями в `.env.example`.

## API-контракт и сопровождаемость

### MNT-1
**Medium · Сущности EF — одновременно входной и выходной контракт API**

- **Где:** все контроллеры принимают и отдают классы из [Models/](../backend/BrownEvents.Api/Models/).
- **Проверка:** ✔ код.
- **Что:** корневая причина [SEC-1](#sec-1), [SEC-3](#sec-3), [PERF-1](#perf-1), [REL-3](#rel-3): схема БД, API и сериализация связаны; любое поле модели автоматически становится публичным и записываемым.
- **Fix:** раздельные слои: request-DTO (валидация), доменные сущности, response-DTO (маппинг). Для EXT-150 — с первого эндпоинта.

### MNT-2
**Medium · Несогласованная форма ответов**

- **Где:** только сессии обёрнуты в `{ data }` ([ConferencesController.cs:134](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L134), [:163](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L163)); создание отвечает `200` вместо `201` ([:83](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L83)); фронтенд компенсирует это `res.data || res` в трёх местах ([api.js:28](../frontend/src/api.js#L28), [ConferenceDetailPage.jsx:42](../frontend/src/pages/ConferenceDetailPage.jsx#L42), [SessionDetailPage.jsx:15](../frontend/src/pages/SessionDetailPage.jsx#L15)).
- **Проверка:** ✔ код, ✔ BEVN-002.
- **Fix:** единый конверт (или его отсутствие) для всех ответов, `201` + `Location` на создание, единый формат ошибок — задача BEVN-104; фронтенд разбирает ответ в одном месте (`api.js`).

### MNT-3
**Low · Мелкие проблемы структуры и документации**

- **Где:** пустой комментарий на месте бизнес-логики [RegistrationService.cs:17](../backend/BrownEvents.Api/Services/RegistrationService.cs#L17); `RegistrationService` вызывается из `ConferencesController` ([ConferencesController.cs:208-212](../backend/BrownEvents.Api/Controllers/ConferencesController.cs#L208-L212)); у залов нет эндпоинта — клиент должен знать id 1–4 ([Session.cs:37](../backend/BrownEvents.Api/Models/Session.cs#L37)); неиспользуемый `Moq` ([BrownEvents.Tests.csproj:12](../backend/BrownEvents.Tests/BrownEvents.Tests.csproj#L12)); Swagger описывает дефекты как часть контракта ([ApiDocumentation.cs:17-58](../backend/BrownEvents.Api/Swagger/ApiDocumentation.cs#L17-L58)).
- **Проверка:** ✔ код.
- **Fix:** модуль на агрегат (conferences / sessions / registrations / speakers / rooms) с собственным контроллером и сервисом; эндпоинт залов (хотя бы чтение); удалить лишние зависимости; при исправлении каждого пункта обновлять документацию API и убирать его из «Known issues».

## Тесты

### TEST-1
**Medium · Тесты на EF InMemory не воспроизводят прод**

- **Где:** [ConferenceServiceTests.cs:11-17](../backend/BrownEvents.Tests/ConferenceServiceTests.cs#L11-L17), [SessionServiceTests.cs:11-17](../backend/BrownEvents.Tests/SessionServiceTests.cs#L11-L17).
- **Проверка:** ✔ код: InMemory не проверяет FK, не использует ленивые прокси, Singleton и Npgsql. Ни один дефект из разделов «Надёжность» и «Производительность» этими тестами не ловится.
- **Fix:** интеграционные тесты против настоящего Postgres (Testcontainers или сервис в CI) и e2e-тесты HTTP-уровня; на каждую находку этого аудита — регрессионный тест при исправлении. В NestJS: `@nestjs/testing` + `supertest` + Postgres в контейнере.

### TEST-2
**Medium · Нет тестов на самое рискованное**

- **Где:** [BrownEvents.Tests/](../backend/BrownEvents.Tests/) — 7 тестов только на `ConferenceService` и `SessionService`; нет тестов `RegistrationService`, `SpeakerService`, контроллеров, а также `GetByIdAsync` — того самого пути с `.Result` ([ASYNC-1](#async-1)); у фронтенда тестов и тест-раннера нет ([frontend/package.json:6-10](../frontend/package.json#L6-L10)).
- **Проверка:** ✔ код.
- **Fix:** приоритет — регистрация (правила [CORR-1](#corr-1)), параллельные запросы, контракт ответов; для фронтенда — Vitest + Testing Library на формы и разбор ответов API.

## Фронтенд

### FE-1
**Medium · Адрес API захардкожен, прокси nginx/Vite не используются**

- **Где:** [api.js:1](../frontend/src/api.js#L1); мёртвые прокси: [nginx.conf:12-17](../frontend/nginx.conf#L12-L17), [vite.config.js:8-13](../frontend/vite.config.js#L8-L13).
- **Проверка:** ✔ код, BEVN-001.
- **Что:** собранный фронтенд работает только при API на `localhost:5000` у того же пользователя; любой другой хост требует пересборки; из-за другого origin нужен CORS ([SEC-4](#sec-4)).
- **Fix:** относительные пути `/api/...` через прокси того же origin (nginx в проде, Vite в dev) или адрес из переменной сборки (`import.meta.env.VITE_API_URL`).

### FE-2
**Medium · Ошибки в обёртке `request()`**

- **Где:** [api.js:3-14](../frontend/src/api.js#L3-L14).
- **Проверка:** ✔ код.
- **Что:**
  - `...options` разворачивается после `headers` — если вызывающий передаст свои `headers`, `Content-Type` пропадёт (сейчас никто не передаёт — латентный дефект);
  - `Content-Type: application/json` на `GET` делает каждый запрос «непростым» → лишний CORS-preflight;
  - `res.json()` без проверки тела упадёт на `204`/пустом ответе (понадобится для `DELETE`);
  - текст ошибки сервера показывается пользователю как есть — в Development это stack trace ([CFG-3](#cfg-3)).
- **Fix:** собирать `headers` после `...options`; `Content-Type` только при наличии тела; обрабатывать `204`; разбирать ошибку по согласованному формату (BEVN-104) и показывать понятное сообщение.

### FE-3
**Medium · Модалка регистрации: данные теряются, список не обновляется, обещано несуществующее письмо**

- **Где:** [ConferenceDetailPage.jsx:28-35](../frontend/src/pages/ConferenceDetailPage.jsx#L28-L35), [:106-123](../frontend/src/pages/ConferenceDetailPage.jsx#L106-L123), [:300-304](../frontend/src/pages/ConferenceDetailPage.jsx#L300-L304); [RegistrationPage.jsx:47](../frontend/src/pages/RegistrationPage.jsx#L47).
- **Проверка:** ✔ код; что бэкенд отбрасывает поля — ✔ BEVN-001/002.
- **Что:** отправляются `phone`, `company`, `sessionId`, `dietaryRequirements`, которые API молча отбрасывает (у `dietaryRequirements` к тому же нет поля ввода); после успешной регистрации список регистраций на странице не перезагружается (задача BEVN-115); текст обещает письмо-подтверждение, которого бэкенд не отправляет.
- **Fix:** согласовать поля формы с контрактом API (либо добавить их в API, либо убрать из формы); после успеха обновлять список (повторный запрос или добавление из ответа); убрать обещание письма, пока отправки нет.

### FE-4
**Low · Эффекты загрузки без отмены**

- **Где:** [ConferenceDetailPage.jsx:37-80](../frontend/src/pages/ConferenceDetailPage.jsx#L37-L80), [SessionDetailPage.jsx:11-22](../frontend/src/pages/SessionDetailPage.jsx#L11-L22).
- **Проверка:** ✔ код; гонка в браузере не воспроизводилась — ~ вывод.
- **Что:** при быстрой смене `id` поздний ответ предыдущей страницы перезапишет данные текущей; `SessionDetailPage` не сбрасывает `error` при смене `sessionId` — после одной ошибки страница остаётся в ошибке.
- **Fix:** `AbortController` в cleanup эффекта, сброс состояния при смене параметров; либо библиотека запросов с кешем и отменой (TanStack Query).

### FE-5
**Medium · Персональные данные в публичном интерфейсе**

- **Где:** email каждого участника в списке регистраций [ConferenceDetailPage.jsx:258-266](../frontend/src/pages/ConferenceDetailPage.jsx#L258-L266); email спикера [SessionDetailPage.jsx:87](../frontend/src/pages/SessionDetailPage.jsx#L87).
- **Проверка:** ✔ код.
- **Fix:** вместе с [SEC-1](#sec-1)/[SEC-2](#sec-2): публично — максимум число регистраций или имена; контакты — только в интерфейсе организатора.

### FE-6
**Low · Персональные данные в `console.log`**

- **Где:** [api.js:4](../frontend/src/api.js#L4) (каждый запрос с телом), [ConferenceDetailPage.jsx:110](../frontend/src/pages/ConferenceDetailPage.jsx#L110), [RegistrationPage.jsx:29](../frontend/src/pages/RegistrationPage.jsx#L29) (данные формы); всего 8 вызовов `console.log`.
- **Проверка:** ✔ код.
- **Fix:** убрать отладочный вывод; при необходимости — логгер, отключённый в production-сборке, без данных форм; правило ESLint `no-console`.

### FE-7
**Low · Ошибки рендеринга**

- **Где:** `{session.capacity && ...}` выводит `0` вместо скрытия ([SessionCard.jsx:17](../frontend/src/components/SessionCard.jsx#L17), [SessionDetailPage.jsx:76](../frontend/src/pages/SessionDetailPage.jsx#L76), [:98](../frontend/src/pages/SessionDetailPage.jsx#L98)); `session.room.name || session.room` отрендерит объект, если у зала пустое имя → ошибка React ([SessionCard.jsx:15](../frontend/src/components/SessionCard.jsx#L15)); `try/catch` вокруг `toLocaleDateString` не ловит `Invalid Date` (исключения нет, выводится строка "Invalid Date") ([ConferenceCard.jsx:4-8](../frontend/src/components/ConferenceCard.jsx#L4-L8) и аналоги).
- **Проверка:** ✔ код.
- **Fix:** явные условия (`!= null`), проверка `isNaN(date)`; типизированный контракт ответа ([FE-12](#fe-12)).

### FE-8
**Low · Мёртвый и неверный код в `api.js`**

- **Где:** `deleteRegistration` → `DELETE /api/conferences/{id}/registrations/{rid}` — такого маршрута на бэкенде нет ([api.js:36-37](../frontend/src/api.js#L36-L37)); `createConference`, `updateConference`, `getSpeakers` нигде не используются ([api.js:20-24](../frontend/src/api.js#L20-L24), [:41](../frontend/src/api.js#L41)).
- **Проверка:** ✔ код (поиск по `frontend/src`).
- **Fix:** удалить или реализовать соответствующие маршруты; клиент генерировать из OpenAPI-спецификации, чтобы расхождения ловились при сборке.

### FE-9
**Low · Дублирование и раздутый компонент**

- **Где:** навбар скопирован во все страницы; `formatDate`/`statusClass` — в [ConferenceCard.jsx:4-18](../frontend/src/components/ConferenceCard.jsx#L4-L18), [ConferenceDetailPage.jsx:125-141](../frontend/src/pages/ConferenceDetailPage.jsx#L125-L141), [SessionDetailPage.jsx:24-34](../frontend/src/pages/SessionDetailPage.jsx#L24-L34), [SessionCard.jsx:4-8](../frontend/src/components/SessionCard.jsx#L4-L8); `ConferenceDetailPage` — 346 строк и 14 `useState`; форма регистрации дублируется в модалке и на отдельной странице; много inline-стилей; оборванный комментарий [SessionList.jsx:3](../frontend/src/components/SessionList.jsx#L3).
- **Проверка:** ✔ код.
- **Fix:** общий layout с навбаром, утилиты форматирования, отдельный компонент формы регистрации, хук загрузки данных.

### FE-10
**Low · Доступность**

- **Где:** `<label>` без `htmlFor`/`id` ([ConferenceDetailPage.jsx:313-331](../frontend/src/pages/ConferenceDetailPage.jsx#L313-L331), [RegistrationPage.jsx:85-106](../frontend/src/pages/RegistrationPage.jsx#L85-L106)); кликабельный `div` без роли и клавиатуры ([SessionCard.jsx:11](../frontend/src/components/SessionCard.jsx#L11)); модалка без `role="dialog"`, `aria-modal`, фокуса и закрытия по Esc ([ConferenceDetailPage.jsx:292-343](../frontend/src/pages/ConferenceDetailPage.jsx#L292-L343)). Атрибутов `aria-*`/`role` в коде нет совсем.
- **Проверка:** ✔ код.
- **Fix:** связать метки с полями, интерактивные элементы — `button`/`a`, модалка — доступный диалог.

### FE-11
**Low · Нет маршрута 404**

- **Где:** [App.jsx:10-15](../frontend/src/App.jsx#L10-L15).
- **Проверка:** ✔ код.
- **Fix:** маршрут `*` со страницей «не найдено»; страницы конференции/сессии показывают «не найдено» на `404` API отдельно от прочих ошибок.

### FE-12
**Low · Нет линтера, тестов и проверки типов**

- **Где:** [frontend/package.json:6-10](../frontend/package.json#L6-L10) — только `dev/build/preview`; JS без типов; `@types/react` установлены, но не используются.
- **Проверка:** ✔ код.
- **Fix:** ESLint (react-hooks, `no-console`), Vitest, TypeScript с типами, сгенерированными из OpenAPI; запуск в CI ([CFG-4](#cfg-4)).

### FE-13
**Low · Страница сессии не проверяет принадлежность к конференции**

- **Где:** [SessionDetailPage.jsx:6-22](../frontend/src/pages/SessionDetailPage.jsx#L6-L22) — из URL берётся только `sessionId`; `id` конференции используется лишь в ссылках.
- **Проверка:** ✔ код. Найдено слепым аудитом.
- **Что:** `/conferences/1/sessions/7` покажет сессию конференции 3 с хлебными крошками и кнопкой регистрации конференции 1.
- **Fix:** сверять `session.conferenceId` с `id` из URL (иначе «не найдено» или редирект) либо получать сессию вложенным маршрутом `/api/conferences/{id}/sessions/{sid}`.

## Как проверялось

- **Код:** прочитаны все файлы бэкенда (`Program.cs`, конфигурация, `Data/`, `Models/`, `Services/`, `Controllers/`, `Swagger/`, тесты, Dockerfile) и фронтенда (`api.js`, все страницы и компоненты, `App.jsx`, `vite.config.js`, `nginx.conf`, Dockerfile, `package.json`), а также `docker-compose.yml` и `.gitlab-ci.yml`.
- **Стенд для `✔ запрос`:** отдельная docker-сеть; одноразовый `postgres:14` без volume и без публикации порта, с `log_statement=all` (число SQL считалось по логу Postgres); API собран из текущих исходников в `mcr.microsoft.com/dotnet/sdk:6.0` (исходники смонтированы read-only), запущен с `ASPNETCORE_ENVIRONMENT=Production` как в compose, порт `5099`. Compose-стек и dev-база не затрагивались. Замеры SQL и параллельных запросов — на свежем процессе (перезапуск контейнера перед каждым замером), таблица размеров — на чистых демо-данных.
- **Слепой аудит (проверка полноты):** отдельный агент только на чтение получил копию кода вне репозитория (коммит `7e18684`, без `docs/` и без Swagger-описаний известных дефектов; логика приложения с тех пор не менялась — проверено диффом) и текст задачи, но не этот документ. Он нашёл 48 проблем; около 40 совпали с нашими по сути, все High — совпали. Новое от него — [ASYNC-5](#async-5), [CORR-10](#corr-10), [FE-13](#fe-13) и дополнения к [CORR-2](#corr-2), [SEC-6](#sec-6), [SEC-7](#sec-7), [CFG-4](#cfg-4), [FE-9](#fe-9), [TEST-2](#test-2); каждое перепроверено по коду. Одно его утверждение опровергнуто замером ([CFG-2](#cfg-2)). Состояние репозитория до и после совпало (хэш индекса, рабочего дерева и неотслеживаемых файлов).

## Как воспроизвести

Команды для повторения ключевых проверок `✔ запрос`. Запускать в **bash** (на Windows — Git Bash) из корня репозитория, блоки — по порядку в одной сессии терминала. Нужны только Docker и `curl`; используются образы `postgres:14` и `mcr.microsoft.com/dotnet/sdk:6.0`, NuGet-пакеты скачиваются внутри одноразового контейнера. Compose-стек и его база не затрагиваются; нужен свободный порт `5099`. Время — около 15–20 минут, в основном сборка и перезапуски. Раздел прогнан целиком в этом виде (Git Bash, Windows, 2026-10-04): все 7 шагов дали ожидаемый результат.

Вторая часть (шаги 1–7) — обычные HTTP-запросы: после миграции (EXT-150) их можно направить на новый API (переменная `URL`) как регрессионные проверки; ожидаемый результат после исправлений — противоположный указанному.

**Стенд и помощники**

```bash
export MSYS_NO_PATHCONV=1   # Git Bash: не переписывать пути вида /app в аргументах docker
# Пути для нативных программ (curl.exe) при отключённой конвертации: Windows-вид в Git Bash, обычный — в Linux/macOS.
TMPD=$(cygpath -m "${TMPDIR:-/tmp}" 2>/dev/null || echo "${TMPDIR:-/tmp}")
NULLF=$([ -n "$MSYSTEM" ] && echo NUL || echo /dev/null)
NET=bevn-repro-net; PG=bevn-repro-pg; API=bevn-repro-api; URL=http://localhost:5099
BODY=$TMPD/bevn-repro-body.json
CS="Host=$PG;Port=5432;Database=brownevents;Username=brown;Password=brown123"
docker network create $NET
docker run -d --name $PG --network $NET -e POSTGRES_DB=brownevents -e POSTGRES_USER=brown \
  -e POSTGRES_PASSWORD=brown123 postgres:14 -c log_statement=all
docker run -d --name $API --network $NET -p 5099:80 -v "$(pwd -W 2>/dev/null || pwd)/backend:/src-ro:ro" \
  -e ASPNETCORE_ENVIRONMENT=Production -e ASPNETCORE_URLS=http://+:80 -e "ConnectionStrings__DefaultConnection=$CS" \
  mcr.microsoft.com/dotnet/sdk:6.0 sleep infinity
docker exec $API sh -c 'cp -r /src-ro /work && rm -rf /work/*/bin /work/*/obj &&
  dotnet publish /work/BrownEvents.Api/BrownEvents.Api.csproj -c Release -o /app | tail -1'
until docker exec $PG pg_isready -U brown -d brownevents >/dev/null 2>&1; do sleep 1; done

# Свежий процесс API (= пустой Singleton-контекст). ENV — окружение ASP.NET Core, по умолчанию Production.
restart_api(){ docker restart -t 1 $API >/dev/null
  docker exec -d -e ASPNETCORE_ENVIRONMENT=${1:-Production} $API sh -c 'cd /app && exec dotnet BrownEvents.Api.dll > /tmp/api.log 2>&1'
  for i in $(seq 1 120); do curl -s -m 3 -o $NULLF $URL/swagger/index.html && return; sleep 1; done
  echo "API не ответил за 2 минуты; лог: docker exec $API cat /tmp/api.log" >&2; return 1; }
# GET на свежем процессе: код, размер и число SELECT по логу Postgres.
sql_count(){ restart_api; local n=$(docker logs $PG 2>&1 | wc -l)
  curl -s -m 60 -o $BODY -w "GET $1 -> %{http_code}, %{size_download} bytes" $URL$1; sleep 2
  echo ", SELECT: $(docker logs $PG 2>&1 | tail -n +$((n+1)) | grep -cE 'LOG:  (statement|execute[^:]*): SELECT')"; }
psql_q(){ docker exec $PG psql -U brown -d brownevents -tAc "$1"; }
post(){ curl -s -m 30 -o $BODY -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d "$2" $URL$1; }
restart_api   # первый старт создаёт схему и демо-данные
```

**1. PERF-1, SEC-1 — N+1 и весь граф в ответе.** Ожидается: около 22 и 19 SELECT, ~199 КБ и ~376 КБ; в списке спикеров — их email.

```bash
sql_count /api/conferences/2/sessions
sql_count /api/speakers
grep -oE '"email":"[^"]*"' $BODY | sort -u
```

**2. REL-1 — Singleton `DbContext` и параллельные запросы страницы.** Ожидается: один-два `500` из трёх и `A second operation was started on this context instance` в логе (результат зависит от гонки; повторите 2–3 раза).

```bash
restart_api
for p in /api/conferences/2 /api/conferences/2/sessions /api/conferences/2/registrations; do
  curl -s -m 60 -o $NULLF -w "%{http_code} " $URL$p & done; wait; echo
docker exec $API grep -c 'A second operation was started' /tmp/api.log
```

**3. SEC-4 — CORS с чужого origin.** Ожидается: `204`, `Access-Control-Allow-Origin: *`, без `Access-Control-Max-Age`.

```bash
curl -s -i -m 10 -X OPTIONS $URL/api/conferences/2/register -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | tr -d '\r' | grep -iE '^HTTP|^access-control'
```

**4. SEC-3 — mass assignment.** Ожидается: `200`; в БД регистрация со статусом `VIP`, спикер `Fake` и сессия `Injected`.

```bash
restart_api
post /api/conferences '{"title":"Nested","startDate":"2026-01-01T00:00:00","endDate":"2026-01-02T00:00:00",
  "registrations":[{"status":"VIP","attendee":{"firstName":"Mass","lastName":"Assign","email":"mass@x.example"}}],
  "sessions":[{"title":"Injected","speaker":{"firstName":"Fake","lastName":"Speaker"}}]}'; echo
psql_q "select 'registration', \"Status\" from registrations where \"Status\"='VIP'"
psql_q "select 'speaker', \"FirstName\" from speakers where \"FirstName\"='Fake'"
psql_q "select 'session', \"Title\" from sessions where \"Title\"='Injected'"
```

**5. CORR-1, CORR-3 — регистрация без проверок.** Ожидается: четыре `200` при `maxAttendees: 1`; в БД 4 регистрации одного участника (имя «Other» проигнорировано).

```bash
post /api/conferences '{"title":"Limit1","startDate":"2026-01-01T00:00:00","endDate":"2026-01-02T00:00:00","maxAttendees":1}'
CID=$(grep -oE '^\{"id":[0-9]+' $BODY | cut -d: -f2); echo " conference $CID"
for name in Dup Dup Dup Other; do post /api/conferences/$CID/register "{\"firstName\":\"$name\",\"lastName\":\"U\",\"email\":\"dup@x.example\"}"; echo -n " "; done; echo
psql_q "select a.\"FirstName\", count(*) from registrations r join attendees a on a.\"Id\"=r.\"AttendeeId\" where r.\"ConferenceId\"=$CID group by 1"
```

**6. REL-2, REL-5 — ошибка записи «отравляет» API; регистрация не атомарна.** Ожидается: `500`; участник `orphan@x.example` остался в БД; следующая корректная запись — тоже `500`.

```bash
restart_api
post /api/conferences/9999/register '{"firstName":"Orphan","lastName":"A","email":"orphan@x.example"}'; echo
psql_q "select count(*) from attendees where \"Email\"='orphan@x.example'"
post /api/speakers '{"firstName":"Valid","lastName":"Speaker"}'; echo
```

**7. CFG-2 — логи EF не подключены.** Ожидается: окружение `Development`, `0` строк от `Microsoft.EntityFrameworkCore` в логе, хотя запрос выполнил ~22 SQL.

```bash
restart_api Development
curl -s -m 60 -o $NULLF $URL/api/conferences/2/sessions; sleep 1
docker exec $API sh -c 'grep -m1 -o "Hosting environment: [A-Za-z]*" /tmp/api.log; grep -c Microsoft.EntityFrameworkCore /tmp/api.log'
```

**Удаление стенда**

```bash
docker rm -f $API $PG >/dev/null; docker network rm $NET >/dev/null; rm -f $BODY
```

## Допущения и ограничения

- Голодание пула потоков от блокирующих вызовов ([ASYNC-1](#async-1)) и рост памяти ([PERF-2](#perf-2)) выведены из кода; нагрузочный тест и профилирование памяти не проводились.
- Фронтенд разобран статически; в браузере проверен один сценарий — [REL-1](#rel-1) (страница конференции после перезапуска бэкенда и после обновления), он подтвердился в обоих случаях. Остальные находки FE в браузере не проверялись.
- Что `500` приходит без CORS-заголовка, подтверждено в браузере (сообщение CORS в Console); почему сервер его не выставляет ([CFG-3](#cfg-3)) — вывод.
- Даты окончания поддержки .NET 6 и Node 18 ([SEC-7](#sec-7)) — из общеизвестных графиков поддержки, в задаче не перепроверялись.
- Severity отражает текущее использование (демо, без аутентификации). Для CORS ([SEC-4](#sec-4)) оценка повысится, как только появятся cookie/учётные данные.
