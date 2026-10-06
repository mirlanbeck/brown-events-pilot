import { inspectDbError, mapDbError } from '../../src/common/db-error';
import { lockConference } from '../../src/common/locking';
import { makeAttendee, makeConference, wall } from './fixtures';
import { newPrisma, resetDb } from './helpers';

const prisma = newPrisma({ DB_STATEMENT_TIMEOUT_MS: '500' });
beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to reject the operation');
}

function shape(error: unknown): string {
  return JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
}

describe('database error probes (spec §14 №7, №14)', () => {
  it('unique violation -> 23505 with the index name -> 409', async () => {
    await makeAttendee(prisma);
    const error = await caught(() => makeAttendee(prisma));
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '23505', constraint: 'UQ_attendees_Email' } });
    expect(mapDbError(error)?.status).toBe(409);
  });

  it('FK violation -> constraint name -> 422 on the right field', async () => {
    const conference = await makeConference(prisma);
    const error = await caught(() =>
      prisma.session.create({
        data: { title: 'x', startTime: wall('2027-01-10T10:00:00'), endTime: wall('2027-01-10T11:00:00'), capacity: 1, conferenceId: conference.id, speakerId: 999 },
      }),
    );
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { constraint: 'FK_sessions_speakers_SpeakerId' } });
    expect(mapDbError(error)).toMatchObject({ status: 422, errors: [{ field: 'speakerId' }] });
  });

  it('CHECK violation -> 23514 -> 400', async () => {
    const error = await caught(() => prisma.$executeRaw`INSERT INTO "attendees" ("FirstName", "LastName", "Email") VALUES ('A', 'B', 'UPPER@EXAMPLE.COM')`);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '23514' } });
    expect(mapDbError(error)?.status).toBe(400);
  });

  it('statement_timeout reaches the pool -> 57014 -> 503', async () => {
    const error = await caught(() => prisma.$queryRaw`SELECT pg_sleep(2)`);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '57014' } });
    expect(mapDbError(error)).toMatchObject({ status: 503, headers: { 'Retry-After': '1' } });
  });

  it('a held conference lock -> 55P03 after lock_timeout -> 503', async () => {
    const conference = await makeConference(prisma);
    // Both sides use the default 5 s statement_timeout: the 500 ms one of `prisma` would fire before lock_timeout (2 s).
    const holder = newPrisma();
    const waiter = newPrisma();
    let release: () => void = () => undefined;
    const held = holder.$transaction(
      async (tx) => {
        await lockConference(tx, conference.id);
        await new Promise<void>((resolve) => (release = resolve));
      },
      { timeout: 15000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    const error = await caught(() => waiter.$transaction((tx) => lockConference(tx, conference.id)));
    release();
    await held;
    await holder.$disconnect();
    await waiter.$disconnect();
    expect(Date.now() - started).toBeLessThan(4500);
    expect({ info: inspectDbError(error), shape: shape(error) }).toMatchObject({ info: { pgCode: '55P03' } });
    expect(mapDbError(error)?.status).toBe(503);
  });

  it('interactive transaction timeout -> P2028 -> 503', async () => {
    const error = await caught(() =>
      prisma.$transaction(
        async (tx) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          await tx.conference.count();
        },
        { timeout: 100 },
      ),
    );
    expect(inspectDbError(error)?.prismaCode).toBe('P2028');
    expect(mapDbError(error)?.status).toBe(503);
  });
});
