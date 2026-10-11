import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { conflict, notFound } from '../common/errors';
import { lockConference } from '../common/locking';
import { computeStatus, isRegistrationOpen } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { toAttendeeRegistration, toRegistration } from '../representation/mappers';
import type { AttendeeRegistrationResponse, RegistrationResponse } from '../representation/responses';
import { attendeeRegistrationFields, registrationWithRelations } from '../representation/selects';
import type { RegisterAttendeeDto } from './register.dto';
import { decideRegister, type RegistrationStatus } from './registration-rules';

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
}
