import { closedReason, decideCancel, decideJoin, MESSAGES, nextInLine, overlaps, seatsToFill, type JoinState } from './waitlist';

const at = (wall: string) => new Date(`${wall}Z`); // wall-clock digits in UTC fields, as in src/common/dates.ts

describe('overlaps: half-open [start, end) (spec 2)', () => {
  const s = (from: string, to: string) => ({ startTime: at(`2027-01-10T${from}:00`), endTime: at(`2027-01-10T${to}:00`) });
  it.each([
    ['same interval', s('10:00', '11:00'), s('10:00', '11:00'), true],
    ['partial overlap', s('10:00', '11:00'), s('10:30', '11:30'), true],
    ['one inside the other', s('10:00', '12:00'), s('10:30', '11:00'), true],
    ['back to back', s('10:00', '11:00'), s('11:00', '12:00'), false],
    ['back to back, reversed', s('11:00', '12:00'), s('10:00', '11:00'), false],
    ['apart', s('09:00', '10:00'), s('11:00', '12:00'), false],
  ])('%s -> %s', (_name, a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    expect(overlaps(b, a)).toBe(expected);
  });
});

describe('closedReason (spec 4.4)', () => {
  const conference = { startDate: at('2027-01-10T00:00:00'), endDate: at('2027-01-11T00:00:00'), status: null };
  const session = { startTime: at('2027-01-10T10:00:00') };
  it('is open before the session starts while the conference is UPCOMING or ACTIVE', () => {
    expect(closedReason(conference, session, new Date('2026-10-05T12:00:00.000Z'))).toBeNull();
    expect(closedReason(conference, session, new Date('2027-01-10T09:59:59.999Z'))).toBeNull();
  });
  it('closes at the session start, the start time read as UTC', () => {
    expect(closedReason(conference, session, new Date('2027-01-10T10:00:00.000Z'))).toBe('the session has started');
  });
  it('names the conference status when the conference is closed', () => {
    expect(closedReason({ ...conference, status: 'CANCELLED' }, session, new Date('2026-10-05T12:00:00.000Z'))).toBe('the conference is CANCELLED');
    expect(closedReason(conference, session, new Date('2027-01-12T00:00:00.000Z'))).toBe('the conference is COMPLETED');
  });
});

describe('decideJoin: check order of spec 4.2', () => {
  const OK: JoinState = { closed: null, attendeeId: 7, conferenceRegistered: true, current: null, overlapping: false, registeredCount: 1, capacity: 2 };
  const reasonOf = (kind: 'register' | 'waitlist', state: Partial<JoinState>) => {
    const d = decideJoin(kind, { ...OK, ...state });
    return d.ok ? d.status : d.reason;
  };

  it('register with a free seat -> CONFIRMED for the attendee', () => {
    expect(decideJoin('register', OK)).toEqual({ ok: true, status: 'CONFIRMED', attendeeId: 7 });
  });
  it('join waitlist on a full session -> WAITLISTED (DoD: join waitlist)', () => {
    expect(decideJoin('waitlist', { ...OK, registeredCount: 2 })).toEqual({ ok: true, status: 'WAITLISTED', attendeeId: 7 });
  });
  it('register on a full session -> SESSION_FULL, never an automatic waitlist place (DoD)', () => {
    const d = decideJoin('register', { ...OK, registeredCount: 2 });
    expect(d).toEqual({ ok: false, reason: 'SESSION_FULL', message: MESSAGES.full });
  });
  it('register when registeredCount is above capacity (capacity was lowered earlier) -> SESSION_FULL', () => {
    expect(reasonOf('register', { registeredCount: 3 })).toBe('SESSION_FULL');
  });
  it('join waitlist with a free seat -> SEATS_AVAILABLE', () => {
    expect(reasonOf('waitlist', { registeredCount: 1 })).toBe('SEATS_AVAILABLE');
  });
  it('unknown email and missing conference registration give the same answer', () => {
    expect(decideJoin('register', { ...OK, attendeeId: null, conferenceRegistered: false })).toEqual({ ok: false, reason: 'CONFERENCE_REGISTRATION_REQUIRED', message: MESSAGES.conferenceRegistrationRequired });
    expect(decideJoin('register', { ...OK, conferenceRegistered: false })).toEqual({ ok: false, reason: 'CONFERENCE_REGISTRATION_REQUIRED', message: MESSAGES.conferenceRegistrationRequired });
  });
  it('ALREADY_REGISTERED tells a seat from a waitlist place', () => {
    expect(decideJoin('register', { ...OK, current: 'CONFIRMED' })).toMatchObject({ reason: 'ALREADY_REGISTERED', message: MESSAGES.alreadyRegistered });
    expect(decideJoin('waitlist', { ...OK, current: 'WAITLISTED', registeredCount: 2 })).toMatchObject({ reason: 'ALREADY_REGISTERED', message: MESSAGES.alreadyWaitlisted });
  });
  it('closed answers REGISTRATION_CLOSED with the cause', () => {
    expect(decideJoin('register', { ...OK, closed: 'the session has started' })).toEqual({ ok: false, reason: 'REGISTRATION_CLOSED', message: 'Registration is closed: the session has started' });
  });
  it.each([
    ['closed before everything', { closed: 'the conference is CANCELLED', attendeeId: null, conferenceRegistered: false, current: 'CONFIRMED', overlapping: true, registeredCount: 9 }, 'REGISTRATION_CLOSED'],
    ['conference registration before duplicate', { conferenceRegistered: false, current: 'CONFIRMED', overlapping: true, registeredCount: 9 }, 'CONFERENCE_REGISTRATION_REQUIRED'],
    ['duplicate before overlap', { current: 'WAITLISTED', overlapping: true, registeredCount: 9 }, 'ALREADY_REGISTERED'],
    ['overlap before seats', { overlapping: true, registeredCount: 9 }, 'SESSION_OVERLAP'],
  ] as const)('%s', (_name, state, reason) => {
    expect(reasonOf('register', state as Partial<JoinState>)).toBe(reason);
  });
});

describe('seatsToFill (spec 5.2)', () => {
  it.each([
    [2, 1, 5, 1],
    [5, 1, 2, 2],
    [2, 2, 3, 0],
    [2, 3, 3, 0], // capacity below the count never gives negative seats
    [2, 0, 0, 0],
  ])('capacity %d, registered %d, waitlist %d -> %d', (capacity, registered, waitlist, expected) => {
    expect(seatsToFill(capacity, registered, waitlist)).toBe(expected);
  });
});

describe('nextInLine: waitlist order (createdAt, id) (DoD: waitlist ordering)', () => {
  const e = (id: number, createdAt: string) => ({ id, createdAt: new Date(createdAt) });
  it('takes the earliest entries first', () => {
    const list = [e(3, '2026-10-05T12:00:02.000Z'), e(1, '2026-10-05T12:00:01.000Z'), e(2, '2026-10-05T12:00:03.000Z')];
    expect(nextInLine(list, 2).map((x) => x.id)).toEqual([1, 3]);
  });
  it('orders equal times by the smaller id', () => {
    const list = [e(5, '2026-10-05T12:00:00.000Z'), e(4, '2026-10-05T12:00:00.000Z')];
    expect(nextInLine(list, 1).map((x) => x.id)).toEqual([4]);
  });
  it('a later time wins over a smaller id', () => {
    expect(nextInLine([e(9, '2026-10-05T12:00:00.000Z'), e(1, '2026-10-05T12:00:05.000Z')], 1).map((x) => x.id)).toEqual([9]);
  });
  it('returns nothing for zero seats and does not reorder the input', () => {
    const list = [e(2, '2026-10-05T12:00:00.000Z'), e(1, '2026-10-05T12:00:00.000Z')];
    expect(nextInLine(list, 0)).toEqual([]);
    expect(list.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe('decideCancel (spec 4.3; DoD: cancel triggers promotion)', () => {
  it('a cancelled seat promotes the waitlist', () => {
    expect(decideCancel('CONFIRMED')).toEqual({ promote: true });
  });
  it('a cancelled waitlist place does not', () => {
    expect(decideCancel('WAITLISTED')).toEqual({ promote: false });
  });
});
