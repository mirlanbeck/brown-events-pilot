import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ConferenceResponse } from '../representation/responses';
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
  constructor(private readonly conferences: ConferencesService) {}

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
}
