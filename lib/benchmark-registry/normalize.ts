// Fail-closed normalization: a schema change or a missing decision-critical field
// REJECTS the snapshot (throws) rather than silently producing a corrupt catalog.
import type { BenchmarkRecord, SourceAdapter } from "./schema";
import { SchemaError } from "./sources/inferencex";

const REQUIRED: (keyof BenchmarkRecord)[] = [
  "id", "provenance", "modelId", "checkpoint", "weightPrecision", "framework",
  "gpuSku", "gpuCount", "nodeCount", "isl", "osl", "perGpuReported", "latencyQualified",
];

/** Validate one record; throw on any missing decision-critical field. */
export function validateRecord(rec: BenchmarkRecord): void {
  for (const k of REQUIRED) {
    if (rec[k] === undefined || rec[k] === null) {
      throw new SchemaError(`record ${rec?.id ?? "<no id>"} missing required field "${String(k)}"`);
    }
  }
  const p = rec.provenance;
  for (const k of ["sourceName", "sourceClass", "sourceUrl", "rawChecksum", "license", "attribution", "snapshotKind"] as const) {
    if (!p || (p as any)[k] == null) throw new SchemaError(`record ${rec.id} missing provenance.${k}`);
  }
  // A per-GPU throughput must never exist without the source asserting it (no fictional split).
  if (!rec.perGpuReported && (rec.outputTputPerGpu != null || rec.inputTputPerGpu != null)) {
    throw new SchemaError(`record ${rec.id} has a per-GPU metric but perGpuReported=false (fictional per-GPU)`);
  }
}

/** Normalize + validate a pinned raw snapshot. Fail-closed: any error propagates. */
export function normalizeSafe(adapter: SourceAdapter, raw: unknown): BenchmarkRecord[] {
  const recs = adapter.normalize(raw); // adapter throws SchemaError on structural change
  recs.forEach(validateRecord);
  return recs;
}
