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

/** Optional raw string field — null passes through; otherwise a non-empty string (never coerced). */
export function strictStrOpt(v: unknown, field: string): string | null {
  if (v == null) return null;
  return strictStr(v, field);
}

/** Required raw string constrained to an explicit supported union (P1-BENCH-011). A non-empty but
 *  UNKNOWN value is a source schema/semantics change and fails closed — it is NEVER defaulted (e.g. an
 *  unrecognised row-kind must not silently become latency-qualified evidence). */
export function strictEnum<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  const s = strictStr(v, field);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new SchemaError(`field "${field}" must be one of [${allowed.join(", ")}], got ${JSON.stringify(s)}`);
  }
  return s as T;
}

/** Required raw boolean — must ALREADY be a boolean; a string "false" fails closed (never truthiness). */
export function strictBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw new SchemaError(`field "${field}" must be a boolean, got ${JSON.stringify(v)}`);
  return v;
}

/** Optional raw boolean — null passes through; otherwise a real boolean. */
export function strictBoolOpt(v: unknown, field: string): boolean | null {
  if (v == null) return null;
  return strictBool(v, field);
}
