import { Logger, type LoggerService } from '@nestjs/common';
import { createTestApp, resetDb } from './helpers';

class CapturingLogger implements LoggerService {
  readonly entries: Record<string, unknown>[] = [];
  log(message: unknown): void {
    if (message !== null && typeof message === 'object') this.entries.push(message as Record<string, unknown>);
  }
  error(message: unknown): void {
    this.log(message);
  }
  warn(message: unknown): void {
    this.log(message);
  }
}

async function run(env: Record<string, string>) {
  const t = await createTestApp({ env });
  await resetDb(t.prisma);
  const logger = new CapturingLogger();
  Logger.overrideLogger(logger);
  const res = await t.http().get('/api/conferences');
  await t.close();
  Logger.overrideLogger(false);
  return { requestId: res.headers['x-request-id'], entries: logger.entries };
}

describe('logs (CFG-2)', () => {
  it('has no SQL without LOG_SQL, but logs the request with its id', async () => {
    const { requestId, entries } = await run({});
    expect(entries.some((e) => 'query' in e)).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ requestId, method: 'GET', path: '/api/conferences', status: 200 }));
  });
  it('logs SQL with the request id and without parameters under LOG_SQL=true', async () => {
    const { requestId, entries } = await run({ LOG_SQL: 'true' });
    const sql = entries.filter((e) => 'query' in e);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.every((e) => e.requestId === requestId)).toBe(true);
    expect(sql.some((e) => 'params' in e)).toBe(false);
  });
  it('adds parameters only with LOG_SQL_PARAMS=true', async () => {
    const { entries } = await run({ LOG_SQL: 'true', LOG_SQL_PARAMS: 'true' });
    expect(entries.filter((e) => 'query' in e).every((e) => 'params' in e)).toBe(true);
  });
});
