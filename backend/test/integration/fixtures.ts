import { requireWallClock } from '../../src/common/dates';
import type { PrismaService } from '../../src/prisma/prisma.service';

export const wall = requireWallClock;

export function makeConference(
  prisma: PrismaService,
  o: { title?: string; startDate?: string; endDate?: string; status?: string | null; maxAttendees?: number | null } = {},
) {
  return prisma.conference.create({
    data: {
      title: o.title ?? 'Test Conference',
      startDate: wall(o.startDate ?? '2027-01-10T00:00:00'),
      endDate: wall(o.endDate ?? '2027-01-11T00:00:00'),
      status: o.status ?? null,
      maxAttendees: o.maxAttendees ?? null,
    },
  });
}

export function makeSpeaker(prisma: PrismaService, o: { firstName?: string; email?: string | null; emailPublic?: boolean } = {}) {
  return prisma.speaker.create({
    data: { firstName: o.firstName ?? 'Alice', lastName: 'Novak', bio: 'Bio', email: o.email ?? 'alice.novak@example.com', emailPublic: o.emailPublic ?? false },
  });
}

export function makeRoom(prisma: PrismaService, o: { name?: string; capacity?: number } = {}) {
  return prisma.room.create({ data: { name: o.name ?? 'Hall A', capacity: o.capacity ?? 300, location: 'Ground Floor' } });
}

export function makeSession(
  prisma: PrismaService,
  conferenceId: number,
  o: { title?: string; startTime?: string; endTime?: string; capacity?: number; speakerId?: number | null; roomId?: number | null } = {},
) {
  return prisma.session.create({
    data: {
      title: o.title ?? 'Talk',
      startTime: wall(o.startTime ?? '2027-01-10T10:00:00'),
      endTime: wall(o.endTime ?? '2027-01-10T11:00:00'),
      capacity: o.capacity ?? 50,
      conferenceId,
      speakerId: o.speakerId ?? null,
      roomId: o.roomId ?? null,
    },
  });
}

export function makeAttendee(prisma: PrismaService, o: { firstName?: string; email?: string } = {}) {
  return prisma.attendee.create({ data: { firstName: o.firstName ?? 'Maria', lastName: 'Kowalska', email: o.email ?? 'maria.kowalska@example.com' } });
}

export function makeRegistration(prisma: PrismaService, conferenceId: number, attendeeId: number) {
  return prisma.registration.create({ data: { conferenceId, attendeeId, registeredAt: new Date('2026-10-01T09:00:00.000Z') } });
}
