import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const DAY_MS = 86_400_000;

// Demo data of the .NET DataSeeder (e95142d), with two changes (spec 7.5, CORR-10): CloudOps Days and Data & AI Forum
// start 30 and 90 days after the seed runs, so registration works on the demo; statuses are derived, not stored.
export async function seedDemoData(prisma: PrismaClient, now: Date): Promise<boolean> {
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (dayOffset: number, hour = 0, minute = 0) => new Date(day0 + dayOffset * DAY_MS + (hour * 60 + minute) * 60_000);
  const fixed = (y: number, m: number, d: number, hour = 0, minute = 0) => new Date(Date.UTC(y, m - 1, d, hour, minute));

  // One transaction: the old seeder saved in four steps and checked only conferences, so a failure after the
  // speakers were saved left duplicate speakers behind on the next start (DataSeeder.cs:9, :18).
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.conference.count()) > 0) return false;

      const speaker = (firstName: string, lastName: string, bio: string, email: string) =>
        tx.speaker.create({ data: { firstName, lastName, bio, email, emailPublic: true } });
      const alice = await speaker('Alice', 'Novak', 'Principal Engineer at CloudScale. 15 years in distributed systems.', 'alice.novak@example.com');
      const ben = await speaker('Ben', 'Okafor', "Author of 'Pragmatic .NET'. Microsoft MVP.", 'ben.okafor@example.com');
      const chloe = await speaker('Chloe', 'Tanaka', 'Staff SRE at Observio. Reliability evangelist.', 'chloe.tanaka@example.com');

      const room = (name: string, capacity: number, location: string) => tx.room.create({ data: { name, capacity, location } });
      const hallA = await room('Hall A', 300, 'Ground Floor');
      const room101 = await room('Room 101', 80, 'First Floor');
      const room202 = await room('Room 202', 50, 'Second Floor');
      await room('Workshop', 30, 'Basement');

      const summit = await tx.conference.create({
        data: {
          title: '.NET Summit 2024',
          description: 'The premier .NET conference for enterprise developers. Three tracks covering ASP.NET Core, EF Core, and cloud-native patterns.',
          location: 'Prague, Czech Republic', venue: 'Prague Convention Centre', startDate: fixed(2024, 10, 14), endDate: fixed(2024, 10, 16),
          maxAttendees: 600, organizerName: 'DotNet Crew', website: 'https://dotnetsummit.example.com',
        },
      });
      const cloudOps = await tx.conference.create({
        data: {
          title: 'CloudOps Days', description: 'Kubernetes, observability, platform engineering, and SRE practices for modern infrastructure teams.',
          location: 'Amsterdam, Netherlands', venue: 'Beurs van Berlage', startDate: at(30), endDate: at(31), maxAttendees: 400, organizerName: 'Infra Guild',
        },
      });
      const dataAi = await tx.conference.create({
        data: {
          title: 'Data & AI Forum', description: 'Machine learning, vector databases, and LLM integrations for the working software engineer.',
          location: 'Warsaw, Poland', venue: 'Warsaw Expo Centre', startDate: at(90), endDate: at(91), maxAttendees: 250, organizerName: 'DataFlow Community',
        },
      });

      const sessions = [
        { title: 'EF Core Performance Deep Dive', description: 'Query profiling, batching strategies, and caching patterns for production EF Core applications.', startTime: fixed(2024, 10, 14, 10), endTime: fixed(2024, 10, 14, 11), capacity: 300, conferenceId: summit.id, speakerId: alice.id, roomId: hallA.id },
        { title: 'ASP.NET Core Minimal APIs in Practice', description: 'When to use minimal APIs over controllers, and how to structure them for production applications.', startTime: fixed(2024, 10, 14, 11, 30), endTime: fixed(2024, 10, 14, 12, 30), capacity: 80, conferenceId: summit.id, speakerId: ben.id, roomId: room101.id },
        { title: 'Async .NET in Practice', description: 'Writing correct and efficient asynchronous code in .NET: patterns, pitfalls, and real-world examples.', startTime: fixed(2024, 10, 15, 9), endTime: fixed(2024, 10, 15, 10), capacity: 50, conferenceId: summit.id, speakerId: ben.id, roomId: room202.id },
        { title: 'Kubernetes for .NET Developers', description: "Manifests, health checks, graceful shutdown, and resource limits — from a developer's perspective.", startTime: at(30, 10), endTime: at(30, 11), capacity: 200, conferenceId: cloudOps.id, speakerId: chloe.id, roomId: hallA.id },
        { title: 'OpenTelemetry End-to-End', description: 'Traces, metrics, logs. Instrumenting a real microservices application from zero to Grafana dashboard.', startTime: at(30, 14), endTime: at(30, 15), capacity: 80, conferenceId: cloudOps.id, speakerId: chloe.id, roomId: room101.id },
        { title: 'Building RAG Systems with .NET', description: 'Vector embeddings, semantic search, and retrieval-augmented generation using Microsoft.Extensions.AI.', startTime: at(90, 10), endTime: at(90, 11, 30), capacity: 120, conferenceId: dataAi.id, speakerId: alice.id, roomId: hallA.id },
        { title: 'EF Core + pgvector: Vector Search in Postgres', description: 'Storing and querying vector embeddings inside PostgreSQL using the pgvector extension and EF Core.', startTime: at(90, 14), endTime: at(90, 15), capacity: 50, conferenceId: dataAi.id, speakerId: ben.id, roomId: room202.id },
      ];
      for (const data of sessions) await tx.session.create({ data });
      return true;
    },
    { timeout: 30_000 },
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    console.log((await seedDemoData(prisma, new Date())) ? 'Demo data seeded' : 'Demo data already present, nothing to do');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
