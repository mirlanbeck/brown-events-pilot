import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT32_MAX, LIMITS } from '../common/limits';
import { IsAsciiEmail, NormalizeEmail, Trim } from '../common/validation';

const NOT_STORED = 'Accepted from the registration forms, not stored (spec 5.4).';

export class RegisterAttendeeDto {
  @ApiProperty({ example: 'Maria', maxLength: LIMITS.attendees.FirstName, description: 'Ignored if the attendee already exists: the stored name is kept and returned.' })
  @Trim() @IsString() @IsNotEmpty() @MaxLength(LIMITS.attendees.FirstName)
  firstName!: string;

  @ApiProperty({ example: 'Kowalska', maxLength: LIMITS.attendees.LastName })
  @Trim() @IsString() @IsNotEmpty() @MaxLength(LIMITS.attendees.LastName)
  lastName!: string;

  @ApiProperty({ example: 'maria.kowalska@example.com', description: 'ASCII only; trimmed and lower-cased; identifies the attendee. Never returned.' })
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+48 600 000 000', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.phone) phone?: string;
  @ApiPropertyOptional({ example: 'ACME', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.company) company?: string;
  @ApiPropertyOptional({ example: '', description: NOT_STORED }) @IsOptional() @IsString() @MaxLength(LIMITS.registerForm.dietaryRequirements) dietaryRequirements?: string;
  @ApiPropertyOptional({ type: Number, nullable: true, example: null, description: `${NOT_STORED} Not checked against existing sessions.` })
  @IsOptional() @IsInt() @Min(1) @Max(INT32_MAX)
  sessionId?: number | null;
}
