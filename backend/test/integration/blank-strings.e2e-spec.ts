import { makeConference, makeSession } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

// Required strings are trimmed before validation: a whitespace-only value is empty (CORR-4, BEVN-107
// "creating a conference with no title"), and surrounding spaces are not stored.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: '2026-10-05T12:00:00.000Z' });
});
beforeEach(async () => {
  await resetDb(t.prisma);
  await makeConference(t.prisma);
  await makeSession(t.prisma, 1);
});
afterAll(() => t.close());

const send = (method: 'post' | 'put', path: string, body: object) => t.http()[method](path).set('Content-Type', 'application/json').send(body);
const fieldsOf = (res: { body: { errors?: { field: string }[] } }) => (res.body.errors ?? []).map((e) => e.field);

const CONFERENCE = { title: 'Frontend Frontiers', description: null, location: null, venue: null, startDate: '2027-01-10T00:00:00', endDate: '2027-01-11T00:00:00', status: null, maxAttendees: null, organizerName: null, website: null };
const SESSION = { title: 'Talk', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 10, speakerId: null, roomId: null };
const ATTENDEE = { firstName: 'John', lastName: 'Connor', email: 'john.connor@example.com' };
const SPEAKER = { firstName: 'Dmitri', lastName: 'Ivanov' };

describe('whitespace-only required strings are rejected with 400', () => {
  it.each([
    ['POST /api/conferences', 'post', '/api/conferences', { ...CONFERENCE, title: '   ' }, 'title'],
    ['PUT /api/conferences/1', 'put', '/api/conferences/1', { ...CONFERENCE, title: '\t \n' }, 'title'],
    ['POST /api/conferences/1/sessions', 'post', '/api/conferences/1/sessions', { ...SESSION, title: '   ' }, 'title'],
    ['PUT /api/sessions/1', 'put', '/api/sessions/1', { ...SESSION, title: '   ' }, 'title'],
    ['register firstName', 'post', '/api/conferences/1/register', { ...ATTENDEE, firstName: '   ' }, 'firstName'],
    ['register lastName', 'post', '/api/conferences/1/register', { ...ATTENDEE, lastName: '   ' }, 'lastName'],
    ['speaker firstName', 'post', '/api/speakers', { ...SPEAKER, firstName: '   ' }, 'firstName'],
    ['speaker lastName', 'post', '/api/speakers', { ...SPEAKER, lastName: '   ' }, 'lastName'],
  ] as const)('%s', async (_name, method, path, body, field) => {
    const res = await send(method, path, body);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toContain(field);
  });
});

describe('surrounding spaces are not stored', () => {
  it('trims attendee names ("John " -> "John")', async () => {
    const res = await send('post', '/api/conferences/1/register', { ...ATTENDEE, firstName: 'John ', lastName: '  Connor' });
    expect(res.status).toBe(201);
    expect(res.body.attendee).toMatchObject({ firstName: 'John', lastName: 'Connor' });
    expect(await t.prisma.attendee.findFirstOrThrow({ select: { firstName: true, lastName: true } })).toEqual({ firstName: 'John', lastName: 'Connor' });
  });
  it('trims conference and session titles and speaker names', async () => {
    expect((await send('post', '/api/conferences', { ...CONFERENCE, title: '  Frontend Frontiers ' })).body.title).toBe('Frontend Frontiers');
    expect((await send('put', '/api/sessions/1', { ...SESSION, title: ' Talk ' })).body.title).toBe('Talk');
    expect((await send('post', '/api/speakers', { firstName: ' Dmitri', lastName: 'Ivanov ' })).body).toMatchObject({ firstName: 'Dmitri', lastName: 'Ivanov' });
  });
});
