import { loadConfig } from '../../src/config/app-config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testDatabaseUrl } from './setup/test-db-url';

export { testDatabaseUrl };

export function newPrisma(env: Record<string, string> = {}): PrismaService {
  return new PrismaService(loadConfig({ DATABASE_URL: testDatabaseUrl(), ...env }));
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "registrations", "attendees", "sessions", "speakers", "rooms", "conferences" RESTART IDENTITY CASCADE`;
}
