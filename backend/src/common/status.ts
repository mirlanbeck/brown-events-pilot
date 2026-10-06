import { DAY_MS, dayIndex } from './dates';

export const CONFERENCE_STATUSES = ['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type ConferenceStatus = (typeof CONFERENCE_STATUSES)[number];
export const DERIVED_STATUS_MESSAGE = 'status is derived from dates; only CANCELLED can be set';

// ACTIVE from the start of startDate's day to the end of endDate's day (endDate holds midnight of the last day).
// "now" is UTC while the dates carry no zone, so at a day boundary the status can be off by up to ±14 h (spec 6.1).
export function computeStatus(start: Date, end: Date, cancelled: boolean, now: Date): ConferenceStatus {
  if (cancelled) return 'CANCELLED';
  const opens = dayIndex(start) * DAY_MS;
  const closes = (dayIndex(end) + 1) * DAY_MS;
  const t = now.getTime();
  if (t < opens) return 'UPCOMING';
  if (t < closes) return 'ACTIVE';
  return 'COMPLETED';
}

export function isRegistrationOpen(status: ConferenceStatus): boolean {
  return status === 'UPCOMING' || status === 'ACTIVE';
}

export type StatusInputResult = { ok: true; cancelled: boolean } | { ok: false; message: string };

export function resolveStatusInput(input: string | null | undefined, start: Date, end: Date, now: Date): StatusInputResult {
  if (input === null || input === undefined) return { ok: true, cancelled: false };
  if (input === 'CANCELLED') return { ok: true, cancelled: true };
  if (input === computeStatus(start, end, false, now)) return { ok: true, cancelled: false };
  return { ok: false, message: DERIVED_STATUS_MESSAGE };
}
