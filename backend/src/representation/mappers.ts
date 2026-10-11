import { formatInstant, formatWallClock } from '../common/dates';
import { computeStatus } from '../common/status';
import type { RegistrationStatus } from '../registrations/registration-rules';
import type { EntryCounts } from '../session-registrations/promotion';
import type { EntryStatus } from '../session-registrations/waitlist';
import type {
  AttendeeRegistrationResponse, ConferenceResponse, ConferenceSummaryResponse, RegistrationResponse, RegistrationSummaryResponse, RoomResponse,
  SessionDetailResponse, SessionRegistrationResponse, SessionResponse, SessionSummaryResponse, SpeakerResponse, SpeakerSummaryResponse,
} from './responses';
import type {
  AttendeeRegistrationRow, ConferenceRow, ConferenceWithRelationsRow, RegistrationRow, RegistrationWithRelationsRow, RoomRow,
  SessionRegistrationRow, SessionRow, SessionWithRelationsRow, SpeakerRow, SpeakerWithSessionsRow,
} from './selects';

export function toConferenceSummary(c: ConferenceRow, now: Date): ConferenceSummaryResponse {
  return {
    id: c.id, title: c.title, description: c.description, location: c.location, venue: c.venue,
    startDate: formatWallClock(c.startDate), endDate: formatWallClock(c.endDate),
    status: computeStatus(c.startDate, c.endDate, c.status === 'CANCELLED', now),
    maxAttendees: c.maxAttendees, organizerName: c.organizerName, website: c.website,
  };
}

export function toSessionSummary(s: SessionRow): SessionSummaryResponse {
  return {
    id: s.id, title: s.title, description: s.description, startTime: formatWallClock(s.startTime), endTime: formatWallClock(s.endTime),
    capacity: s.capacity, conferenceId: s.conferenceId, speakerId: s.speakerId, roomId: s.roomId,
  };
}

export function toRegistrationSummary(r: RegistrationRow): RegistrationSummaryResponse {
  // The CHECK constraint keeps Status within REGISTRATION_STATUSES.
  return { id: r.id, registeredAt: formatInstant(r.registeredAt), status: r.status as RegistrationStatus, conferenceId: r.conferenceId, attendeeId: r.attendeeId };
}

export function toConference(c: ConferenceWithRelationsRow, now: Date): ConferenceResponse {
  return { ...toConferenceSummary(c, now), sessions: c.sessions.map(toSessionSummary), registrations: c.registrations.map(toRegistrationSummary) };
}

export function toSpeakerSummary(sp: SpeakerRow): SpeakerSummaryResponse {
  return { id: sp.id, firstName: sp.firstName, lastName: sp.lastName, bio: sp.bio, email: sp.emailPublic ? sp.email : null, emailPublic: sp.emailPublic };
}

export function toSpeaker(sp: SpeakerWithSessionsRow): SpeakerResponse {
  return { ...toSpeakerSummary(sp), sessions: sp.sessions.map(toSessionSummary) };
}

export function toRoom(r: RoomRow): RoomResponse {
  return { id: r.id, name: r.name, capacity: r.capacity, location: r.location };
}

export function toSession(s: SessionWithRelationsRow, now: Date): SessionResponse {
  return {
    ...toSessionSummary(s),
    conference: toConferenceSummary(s.conference, now),
    speaker: s.speaker ? toSpeakerSummary(s.speaker) : null,
    room: s.room ? toRoom(s.room) : null,
  };
}

export function toRegistration(r: RegistrationWithRelationsRow, now: Date): RegistrationResponse {
  return {
    ...toRegistrationSummary(r),
    conference: toConferenceSummary(r.conference, now),
    attendee: { id: r.attendee.id, firstName: r.attendee.firstName, lastName: r.attendee.lastName },
  };
}

export function toAttendeeRegistration(r: AttendeeRegistrationRow, now: Date): AttendeeRegistrationResponse {
  // The CHECK constraint keeps Status within REGISTRATION_STATUSES.
  return { id: r.id, status: r.status as RegistrationStatus, registeredAt: formatInstant(r.registeredAt), conference: toConferenceSummary(r.conference, now) };
}

export function toSessionDetail(s: SessionWithRelationsRow, counts: EntryCounts, now: Date): SessionDetailResponse {
  return { ...toSession(s, now), registeredCount: counts.registeredCount, waitlistCount: counts.waitlistCount };
}

export function toSessionRegistration(r: SessionRegistrationRow): SessionRegistrationResponse {
  // The CHECK constraint keeps Status within ENTRY_STATUSES.
  return { id: r.id, sessionId: r.sessionId, attendeeId: r.attendeeId, status: r.status as EntryStatus, createdAt: formatInstant(r.createdAt) };
}
