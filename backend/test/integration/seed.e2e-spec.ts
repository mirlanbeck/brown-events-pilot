import { isWithinDays } from '../../src/common/dates';
import { seedDemoData } from '../../prisma/seed';
import { createTestApp, resetDb, type TestApp } from './helpers';

const NOW = new Date('2026-10-05T15:30:00.000Z');
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ now: NOW.toISOString() });
});
beforeEach(() => resetDb(t.prisma));
afterAll(() => t.close());

describe('seedDemoData (spec 7.5)', () => {
  it('seeds once and then does nothing', async () => {
    expect(await seedDemoData(t.prisma, NOW)).toBe(true);
    expect(await seedDemoData(t.prisma, NOW)).toBe(false);
    expect([await t.prisma.speaker.count(), await t.prisma.room.count(), await t.prisma.conference.count(), await t.prisma.session.count()]).toEqual([3, 4, 3, 7]);
    expect(await t.prisma.registration.count()).toBe(0);
  });

  it('keeps .NET Summit in the past and moves the other two to +30 and +90 days with the same times of day', async () => {
    await seedDemoData(t.prisma, NOW);
    const res = await t.http().get('/api/conferences');
    type Row = { title: string; startDate: string; endDate: string; status: string; sessions: { startTime: string; endTime: string }[] };
    const byTitle: Record<string, Row> = Object.fromEntries((res.body as Row[]).map((c) => [c.title, c]));
    expect(byTitle['.NET Summit 2024']).toMatchObject({ startDate: '2024-10-14T00:00:00', endDate: '2024-10-16T00:00:00', status: 'COMPLETED' });
    expect(byTitle['CloudOps Days']).toMatchObject({ startDate: '2026-11-04T00:00:00', endDate: '2026-11-05T00:00:00', status: 'UPCOMING' });
    expect(byTitle['CloudOps Days'].sessions.map((s) => [s.startTime, s.endTime])).toEqual([
      ['2026-11-04T10:00:00', '2026-11-04T11:00:00'],
      ['2026-11-04T14:00:00', '2026-11-04T15:00:00'],
    ]);
    expect(byTitle['Data & AI Forum']).toMatchObject({ startDate: '2027-01-03T00:00:00', endDate: '2027-01-04T00:00:00', status: 'UPCOMING' });
    expect(byTitle['Data & AI Forum'].sessions.map((s) => [s.startTime, s.endTime])).toEqual([
      ['2027-01-03T10:00:00', '2027-01-03T11:30:00'],
      ['2027-01-03T14:00:00', '2027-01-03T15:00:00'],
    ]);
  });

  it('passes every domain rule and keeps room ids 1-4 and public speaker emails', async () => {
    await seedDemoData(t.prisma, NOW);
    const sessions = await t.prisma.session.findMany({ include: { conference: true, room: true } });
    for (const s of sessions) {
      expect(isWithinDays(s.startTime, s.endTime, s.conference.startDate, s.conference.endDate)).toBe(true);
      expect(s.capacity).toBeLessThanOrEqual(s.room?.capacity ?? Infinity);
    }
    expect((await t.prisma.room.findMany({ orderBy: { id: 'asc' } })).map((r) => [r.id, r.name])).toEqual([[1, 'Hall A'], [2, 'Room 101'], [3, 'Room 202'], [4, 'Workshop']]);
    expect((await t.http().get('/api/speakers')).body.map((s: { email: string }) => s.email)).toEqual(['alice.novak@example.com', 'ben.okafor@example.com', 'chloe.tanaka@example.com']);
  });

  it('makes demo registration work: open on CloudOps Days, closed on .NET Summit', async () => {
    await seedDemoData(t.prisma, NOW);
    const body = { firstName: 'Maria', lastName: 'Kowalska', email: 'maria.kowalska@example.com' };
    expect((await t.http().post('/api/conferences/2/register').set('Content-Type', 'application/json').send(body)).status).toBe(201);
    expect((await t.http().post('/api/conferences/1/register').set('Content-Type', 'application/json').send(body)).status).toBe(409);
  });
});
