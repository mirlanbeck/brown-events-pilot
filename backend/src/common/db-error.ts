import { Prisma } from '../generated/prisma/client';
import type { ConflictReason, FieldError } from './errors';

export interface ErrorSpec {
  status: number;
  message: string;
  errors?: FieldError[];
  headers?: Record<string, string>;
  reason?: ConflictReason;
  /** Logged, never sent to the client. */
  detail?: string;
}

export interface DbErrorInfo {
  prismaCode: string;
  pgCode?: string;
  constraint?: string;
}

const FK_FIELDS: Record<string, string> = {
  FK_sessions_speakers_SpeakerId: 'speakerId',
  FK_sessions_rooms_RoomId: 'roomId',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// Shape observed for Prisma 7.10 + adapter-pg (probes in test/integration/db-errors.e2e-spec.ts):
// meta.driverAdapterError.cause.originalCode = Postgres SQLSTATE; cause.constraint.index = constraint name for unique
// and FK violations. CHECK violations carry no name (only the message, whose detail holds the whole row — not logged).
export function inspectDbError(error: unknown): DbErrorInfo | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const cause = record(record(record(error.meta).driverAdapterError).cause);
  return {
    prismaCode: error.code,
    pgCode: text(cause.originalCode),
    constraint: text(record(cause.constraint).index),
  };
}

const busy = (): ErrorSpec => ({ status: 503, message: 'The database is busy, retry the request', headers: { 'Retry-After': '1' } });

export function mapDbError(error: unknown): ErrorSpec | null {
  const info = inspectDbError(error);
  if (!info) return null;
  const { prismaCode, pgCode, constraint } = info;
  if (prismaCode === 'P2028' || pgCode === '55P03' || pgCode === '57014') return busy();
  if (prismaCode === 'P1001' || prismaCode === 'P1017') return { status: 503, message: 'The database is unavailable', headers: { 'Retry-After': '1' } };
  if (pgCode === '23514') return { status: 400, message: 'The request violates a data constraint', detail: constraint };
  if (pgCode === '22003') return { status: 400, message: 'A number in the request is out of range' };
  if (prismaCode === 'P2003' || pgCode === '23503') {
    const field = constraint ? FK_FIELDS[constraint] : undefined;
    if (!field) return null;
    return { status: 422, message: 'Referenced record does not exist', errors: [{ field, messages: [`${field} does not reference an existing record`] }] };
  }
  if (prismaCode === 'P2002' || pgCode === '23505') return { status: 409, message: 'The request conflicts with an existing record', detail: constraint };
  if (prismaCode === 'P2025') return { status: 404, message: 'Resource not found' };
  return null;
}
