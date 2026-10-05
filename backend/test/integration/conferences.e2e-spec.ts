import { makeAttendee, makeConference, makeRegistration, makeSession } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: unknown) => t.http()[method](path).set('Content-Type', 'application/json').send(body as object);

const FULL = {
  title: 'Frontend Frontiers 2026', description: 'React, TypeScript and web performance for product teams.', location: 'Berlin, Germany',
  venue: 'Station Berlin', startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00', status: 'UPCOMING', maxAttendees: 350,
  organizerName: 'Web Guild', website: 'https://frontendfrontiers.example.com',
};
const fieldsOf = (res: { body: { errors?: { field: string }[] } }) => (res.body.errors ?? []).map((e) => e.field);

describe('GET /api/conferences', () => {
  it('returns bare arrays with direct relations, own fields only (A01, spec 5.1, 5.2)', async () => {
    const conference = await makeConference(t.prisma, { startDate: '2026-10-05T00:00:00', endDate: '2026-10-06T00:00:00', maxAttendees: 10 });
    await makeSession(t.prisma, conference.id, { startTime: '2026-10-05T10:00:00', endTime: '2026-10-05T11:00:00' });
    const attendee = await makeAttendee(t.prisma);
    await makeRegistration(t.prisma, conference.id, attendee.id);
    const res = await t.http().get('/api/conferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1, title: 'Test Conference', description: null, location: null, venue: null, startDate: '2026-10-05T00:00:00', endDate: '2026-10-06T00:00:00',
        status: 'ACTIVE', maxAttendees: 10, organizerName: null, website: null,
        sessions: [{ id: 1, title: 'Talk', description: null, startTime: '2026-10-05T10:00:00', endTime: '2026-10-05T11:00:00', capacity: 50, conferenceId: 1, speakerId: null, roomId: null }],
        registrations: [{ id: 1, registeredAt: '2026-10-01T09:00:00.000Z', status: 'CONFIRMED', conferenceId: 1, attendeeId: 1 }],
      },
    ]);
  });
});

describe('GET /api/conferences/:id', () => {
  it('returns one conference; status derived, CANCELLED kept', async () => {
    await makeConference(t.prisma, { startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00' });
    await makeConference(t.prisma, { status: 'CANCELLED' });
    expect((await t.http().get('/api/conferences/1')).body.status).toBe('COMPLETED');
    expect((await t.http().get('/api/conferences/2')).body.status).toBe('CANCELLED');
  });
  it.each([['999', 404], ['abc', 400], ['0', 400], ['-1', 400], ['2147483648', 400]])('GET /api/conferences/%s -> %d (A03-A05, CORR-7)', async (id, status) => {
    const res = await t.http().get(`/api/conferences/${id}`);
    expect(res.status).toBe(status);
    expect(res.body.requestId).toBeDefined();
  });
});

describe('POST /api/conferences', () => {
  it('creates: 201 + Location + same body as GET (B01, MNT-2)', async () => {
    const res = await send('post', '/api/conferences', FULL);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/conferences/1');
    expect(res.body).toEqual((await t.http().get('/api/conferences/1')).body);
    expect(res.body).toMatchObject({ ...FULL, id: 1, sessions: [], registrations: [] });
  });

  it.each([
    ['{} (B05)', {}, ['title', 'startDate', 'endDate']],
    ['lower-case status (B06)', { ...FULL, status: 'active' }, ['status']],
    ['wrong types (B07)', { ...FULL, title: 123, maxAttendees: 'many' }, ['title', 'maxAttendees']],
    ['dates with offsets (B08)', { ...FULL, startDate: '2026-11-12T10:00:00Z', endDate: '2026-11-13T10:00:00+02:00' }, ['startDate', 'endDate']],
    ['end before start, negative seats (B09)', { ...FULL, startDate: '2026-05-02T00:00:00', endDate: '2026-05-01T00:00:00', maxAttendees: -3 }, ['endDate', 'maxAttendees']],
    ['non-existent date', { ...FULL, startDate: '2027-02-29T00:00:00' }, ['startDate']],
    ['int32 overflow (Review Focus 3)', { ...FULL, maxAttendees: 3_000_000_000 }, ['maxAttendees']],
    ['PascalCase key (Review Focus 2)', { ...FULL, Title: 'x' }, ['Title']],
    ['mass assignment (B16, SEC-3)', { ...FULL, id: 50, registrations: [{ status: 'VIP' }], sessions: [{ title: 'Injected' }] }, ['id', 'registrations', 'sessions']],
    ['website without scheme', { ...FULL, website: 'frontendfrontiers.example.com' }, ['website']],
  ])('rejects %s with 400 listing the fields', async (_name, body, fields) => {
    const res = await send('post', '/api/conferences', body);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(fields));
    expect(await t.prisma.conference.count()).toBe(0);
  });

  it('accepts a status only when it matches the dates (spec 5.4)', async () => {
    const wrong = await send('post', '/api/conferences', { ...FULL, status: 'ACTIVE' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors).toEqual([{ field: 'status', messages: ['status is derived from dates; only CANCELLED can be set'] }]);
    expect((await send('post', '/api/conferences', { ...FULL, status: 'CANCELLED' })).body.status).toBe('CANCELLED');
    const { status: _s, ...noStatus } = FULL;
    expect((await send('post', '/api/conferences', noStatus)).body.status).toBe('UPCOMING');
  });
});

describe('PUT /api/conferences/:id', () => {
  it('replaces the conference (B10 with a valid status)', async () => {
    await makeConference(t.prisma);
    const res = await send('put', '/api/conferences/1', { ...FULL, description: 'Updated', endDate: '2026-11-14T00:00:00' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, description: 'Updated', endDate: '2026-11-14T00:00:00', status: 'UPCOMING' });
  });

  it('requires every key, null allowed (B11, B14, CORR-5)', async () => {
    await makeConference(t.prisma, { title: 'Before' });
    const partial = await send('put', '/api/conferences/1', { title: 'Only title' });
    expect(partial.status).toBe(400);
    expect(fieldsOf(partial)).toEqual(expect.arrayContaining(['description', 'location', 'venue', 'startDate', 'endDate', 'status', 'maxAttendees', 'organizerName', 'website']));
    const { status: _s, ...noStatusKey } = FULL;
    expect(fieldsOf(await send('put', '/api/conferences/1', noStatusKey))).toEqual(['status']);
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: 1 } })).title).toBe('Before'); // CORR-6: nothing half-applied
    const nulls = await send('put', '/api/conferences/1', { ...FULL, description: null, location: null, venue: null, status: null, maxAttendees: null, organizerName: null, website: null });
    expect(nulls.status).toBe(200);
  });

  it('cancels and un-cancels', async () => {
    await makeConference(t.prisma);
    expect((await send('put', '/api/conferences/1', { ...FULL, status: 'CANCELLED' })).body.status).toBe('CANCELLED');
    expect((await send('put', '/api/conferences/1', { ...FULL, status: null })).body.status).toBe('UPCOMING');
  });

  it('answers 404 for a missing conference and 400 for a bad id (B12, B13)', async () => {
    expect((await send('put', '/api/conferences/999', FULL)).status).toBe(404);
    expect((await send('put', '/api/conferences/abc', FULL)).status).toBe(400);
  });

  it('refuses dates that would leave sessions outside, listing them (spec 6.3)', async () => {
    const conference = await makeConference(t.prisma, { startDate: '2026-11-12T00:00:00', endDate: '2026-11-13T00:00:00' });
    await makeSession(t.prisma, conference.id, { startTime: '2026-11-13T10:00:00', endTime: '2026-11-13T11:00:00' });
    const res = await send('put', '/api/conferences/1', { ...FULL, startDate: '2026-11-12T00:00:00', endDate: '2026-11-12T00:00:00' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Sessions 1 would fall outside the new conference dates');
    expect((await t.prisma.conference.findUniqueOrThrow({ where: { id: 1 } })).endDate.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });
});
