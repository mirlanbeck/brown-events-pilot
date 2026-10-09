import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { SessionRegistrationResponse } from '../representation/responses';
import { ApiConflicts, ApiErrors } from '../swagger/api-errors.decorator';
import { SessionAttendeeDto } from './session-attendee.dto';
import { SessionRegistrationsService } from './session-registrations.service';

const BODY_EXAMPLES = { attendee: { value: { email: 'maria.kowalska@example.com' } } };

@ApiTags('Sessions')
@Controller('sessions')
export class SessionRegistrationsController {
  constructor(private readonly registrations: SessionRegistrationsService) {}

  @Post(':id/register')
  @ApiOperation({
    operationId: 'Sessions_Register',
    summary: 'Register an attendee for a session',
    description: 'Needs a confirmed conference registration. A full session is 409 SESSION_FULL: the attendee is not put on the waitlist. No Location header.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'CONFERENCE_REGISTRATION_REQUIRED', 'ALREADY_REGISTERED', 'SESSION_OVERLAP', 'SESSION_FULL')
  register(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.register(id, dto);
  }

  @Post(':id/waitlist')
  @ApiOperation({
    operationId: 'Sessions_JoinWaitlist',
    summary: 'Put an attendee on the waitlist of a full session',
    description: 'Only when the session is full (otherwise 409 SEATS_AVAILABLE). Places are taken in order of createdAt, then id.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED', 'CONFERENCE_REGISTRATION_REQUIRED', 'ALREADY_REGISTERED', 'SESSION_OVERLAP', 'SEATS_AVAILABLE')
  joinWaitlist(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.joinWaitlist(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'Sessions_Cancel',
    summary: 'Cancel a session registration or waitlist place',
    description: 'A cancelled confirmed place goes to the first on the waitlist in the same transaction. 404 if the email has no active entry on the session.',
  })
  @ApiBody({ type: SessionAttendeeDto, examples: BODY_EXAMPLES })
  @ApiOkResponse({ type: SessionRegistrationResponse })
  @ApiErrors(400, 404, 413, 415, 503)
  @ApiConflicts('REGISTRATION_CLOSED')
  cancel(@Param('id', ParseIdPipe) id: number, @Body() dto: SessionAttendeeDto): Promise<SessionRegistrationResponse> {
    return this.registrations.cancel(id, dto);
  }
}
