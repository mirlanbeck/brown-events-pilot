import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceUnavailable } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

// Infrastructure, not part of the API surface: outside /api and outside Swagger (spec 9.3).
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw serviceUnavailable('The database is unavailable');
    }
    return { status: 'ok' };
  }
}
