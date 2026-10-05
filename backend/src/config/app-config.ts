// Abstract class (not an interface) so that Nest can inject it by type.
export abstract class AppConfig {
  abstract readonly databaseUrl: string;
  abstract readonly port: number;
  abstract readonly corsOrigins: string[];
  abstract readonly swaggerEnabled: boolean;
  abstract readonly logSql: boolean;
  abstract readonly logSqlParams: boolean;
  abstract readonly statementTimeoutMs: number;
}

type Env = Record<string, string | undefined>;

function intVar(name: string, raw: string | undefined, fallback: number, min: number, max: number, errors: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

export function loadConfig(env: Env): AppConfig {
  const errors: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a postgresql:// connection string');
  const port = intVar('PORT', env.PORT, 80, 1, 65535, errors);
  const statementTimeoutMs = intVar('DB_STATEMENT_TIMEOUT_MS', env.DB_STATEMENT_TIMEOUT_MS, 5000, 1, 600000, errors);
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  for (const origin of corsOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) errors.push(`CORS_ORIGINS entry "${origin}" must be an origin such as http://localhost:5173`);
  }
  if (errors.length > 0) throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
  return {
    databaseUrl,
    port,
    corsOrigins,
    swaggerEnabled: env.SWAGGER_ENABLED === 'true',
    logSql: env.LOG_SQL === 'true',
    logSqlParams: env.LOG_SQL_PARAMS === 'true',
    statementTimeoutMs,
  };
}
