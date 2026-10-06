import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type Request, type Response } from 'express';
import { AllExceptionsFilter } from './common/exception.filter';
import { BODY_LIMIT, bodyParserErrorHandler, contentTypeMiddleware, isJsonContentType, methodNotAllowedMiddleware } from './common/http-middleware';
import { requestContextMiddleware } from './common/request-context';
import { AppValidationPipe } from './common/validation';
import { writeError } from './common/write-error';
import { AppConfig } from './config/app-config';
import { setupSwagger } from './swagger/swagger';

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
  if (config.swaggerEnabled) setupSwagger(app);
}

// Called after app.init(): with a global prefix Nest answers unknown routes only under /api; every other path would fall
// through to the HTML "Cannot GET" page of Express. The last middleware answers them in the error format of spec 5.6.
export function installNotFoundFallback(app: NestExpressApplication): void {
  app.use((_req: Request, res: Response) => writeError(res, { status: 404, message: 'Route not found' }));
}
