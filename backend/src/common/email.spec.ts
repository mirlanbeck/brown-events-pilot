import { ASCII_PRINTABLE, normalizeEmail } from './email';

describe('email', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Maria.Kowalska@Example.COM ')).toBe('maria.kowalska@example.com');
  });
  it('recognises ASCII-only addresses', () => {
    expect(ASCII_PRINTABLE.test('maria@example.com')).toBe(true);
    expect(ASCII_PRINTABLE.test('иван@пример.рф')).toBe(false);
    expect(ASCII_PRINTABLE.test('josé@example.com')).toBe(false);
  });
});
