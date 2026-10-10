export interface FieldError {
  field: string;
  messages: string[];
}

// Machine-readable cause of a 409 of the session registration endpoints (BEVN-202 spec 4.6). Other 409s have none.
export const CONFLICT_REASONS = [
  'REGISTRATION_CLOSED',
  'CONFERENCE_REGISTRATION_REQUIRED',
  'ALREADY_REGISTERED',
  'SESSION_OVERLAP',
  'SESSION_FULL',
  'SEATS_AVAILABLE',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

// Thrown by services and pipes; AllExceptionsFilter turns it into the error body of spec 5.6.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
    readonly reason?: ConflictReason,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, errors?: FieldError[]) => new ApiError(400, message, errors);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string, reason?: ConflictReason) => new ApiError(409, message, undefined, undefined, reason);
export const unprocessable = (message: string, errors?: FieldError[]) => new ApiError(422, message, errors);
export const serviceUnavailable = (message: string) => new ApiError(503, message, undefined, { 'Retry-After': '1' });
