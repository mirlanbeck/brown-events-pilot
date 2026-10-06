import { makeConference, makeSession, makeSpeaker } from './fixtures';
import { createTestApp, resetDb, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

const json = (path: string) => t.http().post(path).set('Content-Type', 'application/json');

describe('GET /api/speakers', () => {
  it('returns speakers with their sessions, own fields only (A13, spec 5.2)', async () => {
    const conference = await makeConference(t.prisma);
    const speaker = await makeSpeaker(t.prisma, { emailPublic: true });
    await makeSession(t.prisma, conference.id, { speakerId: speaker.id });
    const res = await t.http().get('/api/speakers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1, firstName: 'Alice', lastName: 'Novak', bio: 'Bio', email: 'alice.novak@example.com', emailPublic: true,
        sessions: [
          { id: 1, title: 'Talk', description: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', capacity: 50, conferenceId: 1, speakerId: 1, roomId: null },
        ],
      },
    ]);
  });

  it('hides the email of a speaker who has not made it public (SEC-1)', async () => {
    await makeSpeaker(t.prisma, { emailPublic: false });
    const res = await t.http().get('/api/speakers');
    expect(res.body[0].email).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('@');
  });
});

describe('POST /api/speakers', () => {
  it('creates a speaker: 201, emailPublic defaults to false (D01)', async () => {
    const res = await json('/api/speakers').send({ firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: 'dmitri.ivanov@example.com' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({ id: 1, firstName: 'Dmitri', lastName: 'Ivanov', bio: 'Frontend architect.', email: null, emailPublic: false, sessions: [] });
    expect((await t.prisma.speaker.findUniqueOrThrow({ where: { id: 1 } })).email).toBe('dmitri.ivanov@example.com');
  });

  it('returns the email when emailPublic is true', async () => {
    const res = await json('/api/speakers').send({ firstName: 'A', lastName: 'B', email: 'a.b@example.com', emailPublic: true });
    expect(res.body.email).toBe('a.b@example.com');
  });

  it('lists every failed field (D02, BEVN-107)', async () => {
    const res = await json('/api/speakers').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(['firstName', 'lastName']);
  });

  it.each([
    [{ firstName: 'X', lastName: 'Y', email: 'not-an-email' }, 'email'],
    [{ firstName: 'X', lastName: 'Y', email: 'иван@пример.рф' }, 'email'],
    [{ firstName: 'X', lastName: 'Y', id: 50 }, 'id'],
    [{ firstName: 'X'.repeat(101), lastName: 'Y' }, 'firstName'],
    [{ firstName: 'X', lastName: 'Y', emailPublic: 'yes' }, 'emailPublic'],
  ])('rejects %j on field %s', async (body, field) => {
    const res = await json('/api/speakers').send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
  });

  it('rejects a JSON array body (Review Focus 1)', async () => {
    const res = await json('/api/speakers').send([{ firstName: 'A', lastName: 'B' }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request body must be a JSON object');
  });
});
