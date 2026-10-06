import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, installNotFoundFallback } from './configure-app';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(process.env), {
    bodyParser: false, // configureApp installs its own parser with error handling (spec 5.6)
    logger: new ConsoleLogger({ json: true }),
  });
  const config = app.get(AppConfig);
  configureApp(app, config);
  await app.init();
  installNotFoundFallback(app);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
