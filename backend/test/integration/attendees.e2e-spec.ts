import { Logger, type LoggerService } from '@nestjs/common';
import { makeAttendee, makeConference, makeRegistration, makeSession, makeSessionRegistration } from './fixtures';
import { createTestApp, DEFAULT_NOW, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: DEFAULT_NOW });
});
afterAll(() => t.close());
beforeEach(async () => {
  t.clock.set(new Date(DEFAULT_NOW));
  await resetDb(t.prisma);
});

const ANN = 'ann@example.com';
const BOB = 'bob@example.com';
const path = (email: string) => `/api/attendees/${encodeURIComponent(email)}/registrations`;
const list = (email: string) => t.http().get(path(email));
const cancel = (email: string, id: number | string, body: unknown = {}) =>
  t.http().post(`${path(email)}/${id}/cancel`).set('Content-Type', 'application/json').send(body as object);

describe('GET /api/attendees/:email/registrations (spec 4.1, 4.2)', () => {
  it('lists CONFIRMED and CANCELLED registrations by conference start date with the conference, without ids or email', async () => {
    const ann = await makeAttendee(t.prisma, { email: ANN });
    const late = await makeConference(t.prisma, { title: 'Late', startDate: '2027-05-01T00:00:00', endDate: '2027-05-02T00:00:00' });
    const early = await makeConference(t.prisma, { title: 'Early', startDate: '2027-02-01T00:00:00', endDate: '2027-02-01T00:00:00' });
    const sameDay = await makeConference(t.prisma, { title: 'Same day', startDate: '2027-05-01T00:00:00', endDate: '2027-05-01T00:00:00' });
    await makeRegistration(t.prisma, late.id, ann.id); // id 1
    await makeRegistration(t.prisma, early.id, ann.id); // id 2
    await makeRegistration(t.prisma, sameDay.id, ann.id); // id 3
    await t.prisma.registration.update({ where: { id: 2 }, data: { status: 'CANCELLED' } });
    const res = await list(ANN);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: number; status: string; conference: { title: string } }) => [r.id, r.status, r.conference.title])).toEqual([
      [2, 'CANCELLED', 'Early'],
      [1, 'CONFIRMED', 'Late'],
      [3, 'CONFIRMED', 'Same day'],
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['conference', 'id', 'registeredAt', 'status']);
    expect(res.body[0]).toMatchObject({ registeredAt: '2026-10-01T09:00:00.000Z', conference: { id: 2, startDate: '2027-02-01T00:00:00', status: 'UPCOMING' } });
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('answers 200 [] for an unknown email and for an attendee without registrations', async () => {
    await makeAttendee(t.prisma, { email: ANN });
    for (const email of [ANN, 'nobody@example.com']) {
      const res = await list(email);
      expect([res.status, res.body]).toEqual([200, []]);
    }
  });

  it('shows only the registrations of this email', async () => {
    const conference = await makeConference(t.prisma);
    const bob = await makeAttendee(t.prisma, { email: BOB });
    await makeRegistration(t.prisma, conference.id, bob.id);
    expect((await list(ANN)).body).toEqual([]);
  });

  it('finds the attendee whatever the case, spaces, + and / of the email (Review Focus 1)', async () => {
    const conference = await makeConference(t.prisma);
    const ann = await makeAttendee(t.prisma, { email: 'ann+tag/x@example.com' });
    await makeRegistration(t.prisma, conference.id, ann.id);
    const res = await list('  Ann+Tag/X@Example.COM ');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it.each(['ann', 'ann@example', 'анна@example.com'])('answers 400 on the email field for %p, without the value', async (email) => {
    const res = await list(email);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: 'Invalid email', errors: [{ field: 'email' }] });
    expect(JSON.stringify(res.body)).not.toContain(email);
  });

  it('answers 405 with Allow: GET for other methods', async () => {
    const res = await t.http().delete(path(ANN));
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
  });
});

class LevelLogger implements LoggerService {
  readonly entries: { level: string; context?: string; message: Record<string, unknown> }[] = [];
  private push(level: string, message: unknown, context: unknown): void {
    if (message !== null && typeof message === 'object') {
      this.entries.push({ level, context: typeof context === 'string' ? context : undefined, message: message as Record<string, unknown> });
    }
  }
  log(message: unknown, context?: unknown): void {
    this.push('log', message, context);
  }
  error(message: unknown, context?: unknown): void {
    this.push('error', message, context);
  }
  warn(message: unknown, context?: unknown): void {
    this.push('warn', message, context);
  }
}

async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; entries: LevelLogger['entries'] }> {
  const logger = new LevelLogger();
  Logger.overrideLogger(logger);
  try {
    return { result: await run(), entries: logger.entries };
  } finally {
    Logger.overrideLogger(false);
  }
}
const events = (entries: LevelLogger['entries'], event: string) => entries.filter((e) => e.message.event === event);
const snapshot = async () => ({
  registrations: await t.prisma.registration.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true } }),
  entries: await t.prisma.sessionRegistration.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true } }),
});

// Conference 1 (2027-01-10..11): s1 10:00 (1 seat), s2 11:00 (1 seat), s3 12:00 (1 seat). Ann, Bob, Carol, Dan are registered
// (registrations 1-4). s1: Ann seat (e1), Bob waits (e2); s2: Ann seat (e3), Carol waits (e4); s3: Dan seat (e5), Ann waits (e6).
// Conference 2: Ann registered (registration 5) with a seat in s4 (e7).
async function seedCascade(): Promise<void> {
  const c1 = await makeConference(t.prisma);
  const s1 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 1 });
  const s2 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T11:00:00', endTime: '2027-01-10T12:00:00', capacity: 1 });
  const s3 = await makeSession(t.prisma, c1.id, { startTime: '2027-01-10T12:00:00', endTime: '2027-01-10T13:00:00', capacity: 1 });
  const people: number[] = [];
  for (const email of [ANN, BOB, 'carol@example.com', 'dan@example.com']) {
    const attendee = await makeAttendee(t.prisma, { email });
    await makeRegistration(t.prisma, c1.id, attendee.id);
    people.push(attendee.id);
  }
  const [a, b, c, d] = people;
  await makeSessionRegistration(t.prisma, s1.id, a, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s1.id, b, 'WAITLISTED');
  await makeSessionRegistration(t.prisma, s2.id, a, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s2.id, c, 'WAITLISTED');
  await makeSessionRegistration(t.prisma, s3.id, d, 'CONFIRMED');
  await makeSessionRegistration(t.prisma, s3.id, a, 'WAITLISTED');
  const c2 = await makeConference(t.prisma, { title: 'Other', startDate: '2027-02-10T00:00:00', endDate: '2027-02-10T00:00:00' });
  const s4 = await makeSession(t.prisma, c2.id, { startTime: '2027-02-10T10:00:00', endTime: '2027-02-10T11:00:00' });
  await makeRegistration(t.prisma, c2.id, a);
  await makeSessionRegistration(t.prisma, s4.id, a, 'CONFIRMED');
}

describe('POST /api/attendees/:email/registrations/:id/cancel (spec 4.3, 5)', () => {
  it('cancels the registration and every active session entry of the conference, also on a started session; promotes only where registration is open (DoD)', async () => {
    await seedCascade();
    t.clock.set(new Date('2027-01-10T10:30:00.000Z')); // conference ACTIVE, s1 started, s2 and s3 open
    const { result: res, entries } = await captureLogs(() => cancel(ANN, 1));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, status: 'CANCELLED', registeredAt: '2026-10-01T09:00:00.000Z', conference: { id: 1, status: 'ACTIVE' } });
    expect(Object.keys(res.body).sort()).toEqual(['conference', 'id', 'registeredAt', 'status']);
    expect((await snapshot()).entries).toEqual([
      { id: 1, status: 'CANCELLED' }, // Ann, s1 (started)
      { id: 2, status: 'WAITLISTED' }, // Bob stays: s1 has started
      { id: 3, status: 'CANCELLED' }, // Ann, s2
      { id: 4, status: 'CONFIRMED' }, // Carol promoted
      { id: 5, status: 'CONFIRMED' }, // Dan
      { id: 6, status: 'CANCELLED' }, // Ann's waitlist place, s3
      { id: 7, status: 'CONFIRMED' }, // Ann in the other conference (Review Focus 3)
    ]);
    expect((await snapshot()).registrations).toEqual([
      { id: 1, status: 'CANCELLED' }, { id: 2, status: 'CONFIRMED' }, { id: 3, status: 'CONFIRMED' }, { id: 4, status: 'CONFIRMED' }, { id: 5, status: 'CONFIRMED' },
    ]);
    const requestId = res.headers['x-request-id'];
    expect(events(entries, 'registration.cancelled')).toEqual([
      { level: 'log', context: 'Registrations', message: { event: 'registration.cancelled', requestId, registrationId: 1, attendeeId: 1, conferenceId: 1, sessionEntriesCancelled: 3 } },
    ]);
    expect(events(entries, 'waitlist.promoted')).toEqual([
      { level: 'log', context: 'Waitlist', message: { event: 'waitlist.promoted', requestId, sessionId: 2, attendeeId: 3, registrationId: 4, trigger: 'conference-cancel' } },
    ]);
    const order = entries.map((e) => e.message.event).filter(Boolean);
    expect(order.indexOf('registration.cancelled')).toBeLessThan(order.indexOf('waitlist.promoted'));
    expect(JSON.stringify(entries)).not.toContain('@');
  });

  it('leaves the attendee without active entries in the conference (spec 2 invariant)', async () => {
    await seedCascade();
    expect((await cancel(ANN, 1)).status).toBe(200);
    const active = await t.prisma.sessionRegistration.count({ where: { attendeeId: 1, status: { in: ['CONFIRMED', 'WAITLISTED'] }, session: { conferenceId: 1 } } });
    expect(active).toBe(0);
  });

  it('answers the same 404 for a registration of another email, an unknown id and an unknown email; nothing changes', async () => {
    await seedCascade();
    const before = await snapshot();
    for (const [email, id] of [[BOB, 1], [ANN, 999], ['nobody@example.com', 1]] as const) {
      const res = await cancel(email, id);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Registration ${id} not found for this email`);
      expect(JSON.stringify(res.body)).not.toContain('@');
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['CANCELLED', () => t.prisma.conference.update({ where: { id: 1 }, data: { status: 'CANCELLED' } })],
    ['COMPLETED', () => Promise.resolve(t.clock.set(new Date('2027-01-12T00:00:00.000Z')))],
  ] as const)('answers 409 REGISTRATION_CLOSED for a %s conference, also for a cancelled registration; nothing changes', async (status, close) => {
    await seedCascade();
    await t.prisma.registration.update({ where: { id: 2 }, data: { status: 'CANCELLED' } });
    await close();
    const before = await snapshot();
    for (const [email, id] of [[ANN, 1], [BOB, 2]] as const) {
      const res = await cancel(email, id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ reason: 'REGISTRATION_CLOSED', message: `Registration is closed: the conference is ${status}` });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('answers 409 ALREADY_CANCELLED to a repeated cancel without changes or log entries', async () => {
    await seedCascade();
    await cancel(ANN, 1);
    const before = await snapshot();
    const { result: res, entries } = await captureLogs(() => cancel(`  ${ANN.toUpperCase()} `, 1));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'ALREADY_CANCELLED', message: 'The registration is already cancelled' });
    expect(await snapshot()).toEqual(before);
    expect([...events(entries, 'registration.cancelled'), ...events(entries, 'waitlist.promoted')]).toEqual([]);
  });

  it('answers 400 for a bad email or id and for a body with fields or not an object (plan decision 2)', async () => {
    await seedCascade();
    expect((await cancel('ann', 1)).body.errors).toEqual([{ field: 'email', messages: ['email must be an email address'] }]);
    expect((await cancel(ANN, 'abc')).body.errors).toEqual([{ field: 'id', messages: ['id must be an integer between 1 and 2147483647'] }]);
    const extra = await cancel(ANN, 1, { reason: 'x' });
    expect(extra.status).toBe(400);
    expect(extra.body.errors).toEqual([{ field: 'reason', messages: ['property reason should not exist'] }]);
    expect((await cancel(ANN, 1, [])).status).toBe(400);
    expect((await snapshot()).registrations[0]).toEqual({ id: 1, status: 'CONFIRMED' });
  });

  it('answers 415 without Content-Type and 405 for GET', async () => {
    await seedCascade();
    expect((await t.http().post(`${path(ANN)}/1/cancel`)).status).toBe(415);
    const res = await t.http().get(`${path(ANN)}/1/cancel`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
