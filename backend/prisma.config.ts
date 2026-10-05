import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node dist/prisma/seed.js' },
  // No datasource without DATABASE_URL, so that `prisma generate` runs in the Docker build stage.
  ...(url ? { datasource: { url, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } } : {}),
});
