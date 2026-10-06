export const ASCII_PRINTABLE = /^[\x21-\x7E]+$/;

// trim + lower-case on write and lookup (CORR-3). Only ASCII addresses are accepted (spec 6.4), so JS toLowerCase()
// and Postgres lower() in the CHECK constraint agree.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
