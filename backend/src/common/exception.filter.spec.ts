import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiError, conflict } from './errors';
import { toErrorSpec } from './exception.filter';

describe('toErrorSpec (spec 5.6)', () => {
  it('passes ApiError through', () => {
    const error = new ApiError(422, 'Session violates conference rules', [{ field: 'capacity', messages: ['too big'] }]);
    expect(toErrorSpec(error)).toMatchObject({ status: 422, message: 'Session violates conference rules', errors: [{ field: 'capacity', messages: ['too big'] }] });
  });
  it('renames the router 404', () => {
    expect(toErrorSpec(new NotFoundException('Cannot GET /x'))).toMatchObject({ status: 404, message: 'Route not found' });
  });
  it('keeps other Nest HTTP errors, without internals', () => {
    expect(toErrorSpec(new BadRequestException('bad'))).toMatchObject({ status: 400, message: 'Bad Request' });
  });
  it('hides unexpected errors behind a generic 500', () => {
    const spec = toErrorSpec(new TypeError("Cannot read properties of undefined (reading 'toUpperCase')"));
    expect(spec).toMatchObject({ status: 500, message: 'Internal server error' });
    expect(JSON.stringify(spec)).not.toContain('toUpperCase');
  });
  it('passes the reason of a 409 through (BEVN-202 spec 4.6)', () => {
    expect(toErrorSpec(conflict('No seats left in this session; join the waitlist instead', 'SESSION_FULL'))).toMatchObject({ status: 409, reason: 'SESSION_FULL' });
  });
});

describe('toErrorSpec for Express-style errors (http-errors, body-parser)', () => {
  it('keeps a 4xx status carried by the error and hides its message', () => {
    const corruptGzip = Object.assign(new Error('incorrect header check'), { status: 400, code: 'Z_DATA_ERROR' });
    expect(toErrorSpec(corruptGzip)).toEqual({ status: 400, message: 'Bad Request' });
    expect(toErrorSpec(Object.assign(new Error('teapot'), { statusCode: 418 }))).toEqual({ status: 418, message: "I'm a Teapot" });
  });
  it('does not trust 5xx or odd statuses from the error', () => {
    expect(toErrorSpec(Object.assign(new Error('x'), { status: 503 }))).toMatchObject({ status: 500, message: 'Internal server error' });
    expect(toErrorSpec(Object.assign(new Error('x'), { status: '400' }))).toMatchObject({ status: 500 });
  });
});
