import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { RegistrationResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { RegisterAttendeeDto } from './register.dto';
import { RegistrationsService } from './registrations.service';

// Same URLs as before (spec 4.2); a module of its own instead of a call from the conferences controller (MNT-3).
@ApiTags('Conferences')
@Controller('conferences')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get(':id/registrations')
  @ApiOperation({ operationId: 'Conferences_GetRegistrations', summary: 'List registrations of a conference', description: 'Attendee names only; emails are never returned (SEC-1).' })
  @ApiOkResponse({ type: [RegistrationResponse] })
  @ApiErrors(400, 404, 503)
  list(@Param('id', ParseIdPipe) id: number): Promise<RegistrationResponse[]> {
    return this.registrations.listForConference(id);
  }

  @Post(':id/register')
  @ApiOperation({
    operationId: 'Conferences_Register',
    summary: 'Register an attendee',
    description: 'Open while the conference is UPCOMING or ACTIVE and has seats. 409: already registered, no seats, closed. No Location header.',
  })
  @ApiBody({ type: RegisterAttendeeDto, examples: { modal: { value: { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com', phone: '', company: '', dietaryRequirements: '', sessionId: null } }, page: { value: { firstName: 'Jan', lastName: 'Nowak', email: 'jan.nowak@example.com', phone: '+48 600 000 000', company: 'ACME' } } } })
  @ApiCreatedResponse({ type: RegistrationResponse })
  @ApiErrors(400, 404, 409, 413, 415, 503)
  register(@Param('id', ParseIdPipe) id: number, @Body() dto: RegisterAttendeeDto): Promise<RegistrationResponse> {
    return this.registrations.register(id, dto);
  }
}
