import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { AllExceptionsFilter } from './common/exception.filter';
import { BODY_LIMIT, bodyParserErrorHandler, contentTypeMiddleware, isJsonContentType, methodNotAllowedMiddleware } from './common/http-middleware';
import { requestContextMiddleware } from './common/request-context';
import { AppValidationPipe } from './common/validation';
import { AppConfig } from './config/app-config';

// Order matters: request id first (every later answer carries it), CORS before any error so errors keep the
// CORS headers (CFG-3), 405 and 415 before the parser, the parser's own errors right after it.
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.use(requestContextMiddleware(new Logger('HTTP')));
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.use(methodNotAllowedMiddleware);
  app.use(contentTypeMiddleware);
  app.use(json({ limit: BODY_LIMIT, strict: true, type: (req) => isJsonContentType(req.headers['content-type']) }));
  app.use(bodyParserErrorHandler);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
