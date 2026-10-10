import { Logger, type LoggerService } from '@nestjs/common';
import { makeAttendee, makeConference, makeRegistration, makeSession, makeSessionRegistration } from './fixtures';
import { createTestApp, DEFAULT_NOW, resetDb, whileTableLocked, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: DEFAULT_NOW });
});
afterAll(() => t.close());

type Action = 'register' | 'waitlist' | 'cancel';
const post = (sessionId: number | string, action: Action, body: unknown) =>
  t.http().post(`/api/sessions/${sessionId}/${action}`).set('Content-Type', 'application/json').send(body as object);
const counts = async (sessionId = 1) => {
  const res = await t.http().get(`/api/sessions/${sessionId}`);
  return { registeredCount: res.body.registeredCount, capacity: res.body.capacity, waitlistCount: res.body.waitlistCount };
};
const statuses = () => t.prisma.sessionRegistration.findMany({ orderBy: { id: 'asc' }, select: { id: true, attendeeId: true, status: true } });

// Records the Nest level (the method called) and the context of each structured log entry.
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
const promotions = (entries: LevelLogger['entries']) => entries.filter((e) => e.message.event === 'waitlist.promoted');

// Conference 1: 2027-01-10..11, UPCOMING at DEFAULT_NOW. Session 1 10:00-11:00 (1 seat), session 2 10:30-11:30 (overlaps 1),
// session 3 11:00-12:00 (back to back with 1). A, B, C are registered for the conference; D is an attendee without a registration.
const A = { email: 'a@example.com' };
const B = { email: 'b@example.com' };
const C = { email: 'c@example.com' };
const D = { email: 'd@example.com' };

beforeEach(async () => {
  t.clock.set(new Date(DEFAULT_NOW));
  await resetDb(t.prisma);
  const conference = await makeConference(t.prisma);
  await makeSession(t.prisma, conference.id, { capacity: 1 });
  await makeSession(t.prisma, conference.id, { startTime: '2027-01-10T10:30:00', endTime: '2027-01-10T11:30:00', capacity: 5 });
  await makeSession(t.prisma, conference.id, { startTime: '2027-01-10T11:00:00', endTime: '2027-01-10T12:00:00', capacity: 5 });
  for (const { email } of [A, B, C]) {
    const attendee = await makeAttendee(t.prisma, { email });
    await makeRegistration(t.prisma, conference.id, attendee.id);
  }
  await makeAttendee(t.prisma, D);
});

// Ways to close registration (spec 4.4). Plain functions returning a promise: an async function without await fails
// the lint rule require-await.
const CLOSERS: [string, () => Promise<unknown>, string][] = [
  ['the session has started', () => Promise.resolve(t.clock.set(new Date('2027-01-10T10:00:00.000Z'))), 'Registration is closed: the session has started'],
  ['the conference is CANCELLED', () => t.prisma.conference.update({ where: { id: 1 }, data: { status: 'CANCELLED' } }), 'Registration is closed: the conference is CANCELLED'],
  ['the conference is COMPLETED', () => Promise.resolve(t.clock.set(new Date('2027-01-12T00:00:00.000Z'))), 'Registration is closed: the conference is COMPLETED'],
];

describe('POST /api/sessions/:id/register and /waitlist (spec 4.1, 4.2)', () => {
  it('registers: 201, entry without names or email, no Location; GET shows the counts', async () => {
    const res = await post(1, 'register', A);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({ id: 1, sessionId: 1, attendeeId: 1, status: 'CONFIRMED', createdAt: '2026-10-05T12:00:00.000Z' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('GET /api/sessions/:id keeps the session fields and adds the two counts', async () => {
    const res = await t.http().get('/api/sessions/1');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['capacity', 'conference', 'conferenceId', 'description', 'endTime', 'id', 'registeredCount', 'room', 'roomId', 'speaker', 'speakerId', 'startTime', 'title', 'waitlistCount'],
    );
    expect(res.body).toMatchObject({ registeredCount: 0, waitlistCount: 0 });
  });

  it('finds the attendee whatever the case and spaces of the email (Review Focus 1)', async () => {
    expect((await post(1, 'register', { email: '  A@Example.COM ' })).body).toMatchObject({ attendeeId: 1, status: 'CONFIRMED' });
  });

  it('refuses a full session with 409 SESSION_FULL and does not put the attendee on the waitlist (DoD)', async () => {
    await post(1, 'register', A);
    const res = await post(1, 'register', B);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict', reason: 'SESSION_FULL', message: 'No seats left in this session; join the waitlist instead' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('adds to the waitlist of a full session: 201 WAITLISTED (DoD)', async () => {
    await post(1, 'register', A);
    const res = await post(1, 'waitlist', B);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sessionId: 1, attendeeId: 2, status: 'WAITLISTED' });
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
  });

  it('refuses the waitlist while seats are free: 409 SEATS_AVAILABLE', async () => {
    const res = await post(1, 'waitlist', A);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('SEATS_AVAILABLE');
    expect(await t.prisma.sessionRegistration.count()).toBe(0);
  });

  it('answers 409 CONFERENCE_REGISTRATION_REQUIRED the same way for an unregistered attendee and an unknown email', async () => {
    const unregistered = await post(1, 'register', D);
    const unknown = await post(1, 'register', { email: 'nobody@example.com' });
    for (const res of [unregistered, unknown]) {
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('CONFERENCE_REGISTRATION_REQUIRED');
    }
    const { requestId: _a, ...first } = unregistered.body;
    const { requestId: _b, ...second } = unknown.body;
    expect(first).toEqual(second);
    expect(await t.prisma.attendee.count()).toBe(4);
  });

  it('answers 409 ALREADY_REGISTERED with different messages for a seat and a waitlist place', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    expect((await post(1, 'register', A)).body).toMatchObject({ reason: 'ALREADY_REGISTERED', message: 'Attendee is already registered for this session' });
    expect((await post(1, 'waitlist', B)).body).toMatchObject({ reason: 'ALREADY_REGISTERED', message: 'Attendee is already on the waitlist for this session' });
  });

  it('refuses an overlapping session with 409 SESSION_OVERLAP, counting waitlist places, and allows back-to-back ones', async () => {
    await post(1, 'register', A);
    expect((await post(2, 'register', A)).body.reason).toBe('SESSION_OVERLAP');
    expect((await post(3, 'register', A)).status).toBe(201);
    await post(1, 'waitlist', B);
    expect((await post(2, 'register', B)).body.reason).toBe('SESSION_OVERLAP');
  });

  it('does not count a cancelled entry as an overlap (critic 3)', async () => {
    await post(1, 'register', A);
    await post(1, 'cancel', A);
    expect((await post(2, 'register', A)).status).toBe(201);
  });

  it('does not check overlaps with sessions of another conference (spec 2; critic 4)', async () => {
    const other = await makeConference(t.prisma, { title: 'Other' });
    const session = await makeSession(t.prisma, other.id);
    await makeRegistration(t.prisma, other.id, 1);
    await post(1, 'register', A);
    expect((await post(session.id, 'register', A)).status).toBe(201);
  });

  it.each(CLOSERS)('answers 409 REGISTRATION_CLOSED when %s, before any other check (spec 4.2, 4.4)', async (_name, close, message) => {
    await close();
    for (const res of [await post(1, 'register', A), await post(1, 'waitlist', { email: 'nobody@example.com' })]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ reason: 'REGISTRATION_CLOSED', message });
    }
  });

  it('is still open one second before the session starts', async () => {
    t.clock.set(new Date('2027-01-10T09:59:59.000Z'));
    expect((await post(1, 'register', A)).status).toBe(201);
  });

  it.each(['register', 'waitlist'] as const)('%s: 404 for a missing session, 400 for a bad id or body', async (action) => {
    expect((await post(999, action, A)).body).toMatchObject({ statusCode: 404, message: 'Session 999 not found' });
    expect((await post('abc', action, A)).status).toBe(400);
    const badEmail = await post(1, action, { email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.errors.map((e: { field: string }) => e.field)).toEqual(['email']);
    const extra = await post(1, action, { ...A, sessionId: 1 });
    expect(extra.status).toBe(400);
    expect(extra.body.errors.map((e: { field: string }) => e.field)).toEqual(['sessionId']);
  });

  it('answers 405 for GET on the new routes', async () => {
    const res = await t.http().get('/api/sessions/1/register');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});

describe('POST /api/sessions/:id/cancel (spec 4.3, 5.2, 5.3)', () => {
  it('cancels a seat: 200 with the CANCELLED entry; the first on the waitlist gets the seat and the promotion is logged at INFO (DoD)', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    const { result: res, entries } = await captureLogs(() => post(1, 'cancel', A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, sessionId: 1, attendeeId: 1, status: 'CANCELLED', createdAt: '2026-10-05T12:00:00.000Z' });
    // B and C joined at the same FixedClock instant: the smaller id goes first (spec 2).
    expect(await statuses()).toEqual([
      { id: 1, attendeeId: 1, status: 'CANCELLED' },
      { id: 2, attendeeId: 2, status: 'CONFIRMED' },
      { id: 3, attendeeId: 3, status: 'WAITLISTED' },
    ]);
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    const logged = promotions(entries);
    expect(logged).toEqual([
      {
        level: 'log',
        context: 'Waitlist',
        message: { event: 'waitlist.promoted', requestId: res.headers['x-request-id'], sessionId: 1, attendeeId: 2, registrationId: 2, trigger: 'cancel' },
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain('@');
  });

  it('promotes by createdAt before id (DoD: waitlist ordering)', async () => {
    const [a, b, c] = [1, 2, 3];
    await makeSessionRegistration(t.prisma, 1, a, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, b, 'WAITLISTED', '2026-10-01T09:00:02.000Z');
    await makeSessionRegistration(t.prisma, 1, c, 'WAITLISTED', '2026-10-01T09:00:01.000Z');
    await post(1, 'cancel', A);
    expect((await statuses()).map((s) => s.status)).toEqual(['CANCELLED', 'WAITLISTED', 'CONFIRMED']);
  });

  it('promotes from the waitlist of the cancelled session only; entries of other sessions neither fill nor take its seat', async () => {
    // Session 4 (another day) is full and has its own, earlier waitlist place; its seat must not count for session 1 either.
    const other = await makeSession(t.prisma, 1, { startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 1 });
    await makeSessionRegistration(t.prisma, 1, 1, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, 3, 'WAITLISTED', '2026-10-01T09:00:02.000Z');
    await makeSessionRegistration(t.prisma, other.id, 3, 'CONFIRMED', '2026-10-01T09:00:00.000Z');
    await makeSessionRegistration(t.prisma, other.id, 2, 'WAITLISTED', '2026-10-01T09:00:01.000Z');
    const { entries } = await captureLogs(() => post(1, 'cancel', A));
    expect(await statuses()).toEqual([
      { id: 1, attendeeId: 1, status: 'CANCELLED' },
      { id: 2, attendeeId: 3, status: 'CONFIRMED' },
      { id: 3, attendeeId: 3, status: 'CONFIRMED' },
      { id: 4, attendeeId: 2, status: 'WAITLISTED' },
    ]);
    expect(await counts(other.id)).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    expect(promotions(entries).map((e) => [e.message.sessionId, e.message.attendeeId, e.message.registrationId])).toEqual([[1, 3, 2]]);
  });

  it('cancels a waitlist place without promoting anyone and without a log entry', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    const { result: res, entries } = await captureLogs(() => post(1, 'cancel', B));
    expect(res.body.status).toBe('CANCELLED');
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 1 });
    expect(promotions(entries)).toEqual([]);
  });

  it('answers 404 without an active entry, for a repeated cancel and for an unknown email; nothing is promoted (Review Focus 2)', async () => {
    await post(1, 'register', A);
    await post(1, 'waitlist', B);
    await post(1, 'cancel', A); // B promoted
    const { result, entries } = await captureLogs(async () => [await post(1, 'cancel', A), await post(1, 'cancel', C), await post(1, 'cancel', { email: 'nobody@example.com' })]);
    for (const res of result) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('No active registration or waitlist place for this email on this session');
    }
    expect(promotions(entries)).toEqual([]);
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 1, waitlistCount: 0 });
  });

  it('cancels only on the given session: an entry on another session stays and the answer is 404 (critic 2)', async () => {
    await post(3, 'register', A);
    expect((await post(1, 'cancel', A)).status).toBe(404);
    expect(await statuses()).toEqual([{ id: 1, attendeeId: 1, status: 'CONFIRMED' }]);
  });

  it('finds the entry whatever the case and spaces of the email (Review Focus 1)', async () => {
    await post(1, 'register', A);
    expect((await post(1, 'cancel', { email: ' A@EXAMPLE.com' })).status).toBe(200);
  });

  it.each(CLOSERS)('answers 409 REGISTRATION_CLOSED when %s and keeps the entry', async (_name, close) => {
    await post(1, 'register', A);
    await close();
    const res = await post(1, 'cancel', A);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('REGISTRATION_CLOSED');
    expect((await statuses())[0].status).toBe('CONFIRMED');
  });

  it('404 for a missing session, 400 for a bad id or body', async () => {
    expect((await post(999, 'cancel', A)).body.message).toBe('Session 999 not found');
    expect((await post('abc', 'cancel', A)).status).toBe(400);
    expect((await post(1, 'cancel', { email: 'x' })).status).toBe(400);
    expect((await post(1, 'cancel', { ...A, reason: 'x' })).status).toBe(400);
  });

  it('registers again after a cancel as a new row; a new waitlist place goes to the end (spec 3.1)', async () => {
    await post(1, 'register', A);
    await post(1, 'cancel', A);
    const again = await post(1, 'register', A);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: 2, status: 'CONFIRMED' });
    await post(1, 'waitlist', B);
    await post(1, 'waitlist', C);
    await post(1, 'cancel', B);
    t.clock.set(new Date('2026-10-05T12:00:01.000Z'));
    await post(1, 'waitlist', B);
    await post(1, 'cancel', A);
    expect((await statuses()).map((s) => [s.attendeeId, s.status])).toEqual([
      [1, 'CANCELLED'], [1, 'CANCELLED'], [2, 'CANCELLED'], [3, 'CONFIRMED'], [2, 'WAITLISTED'],
    ]);
  });
});

describe('PUT /api/sessions/:id with registrations (spec 4.5)', () => {
  const SESSION_1 = { title: 'Talk', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', speakerId: null, roomId: null };
  const put = (body: object) => t.http().put('/api/sessions/1').set('Content-Type', 'application/json').send(body);
  async function fillSession1(confirmed: number[], waitlisted: number[]): Promise<void> {
    for (const id of confirmed) await makeSessionRegistration(t.prisma, 1, id, 'CONFIRMED');
    for (const [i, id] of waitlisted.entries()) await makeSessionRegistration(t.prisma, 1, id, 'WAITLISTED', `2026-10-01T10:00:0${i}.000Z`);
  }

  it('refuses capacity below the confirmed count with 422 on capacity', async () => {
    await fillSession1([1, 2], []);
    const res = await put({ ...SESSION_1, capacity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ field: 'capacity', messages: ['capacity must not be below the number of confirmed registrations (2)'] }]);
  });

  it('allows capacity equal to the confirmed count (Review Focus 3)', async () => {
    await fillSession1([1, 2], []);
    expect((await put({ ...SESSION_1, capacity: 2 })).status).toBe(200);
  });

  it('reports the room and the confirmed-count errors together under capacity', async () => {
    await t.prisma.room.create({ data: { name: 'Small', capacity: 1 } });
    await fillSession1([1, 2, 3], []);
    const res = await put({ ...SESSION_1, capacity: 2, roomId: 1 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'capacity', messages: ['capacity must not exceed the room capacity (1)', 'capacity must not be below the number of confirmed registrations (3)'] },
    ]);
  });

  it('promotes the waitlist in order when capacity grows, one INFO entry per attendee with trigger session-update (Review Focus 4)', async () => {
    await fillSession1([1], [3, 2]);
    const { result: res, entries } = await captureLogs(() => put({ ...SESSION_1, capacity: 5 }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).not.toContain('registeredCount'); // PUT keeps SessionResponse (spec 4.1)
    expect(await counts()).toEqual({ registeredCount: 3, capacity: 5, waitlistCount: 0 });
    expect(promotions(entries).map((e) => [e.level, e.message.attendeeId, e.message.trigger])).toEqual([
      ['log', 3, 'session-update'],
      ['log', 2, 'session-update'],
    ]);
  });

  it('promotes only as many as the new seats', async () => {
    await fillSession1([1], [2, 3]);
    await put({ ...SESSION_1, capacity: 2 });
    expect(await counts()).toEqual({ registeredCount: 2, capacity: 2, waitlistCount: 1 });
  });

  it('does not promote after the session has started (spec 4.5, 9)', async () => {
    await fillSession1([1], [2]);
    t.clock.set(new Date('2027-01-10T10:30:00.000Z'));
    const { entries } = await captureLogs(() => put({ ...SESSION_1, capacity: 5 }));
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 5, waitlistCount: 1 });
    expect(promotions(entries)).toEqual([]);
  });

  it('gives the seats added after the start to the waitlist when a PUT moves the session back into the future; a newcomer gets SESSION_FULL (critic 1 path A, 5)', async () => {
    await fillSession1([1], [2]);
    t.clock.set(new Date('2027-01-10T10:30:00.000Z'));
    expect((await put({ ...SESSION_1, capacity: 2 })).status).toBe(200);
    expect(await counts()).toEqual({ registeredCount: 1, capacity: 2, waitlistCount: 1 }); // closed: nobody promoted
    const { result: res, entries } = await captureLogs(() => put({ ...SESSION_1, startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 2 }));
    expect(res.status).toBe(200);
    expect(await counts()).toEqual({ registeredCount: 2, capacity: 2, waitlistCount: 0 });
    expect(promotions(entries).map((e) => [e.message.attendeeId, e.message.trigger])).toEqual([[2, 'session-update']]);
    expect((await post(1, 'register', C)).body.reason).toBe('SESSION_FULL');
  });
});

describe('PUT /api/conferences/:id and the waitlists (spec 4.8; plan decision 12)', () => {
  const CONFERENCE_1 = { title: 'Test Conference', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: null, organizerName: null, website: null };
  const putConference = (body: object) => t.http().put('/api/conferences/1').set('Content-Type', 'application/json').send(body);
  const putSession = (id: number, startTime: string, endTime: string, capacity: number) =>
    t.http().put(`/api/sessions/${id}`).set('Content-Type', 'application/json').send({ title: 'Talk', description: null, startTime, endTime, capacity, speakerId: null, roomId: null });
  // Session 1: A has the seat, C and B wait (C first); a seat is added directly in the database (as if while registration was closed).
  async function seatAddedWhileClosed(): Promise<void> {
    await makeSessionRegistration(t.prisma, 1, 1, 'CONFIRMED');
    await makeSessionRegistration(t.prisma, 1, 3, 'WAITLISTED', '2026-10-01T10:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, 2, 'WAITLISTED', '2026-10-01T10:00:01.000Z');
    await t.prisma.session.update({ where: { id: 1 }, data: { capacity: 2 } });
  }

  it('lifting CANCELLED gives the seats added meanwhile to the waitlists of every open session in order; a newcomer gets SESSION_FULL (critic 1 path B)', async () => {
    await t.prisma.session.update({ where: { id: 3 }, data: { capacity: 1 } });
    await makeSessionRegistration(t.prisma, 1, 1, 'CONFIRMED');
    await makeSessionRegistration(t.prisma, 1, 3, 'WAITLISTED', '2026-10-01T10:00:00.000Z');
    await makeSessionRegistration(t.prisma, 1, 2, 'WAITLISTED', '2026-10-01T10:00:01.000Z');
    await makeSessionRegistration(t.prisma, 3, 1, 'CONFIRMED');
    await makeSessionRegistration(t.prisma, 3, 2, 'WAITLISTED');
    expect((await putConference({ ...CONFERENCE_1, status: 'CANCELLED' })).status).toBe(200);
    expect((await putSession(1, '2027-01-10T10:00:00', '2027-01-10T11:00:00', 2)).status).toBe(200);
    expect((await putSession(3, '2027-01-10T11:00:00', '2027-01-10T12:00:00', 2)).status).toBe(200);
    expect(await counts(1)).toEqual({ registeredCount: 1, capacity: 2, waitlistCount: 2 }); // closed: nobody promoted

    const { result: res, entries } = await captureLogs(() => putConference(CONFERENCE_1));
    expect(res.status).toBe(200);
    expect(await counts(1)).toEqual({ registeredCount: 2, capacity: 2, waitlistCount: 1 });
    expect(await counts(3)).toEqual({ registeredCount: 2, capacity: 2, waitlistCount: 0 });
    expect(promotions(entries).map((e) => [e.level, e.message.sessionId, e.message.attendeeId, e.message.trigger])).toEqual([
      ['log', 1, 3, 'conference-update'],
      ['log', 3, 2, 'conference-update'],
    ]);
    const newcomer = await makeAttendee(t.prisma, { email: 'e@example.com' });
    await makeRegistration(t.prisma, 1, newcomer.id);
    expect((await post(1, 'register', { email: 'e@example.com' })).body.reason).toBe('SESSION_FULL');
  });

  it('promotes nobody when registration stays closed after the PUT', async () => {
    await seatAddedWhileClosed();
    const { result: res, entries } = await captureLogs(() => putConference({ ...CONFERENCE_1, status: 'CANCELLED' }));
    expect(res.status).toBe(200);
    expect(await counts(1)).toEqual({ registeredCount: 1, capacity: 2, waitlistCount: 2 });
    expect(promotions(entries)).toEqual([]);
  });

  it('promotes nobody when the PUT is refused (Review Focus 8)', async () => {
    await seatAddedWhileClosed();
    const { result: res, entries } = await captureLogs(() => putConference({ ...CONFERENCE_1, startDate: '2027-02-01T00:00:00', endDate: '2027-02-02T00:00:00' }));
    expect(res.status).toBe(409);
    expect(await counts(1)).toEqual({ registeredCount: 1, capacity: 2, waitlistCount: 2 });
    expect(promotions(entries)).toEqual([]);
  });
});

describe('races under the conference lock (spec 5.1)', () => {
  it('gives the last seat to exactly one of ten parallel requests', async () => {
    const session = await makeSession(t.prisma, 1, { startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 3 });
    await makeSessionRegistration(t.prisma, session.id, 1, 'CONFIRMED');
    await makeSessionRegistration(t.prisma, session.id, 2, 'CONFIRMED');
    for (let i = 0; i < 10; i += 1) {
      const racer = await makeAttendee(t.prisma, { email: `racer${i}@example.com` });
      await makeRegistration(t.prisma, 1, racer.id);
    }
    let results: { status: number; body: { reason?: string } }[] = [];
    await whileTableLocked('session_registrations', async () => {
      results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(session.id, 'register', { email: `racer${i}@example.com` })));
    });
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.reason === 'SESSION_FULL')).toBe(true);
    expect(await t.prisma.sessionRegistration.count({ where: { sessionId: session.id, status: 'CONFIRMED' } })).toBe(3);
  });

  it('lets one attendee into only one of two overlapping sessions requested at once', async () => {
    let results: { status: number; body: { reason?: string } }[] = [];
    await whileTableLocked('session_registrations', async () => {
      results = await Promise.all([post(1, 'register', A), post(2, 'register', A)]);
    });
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.reason).toBe('SESSION_OVERLAP');
    expect(await t.prisma.sessionRegistration.count({ where: { attendeeId: 1 } })).toBe(1);
  });
});
