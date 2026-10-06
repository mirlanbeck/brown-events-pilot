import { loadConfig } from './app-config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      port: 80,
      corsOrigins: [],
      swaggerEnabled: false,
      logSql: false,
      logSqlParams: false,
      statementTimeoutMs: 5000,
    });
  });

  it('turns flags on only for the exact value "true"', () => {
    const on = loadConfig({ ...base, SWAGGER_ENABLED: 'true', LOG_SQL: 'true', LOG_SQL_PARAMS: 'true' });
    expect([on.swaggerEnabled, on.logSql, on.logSqlParams]).toEqual([true, true, true]);
    const off = loadConfig({ ...base, SWAGGER_ENABLED: 'TRUE', LOG_SQL: '1', LOG_SQL_PARAMS: 'yes' });
    expect([off.swaggerEnabled, off.logSql, off.logSqlParams]).toEqual([false, false, false]);
  });

  it('parses CORS origins', () => {
    const cfg = loadConfig({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://app.example.com' });
    expect(cfg.corsOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('lists every invalid variable in one error', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'mysql://x', PORT: '0', DB_STATEMENT_TIMEOUT_MS: 'soon', CORS_ORIGINS: 'localhost:5173' }),
    ).toThrow(/DATABASE_URL[\s\S]*PORT[\s\S]*DB_STATEMENT_TIMEOUT_MS[\s\S]*CORS_ORIGINS/);
  });
});
