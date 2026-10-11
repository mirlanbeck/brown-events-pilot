import { decideCancelRegistration, decideRegister } from './registration-rules';

describe('decideCancelRegistration (spec 4.3)', () => {
  it.each(['UPCOMING', 'ACTIVE'] as const)('cancels a CONFIRMED registration while the conference is %s', (conferenceStatus) => {
    expect(decideCancelRegistration({ status: 'CONFIRMED', conferenceStatus })).toEqual({ ok: true });
  });
  it.each(['COMPLETED', 'CANCELLED'] as const)('answers REGISTRATION_CLOSED for a %s conference, before ALREADY_CANCELLED', (conferenceStatus) => {
    for (const status of ['CONFIRMED', 'CANCELLED'] as const) {
      expect(decideCancelRegistration({ status, conferenceStatus })).toEqual({
        ok: false,
        reason: 'REGISTRATION_CLOSED',
        message: `Registration is closed: the conference is ${conferenceStatus}`,
      });
    }
  });
  it('answers ALREADY_CANCELLED for a cancelled registration of an open conference', () => {
    expect(decideCancelRegistration({ status: 'CANCELLED', conferenceStatus: 'UPCOMING' })).toEqual({
      ok: false,
      reason: 'ALREADY_CANCELLED',
      message: 'The registration is already cancelled',
    });
  });
});

describe('decideRegister (spec 4.5)', () => {
  it('creates without a row and reactivates a cancelled row', () => {
    expect(decideRegister({ existing: null, taken: 0, maxAttendees: null })).toEqual({ ok: true, action: 'create' });
    expect(decideRegister({ existing: 'CANCELLED', taken: 0, maxAttendees: null })).toEqual({ ok: true, action: 'reactivate' });
  });
  it('refuses a CONFIRMED row with the old message, even when the conference is full', () => {
    expect(decideRegister({ existing: 'CONFIRMED', taken: 5, maxAttendees: 5 })).toEqual({ ok: false, message: 'Attendee is already registered for this conference' });
  });
  it('checks the seats for a new and for a cancelled row alike', () => {
    for (const existing of [null, 'CANCELLED'] as const) {
      expect(decideRegister({ existing, taken: 2, maxAttendees: 2 })).toEqual({ ok: false, message: 'No seats left' });
      expect(decideRegister({ existing, taken: 1, maxAttendees: 2 }).ok).toBe(true);
    }
  });
  it('has no seat limit without maxAttendees', () => {
    expect(decideRegister({ existing: null, taken: 1000, maxAttendees: null }).ok).toBe(true);
  });
});
