# BrownEvents (.NET)

> **Тестовое задание:** правила, маршрут тасок и сайд-квесты — в репозитории
> [rolling-scopes-school/ai-native](https://github.com/rolling-scopes-school/ai-native/tree/main/test-task).
> Здесь — только код.

Conference management application — the .NET version of the BrownEvents brownfield reference project.

**Stack:** ASP.NET Core 6 · EF Core 6 · PostgreSQL 14 · React 18 · Vite

---

## Quick Start

```bash
docker-compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000/api |
| Swagger UI | http://localhost:5000/swagger |

The backend seeds demo data (3 conferences, 7 sessions, 3 speakers) on first startup.

---

## Development Setup

### Backend

Requirements: .NET 6 SDK, PostgreSQL 14

```bash
# Start only the database
docker-compose up postgres -d

# Run the API
cd backend
dotnet run --project BrownEvents.Api

# Run tests
dotnet test BrownEvents.Tests
```

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
  BrownEvents.Api/          ← ASP.NET Core Web API
    Controllers/            ← HTTP layer
    Services/               ← business logic
    Models/                 ← EF Core entities
    Data/                   ← DbContext + DataSeeder
  BrownEvents.Tests/        ← xUnit unit tests

frontend/
  src/
    pages/                  ← React page components
    components/             ← shared UI components
    api.js                  ← HTTP client
```
