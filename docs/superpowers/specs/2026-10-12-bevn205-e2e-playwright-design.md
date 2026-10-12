# BEVN-205 — набор end-to-end тестов на Playwright: спецификация

- Задача: [issue #11](https://github.com/mirlanbeck/brown-events-pilot/issues/11), первоисточник —
  `rolling-scopes-school/ai-native`, `test-task/tasks/BEVN-205-e2e-suite.md` (тексты совпадают, `diff` 2026-10-12).
- Ветка: `BEVN-205-e2e-playwright` (от `main` после EXT-152, `cd649ba`).
- Входы: решения шага 0 (раздел 2), spec BEVN-202 (сессии, список ожидания, `REFRESH_ON`), spec BEVN-203 (дашборд),
  аудит BEVN-003 (TEST-1, TEST-2, FE-1, FE-10), `backend/scripts/stand.sh`, запись EXT-152 в devlog (`--add-host` для nginx).
- Статус: утверждён пользователем 2026-10-12 (Р1–Р6, П1–П6; П2 пересмотрен — TypeScript). План: `docs/superpowers/plans/2026-10-12-bevn205-e2e-playwright.md`.

Обозначения: **[подтверждено]** — чтением кода, запуском или ответом API; **[предполагаю]** — проверка названа в разделе 8.

## 1. Цель и Definition of Done

Три критических пользовательских сценария покрыты e2e-тестами Playwright против настоящего стека (backend + Postgres +
продакшн-сборка фронтенда в nginx), без моков API. Тесты запускаются в CI отдельным job `e2e`.

DoD (issue #11 с «Pilot addition»):

1. Playwright настроен в `frontend/` или в отдельной папке `e2e/`.
2. Flow 1: список конференций → деталь → сессии.
3. Flow 2: деталь сессии → регистрация участника → регистрация видна.
4. Flow 3 (waitlist из BEVN-202): сессию заполняют → следующая регистрация отклонена → участник встаёт в очередь →
   подтверждённая регистрация отменяется → первый из очереди повышен.
5. В каждом flow — минимум один негативный случай.
6. Тесты проходят на стеке `docker-compose up`.
7. В `.github/workflows/ci.yml` — job `e2e`, который поднимает стек и запускает Playwright.
8. Скриншоты упавших тестов — артефакты workflow.

Фраза первоисточника «blocks merging on failure» в DoD-чекбоксы не входит. Required status checks для приватного
репозитория на бесплатном плане недоступны (`gh api …/branches/main/protection` → 403) **[подтверждено]**: job `e2e`
делает CI красным, но merge технически не блокирует. В PR это указывается.

## 2. Решения шага 0 (согласованы пользователем 2026-10-12)

| # | Решение | Альтернатива и почему не она |
|---|---|---|
| Р1 | Тесты в отдельной папке `e2e/` со своим `package.json` и lock-файлом | `frontend/` — зависимость Playwright попала бы в lock и `npm audit` фронтенда, Vitest и Playwright делили бы одно дерево |
| Р2 | Локально — изолированный стенд: `stand.sh` с `STAND_PORT=5000` + контейнер образа фронтенда на `127.0.0.1:5173`; compose пользователь останавливает сам | Локальный `docker compose up` — пишет в dev-базу (CLAUDE.md) |
| Р3 | В CI — буквально `docker compose up` на чистом runner'е | Стенд в CI — расходится с DoD 6 без причины: в CI dev-базы нет |
| Р4 | Фронтенд стенда — продакшн-образ из `frontend/Dockerfile` с `--add-host`, как в EXT-152 (значение там не записано; здесь — `backend:host-gateway`, **[предполагаю]**, что Docker Desktop его разрешает, проверка — 8.2.2) | `vite preview` — не та сборка, что в compose |
| Р5 | Flow 2: «регистрация видна» = сообщение + счётчик `1 / N registered` без перезагрузки + тот же счётчик после перезагрузки | Дашборд — показывает только регистрации на конференции, не на сессии **[подтверждено]** `DashboardPage.jsx` |
| Р6 | Flow 3, вариант «в»: отказ `SESSION_FULL` через «устаревшую» вкладку (механизм `REFRESH_ON`) + проверка, что после перезагрузки кнопки «Register for session» нет | «б» — отказ только API-запросом, пользователь его не видит; кнопку «Join waitlist» не убираем, продукт не меняется |

Предложения агента — утверждены пользователем 2026-10-12 вместе со spec:

| # | Предложение | Альтернатива и почему не она |
|---|---|---|
| П1 | Тестовые данные (конференция, сессии, регистрации на конференцию) создаются через API в подготовке каждого теста; действия, которые проверяет flow, — только через UI. Для Flow 2 согласовано (Р5), здесь — для всех flow | Опора на сид — тесты зависели бы от дат сида и от данных прошлых прогонов |
| П2 | TypeScript (`strict`, `nodenext`, как в `backend/`) с проверкой `tsc --noEmit` (скрипт `typecheck`, шаг CI до подъёма стека); dev-зависимости `typescript@6.0.3` и `@types/node@24.19.1` — версии backend. Пересмотрено пользователем 2026-10-12 (было: JS) | JS — без зависимостей, но опечатка в тесте видна только после сборки образов и подъёма стека в CI, а `tsc` ловит её за секунды |
| П3 | `workers: 1`, `retries: 0` | Параллельность — выигрыш секунд на трёх тестах; `retries` скрывает нестабильность |
| П4 | Job `e2e` независим от `backend`/`frontend` (параллельно, Node 24) | `needs: [backend, frontend]` — не тратит ~5 мин runner'а, если unit-тесты упали, но удлиняет CI на время этих job'ов |
| П5 | Доказательство DoD 8 в CI — временный коммит с ложной проверкой и `revert` (8.3.2) | force-push переписанной ветки — история PR чище, но это переписывание опубликованной ветки |
| П6 | Исполнение — агент сам, задача за задачей; перед push — ревью всей ветки отдельным агентом-ревьюером (без контекста исполнителя), находки — пользователю. Решено пользователем 2026-10-12 | Субагент-исполнитель и ревьюер на каждую задачу — большинство шагов ждут пользователя (установка, compose, стенд), код тестов уже в плане; 12 сессий агентов вместо одной |

## 3. Факты о приложении, на которые опираются тесты

Все пункты **[подтверждено]** чтением кода.

- `frontend/src/api.js:1` — `BASE_URL = 'http://localhost:5000'` (FE-1); CORS backend разрешает origin из `CORS_ORIGINS`,
  в compose и `stand.sh` — `http://localhost:5173`. Следствие: страница должна открываться ровно на `http://localhost:5173`
  (не `127.0.0.1`), backend — на порту 5000 хоста.
- Маршруты (`App.jsx`): `/`, `/conferences/:id`, `/conferences/:id/sessions/:sessionId`, `/conferences/:id/register`, `/dashboard`.
- Список (`ConferenceCard.jsx`): карточка `.card` с заголовком и ссылкой «View Details»; пагинации нет — тест ищет свою
  конференцию по уникальному названию.
- Деталь конференции: `h1` с названием, раздел «Sessions» со `SessionCard` (ссылка «Details →»); при ошибке загрузки —
  `h3` «Failed to load conference».
- Деталь сессии: `h1` с названием, `👥 {registeredCount} / {capacity} registered`, `⏳ Waitlist: {waitlistCount}`; панель
  регистрации видна, пока конференция `UPCOMING`/`ACTIVE`.
- Панель (`SessionRegistrationPanel.jsx`): поле `#session-email` (`type=email`, `required`, `<label htmlFor>`), кнопка
  «Register for session» или — если `registeredCount >= capacity` — «Join waitlist», кнопка «Cancel my registration»;
  успех в `role=status`, ошибка в `role=alert`; при `SESSION_FULL`/`SEATS_AVAILABLE` страница перечитывает сессию.
- Сообщения API (`waitlist.ts`), по которым тесты различают состояния:
  - `SESSION_FULL` — «No seats left in this session; join the waitlist instead»;
  - `CONFERENCE_REGISTRATION_REQUIRED` — «Register for the conference before registering for its sessions»
    (+ ссылка «Register for conference» в `role=alert`);
  - `ALREADY_REGISTERED` — «Attendee is already registered for this session» (CONFIRMED) /
    «Attendee is already on the waitlist for this session» (WAITLISTED). Проверки идут до проверки заполненности,
    поэтому повышенный участник отличим от ждущего через ту же кнопку «Join waitlist».
- Отмена `CONFIRMED` записи на сессию повышает первого из очереди (`createdAt`, затем `id`) в той же транзакции
  (`session-registrations.service.ts:78`).
- API подготовки (как в `backend/scripts/bevn203-demo-data.sh`): `POST /api/conferences`
  (`title`, `startDate`, `endDate`), `POST /api/conferences/{id}/sessions` (`title`, `startTime`, `endTime`, `capacity`),
  `POST /api/conferences/{id}/register` (`firstName`, `lastName`, `email`). Аутентификации нет (SEC-2), rate limit нет.
- FE-10 (метки модалки и `RegistrationPage` без `htmlFor`) тестов не касается: регистрация на конференцию делается в
  подготовке через API, формы с несвязанными метками тесты не заполняют.

## 4. Структура

```
e2e/
  package.json            # "type": "module"; devDependencies (точные версии): @playwright/test, typescript, @types/node;
                          # скрипты "test" (playwright test) и "typecheck" (tsc --noEmit)
  package-lock.json       # LF
  tsconfig.json           # strict, module/moduleResolution nodenext, target ES2023, noEmit, types ["node"]
  playwright.config.ts
  .gitignore              # node_modules/, test-results/, playwright-report/
  scripts/stand.sh        # build | up | down | logs: стенд backend (через backend/scripts/stand.sh) + контейнер фронтенда
  support/api.ts          # подготовка данных через API и генерация уникальных имён и email
  tests/
    browse.spec.ts        # Flow 1
    session-registration.spec.ts  # Flow 2
    waitlist.spec.ts      # Flow 3
```

Код — TypeScript (П2). Playwright исполняет `.ts` сам, без сборки; `tsc` только проверяет типы. Импорты внутри `e2e/` — с
расширением `.js` (`'../support/api.js'`), как требует `nodenext` в ESM-пакете **[предполагаю]**, что загрузчик Playwright
1.64 разрешает такой импорт в `.ts`-файл — проверка: первый прогон Task 3. Ответы API в `support/api.ts` описаны
минимальными интерфейсами (`{ id: number; title: string }`), типы из `backend/` не импортируются — пакеты независимы.

### 4.1 `playwright.config.ts`

- `testDir: 'tests'`, `outputDir: 'test-results'`, `fullyParallel: false`, `workers: 1` — небольшой набор, предсказуемый
  порядок и логи; изоляция данных всё равно своя у каждого теста (П1).
- `retries: 0` — падение не маскируется повтором.
- `forbidOnly: !!process.env.CI`; `timeout: 30_000`, `expect.timeout: 5_000`.
- `use.baseURL` — `E2E_BASE_URL`, по умолчанию `http://localhost:5173`; `screenshot: 'only-on-failure'`,
  `trace: 'retain-on-failure'`.
- `reporter`: `list` + `html` (`open: 'never'`).
- Один проект — `chromium`.

### 4.2 `support/api.ts`

- Адрес API — `E2E_API_URL`, по умолчанию `http://127.0.0.1:5000` (подготовка идёт из Node, не из браузера, CORS не участвует).
- `uniq(prefix)` — `prefix + Date.now() + случайный суффикс`; email — `e2e.<uniq>@example.com`. Повторный прогон на том же
  стенде не конфликтует с прошлым.
- `createConference(api)` — даты +30 и +31 день от сегодня (UTC): статус `UPCOMING`, регистрация открыта; сессии — в
  первый день, без пересечений (`SESSION_OVERLAP` не возникает).
- `createSession(api, conferenceId, { title, capacity, hour })`, `registerForConference(api, conferenceId, email)`.
- Ответ не 2xx — исключение с методом, путём, статусом и телом: падение подготовки отличимо от падения проверки.

### 4.3 `e2e/scripts/stand.sh`

- `build`: `bash backend/scripts/stand.sh build` + `docker build -t brownevents-frontend:stand frontend`.
- `up`: `STAND_PORT=5000 bash backend/scripts/stand.sh up`; затем
  `docker run -d --name bevn205-stand-web -p 127.0.0.1:5173:80 --add-host backend:host-gateway brownevents-frontend:stand`;
  ожидание `200` на `http://127.0.0.1:5173/` (до 60 с), вывод времени старта контейнера.
- `down`: удалить `bevn205-stand-web`, затем `backend/scripts/stand.sh down`.
- `logs`: логи API и nginx.
- `backend/scripts/stand.sh` не меняется.

## 5. Сценарии

Общее: у каждого теста своя конференция и свои email (П1); локаторы — по ролям, тексту и `#id`, без CSS-классов там,
где есть роль или текст; карточка ищется как `.card` с текстом названия (у карточки нет роли).

### 5.1 Flow 1 — `browse.spec.ts`

Подготовка: конференция с двумя сессиями.

1. **Happy path.** `/` → карточка с названием конференции видна, бейдж `UPCOMING` → «View Details» → URL
   `/conferences/{id}`, `h1` = название → в разделе «Sessions» обе сессии → «Details →» у первой → URL
   `/conferences/{id}/sessions/{sessionId}`, `h1` = название сессии, `0 / {capacity} registered`.
2. **Негативный.** `/conferences/2147483647` (нет такой; `ParseIdPipe` такой id принимает — `parse-id.pipe.spec.ts`,
   ответ 404 **[предполагаю]**, проверка — `curl` на стенде) → «Failed to load conference», раздела «Sessions» нет.

### 5.2 Flow 2 — `session-registration.spec.ts`

Подготовка: конференция, сессия на 5 мест, участник зарегистрирован на конференцию через API.

1. **Happy path.** Страница сессии → `0 / 5 registered` → email участника → «Register for session» → `role=status`:
   «You are registered for this session.» → `1 / 5 registered` без перезагрузки → `page.reload()` → `1 / 5 registered` (Р5).
2. **Негативный: пустой email.** «Register for session» с пустым полем → браузер не отправляет форму:
   `validity.valueMissing === true`, сообщений в `role=status`/`role=alert` нет, запросов `POST /api/sessions/*` не было
   (`page.on('request')`), счётчик `0 / 5`.
3. **Негативный: нет регистрации на конференцию.** Новый email → «Register for session» → `role=alert`: «Register for the
   conference before registering for its sessions» и ссылка «Register for conference» → счётчик `0 / 5`.

### 5.3 Flow 3 — `waitlist.spec.ts`

Подготовка: конференция, сессия на 2 места, четыре участника A, B, C, D зарегистрированы на конференцию через API.
Один тест (шаги зависят друг от друга), шаги размечены `test.step`.

1. Вкладка 1 открывает страницу сессии: `0 / 2`, кнопка «Register for session».
2. Вкладка 2 (тот же контекст браузера): A и B регистрируются через UI → `2 / 2 registered`, кнопка сменилась на «Join waitlist».
3. **Отказ.** Вкладка 1 (страница не обновлялась, кнопка всё ещё «Register for session»): C → «Register for session» →
   `role=alert`: «No seats left in this session; join the waitlist instead»; страница перечитала сессию: `2 / 2`, кнопка
   «Join waitlist».
4. Вкладка 1: C → «Join waitlist» → «You are on the waitlist.», `Waitlist: 1`.
5. Перезагрузка: кнопки «Register for session» нет, есть «Join waitlist» (Р6). D → «Join waitlist» → `Waitlist: 2`.
6. **Негативный.** D → «Join waitlist» повторно → «Attendee is already on the waitlist for this session», `Waitlist: 2`.
7. A → «Cancel my registration» → «Your registration or waitlist place is cancelled.» → `2 / 2 registered`, `Waitlist: 1`.
8. **Повышение.** C → «Join waitlist» → «Attendee is already registered for this session» (C — CONFIRMED);
   D → «Join waitlist» → «Attendee is already on the waitlist for this session» (D — всё ещё в очереди).

## 6. CI — job `e2e` в `.github/workflows/ci.yml`

- `runs-on: ubuntu-24.04`, `timeout-minutes: 25`, `defaults.run.working-directory: e2e`; независим от `backend` и `frontend`.
- Шаги:
  1. `actions/checkout@v7`; `actions/setup-node@v7` — Node 24, кэш npm по `e2e/package-lock.json`.
  2. Versions: `node --version`, `npm --version`, `docker --version`, `docker compose version`.
  2a. `npm ci`; `npm run typecheck` — до подъёма стека: ошибка типов роняет job за секунды (П2).
  3. `docker compose up -d --build` из корня репозитория; ожидание `200` на `http://127.0.0.1:5000/health` и
     `http://127.0.0.1:5173/` циклом с `curl` (до 120 с) — без `--wait`, чтобы не зависеть от того, как версия compose
     на runner'е трактует завершившийся сервис `migrate`.
  4. `npx playwright install --with-deps chromium`.
  5. `npx playwright test` с `CI=true`.
  6. `if: failure()` — `docker compose logs --no-color` (диагностика) и `actions/upload-artifact@v7`:
     `e2e/test-results/` (скриншоты, трейсы) и `e2e/playwright-report/`, `if-no-files-found: ignore`, `retention-days: 14`.
  7. `if: always()` — `docker compose down -v`.
- Проверка workflow — `actionlint -shellcheck …` (CLAUDE.md).

## 7. Документы

- `CLAUDE.md`, раздел «Команды»: строка про e2e (`cd e2e && npm ci`, `bash scripts/stand.sh build|up|down`, `npm test`).
- `README.md` (LF), раздел «Development Setup»: подраздел `### E2E tests` рядом с `### Backend` и `### Frontend` —
  установка, стенд, запуск, требование освободить порты 5000/5173; в «Project Structure» — строка про `e2e/`.
- Запись в `docs/devlog.md` (CRLF) — в конце, на утверждение.

## 8. Проверки и доказательства DoD

### 8.1 Установка (делает пользователь, агент проверяет)

1. `@playwright/test` — точная версия `1.64.0` (`npm view`: `latest` = 1.64.0, `engines.node >= 20` **[подтверждено]**);
   `typescript@6.0.3` и `@types/node@24.19.1` — версии из `backend/package.json` **[подтверждено]**. Ставятся одной командой
   в `e2e/` (план, Task 1), lock-файл — в репозитории. Что `tsc` 6.0.3 проверяет типы Playwright 1.64 без ошибок —
   **[подтверждено]** `npm run typecheck` на конфиге и `support/api.ts` (Task 1, 2026-10-12).
2. Chromium — `npx playwright install chromium` из `e2e/` (каталог `%LOCALAPPDATA%\ms-playwright`: `chromium-1248`,
   `chromium_headless_shell-1248`, `ffmpeg-1013`, `winldd-1007`, всего 719 МБ — **[подтверждено]** 2026-10-12).
3. Проверка: `npx playwright --version`, наличие каталога `chromium-*` в `%LOCALAPPDATA%\ms-playwright`.
4. `npm audit` в `e2e/` — результат в devlog; lock-файл — LF, сверка, что в нём только дерево `@playwright/test`
   (`playwright`, `playwright-core`), `typescript`, `@types/node` и `undici-types` — **[подтверждено]** чтением lock
   2026-10-12 (6 пакетов; `fsevents`, который предполагался, у `playwright` 1.64 в зависимостях нет); `npm audit` — 0.

### 8.2 Локально на стенде

1. Пользователь останавливает compose (порты 5000 и 5173); агент проверяет, что порты свободны.
2. `bash scripts/stand.sh build` → `up`; проверка: свежее время старта контейнеров, `200` на `/health` и на `/`.
3. `npm test` — все тесты зелёные, два прогона подряд на одном стенде (проверка П1 — независимость от прошлых данных).
4. **Мутация (без коммита):** в тесте Flow 2 ожидать `2 / 5` вместо `1 / 5` → тест падает, в `test-results/` есть PNG
   страницы → правка откатывается. Так проверяется, что проверки не «всегда зелёные» и что скриншот при падении сохраняется.
5. `bash scripts/stand.sh down`; контейнеры и сеть стенда удалены.

### 8.3 CI

1. Push ветки → job `e2e` зелёный; по логу: версии Node/compose, число тестов (`3 passed`… фактическое), время.
2. **Артефакт при падении (DoD 8)** — по согласованию с пользователем: временный коммит с заведомо ложной проверкой →
   job красный, в артефакте `e2e-results` есть PNG → коммит откатывается revert'ом (оба коммита остаются в истории PR) или
   ветка переписывается — выбор пользователя. **[предполагаю]**, что `upload-artifact@v7` при `if: failure()` выгружает
   `test-results/` — подтверждается этим прогоном.
3. **[предполагаю]**, что на `ubuntu-24.04` есть `docker compose` v2 и `host-gateway` не нужен (в compose фронтенд в
   одной сети с `backend`) — подтверждается логом шага Versions и зелёным прогоном.

### 8.4 DoD → подтверждение

| DoD | Чем подтверждается |
|---|---|
| 1 | `e2e/playwright.config.ts`, `e2e/package.json`, `e2e/tsconfig.json` в диффе; `npm run typecheck` без ошибок |
| 2–4 | Тесты 5.1–5.3 зелёные локально и в CI |
| 5 | Негативные тесты 5.1.2, 5.2.2, 5.2.3, шаги 5.3.3 и 5.3.6 |
| 6 | Зелёный job `e2e` на `docker compose up` (CI) + локальный прогон на стенде из тех же образов |
| 7 | Job `e2e` в `ci.yml`, `actionlint` без замечаний |
| 8 | Красный прогон из 8.3.2 с артефактом PNG |

## 9. Известные ограничения

- Merge не блокируется технически (раздел 1).
- Тесты зависят от текстов сообщений API и UI: изменение текста ломает e2e — это сознательно (тексты видит пользователь).
- Повышение из очереди проверяется косвенно — сообщениями `ALREADY_REGISTERED` (раздела «кто записан на сессию» в UI и API
  нет). Время повышения и порядок при равном `createdAt` покрыты интеграционными тестами BEVN-202, не e2e.
- Локальный прогон требует остановленного compose (FE-1: адрес API и origin захардкожены).
- Chromium только; Firefox и WebKit — вне задачи.

## 10. Вне задачи

- Исправление FE-1 и FE-10, изменения продуктового кода и `backend/scripts/stand.sh`.
- Visual regression, мобильные viewport'ы, нагрузочные сценарии.
- Required status checks / branch protection (недоступно на плане репозитория).
