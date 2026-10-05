import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ConferenceResponse, SessionResponse } from '../representation/responses';
import { CreateSessionDto } from '../sessions/session.dto';
import { SessionsService } from '../sessions/sessions.service';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { CreateConferenceDto, UpdateConferenceDto } from './conference.dto';
import { ConferencesService } from './conferences.service';

const EXAMPLE = {
  title: 'Frontend Frontiers 2026', description: 'React, TypeScript and web performance for product teams.', location: 'Berlin, Germany',
  venue: 'Station Berlin', startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00', status: null, maxAttendees: 350,
  organizerName: 'Web Guild', website: 'https://frontendfrontiers.example.com',
};

@ApiTags('Conferences')
@Controller('conferences')
export class ConferencesController {
  constructor(
    private readonly conferences: ConferencesService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'Conferences_GetAll', summary: 'List conferences with their sessions and registrations' })
  @ApiOkResponse({ type: [ConferenceResponse] })
  @ApiErrors(503)
  list(): Promise<ConferenceResponse[]> {
    return this.conferences.list();
  }

  @Get(':id')
  @ApiOperation({ operationId: 'Conferences_GetById', summary: 'Get a conference' })
  @ApiOkResponse({ type: ConferenceResponse })
  @ApiErrors(400, 404, 503)
  get(@Param('id', ParseIdPipe) id: number): Promise<ConferenceResponse> {
    return this.conferences.get(id);
  }

  @Post()
  @ApiOperation({ operationId: 'Conferences_Create', summary: 'Create a conference' })
  @ApiBody({ type: CreateConferenceDto, examples: { conference: { value: EXAMPLE } } })
  @ApiCreatedResponse({ type: ConferenceResponse, description: 'Location: /api/conferences/{id}' })
  @ApiErrors(400, 413, 415, 503)
  async create(@Body() dto: CreateConferenceDto, @Res({ passthrough: true }) res: Response): Promise<ConferenceResponse> {
    const created = await this.conferences.create(dto);
    res.setHeader('Location', `/api/conferences/${created.id}`);
    return created;
  }

  @Put(':id')
  @ApiOperation({ operationId: 'Conferences_Update', summary: 'Replace a conference', description: 'Full replacement: every key is required, null clears a nullable field.' })
  @ApiBody({ type: UpdateConferenceDto, examples: { conference: { value: EXAMPLE } } })
  @ApiOkResponse({ type: ConferenceResponse })
  @ApiErrors(400, 404, 409, 413, 415, 503)
  update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateConferenceDto): Promise<ConferenceResponse> {
    return this.conferences.update(id, dto);
  }

  @Get(':id/sessions')
  @ApiOperation({ operationId: 'Conferences_GetSessions', summary: 'List sessions of a conference', description: 'A bare array (no {data} wrapper since EXT-150).' })
  @ApiOkResponse({ type: [SessionResponse] })
  @ApiErrors(400, 404, 503)
  listSessions(@Param('id', ParseIdPipe) id: number): Promise<SessionResponse[]> {
    return this.sessions.listForConference(id);
  }

  @Post(':id/sessions')
  @ApiOperation({ operationId: 'Conferences_AddSession', summary: 'Add a session to a conference' })
  @ApiBody({ type: CreateSessionDto, examples: { session: { value: { title: 'Platform Engineering Without the Hype', description: 'What an internal developer platform really needs on day one.', startTime: '2025-03-06T10:00:00', endTime: '2025-03-06T11:00:00', capacity: 80, speakerId: 3, roomId: 2 } } } })
  @ApiCreatedResponse({ type: SessionResponse, description: 'Location: /api/sessions/{id}' })
  @ApiErrors(400, 404, 413, 415, 422, 503)
  async addSession(@Param('id', ParseIdPipe) id: number, @Body() dto: CreateSessionDto, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const created = await this.sessions.create(id, dto);
    res.setHeader('Location', `/api/sessions/${created.id}`);
    return created;
  }
}
