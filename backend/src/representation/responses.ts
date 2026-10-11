import { ApiProperty } from '@nestjs/swagger';
import { CONFERENCE_STATUSES, type ConferenceStatus } from '../common/status';
import { CONFLICT_REASONS, type ConflictReason } from '../common/errors';
import { REGISTRATION_STATUSES, type RegistrationStatus } from '../registrations/registration-rules';
import { ENTRY_STATUSES, type EntryStatus } from '../session-registrations/waitlist';

const WALL = { type: String, example: '2025-03-05T10:00:00', description: 'Venue wall-clock time, YYYY-MM-DDTHH:mm:ss, no offset (spec 5.5)' };

export class ConferenceSummaryResponse {
  @ApiProperty({ example: 2 }) id!: number;
  @ApiProperty({ example: 'CloudOps Days' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Amsterdam, Netherlands' }) location!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Beurs van Berlage' }) venue!: string | null;
  @ApiProperty({ ...WALL, example: '2025-03-05T00:00:00' }) startDate!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T00:00:00', description: 'Midnight at the start of the last day' }) endDate!: string;
  @ApiProperty({ enum: CONFERENCE_STATUSES, description: 'CANCELLED if cancelled, otherwise derived from the dates' }) status!: ConferenceStatus;
  @ApiProperty({ type: Number, nullable: true, example: 400 }) maxAttendees!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'Infra Guild' }) organizerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
}

export class SessionSummaryResponse {
  @ApiProperty({ example: 4 }) id!: number;
  @ApiProperty({ example: 'Kubernetes for .NET Developers' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty(WALL) startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-05T11:00:00' }) endTime!: string;
  @ApiProperty({ example: 200 }) capacity!: number;
  @ApiProperty({ example: 2 }) conferenceId!: number;
  @ApiProperty({ type: Number, nullable: true, example: 3 }) speakerId!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 1 }) roomId!: number | null;
}

export class RegistrationSummaryResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: '2026-10-05T04:44:13.136Z', description: 'UTC instant with Z' }) registeredAt!: string;
  @ApiProperty({ enum: REGISTRATION_STATUSES, example: 'CONFIRMED' }) status!: RegistrationStatus;
  @ApiProperty({ example: 2 }) conferenceId!: number;
  @ApiProperty({ example: 1 }) attendeeId!: number;
}

export class ConferenceResponse extends ConferenceSummaryResponse {
  @ApiProperty({ type: [SessionSummaryResponse] }) sessions!: SessionSummaryResponse[];
  @ApiProperty({ type: [RegistrationSummaryResponse] }) registrations!: RegistrationSummaryResponse[];
}

export class SpeakerSummaryResponse {
  @ApiProperty({ example: 3 }) id!: number;
  @ApiProperty({ example: 'Chloe' }) firstName!: string;
  @ApiProperty({ example: 'Tanaka' }) lastName!: string;
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only when emailPublic is true, otherwise null (SEC-1)' }) email!: string | null;
  @ApiProperty({ example: true }) emailPublic!: boolean;
}

export class SpeakerResponse extends SpeakerSummaryResponse {
  @ApiProperty({ type: [SessionSummaryResponse] }) sessions!: SessionSummaryResponse[];
}

export class RoomResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'Hall A' }) name!: string;
  @ApiProperty({ example: 300 }) capacity!: number;
  @ApiProperty({ type: String, nullable: true, example: 'Ground Floor' }) location!: string | null;
}

export class SessionResponse extends SessionSummaryResponse {
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
  @ApiProperty({ type: SpeakerSummaryResponse, nullable: true }) speaker!: SpeakerSummaryResponse | null;
  @ApiProperty({ type: RoomResponse, nullable: true }) room!: RoomResponse | null;
}

export class SessionDetailResponse extends SessionResponse {
  @ApiProperty({ example: 120, description: 'Confirmed session registrations (BEVN-202)' }) registeredCount!: number;
  @ApiProperty({ example: 0, description: 'Attendees on the waitlist of the session' }) waitlistCount!: number;
}

export class SessionRegistrationResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 4 }) sessionId!: number;
  @ApiProperty({ example: 1, description: 'No name or email (SEC-1)' }) attendeeId!: number;
  @ApiProperty({ enum: ENTRY_STATUSES, example: 'CONFIRMED' }) status!: EntryStatus;
  @ApiProperty({ example: '2026-10-07T09:00:00.000Z', description: 'UTC instant with Z; the waitlist is ordered by createdAt, then id' }) createdAt!: string;
}

export class AttendeePublicResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'Maria' }) firstName!: string;
  @ApiProperty({ example: 'Kowalska' }) lastName!: string;
}

export class RegistrationResponse extends RegistrationSummaryResponse {
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
  @ApiProperty({ type: AttendeePublicResponse, description: 'Stored name; the email is never returned (SEC-1)' }) attendee!: AttendeePublicResponse;
}

export class AttendeeRegistrationResponse {
  @ApiProperty({ example: 7 }) id!: number;
  @ApiProperty({ enum: REGISTRATION_STATUSES, example: 'CONFIRMED' }) status!: RegistrationStatus;
  @ApiProperty({ example: '2026-10-10T09:00:00.000Z', description: 'UTC instant with Z; the time of the last (re)registration' }) registeredAt!: string;
  @ApiProperty({ type: ConferenceSummaryResponse }) conference!: ConferenceSummaryResponse;
}

export class FieldErrorResponse {
  @ApiProperty({ example: 'email' }) field!: string;
  @ApiProperty({ type: [String], example: ['email must be an email address'] }) messages!: string[];
}

export class ErrorResponse {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: 'Bad Request' }) error!: string;
  @ApiProperty({ example: 'Validation failed' }) message!: string;
  @ApiProperty({ example: '3f1c2a7e-8b4d-4c1e-9a55-2d6f0b9e7c11', description: 'Same value as the X-Request-Id header' }) requestId!: string;
  @ApiProperty({ enum: CONFLICT_REASONS, required: false, description: 'Only on 409 of the session registration endpoints and of the registration cancel' }) reason?: ConflictReason;
  @ApiProperty({ type: [FieldErrorResponse], required: false }) errors?: FieldErrorResponse[];
}
