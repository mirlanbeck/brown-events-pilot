import type { Tx } from '../common/locking';
import { promoteConference, promoteFromWaitlist } from './promotion';

interface Entry {
  id: number;
  attendeeId: number;
  createdAt: Date;
}

// Only the three calls promoteFromWaitlist makes; the rest of the transaction client is not needed.
function fakeTx(waitlist: Entry[], registeredCount: number) {
  const findMany = jest.fn().mockResolvedValue(waitlist);
  const count = jest.fn().mockResolvedValue(registeredCount);
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = { sessionRegistration: { findMany, count, updateMany } } as unknown as Tx;
  return { tx, count, updateMany };
}

const at = (second: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, second));
const WAITLIST: Entry[] = [
  { id: 12, attendeeId: 3, createdAt: at(2) },
  { id: 13, attendeeId: 4, createdAt: at(5) },
  { id: 11, attendeeId: 2, createdAt: at(2) },
];

describe('promoteFromWaitlist (spec 5.2; DoD: cancel triggers promotion, waitlist ordering)', () => {
  it('gives the seat freed by a cancel to the first by (createdAt, id)', async () => {
    const { tx, updateMany } = fakeTx(WAITLIST, 1);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([{ registrationId: 11, attendeeId: 2, sessionId: 7 }]);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: [11] } }, data: { status: 'CONFIRMED' } });
  });

  it('fills every free seat in waitlist order', async () => {
    const { tx } = fakeTx(WAITLIST, 1);
    expect((await promoteFromWaitlist(tx, { id: 7, capacity: 10 })).map((p) => p.registrationId)).toEqual([11, 12, 13]);
  });

  it('changes nothing while the session is full', async () => {
    const { tx, updateMany } = fakeTx(WAITLIST, 2);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not count seats for an empty waitlist', async () => {
    const { tx, count, updateMany } = fakeTx([], 0);
    expect(await promoteFromWaitlist(tx, { id: 7, capacity: 2 })).toEqual([]);
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('promoteConference (spec 4.8, 5.2; plan decision 12)', () => {
  const OPEN = { id: 1, startDate: new Date(Date.UTC(2027, 0, 10)), endDate: new Date(Date.UTC(2027, 0, 11)), status: null };
  const NOW = new Date(Date.UTC(2026, 9, 5, 12));
  const session = (id: number, capacity: number) => ({ id, capacity, startTime: new Date(Date.UTC(2027, 0, 10, 10)) });

  // Only the three calls promoteConference makes.
  function fakeConferenceTx(waiting: (Entry & { session: ReturnType<typeof session> })[], confirmed: [number, number][]) {
    const findMany = jest.fn().mockResolvedValue(waiting);
    const groupBy = jest.fn().mockResolvedValue(confirmed.map(([sessionId, n]) => ({ sessionId, _count: { _all: n } })));
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = { sessionRegistration: { findMany, groupBy, updateMany } } as unknown as Tx;
    return { tx, groupBy, updateMany };
  }

  it('fills the free seats of each open session in waitlist order, sessions by id', async () => {
    const { tx, updateMany } = fakeConferenceTx(
      [
        { id: 21, attendeeId: 5, createdAt: at(1), session: session(2, 2) },
        { id: 12, attendeeId: 3, createdAt: at(2), session: session(1, 3) },
        { id: 11, attendeeId: 2, createdAt: at(2), session: session(1, 3) },
        { id: 13, attendeeId: 4, createdAt: at(5), session: session(1, 3) },
      ],
      [[1, 1], [2, 1]],
    );
    expect(await promoteConference(tx, OPEN, NOW)).toEqual([
      { registrationId: 11, attendeeId: 2, sessionId: 1 },
      { registrationId: 12, attendeeId: 3, sessionId: 1 },
      { registrationId: 21, attendeeId: 5, sessionId: 2 },
    ]);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: [11, 12, 21] } }, data: { status: 'CONFIRMED' } });
  });

  it('skips sessions with closed registration and makes no further query when none is open', async () => {
    const { tx, groupBy, updateMany } = fakeConferenceTx([{ id: 31, attendeeId: 6, createdAt: at(1), session: session(3, 5) }], []);
    expect(await promoteConference(tx, OPEN, new Date(Date.UTC(2027, 0, 10, 10)))).toEqual([]); // the session has started
    expect(await promoteConference(tx, { ...OPEN, status: 'CANCELLED' }, NOW)).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('changes nothing when every open session is full', async () => {
    const { tx, updateMany } = fakeConferenceTx([{ id: 41, attendeeId: 7, createdAt: at(1), session: session(4, 1) }], [[4, 1]]);
    expect(await promoteConference(tx, OPEN, NOW)).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
