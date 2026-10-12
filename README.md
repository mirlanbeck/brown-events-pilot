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
The password is inserted into `DATABASE_URL` as is: avoid `@`, `:` and `/` in it or URL-encode them.
Postgres applies `POSTGRES_PASSWORD` only when the volume is created: to change it later, recreate the volume
(`docker compose down -v`, the data is lost) or run `ALTER USER brown WITH PASSWORD '...';` in the database.
The database port is not published; for host access (port 5433):
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.

---

## Development Setup

### Backend

Requirements: Node.js 24.9+ (the image and CI use Node 24; Jest needs 24.9+ to load the ESM Nest packages), Docker (for PostgreSQL).

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
bash scripts/test-db.sh up  # throwaway PostgreSQL on 127.0.0.1:15432
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

### E2E tests

Playwright (Chromium) against the real stack: the backend, PostgreSQL and the production frontend image, no API mocks.
Requirements: Node.js 24, Docker. The frontend calls the API on `http://localhost:5000` and CORS allows only
`http://localhost:5173`, so the stand takes exactly these ports: stop compose first. The local stand is checked under
Git Bash on Windows; on Linux and macOS `backend/scripts/stand.sh` runs itself as `"$0" down` and needs the executable bit.

```bash
cd e2e
npm ci
npx playwright install chromium
npm run typecheck
bash scripts/stand.sh build   # backend and frontend images
bash scripts/stand.sh up      # API on 127.0.0.1:5000, frontend on http://localhost:5173, throwaway PostgreSQL
npm test                      # screenshots and traces of failed tests: e2e/test-results/
bash scripts/stand.sh down
```

In CI the `e2e` job runs the same tests against `docker compose up`.

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

e2e/
  tests/                    ← Playwright flows: browse, session registration, waitlist
  support/                  ← test data through the API
  scripts/                  ← local stand (backend + frontend image)
```
