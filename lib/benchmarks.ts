// ============================================================================
// benchmarks — real InferenceX inference-throughput curves, baked into the app
// (lib/benchmarks-data.json, refreshed offline from the InferenceX DB — see
// research/inference-benchmark-grounding.md). Used to GROUND self-hosted GPU
// sizing in measured data instead of a single flat throughput estimate.
//
// Each curve is a set of concurrency points; as concurrency rises, per-user
// interactivity (tok/s/user) falls and per-GPU throughput rises. To serve a
// given interactivity SLA you operate at the concurrency where the curve crosses
// it — and read off the per-GPU throughput there.
// ============================================================================

import data from "./benchmarks-data.json";

export interface BenchPoint {
  conc: number;
  intvty: number;      // interactivity: output tok/s per user
  tputPerGpu: number;  // decode tok/s per GPU
  ttft: number;        // time-to-first-token, seconds
}
interface BenchSeries {
  framework: string;
  gpusInConfig: number;
  points: BenchPoint[];
}
type BenchData = {
  source: string;
  generatedAt: string;
  models: Record<string, Record<string, Record<string, Record<string, BenchSeries>>>>;
};
const BENCH = data as BenchData;

export const BENCHMARK_SOURCE = BENCH.source;
export const BENCHMARK_AS_OF = BENCH.generatedAt;

/** Map a GPU instance type to the InferenceX hardware key. */
export function gpuKeyForInstance(instanceType: string): string | null {
  const t = instanceType.toLowerCase();
  if (t.includes("p6-b200") || t.includes("b200")) return "b200";
  if (t.includes("p5e") || t.includes("h200")) return "h200";
  if (t.includes("p5") || t.includes("h100")) return "h100";
  return null;
}

/** Weight-bit precision → InferenceX precision key (data has fp4 / fp8 only). */
function precisionKey(weightBits: number): string {
  return weightBits <= 4 ? "fp4" : "fp8";
}

/** Round a sequence length to the nearest benchmarked bucket present in a series map. */
function nearestBucket(value: number, buckets: number[]): number {
  return buckets.reduce((best, b) => (Math.abs(b - value) < Math.abs(best - value) ? b : best), buckets[0]);
}

export interface BenchLookup {
  points: BenchPoint[];
  framework: string;
  gpusInConfig: number;
  precisionUsed: string;
  seqUsed: string;       // "isl/osl" bucket actually used
}

/**
 * Look up a benchmark curve for a model key + GPU + precision + input/output
 * length. Falls back across precision (exact → any available) and to the nearest
 * ISL bucket. Returns null when the model/GPU pair has no data.
 */
export function getBenchmarkCurve(
  modelKey: string | undefined,
  instanceType: string,
  weightBits: number,
  inputTokens: number,
  outputTokens: number
): BenchLookup | null {
  if (!modelKey) return null;
  const gpu = gpuKeyForInstance(instanceType);
  if (!gpu) return null;
  const byGpu = BENCH.models[modelKey]?.[gpu];
  if (!byGpu) return null;

  const prefer = precisionKey(weightBits);
  const precisionUsed = byGpu[prefer] ? prefer : Object.keys(byGpu)[0];
  const bySeq = byGpu[precisionUsed];
  if (!bySeq) return null;

  const seqKeys = Object.keys(bySeq); // e.g. ["1024/1024","8192/1024"]
  const islBuckets = [...new Set(seqKeys.map((s) => Number(s.split("/")[0])))];
  const oslBuckets = [...new Set(seqKeys.map((s) => Number(s.split("/")[1])))];
  const isl = nearestBucket(inputTokens, islBuckets);
  const osl = nearestBucket(outputTokens, oslBuckets);
  const seqUsed = `${isl}/${osl}`;
  const series = bySeq[seqUsed] ?? bySeq[seqKeys[0]];
  if (!series?.points?.length) return null;

  return {
    points: series.points,
    framework: series.framework,
    gpusInConfig: series.gpusInConfig,
    precisionUsed,
    seqUsed: bySeq[seqUsed] ? seqUsed : seqKeys[0],
  };
}

export interface OperatingPoint {
  tputPerGpu: number;
  ttft: number;
  achievedInteractivity: number; // tok/s/user actually served
  conc: number;
  slaAchievable: boolean;        // false when target exceeds the best point on the curve
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Per-GPU throughput while meeting an interactivity SLA. The curve is sorted by
 * concurrency (interactivity falls, throughput rises). We operate where the curve
 * crosses the target — the highest throughput that still delivers ≥ `target`
 * tok/s/user — interpolating linearly between the bracketing points.
 */
export function operatingPointAt(points: BenchPoint[], target: number): OperatingPoint {
  const pts = [...points].sort((a, b) => a.conc - b.conc);
  const first = pts[0];
  const last = pts[pts.length - 1];

  // Target snappier than even the lowest-concurrency point → SLA not achievable;
  // best we can do is that point (max interactivity), and it's still below target.
  if (target >= first.intvty) {
    return { tputPerGpu: first.tputPerGpu, ttft: first.ttft, achievedInteractivity: first.intvty, conc: first.conc, slaAchievable: false };
  }
  // Target below the highest-concurrency point → SLA met with room; use max throughput.
  if (target <= last.intvty) {
    return { tputPerGpu: last.tputPerGpu, ttft: last.ttft, achievedInteractivity: last.intvty, conc: last.conc, slaAchievable: true };
  }
  // Interpolate at the crossing (intvty decreasing with concurrency).
  for (let i = 0; i < pts.length - 1; i++) {
    const hi = pts[i], lo = pts[i + 1];
    if (hi.intvty >= target && target >= lo.intvty) {
      const t = (hi.intvty - target) / (hi.intvty - lo.intvty || 1);
      return {
        tputPerGpu: lerp(hi.tputPerGpu, lo.tputPerGpu, t),
        ttft: lerp(hi.ttft, lo.ttft, t),
        achievedInteractivity: target,
        conc: lerp(hi.conc, lo.conc, t),
        slaAchievable: true,
      };
    }
  }
  return { tputPerGpu: last.tputPerGpu, ttft: last.ttft, achievedInteractivity: last.intvty, conc: last.conc, slaAchievable: true };
}
