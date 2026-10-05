import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { IsLaterThan, IsPresent, IsWallClock, isPositiveInt32, isText, NullOr } from '../common/validation';

const L = LIMITS.sessions;
const WALL = { type: String, example: '2025-03-06T10:00:00', description: 'YYYY-MM-DDTHH:mm:ss, venue wall-clock time; must fall within the conference days' };
const nullableId = (name: string) => NullOr(`isNullable${name}`, isPositiveInt32, `must be an integer between 1 and ${INT32_MAX} or null`);

export class CreateSessionDto {
  @ApiProperty({ example: 'Platform Engineering Without the Hype', maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: L.Description }) @IsOptional() @IsString() @MaxLength(L.Description) description?: string | null;
  @ApiProperty(WALL) @IsWallClock() startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T11:00:00' }) @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @ApiProperty({ example: 80, minimum: 1, maximum: INT32_MAX, description: 'At most the room capacity' }) @IsInt() @Min(1) @Max(INT32_MAX) capacity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) speakerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 2, description: 'Seeded rooms have ids 1-4; there is no rooms endpoint' }) @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX) roomId?: number | null;
}

// Full replacement; conferenceId is not part of the body: a session never moves between conferences (spec 6.3, C08).
export class UpdateSessionDto {
  @ApiProperty({ maxLength: L.Title }) @IsString() @IsNotEmpty() @MaxLength(L.Title) title!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: L.Description })
  @IsPresent()
  @NullOr('isNullableText', isText(L.Description), `must be a string of at most ${L.Description} characters or null`)
  description!: string | null;
  @ApiProperty(WALL) @IsWallClock() startTime!: string;
  @ApiProperty({ ...WALL, example: '2025-03-06T11:00:00' }) @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @ApiProperty({ example: 80, minimum: 1, maximum: INT32_MAX }) @IsInt() @Min(1) @Max(INT32_MAX) capacity!: number;
  @ApiProperty({ type: Number, nullable: true }) @IsPresent() @nullableId('SpeakerId') speakerId!: number | null;
  @ApiProperty({ type: Number, nullable: true }) @IsPresent() @nullableId('RoomId') roomId!: number | null;
}
