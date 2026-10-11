import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ParseEmailPipe } from '../common/parse-email.pipe';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { AttendeeRegistrationResponse } from '../representation/responses';
import { ApiConflicts, ApiErrors } from '../swagger/api-errors.decorator';
import { CancelRegistrationDto } from './cancel-registration.dto';
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

  @Post(':email/registrations/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'Attendees_CancelRegistration',
    summary: 'Cancel a conference registration',
    description:
      'Open while the conference is UPCOMING or ACTIVE. Also cancels every active session registration and waitlist place of the attendee in the conference ' +
      '(started sessions included); the free seats go to the waitlists of sessions with open registration in the same transaction. ' +
      'Takes no body, but needs Content-Type: application/json — send {}. 404 if the registration does not belong to this email.',
  })
  @ApiParam(EMAIL_PARAM)
  @ApiBody({ type: CancelRegistrationDto, examples: { empty: { value: {} } } })
  @ApiOkResponse({ type: AttendeeRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'ALREADY_CANCELLED')
  cancel(
    @Param('email', ParseEmailPipe) email: string,
    @Param('id', ParseIdPipe) id: number,
    @Body() _body: CancelRegistrationDto,
  ): Promise<AttendeeRegistrationResponse> {
    return this.registrations.cancelForAttendee(email, id);
  }
}
