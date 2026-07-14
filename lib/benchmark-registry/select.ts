// Deterministic selection over the eligible set. Precedence: exact > proxy >
// extrapolated; then independent-reviewed > open-reproducible > vendor-measured >
// research-measured; then (within a source) the operating concurrency nearest the
// request; then a stable id tie-break. No averaging, no silent interpolation.
import type { BenchmarkRecord, EvidenceMatch, RequestSpec } from "./schema";
import { evaluate, type EvalOptions } from "./eligibility";
import { sourceRank, statusRank } from "./confidence";

export function selectBest(records: BenchmarkRecord[], req: RequestSpec, opts: EvalOptions = {}): EvidenceMatch | null {
  const eligible = records.map((r) => evaluate(r, req, opts)).filter((m) => m.eligible);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => cmp(a, b, req));
  return eligible[0];
}

function cmp(a: EvidenceMatch, b: EvidenceMatch, req: RequestSpec): number {
  const s = statusRank(a.evidenceStatus) - statusRank(b.evidenceStatus);
  if (s) return s;
  const c = sourceRank(a.record.provenance.sourceClass) - sourceRank(b.record.provenance.sourceClass);
  if (c) return c;
  if (req.concurrency != null) {
    const d = concDist(a.record, req.concurrency) - concDist(b.record, req.concurrency);
    if (d) return d;
  }
  return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

function concDist(r: BenchmarkRecord, target: number): number {
  return r.concurrency == null ? Number.POSITIVE_INFINITY : Math.abs(r.concurrency - target);
}

export { evaluate };
