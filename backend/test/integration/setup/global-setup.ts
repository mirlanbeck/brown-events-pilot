import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-db-url';

export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testDatabaseUrl() } });
}
