import { formatInstant, formatWallClock, isWithinDays, parseWallClock, requireWallClock } from './dates';

describe('wall-clock dates', () => {
  it.each(['2025-03-05T10:00:00', '2024-02-29T23:59:59', '2025-03-05T00:00:00'])('accepts %s and formats it back unchanged', (s) => {
    expect(formatWallClock(requireWallClock(s))).toBe(s);
  });

  it.each([
    '2025-03-05T10:00:00Z',
    '2025-03-05T10:00:00+02:00',
    '2025-03-05T10:00:00.000',
    '2025-03-05 10:00:00',
    '2025-03-05',
    '2025-02-30T10:00:00',
    '2025-02-29T10:00:00',
    '2025-13-01T00:00:00',
    '2025-03-05T24:00:00',
    '0099-01-01T00:00:00',
    '',
  ])('rejects %p', (s) => {
    expect(parseWallClock(s)).toBeNull();
  });

  it('does not depend on the machine time zone', () => {
    // The digits survive a round trip whatever TZ the process runs in (CI repeats this under three zones).
    const d = requireWallClock('2025-03-05T00:30:00');
    expect(d.toISOString()).toBe('2025-03-05T00:30:00.000Z');
    // A browser in Los Angeles reading the old "Z" form would see the previous day — the reason spec 5.5 keeps no offset.
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', dateStyle: 'short' }).format(new Date('2025-03-05T00:00:00Z'))).toBe('2025-03-04');
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bishkek', timeStyle: 'short' }).format(new Date('2025-03-05T10:00:00Z'))).toBe('16:00');
  });

  it('formats instants with Z and milliseconds', () => {
    expect(formatInstant(new Date(Date.UTC(2026, 9, 5, 4, 44, 13, 136)))).toBe('2026-10-05T04:44:13.136Z');
  });

  it('checks that a session stays within conference days, both ends inclusive', () => {
    const from = requireWallClock('2025-03-05T00:00:00');
    const to = requireWallClock('2025-03-06T00:00:00');
    expect(isWithinDays(requireWallClock('2025-03-05T09:00:00'), requireWallClock('2025-03-06T23:00:00'), from, to)).toBe(true);
    expect(isWithinDays(requireWallClock('2025-03-04T23:00:00'), requireWallClock('2025-03-05T10:00:00'), from, to)).toBe(false);
    expect(isWithinDays(requireWallClock('2025-03-06T23:00:00'), requireWallClock('2025-03-07T00:30:00'), from, to)).toBe(false);
  });
});
