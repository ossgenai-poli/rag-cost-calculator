// Exhaustive, fail-closed validation (P1-7). A malformed field — bad enum, non-finite
// or non-positive number, malformed hash/date/url, inconsistent topology, or an
// unverified snapshot with a TBD revision — REJECTS the snapshot rather than admitting
// a corrupt or over-trusted record.
import type { BenchmarkRecord, Percentile, Serving, SnapshotKind, SourceAdapter, SourceClass } from "./schema";
import { SchemaError } from "./sources/inferencex";

const SOURCE_CLASSES: SourceClass[] = ["independent-reviewed", "open-reproducible", "vendor-measured", "research-measured"];
const SNAPSHOT_KINDS: SnapshotKind[] = ["verified", "illustrative-pending-ingestion"];
const SERVINGS: Serving[] = ["aggregated", "disaggregated"];
const PERCENTILES: Percentile[] = ["p50", "p90", "p95", "p99", "mean", "unknown"];
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function fail(id: string, msg: string): never {
  throw new SchemaError(`record ${id || "<no id>"}: ${msg}`);
}
const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
const posFinite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const nullOrPosFinite = (v: unknown) => v === null || posFinite(v);

export function validateRecord(rec: BenchmarkRecord): void {
  const id = rec?.id;
  if (!id || typeof id !== "string") fail(String(id), "missing/invalid id");
  for (const f of ["modelId", "checkpoint", "weightPrecision", "framework", "gpuSku", "formFactor", "topology", "interconnect", "hostSystem", "measuredDate"] as const) {
    if (!rec[f] || typeof rec[f] !== "string") fail(id, `missing/invalid string "${f}"`);
  }
  if (typeof rec.hostIsAwsRepresentative !== "boolean") fail(id, "hostIsAwsRepresentative must be boolean");
  if (typeof rec.perGpuReported !== "boolean") fail(id, "perGpuReported must be boolean");
  if (typeof rec.latencyQualified !== "boolean") fail(id, "latencyQualified must be boolean");
  if (!SERVINGS.includes(rec.serving)) fail(id, `invalid serving "${rec.serving}"`);

  // counts & topology
  if (!posInt(rec.gpuCount)) fail(id, `gpuCount must be a positive integer (got ${rec.gpuCount})`);
  if (!posInt(rec.nodeCount)) fail(id, `nodeCount must be a positive integer (got ${rec.nodeCount})`);
  if (!posFinite(rec.gpuMemGB)) fail(id, `gpuMemGB must be positive & finite (got ${rec.gpuMemGB})`);
  if (rec.nodeCount > rec.gpuCount) fail(id, `nodeCount ${rec.nodeCount} > gpuCount ${rec.gpuCount} (inconsistent topology)`);
  for (const k of ["tp", "pp", "ep", "dp"] as const) {
    if (!posInt(rec.parallelism?.[k])) fail(id, `parallelism.${k} must be a positive integer (got ${rec.parallelism?.[k]})`);
  }

  // workload & metrics
  if (!posInt(rec.isl) || !posInt(rec.osl)) fail(id, `isl/osl must be positive integers (${rec.isl}/${rec.osl})`);
  if (!(rec.concurrency === null || posInt(rec.concurrency))) fail(id, `concurrency must be null or a positive integer (got ${rec.concurrency})`);
  for (const m of ["outputTputPerGpu", "inputTputPerGpu", "intvty", "tpot", "itl", "throughputTotal"] as const) {
    if (!nullOrPosFinite(rec[m])) fail(id, `${m} must be null or positive & finite (got ${rec[m]})`);
  }
  if (rec.ttft !== null) {
    if (!posFinite(rec.ttft.value)) fail(id, `ttft.value must be positive & finite (got ${rec.ttft?.value})`);
    if (!PERCENTILES.includes(rec.ttft.percentile)) fail(id, `invalid ttft.percentile "${rec.ttft?.percentile}"`);
  }
  // no fictional per-GPU (retained)
  if (!rec.perGpuReported && (rec.outputTputPerGpu != null || rec.inputTputPerGpu != null)) {
    fail(id, "per-GPU metric present but perGpuReported=false (fictional per-GPU)");
  }

  // provenance
  const p = rec.provenance;
  if (!p) fail(id, "missing provenance");
  if (!SOURCE_CLASSES.includes(p.sourceClass)) fail(id, `invalid sourceClass "${p.sourceClass}"`);
  if (!SNAPSHOT_KINDS.includes(p.snapshotKind)) fail(id, `invalid snapshotKind "${p.snapshotKind}"`);
  if (!HASH_RE.test(p.rawChecksum ?? "")) fail(id, `malformed rawChecksum "${p.rawChecksum}"`);
  if (!/^https:\/\//.test(p.sourceUrl ?? "")) fail(id, `sourceUrl must be https (got "${p.sourceUrl}")`);
  if (!DATE_RE.test(p.retrievedAt ?? "")) fail(id, `retrievedAt must be a YYYY-MM-DD date (got "${p.retrievedAt}")`);
  for (const f of ["sourceName", "license", "attribution"] as const) {
    if (!p[f] || typeof p[f] !== "string") fail(id, `missing provenance.${f}`);
  }
  // P2-2: a VERIFIED snapshot must be pinned to a real revision (no TBD).
  if (p.snapshotKind === "verified") {
    const rev = `${p.sourceCommit ?? ""}${p.runId ?? ""}`;
    if (!rev || /TBD/i.test(rev)) fail(id, "verified snapshot must be pinned to a real revision (no TBD)");
  }
}

/** Normalize + validate a pinned raw snapshot. Fail-closed: any error propagates. */
export function normalizeSafe(adapter: SourceAdapter, raw: unknown): BenchmarkRecord[] {
  const recs = adapter.normalize(raw); // adapter throws on structural/numeric change
  recs.forEach(validateRecord);
  return recs;
}
