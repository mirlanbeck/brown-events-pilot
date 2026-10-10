import { errorBody } from './write-error';

describe('errorBody (spec EXT-150 5.6, BEVN-202 spec 4.6)', () => {
  it('adds reason when it is set, after requestId', () => {
    const body = errorBody({ status: 409, message: 'No seats left in this session; join the waitlist instead', reason: 'SESSION_FULL' }, 'rid');
    expect(body).toEqual({ statusCode: 409, error: 'Conflict', message: 'No seats left in this session; join the waitlist instead', requestId: 'rid', reason: 'SESSION_FULL' });
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId', 'reason']);
  });
  it('has no reason key without a reason (existing 409s are unchanged)', () => {
    const body = errorBody({ status: 409, message: 'Attendee is already registered for this conference' }, 'rid');
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId']);
  });
  it('keeps errors last', () => {
    const body = errorBody({ status: 400, message: 'Validation failed', errors: [{ field: 'email', messages: ['x'] }] }, 'rid');
    expect(Object.keys(body)).toEqual(['statusCode', 'error', 'message', 'requestId', 'errors']);
  });
});
