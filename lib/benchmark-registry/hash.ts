// Deterministic canonical-JSON + sha256 for pinned-snapshot checksums.
// Build/offline-time only (node); the shipping catalog is pre-normalized.
import { createHash } from "node:crypto";

/** Stable stringify: object keys sorted recursively → identical bytes for identical data. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function sha256(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex");
}
