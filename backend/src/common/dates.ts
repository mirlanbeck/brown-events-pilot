export const DAY_MS = 86_400_000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

// Schedule values are venue wall-clock times without a zone (spec 5.5). They are kept in Date objects whose UTC
// fields hold the wall-clock digits, so parsing and formatting never depend on the server time zone.
export function parseWallClock(value: string): Date | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const sameDigits =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return sameDigits ? date : null;
}

export function requireWallClock(value: string): Date {
  const date = parseWallClock(value);
  if (!date) throw new Error(`Not a wall-clock date-time: ${value}`);
  return date;
}

export function formatWallClock(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export function formatInstant(date: Date): string {
  return date.toISOString();
}

export function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function isWithinDays(start: Date, end: Date, firstDay: Date, lastDay: Date): boolean {
  return dayIndex(start) >= dayIndex(firstDay) && dayIndex(end) <= dayIndex(lastDay);
}
