import { Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface LockedConference {
  id: number;
  startDate: Date;
  endDate: Date;
  status: string | null;
  maxAttendees: number | null;
}

// Every write that depends on a conference's dates or seats locks its row first (spec 6.2, 6.3), so concurrent
// registrations, session writes and conference updates of the same conference run one after another.
// lock_timeout ends the wait before the transaction timeout; the wait surfaces as 55P03 -> 503 (spec 8).
export async function lockConference(tx: Tx, id: number): Promise<LockedConference | null> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
  const rows = await tx.$queryRaw<LockedConference[]>`
    SELECT "Id" AS "id", "StartDate" AS "startDate", "EndDate" AS "endDate", "Status" AS "status", "MaxAttendees" AS "maxAttendees"
    FROM "conferences" WHERE "Id" = ${id} FOR UPDATE`;
  return rows[0] ?? null;
}
