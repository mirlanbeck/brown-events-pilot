import { applyDecorators, ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { buildMessage, IsEmail, isURL, Matches, MaxLength, ValidateBy, ValidationArguments, ValidationError } from 'class-validator';
import { parseWallClock } from './dates';
import { ASCII_PRINTABLE, normalizeEmail } from './email';
import { badRequest, type FieldError } from './errors';
import { INT32_MAX, LIMITS } from './limits';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

// whitelist + forbidNonWhitelisted for every body, no exceptions (spec 5.4, CORR-4, SEC-3). Only bodies:
// path ids go through ParseIdPipe, so the built-in primitive conversion ("007" -> 7) never runs on them.
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) => badRequest('Validation failed', flattenValidationErrors(errors)),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type !== 'body') return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Request body must be a JSON object');
    return await super.transform(value, metadata);
  }
}

export const isText = (max: number) => (value: unknown) => typeof value === 'string' && value.length <= max;
export const isPositiveInt32 = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= INT32_MAX;
export const isUrlValue = (max: number) => (value: unknown) =>
  typeof value === 'string' && value.length <= max && isURL(value, { require_protocol: true, protocols: ['http', 'https'] });

// The key must be in the body; null is a valid value (PUT is a full replacement, spec 5.4 / CORR-5).
export function IsPresent(): PropertyDecorator {
  return ValidateBy({
    name: 'isPresent',
    validator: {
      validate: (value: unknown) => value !== undefined,
      defaultMessage: buildMessage((each) => `${each}$property is required (send null to clear it)`),
    },
  });
}

// Validates only non-null values, unlike @IsOptional which would also silence @IsPresent.
export function NullOr(name: string, check: (value: unknown) => boolean, message: string): PropertyDecorator {
  return ValidateBy({
    name,
    validator: {
      validate: (value: unknown) => value === undefined || value === null || check(value),
      defaultMessage: buildMessage((each) => `${each}$property ${message}`),
    },
  });
}

export function IsWallClock(): PropertyDecorator {
  return ValidateBy({
    name: 'isWallClock',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && parseWallClock(value) !== null,
      defaultMessage: buildMessage((each) => `${each}$property must be a local date-time YYYY-MM-DDTHH:mm:ss without offset or fraction`),
    },
  });
}

export function IsLaterThan(other: string, options: { allowEqual: boolean }): PropertyDecorator {
  return ValidateBy({
    name: options.allowEqual ? 'isNotBefore' : 'isLaterThan',
    constraints: [other],
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const otherValue: unknown = args ? (args.object as Record<string, unknown>)[other] : undefined;
        const end = typeof value === 'string' ? parseWallClock(value) : null;
        const start = typeof otherValue === 'string' ? parseWallClock(otherValue) : null;
        if (!end || !start) return true; // format errors are reported by @IsWallClock
        return options.allowEqual ? end >= start : end > start;
      },
      defaultMessage: buildMessage((each) => `${each}$property must be ${options.allowEqual ? 'on or after' : 'later than'} $constraint1`),
    },
  });
}

export function IsAsciiEmail(): PropertyDecorator {
  return applyDecorators(
    MaxLength(LIMITS.attendees.Email),
    Matches(ASCII_PRINTABLE, { message: '$property must contain only ASCII characters' }),
    IsEmail({ allow_utf8_local_part: false, require_tld: true }, { message: '$property must be an email address' }),
  );
}

export const NormalizeEmail = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value));
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
