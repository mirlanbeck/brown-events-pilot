import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { conflict, notFound } from '../common/errors';
import { lockConference, type LockedConference, type Tx } from '../common/locking';
import { PrismaService } from '../prisma/prisma.service';
import { toSessionRegistration } from '../representation/mappers';
import type { SessionRegistrationResponse } from '../representation/responses';
import { sessionRegistrationFields } from '../representation/selects';
import { countEntries, logPromotions, promoteFromWaitlist } from './promotion';
import type { SessionAttendeeDto } from './session-attendee.dto';
import { ACTIVE_STATUSES, closedMessage, closedReason, decideCancel, decideJoin, MESSAGES, overlaps, type ActiveStatus, type JoinKind, type JoinState } from './waitlist';

export interface LockedSession {
  id: number;
  startTime: Date;
  endTime: Date;
  capacity: number;
}

// Spec 5.1: lock the conference, then re-read the session — capacity and times read before the lock could be stale
// against a concurrent PUT of the session.
export async function lockSession(tx: Tx, conferenceId: number, sessionId: number): Promise<{ conference: LockedConference; session: LockedSession }> {
  const conference = await lockConference(tx, conferenceId);
  const session = await tx.session.findUnique({ where: { id: sessionId }, select: { id: true, startTime: true, endTime: true, capacity: true } });
  if (!conference || !session) throw notFound(`Session ${sessionId} not found`);
  return { conference, session };
}

async function readJoinState(tx: Tx, conferenceId: number, session: LockedSession, email: string): Promise<Omit<JoinState, 'closed' | 'capacity'>> {
  const attendee = await tx.attendee.findUnique({ where: { email }, select: { id: true } });
  if (!attendee) return { attendeeId: null, conferenceRegistered: false, current: null, overlapping: false, registeredCount: 0 };
  const registration = await tx.registration.findFirst({ where: { conferenceId, attendeeId: attendee.id, status: 'CONFIRMED' }, select: { id: true } });
  // Active entries of the attendee in this conference with their times: the own entry and the overlap check (spec 2).
  const entries = await tx.sessionRegistration.findMany({
    where: { attendeeId: attendee.id, status: { in: ACTIVE_STATUSES }, session: { conferenceId } },
    select: { sessionId: true, status: true, session: { select: { startTime: true, endTime: true } } },
  });
  const own = entries.find((e) => e.sessionId === session.id);
  const { registeredCount } = await countEntries(tx, session.id);
  return {
    attendeeId: attendee.id,
    conferenceRegistered: registration !== null,
    current: own ? (own.status as ActiveStatus) : null,
    overlapping: entries.some((e) => e.sessionId !== session.id && overlaps(e.session, session)),
    registeredCount,
  };
}

@Injectable()
export class SessionRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  register(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.join('register', sessionId, dto.email);
  }

  joinWaitlist(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.join('waitlist', sessionId, dto.email);
  }

  async cancel(sessionId: number, dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    const conferenceId = await this.conferenceOf(sessionId);
    const now = this.clock.now();
    const { row, promoted } = await this.prisma.$transaction(async (tx) => {
      const { conference, session } = await lockSession(tx, conferenceId, sessionId);
      const closed = closedReason(conference, session, now);
      if (closed !== null) throw conflict(closedMessage(closed), 'REGISTRATION_CLOSED');
      // An unknown email and an email without an active entry give the same 404 (spec 4.3).
      const entry = await tx.sessionRegistration.findFirst({
        where: { sessionId, status: { in: ACTIVE_STATUSES }, attendee: { email: dto.email } },
        select: { id: true, status: true },
      });
      if (!entry) throw notFound(MESSAGES.noActiveEntry);
      const cancelled = await tx.sessionRegistration.update({ where: { id: entry.id }, data: { status: 'CANCELLED' }, select: sessionRegistrationFields });
      const promoted = decideCancel(entry.status as ActiveStatus).promote ? await promoteFromWaitlist(tx, session) : [];
      return { row: cancelled, promoted };
    });
    logPromotions(promoted, 'cancel');
    return toSessionRegistration(row);
  }

  // A session never moves between conferences, so its conferenceId is safe to read before the lock (spec 5.1).
  private async conferenceOf(sessionId: number): Promise<number> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { conferenceId: true } });
    if (!session) throw notFound(`Session ${sessionId} not found`);
    return session.conferenceId;
  }

  private async join(kind: JoinKind, sessionId: number, email: string): Promise<SessionRegistrationResponse> {
    const conferenceId = await this.conferenceOf(sessionId);
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const { conference, session } = await lockSession(tx, conferenceId, sessionId);
      const state = await readJoinState(tx, conferenceId, session, email);
      const decision = decideJoin(kind, { ...state, closed: closedReason(conference, session, now), capacity: session.capacity });
      if (!decision.ok) throw conflict(decision.message, decision.reason);
      return tx.sessionRegistration.create({
        data: { sessionId, attendeeId: decision.attendeeId, status: decision.status, createdAt: now },
        select: sessionRegistrationFields,
      });
    });
    return toSessionRegistration(row);
  }
}
