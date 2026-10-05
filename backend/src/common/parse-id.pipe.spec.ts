import { ApiError } from './errors';
import { ParseIdPipe } from './parse-id.pipe';

describe('ParseIdPipe (spec 5.4)', () => {
  const pipe = new ParseIdPipe();
  it.each(['1', '42', '2147483647'])('accepts %s', (raw) => {
    expect(pipe.transform(raw)).toBe(Number(raw));
  });
  it.each(['abc', '0', '-1', '007', '+5', ' 5', '5 ', '1e3', '1.0', '2147483648', '99999999999', ''])('rejects %p with 400', (raw) => {
    try {
      pipe.transform(raw);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).errors).toEqual([{ field: 'id', messages: ['id must be an integer between 1 and 2147483647'] }]);
    }
  });
});
