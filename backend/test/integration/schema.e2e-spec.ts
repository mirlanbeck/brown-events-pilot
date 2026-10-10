import { execSync } from 'node:child_process';
import { inspectDbError } from '../../src/common/db-error';
import { LIMITS } from '../../src/common/limits';
import { makeAttendee, makeConference, makeSession, makeSessionRegistration } from './fixtures';
import { newPrisma, resetDb, testDatabaseUrl } from './helpers';

const prisma = newPrisma();
afterAll(() => prisma.$disconnect());

function urlFor(database: string): string {
  return testDatabaseUrl().replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

describe('database schema (spec 7.2)', () => {
  it('limits every string column exactly as LIMITS says', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string; max: number | null }[]>`
      SELECT table_name, column_name, character_maximum_length AS max
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('character varying', 'text') AND table_name <> '_prisma_migrations'`;
    const actual = Object.fromEntries(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.max]));
    const expected = Object.fromEntries(
      Object.entries(LIMITS)
        .filter(([table]) => table !== 'registerForm')
        .flatMap(([table, columns]) => Object.entries(columns).map(([column, max]) => [`${table}.${column}`, max])),
    );
    expect(actual).toEqual(expected);
  });

  it('uses GENERATED ALWAYS identity keys', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; identity_generation: string }[]>`
      SELECT table_name, identity_generation FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'Id' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    expect(rows).toEqual(
      ['attendees', 'conferences', 'registrations', 'rooms', 'session_registrations', 'sessions', 'speakers'].map((t) => ({ table_name: t, identity_generation: 'ALWAYS' })),
    );
  });

  it('has the CHECK, UNIQUE and FK constraints and FK indexes by name', async () => {
    const constraints = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' ORDER BY conname`;
    expect(constraints.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'CK_conferences_Dates', 'CK_conferences_Status', 'CK_conferences_MaxAttendees', 'CK_rooms_Capacity',
        'CK_sessions_Times', 'CK_sessions_Capacity', 'CK_attendees_Email', 'CK_registrations_Status',
        'FK_sessions_conferences_ConferenceId', 'FK_sessions_speakers_SpeakerId', 'FK_sessions_rooms_RoomId',
        'FK_registrations_conferences_ConferenceId', 'FK_registrations_attendees_AttendeeId',
        'CK_session_registrations_Status', 'FK_session_registrations_sessions_SessionId', 'FK_session_registrations_attendees_AttendeeId',
      ]),
    );
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'IX_sessions_ConferenceId', 'IX_sessions_SpeakerId', 'IX_sessions_RoomId', 'IX_registrations_AttendeeId',
        'UQ_attendees_Email', 'UQ_registrations_ConferenceId_AttendeeId',
        'UQ_session_registrations_SessionId_AttendeeId_Active', 'IX_session_registrations_SessionId_Status_CreatedAt', 'IX_session_registrations_AttendeeId',
      ]),
    );
  });

  it('runs on a collation where lower() agrees with JS for ASCII (spec 6.4)', async () => {
    const [row] = await prisma.$queryRaw<{ lc_collate: string }[]>`SHOW lc_collate`;
    expect(row.lc_collate).not.toMatch(/^tr|^az/i);
    const [lowered] = await prisma.$queryRaw<{ v: string }[]>`SELECT lower('MARIA.KOWALSKA@EXAMPLE.COM') AS v`;
    expect(lowered.v).toBe('MARIA.KOWALSKA@EXAMPLE.COM'.toLowerCase());
  });

  it('has no drift between migrations and schema.prisma (spec 7.3)', async () => {
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_shadow');
    await prisma.$executeRawUnsafe('CREATE DATABASE ext150_shadow');
    // Flag names as printed by `npx prisma migrate diff --help` in Task 1, Step 7.
    execSync('npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(), SHADOW_DATABASE_URL: urlFor('ext150_shadow') },
    });
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_shadow');
  });

  it('refuses to migrate a non-empty database without migration history (P3005)', async () => {
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_p3005');
    await prisma.$executeRawUnsafe('CREATE DATABASE ext150_p3005');
    const probe = newPrisma({ DATABASE_URL: urlFor('ext150_p3005') });
    await probe.$executeRawUnsafe('CREATE TABLE "conferences" ("Id" integer primary key)');
    await probe.$disconnect();
    let output = '';
    try {
      execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: urlFor('ext150_p3005') }, stdio: 'pipe' });
    } catch (error) {
      const e = error as { stdout?: Buffer; stderr?: Buffer };
      output = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    }
    expect(output).toContain('P3005');
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS ext150_p3005');
  });

  // Pins the behaviour of the partialIndexes preview (BEVN-202 spec 3.3, 9): a Prisma update must not turn it into a full unique index.
  it('allows one active session registration per attendee and session, any number of cancelled ones (BEVN-202 spec 3.1)', async () => {
    await resetDb(prisma);
    const conference = await makeConference(prisma);
    const session = await makeSession(prisma, conference.id);
    const attendee = await makeAttendee(prisma);
    const entry = (status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED') => makeSessionRegistration(prisma, session.id, attendee.id, status);
    async function dbErrorOf(promise: Promise<unknown>) {
      try {
        await promise;
      } catch (error) {
        return inspectDbError(error);
      }
      throw new Error('expected a database error');
    }
    await entry('CANCELLED');
    await entry('CANCELLED');
    await entry('CONFIRMED');
    expect(await dbErrorOf(entry('WAITLISTED'))).toMatchObject({ constraint: 'UQ_session_registrations_SessionId_AttendeeId_Active' });
    // Status is a plain String in Prisma, so only the CHECK constraint stops an unknown value.
    const bad = prisma.sessionRegistration.create({ data: { sessionId: session.id, attendeeId: attendee.id, status: 'PENDING', createdAt: new Date() } });
    expect(await dbErrorOf(bad)).toMatchObject({ pgCode: '23514' });
    await resetDb(prisma);
  });
});
