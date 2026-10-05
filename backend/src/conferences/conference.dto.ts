import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { CONFERENCE_STATUSES, type ConferenceStatus } from '../common/status';
import { IsLaterThan, IsPresent, IsWallClock, isPositiveInt32, isText, isUrlValue, NullOr } from '../common/validation';

const L = LIMITS.conferences;
const WALL = { type: String, example: '2026-11-12T00:00:00', description: 'YYYY-MM-DDTHH:mm:ss, venue wall-clock time, no offset (spec 5.5)' };
const STATUS_DOC = {
  enum: CONFERENCE_STATUSES,
  nullable: true,
  description: 'CANCELLED cancels; null means not cancelled. UPCOMING/ACTIVE/COMPLETED are accepted only if they match the status derived from the dates.',
};
const nullableText = (max: number) => NullOr('isNullableText', isText(max), `must be a string of at most ${max} characters or null`);

export class CreateConferenceDto {
  @ApiProperty({ example: 'Frontend Frontiers 2026', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Description }) @IsOptional() @IsString() @MaxLength(L.Description) description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Location }) @IsOptional() @IsString() @MaxLength(L.Location) location?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Venue }) @IsOptional() @IsString() @MaxLength(L.Venue) venue?: string | null;
  @ApiProperty(WALL) @IsWallClock() startDate!: string;
  @ApiProperty({ ...WALL, example: '2026-11-13T00:00:00' }) @IsWallClock() @IsLaterThan('startDate', { allowEqual: true }) endDate!: string;
  @ApiPropertyOptional(STATUS_DOC) @IsOptional() @IsIn(CONFERENCE_STATUSES) status?: ConferenceStatus | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: INT32_MAX }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) maxAttendees?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.OrganizerName }) @IsOptional() @IsString() @MaxLength(L.OrganizerName) organizerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Website }) @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(L.Website) website?: string | null;
}

// PUT is a full replacement: every key must be present, null clears a nullable field (spec 5.4, CORR-5).
export class UpdateConferenceDto {
  @ApiProperty({ example: 'Frontend Frontiers 2026', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Description }) @IsPresent() @nullableText(L.Description) description!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Location }) @IsPresent() @nullableText(L.Location) location!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Venue }) @IsPresent() @nullableText(L.Venue) venue!: string | null;
  @ApiProperty(WALL) @IsWallClock() startDate!: string;
  @ApiProperty({ ...WALL, example: '2026-11-13T00:00:00' }) @IsWallClock() @IsLaterThan('startDate', { allowEqual: true }) endDate!: string;
  @ApiProperty(STATUS_DOC)
  @IsPresent()
  @NullOr('isConferenceStatus', (v) => (CONFERENCE_STATUSES as readonly unknown[]).includes(v), `must be one of ${CONFERENCE_STATUSES.join(', ')} or null`)
  status!: ConferenceStatus | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: INT32_MAX })
  @IsPresent()
  @NullOr('isPositiveInt32', isPositiveInt32, `must be an integer between 1 and ${INT32_MAX} or null`)
  maxAttendees!: number | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.OrganizerName }) @IsPresent() @nullableText(L.OrganizerName) organizerName!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Website })
  @IsPresent()
  @NullOr('isUrl', isUrlValue(L.Website), `must be an http(s) URL of at most ${L.Website} characters or null`)
  website!: string | null;
}
