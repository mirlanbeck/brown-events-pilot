import { makeConference, makeRoom, makeSession, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: unknown) => t.http()[method](path).set('Content-Type', 'application/json').send(body as object);
const fieldsOf = (res: { body: { errors?: { field: string }[] } }) => (res.body.errors ?? []).map((e) => e.field);
// Conference 1: 2027-01-10..2027-01-11; speaker 1 (public email), room 1 Hall A (300), room 2 Room 101 (80).
const SESSION = { title: 'Platform Engineering Without the Hype', description: 'IDP on day one.', startTime: '2027-01-11T10:00:00', endTime: '2027-01-11T11:00:00', capacity: 80, speakerId: 1, roomId: 2 };

beforeEach(async () => {
  await resetDb(t.prisma);
  const conference = await makeConference(t.prisma);
  await makeSpeaker(t.prisma, { emailPublic: true });
  await makeRoom(t.prisma, { name: 'Hall A', capacity: 300 });
  await makeRoom(t.prisma, { name: 'Room 101', capacity: 80 });
  await makeSession(t.prisma, conference.id, { speakerId: 1, roomId: 1 });
});

describe('GET sessions', () => {
  it('lists a conference sessions as a bare array with conference, speaker, room (A06, C09, spec 5.1)', async () => {
    const res = await t.http().get('/api/conferences/1/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Object.keys(res.body[0]).sort()).toEqual(['capacity', 'conference', 'conferenceId', 'description', 'endTime', 'id', 'room', 'roomId', 'speaker', 'speakerId', 'startTime', 'title']);
    expect(Object.keys(res.body[0].conference)).not.toContain('sessions');
    expect(res.body[0].speaker).toEqual({ id: 1, firstName: 'Alice', lastName: 'Novak', bio: 'Bio', email: 'alice.novak@example.com', emailPublic: true });
    expect(res.body[0].room).toEqual({ id: 1, name: 'Hall A', capacity: 300, location: 'Ground Floor' });
  });
  it.each([['/api/conferences/999/sessions', 404], ['/api/conferences/abc/sessions', 400], ['/api/sessions/1', 200], ['/api/sessions/999', 404], ['/api/sessions/abc', 400]])(
    'GET %s -> %d (A07, A10-A12)',
    async (path, status) => {
      expect((await t.http().get(path)).status).toBe(status);
    },
  );
});

describe('POST /api/conferences/:id/sessions', () => {
  it('creates: 201 + Location (C01, MNT-2)', async () => {
    const res = await send('post', '/api/conferences/1/sessions', SESSION);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/sessions/2');
    expect(res.body).toMatchObject({ ...SESSION, id: 2, conferenceId: 1 });
  });
  it('accepts capacity equal to the room capacity', async () => {
    expect((await send('post', '/api/conferences/1/sessions', { ...SESSION, capacity: 80 })).status).toBe(201);
  });
  it.each([
    ['{} (C02)', {}, ['title', 'startTime', 'endTime', 'capacity']],
    ['end equal to start', { ...SESSION, endTime: SESSION.startTime }, ['endTime']],
    ['negative capacity (C05)', { ...SESSION, capacity: -5 }, ['capacity']],
    ['int32 overflow (Review Focus 3)', { ...SESSION, capacity: 3_000_000_000, speakerId: 3_000_000_000 }, ['capacity', 'speakerId']],
    ['conferenceId in the body', { ...SESSION, conferenceId: 1 }, ['conferenceId']],
  ])('rejects %s with 400', async (_name, body, fields) => {
    const res = await send('post', '/api/conferences/1/sessions', body);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(fields));
  });
  it('rejects a session outside the conference days with 422', async () => {
    const res = await send('post', '/api/conferences/1/sessions', { ...SESSION, startTime: '2027-01-12T10:00:00', endTime: '2027-01-12T11:00:00' });
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['startTime']);
  });
  it('rejects capacity above the room capacity with 422', async () => {
    const res = await send('post', '/api/conferences/1/sessions', { ...SESSION, capacity: 81 });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ field: 'capacity', messages: ['capacity must not exceed the room capacity (80)'] }]);
  });
  it('answers 422 on a missing speaker and keeps working afterwards (C10 -> C11, REL-2)', async () => {
    const bad = await send('post', '/api/conferences/1/sessions', { ...SESSION, speakerId: 999 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual([{ field: 'speakerId', messages: ['speakerId does not reference an existing record'] }]);
    expect((await send('post', '/api/speakers', { firstName: 'Valid', lastName: 'Speaker' })).status).toBe(201);
  });
  it('answers 422 on a missing room', async () => {
    expect(fieldsOf(await send('post', '/api/conferences/1/sessions', { ...SESSION, roomId: 999 }))).toEqual(['roomId']);
  });
  it('answers 404 for a missing conference', async () => {
    expect((await send('post', '/api/conferences/999/sessions', SESSION)).status).toBe(404);
  });
});

describe('PUT /api/sessions/:id', () => {
  it('replaces the session (C04)', async () => {
    const res = await send('put', '/api/sessions/1', { ...SESSION, title: 'Kubernetes for .NET Developers', capacity: 250, roomId: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: 'Kubernetes for .NET Developers', capacity: 250, roomId: 1 });
  });
  it('requires every key (C06) and refuses conferenceId (C08)', async () => {
    expect(fieldsOf(await send('put', '/api/sessions/1', { title: 'Only title' }))).toEqual(expect.arrayContaining(['description', 'startTime', 'endTime', 'capacity', 'speakerId', 'roomId']));
    expect(fieldsOf(await send('put', '/api/sessions/1', { ...SESSION, conferenceId: 1 }))).toEqual(['conferenceId']);
  });
  it('allows null for speaker and room', async () => {
    const res = await send('put', '/api/sessions/1', { ...SESSION, description: null, speakerId: null, roomId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ speaker: null, room: null });
  });
  it('answers 404 for a missing session (C07)', async () => {
    expect((await send('put', '/api/sessions/999', SESSION)).status).toBe(404);
  });
});
