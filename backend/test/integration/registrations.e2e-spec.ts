import { lockConference } from '../../src/common/locking';
import { makeAttendee, makeConference, makeRegistration, makeSession, makeSessionRegistration } from './fixtures';
import { createTestApp, newPrisma, resetDb, whileTableLocked, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(async () => {
  t.clock.set(new Date('2026-10-05T12:00:00.000Z'));
  await resetDb(t.prisma);
});
afterAll(() => t.close());

const register = (conferenceId: number | string, body: unknown) =>
  t.http().post(`/api/conferences/${conferenceId}/register`).set('Content-Type', 'application/json').send(body as object);
// Bodies sent by the two frontend forms (D04 modal, D05 page).
const MODAL = { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com', phone: '', company: '', dietaryRequirements: '', sessionId: null };
const PAGE = { firstName: 'Jan', lastName: 'Nowak', email: 'jan.nowak@example.com', phone: '+48 600 000 000', company: 'ACME' };

describe('POST /api/conferences/:id/register', () => {
  it('registers from the modal form: 201, attendee without email, registeredAt with Z (D04, spec 5.3, 5.5)', async () => {
    await makeConference(t.prisma);
    const res = await register(1, MODAL);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toMatchObject({ id: 1, registeredAt: '2026-10-05T12:00:00.000Z', status: 'CONFIRMED', conferenceId: 1, attendeeId: 1, attendee: { id: 1, firstName: 'Maria', lastName: 'Kowalska' } });
    expect(Object.keys(res.body.attendee).sort()).toEqual(['firstName', 'id', 'lastName']);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('registers from the page form and ignores the unstored fields (D05, D06)', async () => {
    await makeConference(t.prisma);
    expect((await register(1, PAGE)).status).toBe(201);
    expect((await register(1, { ...MODAL, email: 'other@example.com', sessionId: 6 })).status).toBe(201);
  });

  it.each([
    [{}, ['firstName', 'lastName', 'email']],
    [{ ...MODAL, sessionId: '5' }, ['sessionId']],
    [{ ...MODAL, sessionId: 0 }, ['sessionId']],
    [{ ...MODAL, sessionId: 3_000_000_000 }, ['sessionId']],
    [{ ...MODAL, email: 'иван@пример.рф' }, ['email']],
    [{ ...MODAL, phone: 'x'.repeat(51) }, ['phone']],
    [{ ...MODAL, status: 'VIP' }, ['status']],
  ])('rejects %j with 400 (D10, Review Focus 3)', async (body, fields) => {
    await makeConference(t.prisma);
    const res = await register(1, body);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(expect.arrayContaining(fields));
  });

  it('keeps non-ASCII names intact (Review Focus 4)', async () => {
    await makeConference(t.prisma);
    const res = await register(1, { ...MODAL, firstName: 'Мария', lastName: 'Kowalská' });
    expect(res.status).toBe(201);
    expect(res.body.attendee).toMatchObject({ firstName: 'Мария', lastName: 'Kowalská' });
  });

  it('refuses a duplicate, whatever the case, spaces or name (D07-D09, Review Focus 5, CORR-3)', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    for (const body of [MODAL, { ...MODAL, firstName: 'Other', lastName: 'Name' }, { ...MODAL, firstName: 'Maria', lastName: 'Upper', email: '  MARIA.Kowalska@Example.com ' }]) {
      const res = await register(1, body);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Attendee is already registered for this conference');
    }
    expect(await t.prisma.attendee.count()).toBe(1);
    expect(await t.prisma.registration.count()).toBe(1);
  });

  it('reuses the attendee on another conference and keeps the stored name (spec 6.2)', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    await register(1, MODAL);
    const res = await register(2, { ...MODAL, firstName: 'Other', email: ' Maria.Kowalska@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.attendee).toEqual({ id: 1, firstName: 'Maria', lastName: 'Kowalska' });
  });

  it.each([
    ['COMPLETED (D11)', { startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00' }],
    ['CANCELLED', { status: 'CANCELLED' }],
  ])('refuses a %s conference with 409 (CORR-1)', async (_name, conference) => {
    await makeConference(t.prisma, conference);
    const res = await register(1, MODAL);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Registration is closed: the conference is (COMPLETED|CANCELLED)$/);
  });

  it('allows an ACTIVE conference on its last day', async () => {
    await makeConference(t.prisma, { startDate: '2026-10-04T00:00:00', endDate: '2026-10-05T00:00:00' });
    expect((await register(1, MODAL)).status).toBe(201);
  });

  it('answers 404 for a missing conference and creates no attendee (D16, REL-5)', async () => {
    expect((await register(9999, MODAL)).status).toBe(404);
    expect(await t.prisma.attendee.count()).toBe(0);
  });

  it('refuses a full conference with 409', async () => {
    await makeConference(t.prisma, { maxAttendees: 1 });
    await register(1, MODAL);
    const res = await register(1, PAGE);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('No seats left');
  });

  it('gives the last seat to exactly one of ten parallel requests (CORR-1, spec 6.2)', async () => {
    await makeConference(t.prisma, { maxAttendees: 3 });
    await register(1, { ...MODAL, email: 'a@example.com' });
    await register(1, { ...MODAL, email: 'b@example.com' });
    let statuses: number[] = [];
    await whileTableLocked('registrations', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => register(1, { ...MODAL, email: `racer${i}@example.com` })));
      statuses = results.map((r) => r.status).sort();
    });
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(await t.prisma.registration.count()).toBe(3);
  });

  it('creates one attendee for one new email on two conferences at once (spec 6.2)', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    let results: { status: number; body: { attendeeId: number } }[] = [];
    await whileTableLocked('attendees', async () => {
      results = await Promise.all([register(1, MODAL), register(2, MODAL)]);
    });
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.attendeeId).toBe(results[1].body.attendeeId);
    expect(await t.prisma.attendee.count()).toBe(1);
  });

  it('answers 503 with Retry-After while the conference is locked longer than lock_timeout (spec 8)', async () => {
    await makeConference(t.prisma);
    const other = newPrisma();
    let release: () => void = () => undefined;
    const held = other.$transaction(
      async (tx) => {
        await lockConference(tx, 1);
        await new Promise<void>((resolve) => (release = resolve));
      },
      { timeout: 15000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const res = await register(1, MODAL);
    release();
    await held;
    await other.$disconnect();
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
  });
});

describe('registering again after a cancel (BEVN-203 spec 3.2, 4.5)', () => {
  const cancelRow = (id: number) => t.prisma.registration.update({ where: { id }, data: { status: 'CANCELLED' } });

  it('brings the same row back to CONFIRMED with the new registeredAt and the stored name', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    await cancelRow(1);
    t.clock.set(new Date('2026-10-06T08:00:00.000Z'));
    const res = await register(1, { ...MODAL, firstName: 'Other', email: '  MARIA.KOWALSKA@example.com ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, status: 'CONFIRMED', registeredAt: '2026-10-06T08:00:00.000Z', attendee: { firstName: 'Maria' } });
    expect(await t.prisma.registration.count()).toBe(1);
  });

  it('does not restore the session entries', async () => {
    await makeConference(t.prisma);
    const session = await makeSession(t.prisma, 1);
    await register(1, MODAL);
    await makeSessionRegistration(t.prisma, session.id, 1, 'CANCELLED');
    await cancelRow(1);
    expect((await register(1, MODAL)).status).toBe(201);
    expect(await t.prisma.sessionRegistration.findMany({ select: { status: true } })).toEqual([{ status: 'CANCELLED' }]);
  });

  it('checks the seats as for a new registration; a cancelled row does not take a seat', async () => {
    await makeConference(t.prisma, { maxAttendees: 1 });
    await register(1, MODAL);
    await cancelRow(1);
    expect((await register(1, PAGE)).status).toBe(201);
    const again = await register(1, MODAL);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('No seats left');
    expect(await t.prisma.registration.findUnique({ where: { id: 1 }, select: { status: true } })).toEqual({ status: 'CANCELLED' });
  });

  it('refuses a closed conference before reactivating', async () => {
    await makeConference(t.prisma, { status: 'CANCELLED' });
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, 1, attendee.id);
    await cancelRow(1);
    expect((await register(1, MODAL)).status).toBe(409);
    expect(await t.prisma.registration.findUnique({ where: { id: 1 }, select: { status: true } })).toEqual({ status: 'CANCELLED' });
  });

  it('lists cancelled registrations with their status in both conference answers (spec 4.7)', async () => {
    await makeConference(t.prisma);
    await register(1, MODAL);
    await register(1, PAGE);
    await cancelRow(1);
    const list = await t.http().get('/api/conferences/1/registrations');
    expect(list.body.map((r: { id: number; status: string }) => [r.id, r.status])).toEqual([[1, 'CANCELLED'], [2, 'CONFIRMED']]);
    const conference = await t.http().get('/api/conferences/1');
    expect(conference.body.registrations.map((r: { status: string }) => r.status)).toEqual(['CANCELLED', 'CONFIRMED']);
  });
});

describe('GET /api/conferences/:id/registrations', () => {
  it('lists registrations with conference and public attendee, no email anywhere (D13, SEC-1)', async () => {
    await makeConference(t.prisma);
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, 1, attendee.id);
    const res = await t.http().get('/api/conferences/1/registrations');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 1, registeredAt: '2026-10-01T09:00:00.000Z', attendee: { id: 1, firstName: 'Maria', lastName: 'Kowalska' }, conference: { id: 1 } });
    expect(JSON.stringify(res.body)).not.toContain('@');
    const conference = await t.http().get('/api/conferences/1');
    expect(Object.keys(conference.body.registrations[0])).not.toContain('attendee');
  });
  it.each([['999', 404], ['abc', 400]])('GET /api/conferences/%s/registrations -> %d (A09)', async (id, status) => {
    expect((await t.http().get(`/api/conferences/${id}/registrations`)).status).toBe(status);
  });
});
