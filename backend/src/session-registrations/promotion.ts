import { Logger } from '@nestjs/common';
import type { Tx } from '../common/locking';
import { requestContext } from '../common/request-context';
import { closedReason, nextInLine, seatsToFill } from './waitlist';

export interface EntryCounts {
  registeredCount: number;
  waitlistCount: number;
}

// Counts are computed, not stored (spec 3.2): one grouped query for both.
export async function countEntries(db: Tx, sessionId: number): Promise<EntryCounts> {
  const groups = await db.sessionRegistration.groupBy({
    by: ['status'],
    where: { sessionId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
    _count: { _all: true },
  });
  const of = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { registeredCount: of('CONFIRMED'), waitlistCount: of('WAITLISTED') };
}

export interface Promoted {
  registrationId: number;
  attendeeId: number;
  sessionId: number;
}

export type PromotionTrigger = 'cancel' | 'session-update' | 'conference-update' | 'conference-cancel';

// Spec 5.2: while seats are free and the waitlist is not empty, the first in line gets CONFIRMED. Runs in the caller's
// transaction under the conference lock; a failure rolls back the cancel or the PUT too. Overlaps are not re-checked:
// the waitlist place passed that check already (spec 5.2, limitations in 9).
export async function promoteFromWaitlist(tx: Tx, session: { id: number; capacity: number }): Promise<Promoted[]> {
  const waitlist = await tx.sessionRegistration.findMany({
    where: { sessionId: session.id, status: 'WAITLISTED' },
    select: { id: true, attendeeId: true, createdAt: true },
  });
  if (waitlist.length === 0) return [];
  const registeredCount = await tx.sessionRegistration.count({ where: { sessionId: session.id, status: 'CONFIRMED' } });
  const chosen = nextInLine(waitlist, seatsToFill(session.capacity, registeredCount, waitlist.length));
  if (chosen.length === 0) return [];
  await tx.sessionRegistration.updateMany({ where: { id: { in: chosen.map((e) => e.id) } }, data: { status: 'CONFIRMED' } });
  return chosen.map((e) => ({ registrationId: e.id, attendeeId: e.attendeeId, sessionId: session.id }));
}

// Spec 4.8, 5.2: after a PUT of the conference every session with open registration gives its free seats to its waitlist.
// A fixed number of queries whatever the number of sessions and entries (PERF-1): the waitlists of the conference in one read,
// the confirmed counts in one groupBy, one updateMany; the choice per session is the same seatsToFill/nextInLine.
export async function promoteConference(tx: Tx, conference: { id: number; startDate: Date; endDate: Date; status: string | null }, now: Date): Promise<Promoted[]> {
  const waiting = await tx.sessionRegistration.findMany({
    where: { status: 'WAITLISTED', session: { conferenceId: conference.id } },
    select: { id: true, attendeeId: true, createdAt: true, session: { select: { id: true, startTime: true, capacity: true } } },
  });
  const lines = new Map<number, { capacity: number; line: typeof waiting }>();
  for (const entry of waiting) {
    if (closedReason(conference, entry.session, now) !== null) continue;
    const group = lines.get(entry.session.id) ?? { capacity: entry.session.capacity, line: [] };
    group.line.push(entry);
    lines.set(entry.session.id, group);
  }
  if (lines.size === 0) return [];
  const confirmed = await tx.sessionRegistration.groupBy({
    by: ['sessionId'],
    where: { sessionId: { in: [...lines.keys()] }, status: 'CONFIRMED' },
    _count: { _all: true },
  });
  const promoted: Promoted[] = [];
  for (const [sessionId, { capacity, line }] of [...lines.entries()].sort(([a], [b]) => a - b)) {
    const registeredCount = confirmed.find((g) => g.sessionId === sessionId)?._count._all ?? 0;
    for (const e of nextInLine(line, seatsToFill(capacity, registeredCount, line.length))) {
      promoted.push({ registrationId: e.id, attendeeId: e.attendeeId, sessionId });
    }
  }
  if (promoted.length === 0) return [];
  await tx.sessionRegistration.updateMany({ where: { id: { in: promoted.map((p) => p.registrationId) } }, data: { status: 'CONFIRMED' } });
  return promoted;
}

const logger = new Logger('Waitlist');

// Called after the commit (spec 5.3): a rolled-back transaction leaves no entry about a promotion that did not happen.
// Nest has no "info" level; log is its INFO (spec 5.3). No email or names (SEC-1).
export function logPromotions(promoted: Promoted[], trigger: PromotionTrigger): void {
  const requestId = requestContext.getStore()?.requestId;
  for (const p of promoted) {
    logger.log({ event: 'waitlist.promoted', requestId, sessionId: p.sessionId, attendeeId: p.attendeeId, registrationId: p.registrationId, trigger });
  }
}
