import { makeAttendee, makeConference, makeRegistration, makeRoom, makeSession, makeSessionRegistration, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: object) => t.http()[method](path).set('Content-Type', 'application/json').send(body);

async function seed(sessions: number): Promise<void> {
  await resetDb(t.prisma);
  await makeConference(t.prisma, { maxAttendees: 1000 });
  await makeSpeaker(t.prisma, { emailPublic: true });
  await makeSpeaker(t.prisma, { firstName: 'Ben', email: 'ben@example.com' });
  await makeRoom(t.prisma, { name: 'Hall A', capacity: 300 });
  await makeRoom(t.prisma, { name: 'Room 101', capacity: 300 });
  for (let i = 0; i < sessions; i += 1) {
    await makeSession(t.prisma, 1, { title: `Talk ${i}`, speakerId: (i % 2) + 1, roomId: (i % 2) + 1 });
  }
  const registered = await makeAttendee(t.prisma, { email: 'registered@example.com' });
  await makeRegistration(t.prisma, 1, registered.id);
  await makeAttendee(t.prisma, { firstName: 'Attendee', email: 'attendee1@example.com' });
}

const CONFERENCE = { title: 'Updated', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: 1000, organizerName: null, website: null };
const CASES: Record<string, () => Promise<{ status: number }>> = {
  'GET /api/conferences': () => t.http().get('/api/conferences'),
  'GET /api/conferences/{id}': () => t.http().get('/api/conferences/1'),
  'GET /api/conferences/{id}/sessions': () => t.http().get('/api/conferences/1/sessions'),
  'GET /api/conferences/{id}/registrations': () => t.http().get('/api/conferences/1/registrations'),
  'GET /api/sessions/{id}': () => t.http().get('/api/sessions/1'),
  'GET /api/speakers': () => t.http().get('/api/speakers'),
  'PUT /api/conferences/{id}': () => send('put', '/api/conferences/1', CONFERENCE),
  'PUT /api/sessions/{id}': () => send('put', '/api/sessions/1', { title: 'Updated', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 5, speakerId: 2, roomId: 2 }),
  'POST /api/conferences/{id}/sessions': () => send('post', '/api/conferences/1/sessions', { title: 'New', startTime: '2027-01-10T12:00:00', endTime: '2027-01-10T13:00:00', capacity: 5, speakerId: 1, roomId: 1 }),
  'POST /api/conferences/{id}/register, new attendee': () => send('post', '/api/conferences/1/register', { firstName: 'New', lastName: 'Attendee', email: 'new@example.com' }),
  'POST /api/conferences/{id}/register, existing attendee': () => send('post', '/api/conferences/1/register', { firstName: 'Attendee', lastName: '1', email: 'attendee1@example.com' }),
};

describe('QueryCount_DoesNotDependOnNumberOfSessions (DoD-11, PERF-1)', () => {
  it.each(Object.keys(CASES))('%s runs as many queries with 40 sessions as with 2', async (name) => {
    const counts: number[] = [];
    for (const sessions of [2, 40]) {
      await seed(sessions);
      let queries = 0;
      const stop = t.prisma.onQuery(() => {
        queries += 1;
      });
      const res = await CASES[name]();
      stop();
      expect(res.status).toBeLessThan(300);
      counts.push(queries);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
});

describe('GetSessionsAsync_ReturnsSessionsWithDirectRelationsOnly', () => {
  it('returns each session with conference, speaker and room, each with its own fields only', async () => {
    await seed(2);
    const res = await t.http().get('/api/conferences/1/sessions');
    for (const session of res.body as Record<string, Record<string, unknown>>[]) {
      expect(Object.keys(session.conference)).not.toEqual(expect.arrayContaining(['sessions']));
      expect(Object.keys(session.conference)).not.toContain('registrations');
      expect(Object.keys(session.speaker)).not.toContain('sessions');
      expect(Object.keys(session.room)).not.toContain('sessions');
    }
  });
});

describe('REL-1: the three parallel requests of the conference page (audit step 2)', () => {
  it.each([1, 2, 3, 4, 5])('round %d on a fresh application: all 200', async () => {
    const fresh = await createTestApp();
    await resetDb(fresh.prisma);
    await makeConference(fresh.prisma);
    await makeSession(fresh.prisma, 1);
    const results = await Promise.all([
      fresh.http().get('/api/conferences/1'),
      fresh.http().get('/api/conferences/1/sessions'),
      fresh.http().get('/api/conferences/1/registrations'),
    ]);
    await fresh.close();
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });
});

describe('BEVN-202: session registration endpoints do not depend on the number of entries', () => {
  // Session 1 (09:00-10:00) is full with n-1 attendees waiting; they hold seats in session 2 (10:00-11:00, back to back).
  async function seedEntries(n: number): Promise<void> {
    await resetDb(t.prisma);
    await makeConference(t.prisma);
    const full = await makeSession(t.prisma, 1, { startTime: '2027-01-10T09:00:00', endTime: '2027-01-10T10:00:00', capacity: 1 });
    const open = await makeSession(t.prisma, 1, { startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 1000 });
    for (let i = 0; i < n; i += 1) {
      const attendee = await makeAttendee(t.prisma, { email: `attendee${i}@example.com` });
      await makeRegistration(t.prisma, 1, attendee.id);
      await makeSessionRegistration(t.prisma, full.id, attendee.id, i === 0 ? 'CONFIRMED' : 'WAITLISTED');
      if (i > 0) await makeSessionRegistration(t.prisma, open.id, attendee.id, 'CONFIRMED');
    }
    const fresh = await makeAttendee(t.prisma, { email: 'fresh@example.com' });
    await makeRegistration(t.prisma, 1, fresh.id);
  }
  const ENTRY_CASES: Record<string, () => Promise<{ status: number }>> = {
    'GET /api/sessions/{id}': () => t.http().get('/api/sessions/1'),
    'POST /api/sessions/{id}/register': () => send('post', '/api/sessions/2/register', { email: 'fresh@example.com' }),
    'POST /api/sessions/{id}/waitlist': () => send('post', '/api/sessions/1/waitlist', { email: 'fresh@example.com' }),
    'POST /api/sessions/{id}/cancel, one promoted': () => send('post', '/api/sessions/1/cancel', { email: 'attendee0@example.com' }),
    'PUT /api/sessions/{id}, the whole waitlist promoted': () =>
      send('put', '/api/sessions/1', { title: 'Talk', description: null, startTime: '2027-01-10T09:00:00', endTime: '2027-01-10T10:00:00', capacity: 1000, speakerId: null, roomId: null }),
  };
  it.each(Object.keys(ENTRY_CASES))('%s runs as many queries with 40 entries as with 3', async (name) => {
    const counts: number[] = [];
    for (const n of [3, 40]) {
      await seedEntries(n);
      let queries = 0;
      const stop = t.prisma.onQuery(() => {
        queries += 1;
      });
      const res = await ENTRY_CASES[name]();
      stop();
      expect(res.status).toBeLessThan(300);
      counts.push(queries);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
});
