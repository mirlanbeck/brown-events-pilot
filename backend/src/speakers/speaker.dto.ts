import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { LIMITS } from '../common/limits';
import { IsAsciiEmail, Trim } from '../common/validation';

export class CreateSpeakerDto {
  @ApiProperty({ example: 'Dmitri', maxLength: LIMITS.speakers.FirstName })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.speakers.FirstName)
  firstName!: string;

  @ApiProperty({ example: 'Ivanov', maxLength: LIMITS.speakers.LastName })
  @IsString() @IsNotEmpty() @MaxLength(LIMITS.speakers.LastName)
  lastName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: LIMITS.speakers.Bio })
  @IsOptional() @IsString() @MaxLength(LIMITS.speakers.Bio)
  bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'dmitri.ivanov@example.com', description: 'ASCII only. Returned only if emailPublic is true.' })
  @IsOptional() @Trim() @IsAsciiEmail()
  email?: string | null;

  @ApiPropertyOptional({ default: false, description: 'Whether the email may appear in public responses (SEC-1). Cannot be changed later: there is no PUT for speakers.' })
  @IsOptional() @IsBoolean()
  emailPublic?: boolean;
}
