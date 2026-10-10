import { ApiProperty } from '@nestjs/swagger';
import { IsAsciiEmail, NormalizeEmail } from '../common/validation';

// Body of the three session registration endpoints (spec 4.1): the email only, same rules as RegisterAttendeeDto.email.
export class SessionAttendeeDto {
  @ApiProperty({ example: 'maria.kowalska@example.com', description: 'Email of an attendee registered for the conference. ASCII only; trimmed and lower-cased. Never returned.' })
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;
}
