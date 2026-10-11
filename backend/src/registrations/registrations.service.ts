import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock';
import { conflict, notFound } from '../common/errors';
import { lockConference } from '../common/locking';
import { requestContext } from '../common/request-context';
import { computeStatus, isRegistrationOpen } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { toAttendeeRegistration, toRegistration } from '../representation/mappers';
import type { AttendeeRegistrationResponse, RegistrationResponse } from '../representation/responses';
import { attendeeRegistrationFields, registrationWithRelations } from '../representation/selects';
import { logPromotions, promoteConference } from '../session-registrations/promotion';
import { ACTIVE_STATUSES } from '../session-registrations/waitlist';
import type { RegisterAttendeeDto } from './register.dto';
import { decideCancelRegistration, decideRegister, REGISTRATION_MESSAGES, type RegistrationStatus } from './registration-rules';

const logger = new Logger('Registrations');

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async listForConference(conferenceId: number): Promise<RegistrationResponse[]> {
    const conference = await this.prisma.conference.findUnique({ where: { id: conferenceId }, select: { id: true } });
    if (!conference) throw notFound(`Conference ${conferenceId} not found`);
    const rows = await this.prisma.registration.findMany({ where: { conferenceId }, select: registrationWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toRegistration(row, now));
  }

  // One query whatever the number of registrations (PERF-1): an unknown email and an attendee without registrations
  // both give [] (spec 4.2), so the attendee is not looked up separately (plan decision 1).
  async listForAttendee(email: string): Promise<AttendeeRegistrationResponse[]> {
    const rows = await this.prisma.registration.findMany({
      where: { attendee: { email } },
      select: attendeeRegistrationFields,
      orderBy: [{ conference: { startDate: 'asc' } }, { id: 'asc' }],
    });
    const now = this.clock.now();
    return rows.map((row) => toAttendeeRegistration(row, now));
  }

  async register(conferenceId: number, dto: RegisterAttendeeDto): Promise<RegistrationResponse> {
    const now = this.clock.now();
    // One transaction with the conference row locked (spec 6.2). Without it a failure after creating the attendee
    // left an orphan attendee (REL-5), and two requests for the last seat could both pass the count check (CORR-1).
    const row = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(`Conference ${conferenceId} not found`);
      const status = computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now);
      if (!isRegistrationOpen(status)) throw conflict(`Registration is closed: the conference is ${status}`);
      // The conference lock does not cover the same new email arriving for another conference at the same time:
      // ON CONFLICT waits for the other insert and then reuses its row instead of failing with a unique violation.
      await tx.$executeRaw`
        INSERT INTO "attendees" ("FirstName", "LastName", "Email") VALUES (${dto.firstName}, ${dto.lastName}, ${dto.email})
        ON CONFLICT ("Email") DO NOTHING`;
      const attendee = await tx.attendee.findUniqueOrThrow({ where: { email: dto.email }, select: { id: true } });
      const existing = await tx.registration.findUnique({ where: { conferenceId_attendeeId: { conferenceId, attendeeId: attendee.id } }, select: { id: true, status: true } });
      const taken = conference.maxAttendees === null ? 0 : await tx.registration.count({ where: { conferenceId, status: 'CONFIRMED' } });
      // The CHECK constraint keeps Status within REGISTRATION_STATUSES.
      const decision = decideRegister({ existing: existing ? (existing.status as RegistrationStatus) : null, taken, maxAttendees: conference.maxAttendees });
      if (!decision.ok) throw conflict(decision.message);
      // A cancelled row comes back (spec 4.5): one row per conference and attendee, the unique index is unchanged.
      if (decision.action === 'reactivate' && existing) {
        return tx.registration.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', registeredAt: now }, select: registrationWithRelations });
      }
      return tx.registration.create({ data: { conferenceId, attendeeId: attendee.id, registeredAt: now }, select: registrationWithRelations });
    });
    return toRegistration(row, now);
  }

  // Spec 5.1. A registration never moves between conferences and is never deleted, and the email of an attendee never
  // changes, so its conference is safe to read before the lock (as conferenceOf in BEVN-202).
  async cancelForAttendee(email: string, registrationId: number): Promise<AttendeeRegistrationResponse> {
    const found = await this.prisma.registration.findFirst({ where: { id: registrationId, attendee: { email } }, select: { conferenceId: true, attendeeId: true } });
    if (!found) throw notFound(REGISTRATION_MESSAGES.notFound(registrationId));
    const { conferenceId, attendeeId } = found;
    const now = this.clock.now();
    const { row, promoted, sessionEntriesCancelled } = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(REGISTRATION_MESSAGES.notFound(registrationId));
      const current = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { status: true } });
      const decision = decideCancelRegistration({
        status: current.status as RegistrationStatus, // the CHECK constraint keeps Status within REGISTRATION_STATUSES
        conferenceStatus: computeStatus(conference.startDate, conference.endDate, conference.status === 'CANCELLED', now),
      });
      if (!decision.ok) throw conflict(decision.message, decision.reason);
      const row = await tx.registration.update({ where: { id: registrationId }, data: { status: 'CANCELLED' }, select: attendeeRegistrationFields });
      // First take the attendee's places in every session of the conference, started ones included (spec 2)...
      const { count } = await tx.sessionRegistration.updateMany({
        where: { attendeeId, status: { in: ACTIVE_STATUSES }, session: { conferenceId } },
        data: { status: 'CANCELLED' },
      });
      // ...then give the free seats to the waitlists of the sessions with open registration (spec 5.2).
      const promoted = await promoteConference(tx, conference, now);
      return { row, promoted, sessionEntriesCancelled: count };
    });
    // After the commit (spec 5.3): cause first, then the promotions (plan decision 5). No email or names (SEC-1).
    logger.log({ event: 'registration.cancelled', requestId: requestContext.getStore()?.requestId, registrationId, attendeeId, conferenceId, sessionEntriesCancelled });
    logPromotions(promoted, 'conference-cancel');
    return toAttendeeRegistration(row, now);
  }
}
