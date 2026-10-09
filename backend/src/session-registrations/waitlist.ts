import type { ConflictReason } from '../common/errors';
import { computeStatus, isRegistrationOpen } from '../common/status';

// Decisions of BEVN-202 as pure functions (spec 8): the service reads the state under the conference lock, these decide.
export const ENTRY_STATUSES = ['CONFIRMED', 'WAITLISTED', 'CANCELLED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export type ActiveStatus = Exclude<EntryStatus, 'CANCELLED'>;
export const ACTIVE_STATUSES: ActiveStatus[] = ['CONFIRMED', 'WAITLISTED'];

export const MESSAGES = {
  conferenceRegistrationRequired: 'Register for the conference before registering for its sessions',
  alreadyRegistered: 'Attendee is already registered for this session',
  alreadyWaitlisted: 'Attendee is already on the waitlist for this session',
  overlap: 'Attendee is registered or waitlisted for another session at the same time',
  full: 'No seats left in this session; join the waitlist instead',
  seatsAvailable: 'The session has free seats; register instead',
  noActiveEntry: 'No active registration or waitlist place for this email on this session',
} as const;

export const closedMessage = (why: string) => `Registration is closed: ${why}`;

export interface Interval {
  startTime: Date;
  endTime: Date;
}

// Half-open [start, end): back-to-back sessions do not overlap (spec 2).
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime();
}

// Spec 4.4: open while the conference is UPCOMING or ACTIVE and the session has not started. The start time has no zone and
// is compared as UTC (spec EXT-150 6.1), so the closing moment is off by the venue's UTC offset in either direction.
export function closedReason(conference: { startDate: Date; endDate: Date; status: string | null }, session: { startTime: Date }, now: Date): string | null {
  const status = computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now);
  if (!isRegistrationOpen(status)) return `the conference is ${status}`;
  if (now.getTime() >= session.startTime.getTime()) return 'the session has started';
  return null;
}

export type JoinKind = 'register' | 'waitlist';

export interface JoinState {
  closed: string | null;
  attendeeId: number | null; // null: no attendee with this email
  conferenceRegistered: boolean; // a CONFIRMED registration for the session's conference
  current: ActiveStatus | null; // the attendee's active entry on this session
  overlapping: boolean; // an active entry on another session of the same conference overlaps this one
  registeredCount: number;
  capacity: number;
}

export type JoinDecision =
  | { ok: true; status: ActiveStatus; attendeeId: number }
  | { ok: false; reason: ConflictReason; message: string };

const refuse = (reason: ConflictReason, message: string): JoinDecision => ({ ok: false, reason, message });

// The first failed check answers (spec 4.2).
export function decideJoin(kind: JoinKind, s: JoinState): JoinDecision {
  if (s.closed !== null) return refuse('REGISTRATION_CLOSED', closedMessage(s.closed));
  if (s.attendeeId === null || !s.conferenceRegistered) return refuse('CONFERENCE_REGISTRATION_REQUIRED', MESSAGES.conferenceRegistrationRequired);
  if (s.current === 'CONFIRMED') return refuse('ALREADY_REGISTERED', MESSAGES.alreadyRegistered);
  if (s.current === 'WAITLISTED') return refuse('ALREADY_REGISTERED', MESSAGES.alreadyWaitlisted);
  if (s.overlapping) return refuse('SESSION_OVERLAP', MESSAGES.overlap);
  const full = s.registeredCount >= s.capacity;
  if (kind === 'register' && full) return refuse('SESSION_FULL', MESSAGES.full);
  if (kind === 'waitlist' && !full) return refuse('SEATS_AVAILABLE', MESSAGES.seatsAvailable);
  return { ok: true, status: kind === 'register' ? 'CONFIRMED' : 'WAITLISTED', attendeeId: s.attendeeId };
}

export function seatsToFill(capacity: number, registeredCount: number, waitlistCount: number): number {
  return Math.max(0, Math.min(capacity - registeredCount, waitlistCount));
}

// Waitlist order (spec 2): createdAt ascending, the smaller id first at equal times.
export function nextInLine<T extends { id: number; createdAt: Date }>(waitlist: T[], seats: number): T[] {
  return [...waitlist].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).slice(0, Math.max(0, seats));
}

export function decideCancel(current: ActiveStatus): { promote: boolean } {
  return { promote: current === 'CONFIRMED' };
}
