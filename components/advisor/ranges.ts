// Unknown & range handling (docs/ux-v2/08-unknown-range-handling.md) — the pure range-recompute layer.
// Rules implemented verbatim from the doc:
//  - Ranges RECOMPUTE, they never extrapolate: low/high fleet and cost come from re-running the real
//    engine (recommend()) at the bound inputs — the band is real, never a percentage guess.
//  - The combined band is a CONTROLLED recompute at all-range-inputs-low / all-range-inputs-high.
//  - "Largest modeled range effect" is a bounded per-input sensitivity recompute (engine re-run at
//    each input's own bounds, other inputs at base), serialized as {input, bounds, effect}. It is a
//    deterministic controlled comparison — never causation inferred from an uncontrolled delta.
//  - Two confidence channels stay separate: evidence confidence is untouched; input confidence is
//    simply how many range-capable inputs are ranges.
//  - Base is always explicit; the headline shows the base case.
import { recommend } from "@/lib/recommendation";
import type { DecisionChoice, StructuredRecommendationResult } from "@/lib/recommendation";
import type { CalcInputs } from "@/lib/types";
import type { AdvisorState } from "./AdvisorInputs";

export type RangeField = "volume" | "outTokens" | "topN";
export interface RangeBounds {
  low: number;
  high: number;
}

export const RANGE_FIELDS: RangeField[] = ["volume", "outTokens", "topN"];
export const RANGE_FIELD_LABELS: Record<RangeField, string> = {
  volume: "Questions per month",
  outTokens: "Output tokens per answer",
  topN: "Context chunks sent (Top N)",
};

/** Typical presets that fill a plausible low/base/high (08: "never block — a missing Fact falls back
 *  to a labeled preset"). outTokens (~150/500/1,200) and topN (recommend 4; range 3–8) are the doc's
 *  own values; the volume tiers are PROPOSED planning values for owner review (UI5-D1) — pilot uses
 *  the doc's example row verbatim. */
export interface RangePreset {
  id: string;
  label: string;
  low: number;
  base: number;
  high: number;
}
export const RANGE_PRESETS: Record<RangeField, RangePreset[]> = {
  volume: [
    { id: "pilot", label: "Pilot", low: 200_000, base: 500_000, high: 1_200_000 },
    { id: "department", label: "Department", low: 2_000_000, base: 5_000_000, high: 12_000_000 },
    { id: "org-wide", label: "Org-wide", low: 80_000_000, base: 200_000_000, high: 480_000_000 },
  ],
  outTokens: [{ id: "answer-length", label: "Short / medium / long answers", low: 150, base: 500, high: 1200 }],
  topN: [{ id: "sources", label: "Typical sources (recommend 4)", low: 3, base: 4, high: 8 }],
};

interface Band {
  low: number;
  base: number;
  high: number;
}

export interface RangeComputation {
  /** Active range fields in fixed contract order. */
  fields: RangeField[];
  /** Combined envelope — ONE controlled recompute with every range input at its low, and one at its
   *  high. A metric is null when it cannot be derived fail-closed (e.g. the base configuration is not
   *  modeled at a bound, or a side has no price). */
  band: {
    fleet: Band | null; // the base result's relevant candidate, looked up at each bound
    selfHost: Band | null;
    api: Band | null;
    decisionLow: DecisionChoice;
    decisionBase: DecisionChoice;
    decisionHigh: DecisionChoice;
    stable: boolean; // decision identical at low, base and high
  };
  /** Bounded per-input sensitivity (only meaningful with ≥2 ranges): the input whose own low↔high
   *  bounds move the relevant candidate's fleet the most. Serialized {input, bounds, effect}. */
  largestEffect: { field: RangeField; bounds: RangeBounds; fleetLow: number; fleetHigh: number } | null;
}

/** Apply one bound value to the journey state (base state otherwise untouched). */
function withValue(state: AdvisorState, field: RangeField, value: number): AdvisorState {
  return { ...state, [field]: value };
}

/** The candidate id the fleet band tracks: the BASE result's best-self-host / comparator candidate. */
function relevantId(base: StructuredRecommendationResult): string | null {
  return base.bestSelfHost?.config.id ?? base.decision.costComparator?.selfHostCandidateId ?? null;
}

function metric(
  lowR: StructuredRecommendationResult,
  baseVal: number | null | undefined,
  highR: StructuredRecommendationResult,
  pick: (r: StructuredRecommendationResult) => number | null | undefined
): Band | null {
  const low = pick(lowR);
  const high = pick(highR);
  if (low == null || high == null || baseVal == null || !Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(baseVal)) return null;
  return { low, base: baseVal, high };
}

/**
 * Compute the real range bands by re-running the engine at the bounds. Pure and deterministic.
 * `base` is the page's already-computed structured result for the base state (never recomputed here);
 * `buildWorkload` is the page's OWN state→workload mapping (passed explicitly — the exact same
 * function that produced the base result, so bound runs can never drift from the headline).
 * Returns null when no range is active. Throws are NOT caught — the caller validates ranges first
 * (low/high finite, low < high, within field minimums), so a throw is a programming error surfaced
 * loudly rather than silently repaired.
 */
export function computeRanges(
  state: AdvisorState,
  ranges: Partial<Record<RangeField, RangeBounds>>,
  base: StructuredRecommendationResult,
  buildWorkload: (s: AdvisorState) => CalcInputs
): RangeComputation | null {
  const fields = RANGE_FIELDS.filter((f) => ranges[f]);
  if (fields.length === 0) return null;

  const run = (s: AdvisorState) => recommend({ workload: buildWorkload(s), optimizeFor: s.optimizeFor, experimentalProvenance: s.experimental });
  const allLowState = fields.reduce((s, f) => withValue(s, f, ranges[f]!.low), state);
  const allHighState = fields.reduce((s, f) => withValue(s, f, ranges[f]!.high), state);
  const lowR = run(allLowState);
  const highR = run(allHighState);

  const id = relevantId(base);
  const evalAt = (r: StructuredRecommendationResult) => (id ? (r.evaluations.find((e) => e.config.id === id) ?? null) : null);
  const baseEval = evalAt(base);

  const band: RangeComputation["band"] = {
    fleet: metric(lowR, baseEval?.fleet.boxes, highR, (r) => evalAt(r)?.fleet.boxes),
    selfHost: metric(lowR, baseEval?.cost.selfHostMonthly, highR, (r) => evalAt(r)?.cost.selfHostMonthly),
    api: metric(lowR, base.apiOption.monthlyCost, highR, (r) => r.apiOption.monthlyCost),
    decisionLow: lowR.decision.choice,
    decisionBase: base.decision.choice,
    decisionHigh: highR.decision.choice,
    stable: lowR.decision.choice === base.decision.choice && highR.decision.choice === base.decision.choice,
  };

  // Bounded per-input sensitivity: each range input at its OWN bounds, others at base (controlled).
  let largestEffect: RangeComputation["largestEffect"] = null;
  if (fields.length >= 2 && id) {
    for (const field of fields) {
      const b = ranges[field]!;
      const lo = evalAt(run(withValue(state, field, b.low)))?.fleet.boxes;
      const hi = evalAt(run(withValue(state, field, b.high)))?.fleet.boxes;
      if (lo == null || hi == null) continue;
      const effect = Math.abs(hi - lo);
      if (!largestEffect || effect > Math.abs(largestEffect.fleetHigh - largestEffect.fleetLow)) {
        largestEffect = { field, bounds: { ...b }, fleetLow: lo, fleetHigh: hi };
      }
    }
  }
  return { fields, band, largestEffect };
}

/** Range pair validation (the input layer enforces this BEFORE state commit; compute assumes it). */
export function rangeBoundsValid(field: RangeField, b: RangeBounds): boolean {
  const min = field === "volume" ? 1 : field === "topN" ? 0 : 0;
  return Number.isFinite(b.low) && Number.isFinite(b.high) && b.low >= min && b.high > b.low;
}
