import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ParseEmailPipe } from '../common/parse-email.pipe';
import { AttendeeRegistrationResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { RegistrationsService } from './registrations.service';

const EMAIL_PARAM = { name: 'email', example: 'maria.kowalska@example.com', description: 'URL-encoded; trimmed and lower-cased like the email of the registration body' };

// The attendee dashboard (BEVN-203). The email is the identity, without verification (SEC-2, spec 9).
@ApiTags('Attendees')
@Controller('attendees')
export class AttendeesController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get(':email/registrations')
  @ApiOperation({
    operationId: 'Attendees_GetRegistrations',
    summary: 'List the conference registrations of an attendee',
    description: 'CONFIRMED and CANCELLED, ordered by conference start date. An unknown email gives []. The email is never returned (SEC-1).',
  })
  @ApiParam(EMAIL_PARAM)
  @ApiOkResponse({ type: [AttendeeRegistrationResponse] })
  @ApiErrors(400, 503)
  list(@Param('email', ParseEmailPipe) email: string): Promise<AttendeeRegistrationResponse[]> {
    return this.registrations.listForAttendee(email);
  }
}
