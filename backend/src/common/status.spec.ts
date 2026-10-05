import { requireWallClock } from './dates';
import { computeStatus, isRegistrationOpen, resolveStatusInput } from './status';

const start = requireWallClock('2026-10-05T00:00:00');
const end = requireWallClock('2026-10-06T00:00:00'); // last day = 6 October
const at = (iso: string) => new Date(iso);

describe('computeStatus (spec 6.1)', () => {
  it.each([
    ['2026-10-04T23:59:59Z', 'UPCOMING'],
    ['2026-10-05T00:00:00Z', 'ACTIVE'],
    ['2026-10-06T23:59:59Z', 'ACTIVE'],
    ['2026-10-07T00:00:00Z', 'COMPLETED'],
  ])('at %s is %s', (now, expected) => {
    expect(computeStatus(start, end, false, at(now))).toBe(expected);
  });

  it('counts the start day from midnight even if startDate has a time', () => {
    expect(computeStatus(requireWallClock('2026-10-05T10:00:00'), end, false, at('2026-10-05T01:00:00Z'))).toBe('ACTIVE');
  });

  it('lets CANCELLED override dates', () => {
    expect(computeStatus(start, end, true, at('2026-10-05T12:00:00Z'))).toBe('CANCELLED');
  });

  it('opens registration only for UPCOMING and ACTIVE', () => {
    expect(['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => isRegistrationOpen(s as never))).toEqual([true, true, false, false]);
  });
});

describe('resolveStatusInput (spec 5.4)', () => {
  const now = at('2026-09-01T00:00:00Z'); // conference is UPCOMING
  it('treats null and missing as "not cancelled"', () => {
    expect(resolveStatusInput(null, start, end, now)).toEqual({ ok: true, cancelled: false });
    expect(resolveStatusInput(undefined, start, end, now)).toEqual({ ok: true, cancelled: false });
  });
  it('accepts CANCELLED', () => {
    expect(resolveStatusInput('CANCELLED', start, end, now)).toEqual({ ok: true, cancelled: true });
  });
  it('accepts a computed status only when it matches the dates', () => {
    expect(resolveStatusInput('UPCOMING', start, end, now)).toEqual({ ok: true, cancelled: false });
    expect(resolveStatusInput('ACTIVE', start, end, now)).toEqual({ ok: false, message: 'status is derived from dates; only CANCELLED can be set' });
  });
});
