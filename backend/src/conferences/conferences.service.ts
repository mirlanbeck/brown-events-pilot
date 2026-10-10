import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { isWithinDays, requireWallClock } from '../common/dates';
import { badRequest, conflict, notFound } from '../common/errors';
import { lockConference } from '../common/locking';
import { resolveStatusInput } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { toConference } from '../representation/mappers';
import type { ConferenceResponse } from '../representation/responses';
import { conferenceWithRelations } from '../representation/selects';
import { logPromotions, promoteConference } from '../session-registrations/promotion';
import type { CreateConferenceDto, UpdateConferenceDto } from './conference.dto';

@Injectable()
export class ConferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<ConferenceResponse[]> {
    const rows = await this.prisma.conference.findMany({ select: conferenceWithRelations, orderBy: { id: 'asc' } });
    const now = this.clock.now();
    return rows.map((row) => toConference(row, now));
  }

  async get(id: number): Promise<ConferenceResponse> {
    const row = await this.prisma.conference.findUnique({ where: { id }, select: conferenceWithRelations });
    if (!row) throw notFound(`Conference ${id} not found`);
    return toConference(row, this.clock.now());
  }

  async create(dto: CreateConferenceDto): Promise<ConferenceResponse> {
    const row = await this.prisma.conference.create({ data: this.toData(dto), select: conferenceWithRelations });
    return toConference(row, this.clock.now());
  }

  async update(id: number, dto: UpdateConferenceDto): Promise<ConferenceResponse> {
    const data = this.toData(dto);
    // One transaction with the conference row locked: without it a session added concurrently could end up outside
    // the new dates, and a failed check after the first write would leave a half-applied update (CORR-6, REL-4).
    const { row, promoted } = await this.prisma.$transaction(async (tx) => {
      if (!(await lockConference(tx, id))) throw notFound(`Conference ${id} not found`);
      const sessions = await tx.session.findMany({ where: { conferenceId: id }, select: { id: true, startTime: true, endTime: true }, orderBy: { id: 'asc' } });
      const outside = sessions.filter((s) => !isWithinDays(s.startTime, s.endTime, data.startDate, data.endDate));
      if (outside.length > 0) throw conflict(`Sessions ${outside.map((s) => s.id).join(', ')} would fall outside the new conference dates`);
      const row = await tx.conference.update({ where: { id }, data, select: conferenceWithRelations });
      // The update may open registration again (CANCELLED lifted, new dates): free seats go to the waitlists first (BEVN-202 spec 4.8).
      return { row, promoted: await promoteConference(tx, row, this.clock.now()) };
    });
    logPromotions(promoted, 'conference-update');
    return toConference(row, this.clock.now());
  }

  private toData(dto: CreateConferenceDto | UpdateConferenceDto) {
    const startDate = requireWallClock(dto.startDate);
    const endDate = requireWallClock(dto.endDate);
    const status = resolveStatusInput(dto.status, startDate, endDate, this.clock.now());
    if (!status.ok) throw badRequest('Validation failed', [{ field: 'status', messages: [status.message] }]);
    return {
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      venue: dto.venue ?? null,
      startDate,
      endDate,
      status: status.cancelled ? 'CANCELLED' : null,
      maxAttendees: dto.maxAttendees ?? null,
      organizerName: dto.organizerName ?? null,
      website: dto.website ?? null,
    };
  }
}
