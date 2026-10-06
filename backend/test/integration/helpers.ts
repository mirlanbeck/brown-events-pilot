import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock, FixedClock } from '../../src/common/clock';
import { AppConfig, loadConfig } from '../../src/config/app-config';
import { configureApp, installNotFoundFallback } from '../../src/configure-app';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testDatabaseUrl } from './setup/test-db-url';

export { testDatabaseUrl };

export const DEFAULT_NOW = '2026-10-05T12:00:00.000Z';

export function newPrisma(env: Record<string, string> = {}): PrismaService {
  return new PrismaService(loadConfig({ DATABASE_URL: testDatabaseUrl(), ...env }));
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "registrations", "attendees", "sessions", "speakers", "rooms", "conferences" RESTART IDENTITY CASCADE`;
}

export interface TestApp {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  clock: FixedClock;
  close: () => Promise<void>;
}

export async function createTestApp(
  options: { now?: string; env?: Record<string, string>; beforeInit?: (app: NestExpressApplication) => void } = {},
): Promise<TestApp> {
  const env = { DATABASE_URL: testDatabaseUrl(), CORS_ORIGINS: 'http://localhost:5173', SWAGGER_ENABLED: 'true', ...options.env };
  const clock = new FixedClock(new Date(options.now ?? DEFAULT_NOW));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, app.get(AppConfig));
  options.beforeInit?.(app);
  // Listen once: on a server that is not listening, supertest calls listen(0) per request and stacks listeners on it.
  await app.listen(0, '127.0.0.1');
  installNotFoundFallback(app);
  return { app, http: () => request(app.getHttpServer()), prisma: app.get(PrismaService), clock, close: () => app.close() };
}
