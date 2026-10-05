import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiError } from './errors';
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
});
