import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { SessionResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { UpdateSessionDto } from './session.dto';
import { SessionsService } from './sessions.service';

@ApiTags('Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id')
  @ApiOperation({ operationId: 'Sessions_GetById', summary: 'Get a session with its conference, speaker and room' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrors(400, 404, 503)
  get(@Param('id', ParseIdPipe) id: number): Promise<SessionResponse> {
    return this.sessions.get(id);
  }

  @Put(':id')
  @ApiOperation({ operationId: 'Sessions_Update', summary: 'Replace a session', description: 'Full replacement; conferenceId cannot be sent.' })
  @ApiBody({ type: UpdateSessionDto, examples: { session: { value: { title: 'Kubernetes for .NET Developers', description: 'Updated', startTime: '2025-03-05T10:30:00', endTime: '2025-03-05T11:30:00', capacity: 250, speakerId: 3, roomId: 1 } } } })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrors(400, 404, 413, 415, 422, 503)
  update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateSessionDto): Promise<SessionResponse> {
    return this.sessions.update(id, dto);
  }
}
