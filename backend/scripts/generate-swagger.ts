import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AppConfig } from '../src/config/app-config';
import { buildSwaggerDocument } from '../src/swagger/swagger';

// OpenAPI document for the CI artifact (SEC-5 Fix). DATABASE_URL must be set but is never used: Prisma connects lazily.
async function main(): Promise<void> {
  const out = process.argv[2] ?? 'swagger.json';
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(process.env), { bodyParser: false, logger: false });
  configureApp(app, { ...app.get(AppConfig), swaggerEnabled: false });
  writeFileSync(out, `${JSON.stringify(buildSwaggerDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
