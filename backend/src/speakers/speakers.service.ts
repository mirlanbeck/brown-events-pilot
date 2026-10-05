import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toSpeaker } from '../representation/mappers';
import type { SpeakerResponse } from '../representation/responses';
import { speakerWithSessions } from '../representation/selects';
import type { CreateSpeakerDto } from './speaker.dto';

@Injectable()
export class SpeakersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SpeakerResponse[]> {
    const rows = await this.prisma.speaker.findMany({ select: speakerWithSessions, orderBy: { id: 'asc' } });
    return rows.map(toSpeaker);
  }

  async create(dto: CreateSpeakerDto): Promise<SpeakerResponse> {
    const row = await this.prisma.speaker.create({
      data: { firstName: dto.firstName, lastName: dto.lastName, bio: dto.bio ?? null, email: dto.email ?? null, emailPublic: dto.emailPublic ?? false },
      select: speakerWithSessions,
    });
    return toSpeaker(row);
  }
}
