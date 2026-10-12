# BEVN-205 E2E Test Suite (Playwright) Implementation Plan

> **Исполнение (выбрано пользователем 2026-10-12, spec П6):** агент сам, задача за задачей; перед push — ревью всей ветки
> отдельным агентом-ревьюером (F1). Решение, которого нет в плане, — остановка и вопрос пользователю. Коммит — в точках,
> отмеченных «Коммит», только после «ок» пользователя.

**Goal:** три пользовательских сценария (обзор конференций, регистрация на сессию, список ожидания) покрыты e2e-тестами
Playwright против настоящего стека; в CI — job `e2e` на `docker compose up` со скриншотами упавших тестов в артефактах.

**Architecture:** отдельная папка `e2e/` (свой `package.json`; `@playwright/test` 1.64.0, TypeScript 6.0.3, Chromium). Данные —
через API в подготовке, проверяемые действия — через UI. Локально — изолированный стенд (`e2e/scripts/stand.sh` поверх
`backend/scripts/stand.sh`) на портах 5000/5173; в CI — compose.

**Spec:** `docs/superpowers/specs/2026-10-12-bevn205-e2e-playwright-design.md` («spec 5.3» — её раздел).

## Global Constraints

- Ничего не устанавливать самому: пакеты и Chromium ставит пользователь (Task 1). Новые файлы — LF.
- Compose и dev-базу не трогать; порты 5000/5173 освобождает пользователь (Task 2). Контейнеры стенда — только по имени,
  которое создал скрипт (`ext150-stand-*`, `bevn205-stand-web`).
- Команды e2e — из `e2e/`; долгие — с тайм-аутом (`npx playwright test` — 5 мин, `stand.sh build` — 10 мин).
- После правки любого `.ts` — `npm run typecheck` до прогона.
- Продуктовый код (`frontend/src`, `backend/src`) и `backend/scripts/stand.sh` не меняются.

## Task 1: каркас `e2e/` и установка

**Files:** create `e2e/package.json`, `e2e/.gitignore`, `e2e/tsconfig.json`, `e2e/playwright.config.ts`, `e2e/support/api.ts`.

- [ ] **1.1** `e2e/package.json` (без зависимостей — их добавит установка):

```json
{
  "name": "brownevents-e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **1.2** `e2e/.gitignore`:

```
node_modules/
test-results/
playwright-report/
```

- [ ] **1.3** Пользователь из `e2e/` выполняет:

```
npm install --save-dev --save-exact @playwright/test@1.64.0 typescript@6.0.3 @types/node@24.19.1
npx playwright install chromium
```

- [ ] **1.4** Проверка (агент): `npx playwright --version` → `Version 1.64.0`; `npx tsc --version` → `Version 6.0.3`; каталог
  `chromium-*` в `%LOCALAPPDATA%\ms-playwright`; в `package.json` три точные версии; `package-lock.json` без CRLF; состав
  lock (spec 8.1.4) — чтением; `npm audit` — результат записать для devlog.
- [ ] **1.5** `e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["playwright.config.ts", "support", "tests"]
}
```

`DOM` — для колбэков `evaluate`, которые выполняются в браузере (`HTMLInputElement.validity`).

- [ ] **1.6** `e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// spec 4.1: one worker and no retries — a small suite, a predictable order, and a failure is never hidden by a rerun.
export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The page must be served from exactly http://localhost:5173: the API allows only this origin (FE-1).
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **1.7** `e2e/support/api.ts`:

```ts
import { request, type APIRequestContext } from '@playwright/test';

// Test data goes through the API (spec 4.2); only the steps a flow checks go through the UI. Setup runs in Node, so CORS
// does not apply and the API is reached on 127.0.0.1.
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:5000';

// Only the fields the tests read; the backend types are not imported — e2e/ is a separate package.
export interface Conference {
  id: number;
  title: string;
}

export interface Session {
  id: number;
  title: string;
  capacity: number;
}

const suffix = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Unique per run: a rerun on the same stand does not meet the data of the previous one.
export const uniq = (prefix: string): string => `${prefix} ${suffix()}`;
export const uniqEmail = (name: string): string => `e2e.${name}.${suffix()}@example.com`;

// YYYY-MM-DD, `days` from today (UTC). The API takes times without a zone.
function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const apiContext = (): Promise<APIRequestContext> => request.newContext({ baseURL: API_URL });

async function post<T>(api: APIRequestContext, path: string, data: object): Promise<T> {
  const res = await api.post(path, { data });
  if (!res.ok()) throw new Error(`setup POST ${path} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Starts in 30 days: UPCOMING, registration open, sessions not started.
export const createConference = (api: APIRequestContext, title: string): Promise<Conference> =>
  post<Conference>(api, '/api/conferences', { title, startDate: `${day(30)}T00:00:00`, endDate: `${day(31)}T00:00:00` });

// One hour on the first conference day; callers pick different hours so sessions never overlap.
export const createSession = (
  api: APIRequestContext,
  conferenceId: number,
  { title, capacity, hour }: { title: string; capacity: number; hour: number },
): Promise<Session> =>
  post<Session>(api, `/api/conferences/${conferenceId}/sessions`, {
    title,
    startTime: `${day(30)}T${pad(hour)}:00:00`,
    endTime: `${day(30)}T${pad(hour + 1)}:00:00`,
    capacity,
  });

export const registerForConference = (api: APIRequestContext, conferenceId: number, email: string): Promise<unknown> =>
  post<unknown>(api, `/api/conferences/${conferenceId}/register`, { firstName: 'E2E', lastName: 'Attendee', email });
```

- [ ] **1.8** `npm run typecheck` → без ошибок (spec 8.1.1 — предположение о TS 6 и типах Playwright 1.64). Ошибка в типах
  самого Playwright — остановка и доклад, не `skipLibCheck`-обходы сверх уже включённого.

## Task 2: стенд `e2e/scripts/stand.sh`

**Files:** create `e2e/scripts/stand.sh`.

- [ ] **2.1** Скрипт:

```bash
#!/usr/bin/env bash
# Local e2e stand (spec BEVN-205 4.3): the backend stand on 127.0.0.1:5000 and the production frontend image on
# 127.0.0.1:5173 — the ports the frontend and CORS expect (FE-1). Compose holds both ports: stop it first.
set -euo pipefail
export MSYS_NO_PATHCONV=1
WEB=bevn205-stand-web
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
FRONTEND=$(cd "$ROOT/frontend" && (pwd -W 2>/dev/null || pwd)) # Windows path for docker under Git Bash
BACKEND_STAND="$ROOT/backend/scripts/stand.sh"
case "$(uname -s)" in MINGW* | MSYS*) NULL_OUT=NUL ;; *) NULL_OUT=/dev/null ;; esac

case "${1:-}" in
  build)
    bash "$BACKEND_STAND" build
    docker build -t brownevents-frontend:stand "$FRONTEND"
    ;;
  up)
    "$0" down
    STAND_PORT=5000 bash "$BACKEND_STAND" up
    # nginx.conf proxies /api/ to the host "backend", which this network has not got; the app never uses that proxy (FE-1).
    docker run -d --name $WEB -p 127.0.0.1:5173:80 --add-host backend:host-gateway brownevents-frontend:stand >/dev/null
    for _ in $(seq 1 60); do
      if [ "$(curl -s -m 2 -o "$NULL_OUT" -w '%{http_code}' http://127.0.0.1:5173/ || true)" = 200 ]; then
        echo "frontend up on http://localhost:5173 (container started $(docker inspect -f '{{.State.StartedAt}}' $WEB))"
        exit 0
      fi
      sleep 1
    done
    echo "frontend did not answer in 60 s; see: $0 logs" >&2
    exit 1
    ;;
  down)
    docker rm -f $WEB >/dev/null 2>&1 || true
    bash "$BACKEND_STAND" down
    ;;
  logs)
    bash "$BACKEND_STAND" logs
    docker logs $WEB
    ;;
  *)
    echo "usage: $0 build|up|down|logs" >&2
    exit 2
    ;;
esac
```

- [ ] **2.2** Пользователь останавливает compose. Агент проверяет, что 5000 и 5173 свободны
  (`docker ps --format '{{.Names}} {{.Ports}}'`, `curl` → нет ответа).
- [ ] **2.3** Из `e2e/`: `bash scripts/stand.sh build` (тайм-аут 10 мин) → `bash scripts/stand.sh up`. Ожидается: строки
  «stand up on http://127.0.0.1:5000 (container started …)» и «frontend up … (container started …)» со временем «сейчас».
  Если nginx не стартует с `host-gateway` — остановка и доклад (spec Р4 — предположение).
- [ ] **2.4** Проверки `curl`: `/health` → 200; `http://127.0.0.1:5173/` → 200; `/api/conferences/2147483647` → 404
  (подтверждает предположение spec 5.1.2; иначе — остановка и вопрос).
- [ ] **2.5** Стенд оставить поднятым для Task 3–5.

**Коммит A** (после «ок»): сначала `docs: add the BEVN-205 spec and plan (BEVN-205)`, затем Task 1–2 —
`test: add the Playwright e2e scaffold and stand script (BEVN-205)`.

## Task 3: Flow 1 — `e2e/tests/browse.spec.ts`

- [ ] **3.1** Тест (spec 5.1):

```ts
import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiContext, createConference, createSession, uniq, type Conference, type Session } from '../support/api.js';

// Flow 1 (spec 5.1): conference list → conference detail → session detail.
test.describe('Flow 1: browse conferences', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let first: Session;
  let second: Session;

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Browse'));
    first = await createSession(api, conference.id, { title: uniq('Browse talk A'), capacity: 30, hour: 10 });
    second = await createSession(api, conference.id, { title: uniq('Browse talk B'), capacity: 40, hour: 12 });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('list → conference detail → session detail', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.card').filter({ has: page.getByText(conference.title, { exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('UPCOMING')).toBeVisible();

    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(`/conferences/${conference.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(conference.title);
    const firstCard = page.locator('.session-card').filter({ hasText: first.title });
    await expect(firstCard).toBeVisible();
    await expect(page.locator('.session-card').filter({ hasText: second.title })).toBeVisible();

    await firstCard.getByRole('link', { name: 'Details →' }).click();
    await expect(page).toHaveURL(`/conferences/${conference.id}/sessions/${first.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
    await expect(page.getByText('0 / 30 registered')).toBeVisible();
  });

  test('an unknown conference shows an error and no sessions', async ({ page }) => {
    await page.goto('/conferences/2147483647');
    await expect(page.getByRole('heading', { name: 'Failed to load conference' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toHaveCount(0);
  });
});
```

- [ ] **3.2** `npm run typecheck`; `npx playwright test tests/browse.spec.ts` → `2 passed`. Это и проверка предположения
  spec 4 об импорте `'../support/api.js'` в `.ts`: если загрузчик его не разрешает — остановка и доклад (вариант —
  `allowImportingTsExtensions` и импорт `.ts`, решает пользователь). Падение — разбор по trace/скриншоту; если две попытки
  подряд упираются в одну причину — остановка и доклад.

## Task 4: Flow 2 — `e2e/tests/session-registration.spec.ts`

- [ ] **4.1** Тест (spec 5.2). У каждого теста своя сессия — счётчики независимы:

```ts
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiContext,
  createConference,
  createSession,
  registerForConference,
  uniq,
  uniqEmail,
  type Conference,
  type Session,
} from '../support/api.js';

// Flow 2 (spec 5.2): session detail → register → the registration is shown and survives a reload.
test.describe('Flow 2: register for a session', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let attendee: string;
  let happy: Session;
  let empty: Session;
  let stranger: Session;

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Session registration'));
    attendee = uniqEmail('flow2');
    await registerForConference(api, conference.id, attendee);
    happy = await createSession(api, conference.id, { title: uniq('Registration talk'), capacity: 5, hour: 10 });
    empty = await createSession(api, conference.id, { title: uniq('Empty email talk'), capacity: 5, hour: 12 });
    stranger = await createSession(api, conference.id, { title: uniq('Stranger talk'), capacity: 5, hour: 14 });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  const open = (page: Page, session: Session) => page.goto(`/conferences/${conference.id}/sessions/${session.id}`);

  test('a registered attendee is counted, also after a reload', async ({ page }) => {
    await open(page, happy);
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    await page.locator('#session-email').fill(attendee);
    await page.getByRole('button', { name: 'Register for session' }).click();
    await expect(page.getByRole('status')).toHaveText('You are registered for this session.');
    await expect(page.getByText('1 / 5 registered')).toBeVisible();
    await page.reload();
    await expect(page.getByText('1 / 5 registered')).toBeVisible();
  });

  test('an empty email is stopped by the browser and sends nothing', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/sessions/')) posts.push(r.url());
    });
    await open(page, empty);
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    await page.getByRole('button', { name: 'Register for session' }).click();
    const valueMissing = await page.locator('#session-email').evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
    expect(valueMissing).toBe(true);
    await expect(page.getByRole('status')).toHaveText('');
    await expect(page.getByRole('alert')).toHaveText('');
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('an attendee without a conference registration is refused', async ({ page }) => {
    await open(page, stranger);
    await page.locator('#session-email').fill(uniqEmail('stranger'));
    await page.getByRole('button', { name: 'Register for session' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Register for the conference before registering for its sessions');
    await expect(alert.getByRole('link', { name: 'Register for conference' })).toBeVisible();
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
  });
});
```

- [ ] **4.2** `npm run typecheck`; `npx playwright test tests/session-registration.spec.ts` → `3 passed`.
- [ ] **4.3** Мутация (spec 8.2.4, без коммита): в первом тесте после `reload` ожидать `2 / 5 registered` → тест падает,
  в `test-results/…/test-failed-1.png` есть скриншот страницы (открыть и посмотреть) → правку откатить, файл совпадает с
  версией 4.1.

## Task 5: Flow 3 — `e2e/tests/waitlist.spec.ts`

- [ ] **5.1** Тест (spec 5.3). Где сообщение повторяется, ожидание идёт по счётчику, а не по тексту — иначе проверка могла
  бы пройти на старом сообщении до ответа API:

```ts
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiContext,
  createConference,
  createSession,
  registerForConference,
  uniq,
  uniqEmail,
  type Conference,
  type Session,
} from '../support/api.js';

type Button = 'Register for session' | 'Join waitlist' | 'Cancel my registration';

// Flow 3 (spec 5.3, BEVN-202): fill the session → a stale page is refused → waitlist → a cancel promotes the first waiting.
test.describe('Flow 3: session waitlist', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let session: Session;
  const who: Record<'a' | 'b' | 'c' | 'd', string> = { a: '', b: '', c: '', d: '' };

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Waitlist'));
    session = await createSession(api, conference.id, { title: uniq('Waitlist talk'), capacity: 2, hour: 10 });
    for (const name of ['a', 'b', 'c', 'd'] as const) {
      who[name] = uniqEmail(`flow3-${name}`);
      await registerForConference(api, conference.id, who[name]);
    }
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  const act = async (page: Page, email: string, button: Button) => {
    await page.locator('#session-email').fill(email);
    await page.getByRole('button', { name: button }).click();
  };

  test('full → refused → waitlist → cancel → the first waiting is promoted', async ({ page, context }) => {
    const url = `/conferences/${conference.id}/sessions/${session.id}`;
    const stale = page;

    await test.step('tab 1 opens the session while seats are free', async () => {
      await stale.goto(url);
      await expect(stale.getByText('0 / 2 registered')).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Register for session' })).toBeVisible();
    });

    await test.step('tab 2: A and B take both seats', async () => {
      const other = await context.newPage();
      await other.goto(url);
      await act(other, who.a, 'Register for session');
      await expect(other.getByText('1 / 2 registered')).toBeVisible();
      await act(other, who.b, 'Register for session');
      await expect(other.getByText('2 / 2 registered')).toBeVisible();
      await expect(other.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
      await other.close();
    });

    await test.step('tab 1 is stale: C is refused, the page switches to the waitlist', async () => {
      await expect(stale.getByRole('button', { name: 'Register for session' })).toBeVisible();
      await act(stale, who.c, 'Register for session');
      await expect(stale.getByRole('alert')).toHaveText('No seats left in this session; join the waitlist instead');
      await expect(stale.getByText('2 / 2 registered')).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
    });

    await test.step('C joins the waitlist', async () => {
      await act(stale, who.c, 'Join waitlist');
      await expect(stale.getByRole('status')).toHaveText('You are on the waitlist.');
      await expect(stale.getByText('Waitlist: 1')).toBeVisible();
    });

    await test.step('after a reload only the waitlist is offered; D joins it', async () => {
      await stale.reload();
      await expect(stale.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Register for session' })).toHaveCount(0);
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByText('Waitlist: 2')).toBeVisible();
    });

    await test.step('D cannot join twice', async () => {
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already on the waitlist for this session');
      await expect(stale.getByText('Waitlist: 2')).toBeVisible();
    });

    await test.step('A cancels: the seat goes to the waitlist', async () => {
      await act(stale, who.a, 'Cancel my registration');
      await expect(stale.getByRole('status')).toHaveText('Your registration or waitlist place is cancelled.');
      await expect(stale.getByText('Waitlist: 1')).toBeVisible();
      await expect(stale.getByText('2 / 2 registered')).toBeVisible();
    });

    await test.step('C, the first waiting, is registered; D still waits', async () => {
      await act(stale, who.c, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already registered for this session');
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already on the waitlist for this session');
    });
  });
});
```

- [ ] **5.2** `npm run typecheck`; `npx playwright test tests/waitlist.spec.ts` → `1 passed`.
- [ ] **5.3** Весь набор дважды подряд на одном стенде: `npm test` → `6 passed` оба раза (spec 8.2.3, П1).
- [ ] **5.4** `bash scripts/stand.sh down`; `docker ps -a` — контейнеров `ext150-stand-*`, `bevn205-stand-web` нет,
  `docker network ls` — сети `ext150-stand-net` нет. Compose пользователь поднимает сам, когда захочет.

**Коммит B** (после «ок»): `test: cover the browse, session registration and waitlist flows end to end (BEVN-205)`.

## Task 6: CI и документы

**Files:** modify `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`.

- [ ] **6.1** В `ci.yml` после job `frontend` — job `e2e` (spec 6):

```yaml
  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    defaults:
      run:
        working-directory: e2e
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: e2e/package-lock.json

      - name: Versions
        run: |
          node --version
          npm --version
          docker --version
          docker compose version

      - name: Install
        run: npm ci

      # Before the stack: a type error fails the job in seconds, not after the image builds.
      - name: Type check
        run: npm run typecheck

      - name: Start the stack
        working-directory: .
        run: docker compose up -d --build

      # A curl loop instead of --wait: no dependence on how this compose version treats the finished migrate service.
      - name: Wait for the stack
        run: |
          for _ in $(seq 1 120); do
            if curl -fs -o /dev/null http://127.0.0.1:5000/health && curl -fs -o /dev/null http://127.0.0.1:5173/; then
              echo "stack is up"
              exit 0
            fi
            sleep 1
          done
          echo "stack did not come up in 120 s" >&2
          exit 1

      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      - name: Playwright
        run: npx playwright test

      - name: Stack logs
        if: failure()
        working-directory: .
        run: docker compose logs --no-color

      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: e2e-results
          path: |
            e2e/test-results/
            e2e/playwright-report/
          if-no-files-found: ignore
          retention-days: 14

      - name: Stop the stack
        if: always()
        working-directory: .
        run: docker compose down -v
```

- [ ] **6.2** `actionlint -shellcheck <путь к shellcheck.exe> .github/workflows/ci.yml` (оба — в
  `%LOCALAPPDATA%\Microsoft\WinGet\Links\`) → без замечаний.
- [ ] **6.3** `CLAUDE.md`, «Проект» — строка про `e2e/` (Playwright 1.64 + TypeScript); «Команды» — `cd e2e && npm ci &&
  npm run typecheck`, `bash scripts/stand.sh build|up|down` (порты 5000/5173, compose остановить), `npm test`.
  `README.md` (LF): `### E2E tests` после `### Frontend`, строка `e2e/` в «Project Structure». Сверить окончания строк
  (`git ls-files --eol`, `git diff --stat` — без диффа «весь файл»).

**Коммит C** (после «ок»): `ci: run the Playwright e2e suite against docker compose (BEVN-205)`.

## Финал

- [ ] **F1** Ревью всей ветки (spec П6): отдельный агент-ревьюер получает spec, план и `git diff main...HEAD` — без моих
  рассуждений; проверяет соответствие spec, корректность ожиданий (гонки, ложно-зелёные проверки), CI. Находки — пользователю
  до push; исправления — по его решению.
- [ ] **F2** Push (после «ок») → PR по шаблону (черновик текста — пользователю) → CI: по логу `e2e` — версии Node/compose,
  `Type check` зелёный, `6 passed`, время; `backend`, `frontend` — зелёные.
- [ ] **F3** DoD 8 (spec 8.3.2, П5, после «ок»): коммит `test: fail an e2e check on purpose to show the CI artifact (BEVN-205)`
  (в Flow 1 ожидать `1 / 30` вместо `0 / 30`) → job `e2e` красный, артефакт `e2e-results` содержит PNG (скачать
  `gh run download`, посмотреть) → `git revert` этого коммита → CI зелёный.
- [ ] **F4** Сверка с каждым пунктом DoD (spec 8.4); черновик записи в devlog (CRLF, пять разделов, «Что сделал бы иначе» —
  `<!-- ваше -->`) — на утверждение; коммит `docs: add BEVN-205 devlog entry`.
