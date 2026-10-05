import { formatInstant, formatWallClock } from '../common/dates';
import { computeStatus } from '../common/status';
import type {
  ConferenceResponse, ConferenceSummaryResponse, RegistrationResponse, RegistrationSummaryResponse, RoomResponse,
  SessionResponse, SessionSummaryResponse, SpeakerResponse, SpeakerSummaryResponse,
} from './responses';
import type {
  ConferenceRow, ConferenceWithRelationsRow, RegistrationRow, RegistrationWithRelationsRow, RoomRow,
  SessionRow, SessionWithRelationsRow, SpeakerRow, SpeakerWithSessionsRow,
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
  return { id: r.id, registeredAt: formatInstant(r.registeredAt), status: r.status, conferenceId: r.conferenceId, attendeeId: r.attendeeId };
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
