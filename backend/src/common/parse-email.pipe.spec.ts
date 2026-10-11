import { ApiError } from './errors';
import { ParseEmailPipe } from './parse-email.pipe';

describe('ParseEmailPipe (BEVN-203 spec 4.4)', () => {
  const pipe = new ParseEmailPipe();
  it.each([
    ['ann@example.com', 'ann@example.com'],
    ['  Ann.Kowalska@Example.COM ', 'ann.kowalska@example.com'],
    ['ann+tag@example.com', 'ann+tag@example.com'],
  ])('accepts %p as %p', (raw, email) => {
    expect(pipe.transform(raw)).toBe(email);
  });
  it.each(['', 'ann', 'ann@example', 'ann maria@example.com', 'анна@example.com', `${'a'.repeat(243)}@example.com`])('rejects %p with 400 on the email field', (raw) => {
    try {
      pipe.transform(raw);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(400);
      expect(e.message).toBe('Invalid email');
      expect(e.errors?.map((f) => f.field)).toEqual(['email']);
      if (raw.trim()) expect(JSON.stringify(e)).not.toContain(raw.trim());
    }
  });
  it('uses the messages of the registration body', () => {
    let error: ApiError | undefined;
    try {
      pipe.transform('ann');
    } catch (e) {
      error = e as ApiError;
    }
    expect(error?.errors).toEqual([{ field: 'email', messages: ['email must be an email address'] }]);
  });
});
