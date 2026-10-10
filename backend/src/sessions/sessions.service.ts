import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { isWithinDays, requireWallClock } from '../common/dates';
import { notFound, unprocessable, type FieldError } from '../common/errors';
import { lockConference, type LockedConference, type Tx } from '../common/locking';
import { PrismaService } from '../prisma/prisma.service';
import { toSession, toSessionDetail } from '../representation/mappers';
import type { SessionDetailResponse, SessionResponse } from '../representation/responses';
import { sessionWithRelations } from '../representation/selects';
import { countEntries, logPromotions, promoteFromWaitlist } from '../session-registrations/promotion';
import { closedReason } from '../session-registrations/waitlist';
import type { CreateSessionDto, UpdateSessionDto } from './session.dto';

interface SessionData {
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  capacity: number;
  speakerId: number | null;
  roomId: number | null;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async listForConference(conferenceId: number): Promise<SessionResponse[]> {
    const conference = await this.prisma.conference.findUnique({ where: { id: conferenceId }, select: { id: true } });
    if (!conference) throw notFound(`Conference ${conferenceId} not found`);
    const rows = await this.prisma.session.findMany({ where: { conferenceId }, select: sessionWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toSession(row, now));
  }

  async get(id: number): Promise<SessionDetailResponse> {
    const row = await this.prisma.session.findUnique({ where: { id }, select: sessionWithRelations });
    if (!row) throw notFound(`Session ${id} not found`);
    return toSessionDetail(row, await countEntries(this.prisma, id), this.clock.now());
  }

  async create(conferenceId: number, dto: CreateSessionDto): Promise<SessionResponse> {
    const data = toSessionData(dto);
    // The conference row is locked: a concurrent PUT of the conference could otherwise move its dates so that this
    // session ends up outside them (spec 6.3). A missing speaker/room fails on the FK -> 422, no pre-check (spec 5.6).
    const row = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, conferenceId);
      if (!conference) throw notFound(`Conference ${conferenceId} not found`);
      await checkRules(tx, conference, data);
      return tx.session.create({ data: { ...data, conferenceId }, select: sessionWithRelations });
    });
    return toSession(row, this.clock.now());
  }

  async update(id: number, dto: UpdateSessionDto): Promise<SessionResponse> {
    const data = toSessionData(dto);
    const current = await this.prisma.session.findUnique({ where: { id }, select: { conferenceId: true } });
    if (!current) throw notFound(`Session ${id} not found`);
    // Same lock as create: the rules depend on the conference dates. conferenceId never changes, so reading it first is safe.
    // The confirmed count is read under the lock: session registrations change it from under a stale read (BEVN-202 spec 5.1).
    const { row, promoted } = await this.prisma.$transaction(async (tx) => {
      const conference = await lockConference(tx, current.conferenceId);
      if (!conference) throw notFound(`Conference ${current.conferenceId} not found`);
      const { registeredCount } = await countEntries(tx, id);
      await checkRules(tx, conference, data, registeredCount);
      const row = await tx.session.update({ where: { id }, data, select: sessionWithRelations });
      // While registration is open after the change (new startTime), free seats go to the waitlist first: after a capacity
      // increase and when a started session moves back into the future (spec 4.5, plan decision 12).
      const open = closedReason(conference, row, this.clock.now()) === null;
      return { row, promoted: open ? await promoteFromWaitlist(tx, row) : [] };
    });
    logPromotions(promoted, 'session-update');
    return toSession(row, this.clock.now());
  }
}

function toSessionData(dto: CreateSessionDto | UpdateSessionDto): SessionData {
  return {
    title: dto.title,
    description: dto.description ?? null,
    startTime: requireWallClock(dto.startTime),
    endTime: requireWallClock(dto.endTime),
    capacity: dto.capacity,
    speakerId: dto.speakerId ?? null,
    roomId: dto.roomId ?? null,
  };
}

async function checkRules(tx: Tx, conference: LockedConference, data: SessionData, registeredCount = 0): Promise<void> {
  const errors: FieldError[] = [];
  // One entry per field with all its messages, like flattenValidationErrors.
  const fail = (field: string, message: string) => {
    const existing = errors.find((e) => e.field === field);
    if (existing) existing.messages.push(message);
    else errors.push({ field, messages: [message] });
  };
  if (!isWithinDays(data.startTime, data.endTime, conference.startDate, conference.endDate)) {
    fail('startTime', 'the session must take place within the conference days');
  }
  if (data.roomId !== null) {
    const room = await tx.room.findUnique({ where: { id: data.roomId }, select: { capacity: true } });
    if (room && data.capacity > room.capacity) fail('capacity', `capacity must not exceed the room capacity (${room.capacity})`);
  }
  if (data.capacity < registeredCount) fail('capacity', `capacity must not be below the number of confirmed registrations (${registeredCount})`);
  if (errors.length > 0) throw unprocessable('Session violates conference rules', errors);
}
