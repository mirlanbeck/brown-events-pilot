import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { STATUS_CODES } from 'node:http';
import { ErrorResponse } from '../representation/responses';

const EXAMPLES: Record<number, { message: string; errors?: { field: string; messages: string[] }[] }> = {
  400: { message: 'Validation failed', errors: [{ field: 'email', messages: ['email must be an email address'] }] },
  404: { message: 'Conference 999 not found' },
  409: { message: 'Attendee is already registered for this conference' },
  413: { message: 'Request body exceeds 100kb' },
  415: { message: 'Content-Type must be application/json' },
  422: { message: 'Referenced record does not exist', errors: [{ field: 'speakerId', messages: ['speakerId does not reference an existing record'] }] },
  500: { message: 'Internal server error' },
  503: { message: 'The database is busy, retry the request' },
};

// Every documented error code with an example body (spec 5.8).
export function ApiErrors(...codes: number[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponse),
    ...[...codes, 500].map((status) =>
      ApiResponse({
        status,
        description: STATUS_CODES[status],
        content: {
          'application/json': {
            schema: { $ref: getSchemaPath(ErrorResponse) },
            example: { statusCode: status, error: STATUS_CODES[status], requestId: '3f1c2a7e-8b4d-4c1e-9a55-2d6f0b9e7c11', ...EXAMPLES[status] },
          },
        },
      }),
    ),
  );
}
