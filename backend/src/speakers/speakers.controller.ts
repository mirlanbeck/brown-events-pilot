import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SpeakerResponse } from '../representation/responses';
import { ApiErrors } from '../swagger/api-errors.decorator';
import { CreateSpeakerDto } from './speaker.dto';
import { SpeakersService } from './speakers.service';

@ApiTags('Speakers')
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly speakers: SpeakersService) {}

  @Get()
  @ApiOperation({ operationId: 'Speakers_GetAll', summary: 'List speakers with their sessions' })
  @ApiOkResponse({ type: [SpeakerResponse] })
  @ApiErrors(503)
  list(): Promise<SpeakerResponse[]> {
    return this.speakers.list();
  }

  @Post()
  @ApiOperation({ operationId: 'Speakers_Create', summary: 'Create a speaker', description: 'No Location header: there is no GET for a single speaker.' })
  @ApiBody({ type: CreateSpeakerDto, examples: { speaker: { value: { firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: 'dmitri.ivanov@example.com', emailPublic: true } } } })
  @ApiCreatedResponse({ type: SpeakerResponse })
  @ApiErrors(400, 413, 415)
  create(@Body() dto: CreateSpeakerDto): Promise<SpeakerResponse> {
    return this.speakers.create(dto);
  }
}
