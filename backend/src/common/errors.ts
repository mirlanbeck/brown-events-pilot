export interface FieldError {
  field: string;
  messages: string[];
}

// Thrown by services and pipes; AllExceptionsFilter turns it into the error body of spec 5.6.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, errors?: FieldError[]) => new ApiError(400, message, errors);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);
export const unprocessable = (message: string, errors?: FieldError[]) => new ApiError(422, message, errors);
export const serviceUnavailable = (message: string) => new ApiError(503, message, undefined, { 'Retry-After': '1' });
