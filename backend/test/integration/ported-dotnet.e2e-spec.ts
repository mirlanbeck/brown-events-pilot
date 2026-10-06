import { makeConference, makeSession } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

// One-to-one port of BrownEvents.Tests (e95142d): ConferenceServiceTests (5) and SessionServiceTests (2), now over HTTP
// and a real Postgres (TEST-1). QueryCountTests are in query-count.e2e-spec.ts.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: object) => t.http()[method](path).set('Content-Type', 'application/json').send(body);
const CONFERENCE = { title: 'New Title', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: null, organizerName: null, website: null };

describe('ConferenceServiceTests', () => {
  it('GetAllAsync_ReturnsAllConferences', async () => {
    await makeConference(t.prisma, { title: 'A' });
    await makeConference(t.prisma, { title: 'B' });
    const res = await t.http().get('/api/conferences');
    expect(res.body.map((c: { title: string }) => c.title)).toEqual(['A', 'B']);
  });

  it('CreateAsync_PersistsConference', async () => {
    const res = await send('post', '/api/conferences', { title: 'Created', startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00' });
    expect(res.status).toBe(201);
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: res.body.id } })).title).toBe('Created');
  });

  // ADAPTED: the .NET test sent Status = "active" and expected "ACTIVE". Since EXT-150 the status is derived from the
  // dates and must match exactly (spec 5.4, D9b), so "active" is a 400. The test now checks the title change and the
  // derived status (precedent: BEVN-104 DoD "at least one existing unit test updated to reflect the new response shape").
  it('UpdateAsync_ChangesTitle', async () => {
    await makeConference(t.prisma, { title: 'Old Title' });
    const res = await send('put', '/api/conferences/1', CONFERENCE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'New Title', status: 'UPCOMING' });
    expect((await send('put', '/api/conferences/1', { ...CONFERENCE, status: 'active' })).status).toBe(400);
  });

  it('UpdateAsync_ReturnsNull_WhenNotFound -> 404', async () => {
    expect((await send('put', '/api/conferences/999', CONFERENCE)).status).toBe(404);
  });

  it('GetSessionsAsync_ReturnsOnlyConferenceSessions', async () => {
    await makeConference(t.prisma);
    await makeConference(t.prisma);
    await makeSession(t.prisma, 1, { title: 'Mine' });
    await makeSession(t.prisma, 2, { title: 'Other' });
    const res = await t.http().get('/api/conferences/1/sessions');
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(['Mine']);
  });
});

describe('SessionServiceTests', () => {
  const SESSION = { title: 'New Session Title', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 10, speakerId: null, roomId: null };

  it('UpdateAsync_ChangesSessionTitle', async () => {
    await makeConference(t.prisma);
    await makeSession(t.prisma, 1, { title: 'Old Session Title' });
    const res = await send('put', '/api/sessions/1', SESSION);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New Session Title');
  });

  it('UpdateAsync_ReturnsNull_WhenNotFound -> 404', async () => {
    expect((await send('put', '/api/sessions/999', SESSION)).status).toBe(404);
  });
});
