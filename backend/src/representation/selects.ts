import type { Prisma } from '../generated/prisma/client';

// One record and its direct relations, each with its own fields only (BEVN-101 criterion, spec 5.2).
export const conferenceFields = {
  id: true, title: true, description: true, location: true, venue: true, startDate: true, endDate: true,
  status: true, maxAttendees: true, organizerName: true, website: true,
} satisfies Prisma.ConferenceSelect;
export const sessionFields = {
  id: true, title: true, description: true, startTime: true, endTime: true, capacity: true, conferenceId: true, speakerId: true, roomId: true,
} satisfies Prisma.SessionSelect;
export const speakerFields = { id: true, firstName: true, lastName: true, bio: true, email: true, emailPublic: true } satisfies Prisma.SpeakerSelect;
export const roomFields = { id: true, name: true, capacity: true, location: true } satisfies Prisma.RoomSelect;
export const registrationFields = { id: true, registeredAt: true, status: true, conferenceId: true, attendeeId: true } satisfies Prisma.RegistrationSelect;
// Never the email of an attendee (SEC-1, spec 5.3).
export const attendeePublicFields = { id: true, firstName: true, lastName: true } satisfies Prisma.AttendeeSelect;

const byId = { id: 'asc' } as const;

export const conferenceWithRelations = {
  ...conferenceFields,
  sessions: { select: sessionFields, orderBy: byId },
  registrations: { select: registrationFields, orderBy: byId },
} satisfies Prisma.ConferenceSelect;
export const sessionWithRelations = {
  ...sessionFields,
  conference: { select: conferenceFields },
  speaker: { select: speakerFields },
  room: { select: roomFields },
} satisfies Prisma.SessionSelect;
export const registrationWithRelations = {
  ...registrationFields,
  conference: { select: conferenceFields },
  attendee: { select: attendeePublicFields },
} satisfies Prisma.RegistrationSelect;
export const speakerWithSessions = { ...speakerFields, sessions: { select: sessionFields, orderBy: byId } } satisfies Prisma.SpeakerSelect;

export type ConferenceRow = Prisma.ConferenceGetPayload<{ select: typeof conferenceFields }>;
export type ConferenceWithRelationsRow = Prisma.ConferenceGetPayload<{ select: typeof conferenceWithRelations }>;
export type SessionRow = Prisma.SessionGetPayload<{ select: typeof sessionFields }>;
export type SessionWithRelationsRow = Prisma.SessionGetPayload<{ select: typeof sessionWithRelations }>;
export type SpeakerRow = Prisma.SpeakerGetPayload<{ select: typeof speakerFields }>;
export type SpeakerWithSessionsRow = Prisma.SpeakerGetPayload<{ select: typeof speakerWithSessions }>;
export type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomFields }>;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ select: typeof registrationFields }>;
export type RegistrationWithRelationsRow = Prisma.RegistrationGetPayload<{ select: typeof registrationWithRelations }>;
