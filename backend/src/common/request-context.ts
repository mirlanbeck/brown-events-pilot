import type { LoggerService } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// SEC-1 (BEVN-203 spec 4.8): the attendee email in the path never reaches the request log, whatever follows it and
// whatever the status. Express matches routes case-insensitively, so the mask does too (plan decision 6).
const ATTENDEE_SEGMENT = /^(\/api\/attendees\/)[^/?]+/i;

export function maskPath(url: string): string {
  return url.replace(ATTENDEE_SEGMENT, '$1***');
}

// The server always generates the id; an incoming X-Request-Id is ignored so clients cannot put text into the log (spec 5.6).
export function requestContextMiddleware(logger: LoggerService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.log({ requestId, method: req.method, path: maskPath(req.originalUrl), status: res.statusCode, durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
    });
    requestContext.run({ requestId }, next);
  };
}
