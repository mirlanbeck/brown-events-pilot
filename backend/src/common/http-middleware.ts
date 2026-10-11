import type { NextFunction, Request, Response } from 'express';
import { writeError } from './write-error';

export const BODY_LIMIT = '100kb';

// Routes of the public API (spec 5.8) with their methods. A test compares this table with the Swagger document,
// so the 405 answer cannot drift from the real routes.
export const API_ROUTES = [
  { path: '/api/conferences', pattern: /^\/api\/conferences\/?$/, methods: ['GET', 'POST'] },
  { path: '/api/conferences/{id}', pattern: /^\/api\/conferences\/[^/]+\/?$/, methods: ['GET', 'PUT'] },
  { path: '/api/conferences/{id}/sessions', pattern: /^\/api\/conferences\/[^/]+\/sessions\/?$/, methods: ['GET', 'POST'] },
  { path: '/api/conferences/{id}/registrations', pattern: /^\/api\/conferences\/[^/]+\/registrations\/?$/, methods: ['GET'] },
  { path: '/api/conferences/{id}/register', pattern: /^\/api\/conferences\/[^/]+\/register\/?$/, methods: ['POST'] },
  { path: '/api/sessions/{id}', pattern: /^\/api\/sessions\/[^/]+\/?$/, methods: ['GET', 'PUT'] },
  { path: '/api/sessions/{id}/register', pattern: /^\/api\/sessions\/[^/]+\/register\/?$/, methods: ['POST'] },
  { path: '/api/sessions/{id}/waitlist', pattern: /^\/api\/sessions\/[^/]+\/waitlist\/?$/, methods: ['POST'] },
  { path: '/api/sessions/{id}/cancel', pattern: /^\/api\/sessions\/[^/]+\/cancel\/?$/, methods: ['POST'] },
  { path: '/api/speakers', pattern: /^\/api\/speakers\/?$/, methods: ['GET', 'POST'] },
  { path: '/api/attendees/{email}/registrations', pattern: /^\/api\/attendees\/[^/]+\/registrations\/?$/, methods: ['GET'] },
  { path: '/api/attendees/{email}/registrations/{id}/cancel', pattern: /^\/api\/attendees\/[^/]+\/registrations\/[^/]+\/cancel\/?$/, methods: ['POST'] },
] as const;

export function methodNotAllowedMiddleware(req: Request, res: Response, next: NextFunction): void {
  const route = API_ROUTES.find((r) => r.pattern.test(req.path));
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (req.method === 'OPTIONS' || !route || (route.methods as readonly string[]).includes(method)) {
    next();
    return;
  }
  writeError(res, { status: 405, message: `Method ${req.method} is not allowed for this path`, headers: { Allow: route.methods.join(', ') } });
}

export function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const mediaType = header.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || /^application\/[a-z0-9.!#$&^_-]+\+json$/.test(mediaType);
}

// 415 before the body parser: otherwise a non-JSON body would reach validation as an empty object and answer 400 (spec 5.4).
export function contentTypeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasBody = req.method === 'POST' || req.method === 'PUT';
  if (hasBody && req.path.startsWith('/api/') && !isJsonContentType(req.headers['content-type'])) {
    writeError(res, { status: 415, message: 'Content-Type must be application/json' });
    return;
  }
  next();
}

interface HttpLikeError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

// The 4xx status an Express-style error (http-errors, body-parser) carries, or null.
export function clientErrorStatus(error: unknown): number | null {
  const e = error as HttpLikeError | null;
  const status = typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : NaN;
  return status >= 400 && status < 500 ? status : null;
}

// Parser messages ("Unexpected token } in JSON at position 10") are not sent to the client (spec 5.6).
export function bodyParserErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (error as HttpLikeError | null)?.type;
  if (type === 'entity.parse.failed') return writeError(res, { status: 400, message: 'Request body is not valid JSON' });
  if (type === 'entity.too.large') return writeError(res, { status: 413, message: `Request body exceeds ${BODY_LIMIT}` });
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') return writeError(res, { status: 415, message: 'Unsupported request body encoding' });
  if (typeof type === 'string') {
    // Any other body-parser error (corrupt gzip, size mismatch, aborted stream): its own 4xx, never its text.
    const status = clientErrorStatus(error);
    return writeError(res, status ? { status, message: 'Request body could not be read' } : { status: 500, message: 'Internal server error' });
  }
  next(error);
}
