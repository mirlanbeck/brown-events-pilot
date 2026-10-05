import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import type { ErrorSpec } from './db-error';
import type { FieldError } from './errors';

export type { ErrorSpec } from './db-error';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  requestId: string;
  errors?: FieldError[];
}

export function requestIdOf(res: Response): string {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : '';
}

export function errorBody(spec: ErrorSpec, requestId: string): ErrorBody {
  return {
    statusCode: spec.status,
    error: STATUS_CODES[spec.status] ?? 'Error',
    message: spec.message,
    requestId,
    ...(spec.errors ? { errors: spec.errors } : {}),
  };
}

// The one place that writes an error response (spec 5.6). Used by the Nest filter and by the Express middleware
// that runs before Nest (405, 415, body parser), so every error has the same body and keeps the CORS headers.
export function writeError(res: Response, spec: ErrorSpec): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  for (const [name, value] of Object.entries(spec.headers ?? {})) res.setHeader(name, value);
  res.status(spec.status).json(errorBody(spec, requestIdOf(res)));
}
