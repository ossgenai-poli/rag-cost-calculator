// Shared strict raw-value validation used by EVERY adapter and every numeric source
// field. A raw numeric field must ALREADY be a finite number — a string ("8") or a
// boolean is a source schema change and fails closed, never a silent coercion (P1-7).
export class SchemaError extends Error {}

/** Required raw numeric field — must already be a finite number (no coercion). */
export function strictNum(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SchemaError(`field "${field}" must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Optional raw numeric field — null passes through; otherwise strict. */
export function strictNumOpt(v: unknown, field: string): number | null {
  if (v == null) return null;
  return strictNum(v, field);
}

/** Required raw string field. */
export function strictStr(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new SchemaError(`field "${field}" must be a non-empty string, got ${JSON.stringify(v)}`);
  }
  return v;
}
