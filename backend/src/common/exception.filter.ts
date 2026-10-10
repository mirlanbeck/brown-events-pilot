import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import { mapDbError, type ErrorSpec } from './db-error';
import { ApiError } from './errors';
import { clientErrorStatus } from './http-middleware';
import { requestIdOf, writeError } from './write-error';

export function toErrorSpec(exception: unknown): ErrorSpec {
  if (exception instanceof ApiError) {
    return { status: exception.status, message: exception.message, errors: exception.errors, headers: exception.headers, reason: exception.reason };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { status, message: status === 404 ? 'Route not found' : (STATUS_CODES[status] ?? 'Error') };
  }
  // Errors passed to next() by Express-level middleware (body-parser, http-errors) reach this filter too; keep their
  // 4xx status (a corrupt gzip body is the client's fault), never their message.
  const clientStatus = clientErrorStatus(exception);
  if (clientStatus) return { status: clientStatus, message: STATUS_CODES[clientStatus] ?? 'Error' };
  return mapDbError(exception) ?? { status: 500, message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const spec = toErrorSpec(exception);
    const requestId = requestIdOf(res);
    if (spec.status >= 500) {
      // Stack and driver details go to the log only (CFG-3).
      this.logger.error({ requestId, status: spec.status, error: exception instanceof Error ? exception.stack : String(exception) });
    } else if (spec.detail) {
      this.logger.warn({ requestId, status: spec.status, detail: spec.detail });
    }
    writeError(res, spec);
  }
}
