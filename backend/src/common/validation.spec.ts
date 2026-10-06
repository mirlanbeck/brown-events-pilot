import { plainToInstance } from 'class-transformer';
import { IsInt, IsString, validate } from 'class-validator';
import { flattenValidationErrors, IsAsciiEmail, IsLaterThan, IsPresent, IsWallClock, isText, NormalizeEmail, NullOr } from './validation';

class Probe {
  @IsString() title!: string;
  @IsPresent() @NullOr('isNullableText', isText(10), 'must be a string of at most 10 characters or null') note!: string | null;
  @IsWallClock() startTime!: string;
  @IsWallClock() @IsLaterThan('startTime', { allowEqual: false }) endTime!: string;
  @NormalizeEmail() @IsAsciiEmail() email!: string;
  @IsInt() n!: number;
}

async function errorsOf(plain: object) {
  return flattenValidationErrors(await validate(plainToInstance(Probe, plain)));
}

const ok = { title: 't', note: null, startTime: '2027-01-10T10:00:00', endTime: '2027-01-10T11:00:00', email: '  Maria@Example.COM ', n: 1 };

describe('validation decorators', () => {
  it('accepts a valid object and normalises the email', async () => {
    expect(await errorsOf(ok)).toEqual([]);
    expect(plainToInstance(Probe, ok).email).toBe('maria@example.com');
  });
  it('requires present keys but allows null', async () => {
    const { note: _note, ...missing } = ok;
    expect(await errorsOf(missing)).toEqual([{ field: 'note', messages: ['note is required (send null to clear it)'] }]);
  });
  it('checks nullable text and wall-clock format and order', async () => {
    const errors = await errorsOf({ ...ok, note: 'x'.repeat(11), startTime: '2027-01-10T10:00:00Z', endTime: '2027-01-10T10:00:00' });
    expect(errors.map((e) => e.field)).toEqual(['note', 'startTime']);
    const order = await errorsOf({ ...ok, endTime: '2027-01-10T10:00:00' });
    expect(order).toEqual([{ field: 'endTime', messages: ['endTime must be later than startTime'] }]);
  });
  it('rejects non-ASCII and malformed emails', async () => {
    expect((await errorsOf({ ...ok, email: 'иван@пример.рф' }))[0].field).toBe('email');
    expect((await errorsOf({ ...ok, email: 'not-an-email' }))[0].field).toBe('email');
  });
});
