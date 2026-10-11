import { makeAttendee, makeConference, makeRegistration } from './fixtures';
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
