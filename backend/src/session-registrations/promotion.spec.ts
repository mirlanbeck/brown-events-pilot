import type { Tx } from '../common/locking';
import { promoteFromWaitlist } from './promotion';

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
