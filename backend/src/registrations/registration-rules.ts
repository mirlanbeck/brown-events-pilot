import type { ConflictReason } from '../common/errors';
import { isRegistrationOpen, type ConferenceStatus } from '../common/status';
import { closedMessage } from '../session-registrations/waitlist';

// BEVN-203 (spec 2, 5.4): statuses of a conference registration and the decisions of cancel and register as pure
// functions. The service reads the state under the conference lock, these decide.
export const REGISTRATION_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_MESSAGES = {
  alreadyCancelled: 'The registration is already cancelled',
  alreadyRegistered: 'Attendee is already registered for this conference',
  noSeats: 'No seats left',
  // One message for an unknown id and for a registration of another email; the email is not repeated (spec 4.3).
  notFound: (id: number) => `Registration ${id} not found for this email`,
} as const;

export type CancelDecision = { ok: true } | { ok: false; reason: ConflictReason; message: string };

// The first failed check answers (spec 4.3): a closed conference before an already cancelled registration.
export function decideCancelRegistration(s: { status: RegistrationStatus; conferenceStatus: ConferenceStatus }): CancelDecision {
  if (!isRegistrationOpen(s.conferenceStatus)) {
    return { ok: false, reason: 'REGISTRATION_CLOSED', message: closedMessage(`the conference is ${s.conferenceStatus}`) };
  }
  if (s.status === 'CANCELLED') return { ok: false, reason: 'ALREADY_CANCELLED', message: REGISTRATION_MESSAGES.alreadyCancelled };
  return { ok: true };
}

export type RegisterDecision = { ok: true; action: 'create' | 'reactivate' } | { ok: false; message: string };

// Spec 4.5: a cancelled row comes back to CONFIRMED after the same seat check as a new one. Whether registration is open
// is checked before, as for a new registration. taken counts CONFIRMED rows only.
export function decideRegister(s: { existing: RegistrationStatus | null; taken: number; maxAttendees: number | null }): RegisterDecision {
  if (s.existing === 'CONFIRMED') return { ok: false, message: REGISTRATION_MESSAGES.alreadyRegistered };
  if (s.maxAttendees !== null && s.taken >= s.maxAttendees) return { ok: false, message: REGISTRATION_MESSAGES.noSeats };
  return { ok: true, action: s.existing === 'CANCELLED' ? 'reactivate' : 'create' };
}
