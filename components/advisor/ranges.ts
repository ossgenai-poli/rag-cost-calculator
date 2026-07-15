// Unknown & range handling (docs/ux-v2/08-unknown-range-handling.md) — the pure range-recompute layer,
// revised per the iteration-5 HOLD:
//  - Ranges RECOMPUTE, they never extrapolate: low/high fleet and cost come from re-running the real
//    engine (recommend()) at the bound inputs — the band is real, never a percentage guess.
//  - The combined band is a CONTROLLED recompute at all-range-inputs-low / all-range-inputs-high.
//  - P1-UI5-1: a range is valid ONLY as a TRIPLET — finite, at/above the field minimum, low < high AND
//    low ≤ base ≤ high; count fields must be integers. One shared rangeTripletValid() is the contract
//    for the input layer, the page gate and this module (computeRanges throws on an invalid triplet —
//    the caller must gate; a throw is a programming error, never silently repaired).
//  - P1-UI5-2: three sampled scenarios are never "range stability". The decision comparison is named
//    sampledPointsAgree and worded as exactly what it is: agreement at the all-low, base and all-high
//    scenarios, with intermediate values NOT exhaustively evaluated (the engine is stepwise/nonlinear —
//    interior decisions can differ, e.g. Top N 0/5/10 → api while Top N 7 → self-host).
//  - P1-UI5-3: bound scenarios disclose engine reconciliations (entered → calculated, C3 contract) and
//    the tracked candidate's recommendation-eligibility; an ineligible bound never presents a
//    qualified cost/fleet band.
//  - Two channels stay separate: evidence confidence is untouched; the range count is RANGE COVERAGE
//    (UI5-D3 — it does not measure how trustworthy the inputs are, so it is never called confidence).
import { recommend } from "@/lib/recommendation";
import type { DecisionChoice, StructuredRecommendationResult } from "@/lib/recommendation";
import type { CalcInputs } from "@/lib/types";
import type { AdvisorState } from "./AdvisorInputs";
import { ADJUSTMENT_FIELD_LABELS } from "./copy";

export type RangeField = "volume" | "outTokens" | "topN" | "peakFactor";
export interface RangeBounds {
  low: number;
  high: number;
}

export const RANGE_FIELDS: RangeField[] = ["volume", "outTokens", "topN", "peakFactor"];
export const RANGE_FIELD_LABELS: Record<RangeField, string> = {
  volume: "Questions per month",
  outTokens: "Output tokens per answer",
  topN: "Context chunks sent (Top N)",
  peakFactor: "Peak-to-average traffic ratio",
};

/** Per-field validation floor + integer rule: volume/outTokens/topN are COUNTS (whole numbers only);
 *  peakFactor is a ratio ≥ 1 (fractional allowed) — UI5-D2. */
const FIELD_MIN: Record<RangeField, number> = { volume: 1, outTokens: 0, topN: 0, peakFactor: 1 };
const FIELD_INTEGER: Record<RangeField, boolean> = { volume: true, outTokens: true, topN: true, peakFactor: false };

/** Typical presets that fill a plausible low/BASE/high triplet (08: "never block — a missing Fact
 *  falls back to a labeled preset"). outTokens (~150/500/1,200) and topN (recommend 4; range 3–8) are
 *  the doc's own values; the volume tiers and the traffic-shape triplet are ILLUSTRATIVE planning
 *  presets (owner UI5-D1/UI5-D2 — labeled visibly, never presented as workload standards). */
export interface RangePreset {
  id: string;
  label: string;
  low: number;
  base: number;
  high: number;
}
export const RANGE_PRESETS: Record<RangeField, RangePreset[]> = {
  volume: [
    { id: "pilot", label: "Pilot — illustrative (200k / 500k / 1.2M)", low: 200_000, base: 500_000, high: 1_200_000 },
    { id: "department", label: "Department — illustrative (2M / 5M / 12M)", low: 2_000_000, base: 5_000_000, high: 12_000_000 },
    { id: "org-wide", label: "Org-wide — illustrative (80M / 200M / 480M)", low: 80_000_000, base: 200_000_000, high: 480_000_000 },
  ],
  outTokens: [{ id: "answer-length", label: "Short / medium / long answers (150 / 500 / 1,200)", low: 150, base: 500, high: 1200 }],
  topN: [{ id: "sources", label: "Typical sources (3 / 4 / 8; recommend 4)", low: 3, base: 4, high: 8 }],
  peakFactor: [
    { id: "traffic-shape", label: "Steady → very spiky — illustrative assumption (1.2 / 2 / 3)", low: 1.2, base: 2, high: 3 },
  ],
};

/**
 * P1-UI5-1 — the ONE shared triplet contract: a range is meaningful only when the base lies inside it.
 * Requires finite values, the field minimum, low < high, low ≤ base ≤ high, and whole numbers for
 * count fields. Validated when bounds commit AND whenever an active range's base changes; an invalid
 * triplet must never reach computeRanges or the export.
 */
export function rangeTripletValid(field: RangeField, base: number, b: RangeBounds): boolean {
  if (!Number.isFinite(b.low) || !Number.isFinite(b.high) || !Number.isFinite(base)) return false;
  if (FIELD_INTEGER[field] && (!Number.isInteger(b.low) || !Number.isInteger(b.high) || !Number.isInteger(base))) return false;
  if (b.low < FIELD_MIN[field]) return false;
  if (!(b.low < b.high)) return false;
  return b.low <= base && base <= b.high;
}

interface Band {
  low: number;
  base: number;
  high: number;
}

/** An engine reconciliation observed in a BOUND scenario (entered → calculated) that is NOT already
 *  disclosed by the base result — the C3 contract carried into the range view (P1-UI5-3). */
export interface BoundAdjustment {
  scenario: "low" | "high";
  field: string;
  entered: number;
  calculated: number;
}

export interface RangeComputation {
  /** Active range fields in fixed contract order. */
  fields: RangeField[];
  /** Combined envelope — ONE controlled recompute with every range input at its low, and one at its
   *  high. Fleet/self-host bands additionally require the tracked candidate to be recommendation-
   *  ELIGIBLE at both bounds (P1-UI5-3) — otherwise they fail closed to null (the amounts stay in the
   *  audit as diagnostics, never as a qualified band). */
  band: {
    fleet: Band | null;
    selfHost: Band | null;
    api: Band | null;
    decisionLow: DecisionChoice;
    decisionBase: DecisionChoice;
    decisionHigh: DecisionChoice;
    /** P1-UI5-2: agreement at the THREE EVALUATED SCENARIOS only (all-low, base, all-high). The engine
     *  is stepwise/nonlinear — this is NEVER a claim of stability across the whole range. */
    sampledPointsAgree: boolean;
  };
  /** Bounded per-input sensitivity (only meaningful with ≥2 ranges): the input whose own low↔high
   *  bounds move the relevant candidate's fleet the most. Serialized {input, bounds, effect}. */
  largestEffect: { field: RangeField; bounds: RangeBounds; fleetLow: number; fleetHigh: number } | null;
  /** P1-UI5-3 — engine reconciliations observed at the bound scenarios (entered → calculated). */
  boundAdjustments: BoundAdjustment[];
  /** P1-UI5-3 — the tracked candidate's recommendation-eligibility at each bound (null = no tracked
   *  self-host candidate exists on the base result). */
  trackedEligibility: { low: boolean; high: boolean } | null;
}

/** Apply one bound value to the journey state (base state otherwise untouched). */
function withValue(state: AdvisorState, field: RangeField, value: number): AdvisorState {
  return { ...state, [field]: value };
}

/** The candidate id the fleet band tracks: the customer's ACTIVE selection (doc 06 — the caller
 *  resolves it fail-closed and passes only an eligible id), else the BASE result's best-self-host /
 *  comparator candidate. */
function relevantId(base: StructuredRecommendationResult, focusId?: string | null): string | null {
  if (focusId && base.evaluations.some((e) => e.config.id === focusId && e.recommendationEligible)) return focusId;
  return base.bestSelfHost?.config.id ?? base.decision.costComparator?.selfHostCandidateId ?? null;
}

function metric(low: number | null | undefined, baseVal: number | null | undefined, high: number | null | undefined): Band | null {
  if (low == null || high == null || baseVal == null || !Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(baseVal)) return null;
  return { low, base: baseVal, high };
}

/** Bound-scenario adjustments the BASE result does not already disclose (field+entered+calculated). */
function newAdjustments(scenario: "low" | "high", r: StructuredRecommendationResult, base: StructuredRecommendationResult): BoundAdjustment[] {
  const seen = new Set(base.inputAdjustments.map((a) => `${a.field}|${a.entered}|${a.calculated}`));
  return r.inputAdjustments
    .filter((a) => !seen.has(`${a.field}|${a.entered}|${a.calculated}`))
    .map((a) => ({ scenario, field: a.field, entered: a.entered, calculated: a.calculated }));
}

/**
 * Compute the real range bands by re-running the engine at the bounds. Pure and deterministic.
 * `base` is the page's already-computed structured result for the base state (never recomputed here);
 * `buildWorkload` is the page's OWN state→workload mapping (passed explicitly — the exact same
 * function that produced the base result, so bound runs can never drift from the headline).
 * Returns null when no range is active. THROWS on an invalid triplet (P1-UI5-1): the caller gates with
 * rangeTripletValid, so a throw here is a programming error surfaced loudly, never silently repaired.
 */
export function computeRanges(
  state: AdvisorState,
  ranges: Partial<Record<RangeField, RangeBounds>>,
  base: StructuredRecommendationResult,
  buildWorkload: (s: AdvisorState) => CalcInputs,
  focusId?: string | null
): RangeComputation | null {
  const fields = RANGE_FIELDS.filter((f) => ranges[f]);
  if (fields.length === 0) return null;
  for (const f of fields) {
    if (!rangeTripletValid(f, state[f], ranges[f]!)) {
      throw new Error(`computeRanges: invalid ${f} triplet reached the recompute (caller must gate with rangeTripletValid)`);
    }
  }

  const run = (s: AdvisorState) => recommend({ workload: buildWorkload(s), optimizeFor: s.optimizeFor, experimentalProvenance: s.experimental });
  const allLowState = fields.reduce((s, f) => withValue(s, f, ranges[f]!.low), state);
  const allHighState = fields.reduce((s, f) => withValue(s, f, ranges[f]!.high), state);
  const lowR = run(allLowState);
  const highR = run(allHighState);

  const id = relevantId(base, focusId);
  const evalAt = (r: StructuredRecommendationResult) => (id ? (r.evaluations.find((e) => e.config.id === id) ?? null) : null);
  const baseEval = evalAt(base);
  const lowEval = evalAt(lowR);
  const highEval = evalAt(highR);

  // P1-UI5-3: a bound where the tracked candidate is not recommendation-eligible can NEVER present a
  // qualified fleet/cost band — the band fails closed and the eligibility is disclosed structurally.
  const trackedEligibility = id
    ? { low: lowEval?.recommendationEligible === true, high: highEval?.recommendationEligible === true }
    : null;
  const bothEligible = trackedEligibility ? trackedEligibility.low && trackedEligibility.high : false;

  const band: RangeComputation["band"] = {
    fleet: bothEligible ? metric(lowEval?.fleet.boxes, baseEval?.fleet.boxes, highEval?.fleet.boxes) : null,
    selfHost: bothEligible ? metric(lowEval?.cost.selfHostMonthly, baseEval?.cost.selfHostMonthly, highEval?.cost.selfHostMonthly) : null,
    api: metric(lowR.apiOption.monthlyCost, base.apiOption.monthlyCost, highR.apiOption.monthlyCost),
    decisionLow: lowR.decision.choice,
    decisionBase: base.decision.choice,
    decisionHigh: highR.decision.choice,
    sampledPointsAgree:
      lowR.decision.choice === base.decision.choice && highR.decision.choice === base.decision.choice,
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

  const boundAdjustments = [...newAdjustments("low", lowR, base), ...newAdjustments("high", highR, base)];
  return { fields, band, largestEffect, boundAdjustments, trackedEligibility };
}

// ---------------------------------------------------------------------------
// Shared wording (P1-UI5-2/3) — ONE copy source for the panel, the risks line and the export, so the
// sampled-scenario semantics and bound disclosures can never diverge between surfaces.
// ---------------------------------------------------------------------------

/** The decision-agreement sentence: exactly what was evaluated, never a stability claim (P1-UI5-2). */
export function decisionScenarioSentence(band: RangeComputation["band"]): string {
  return band.sampledPointsAgree
    ? `The decision is ${band.decisionBase} at the three evaluated scenarios: all-low, base and all-high. Intermediate values and combinations were not exhaustively evaluated.`
    : `The decision differs among the evaluated scenarios (all-low: ${band.decisionLow} · base: ${band.decisionBase} · all-high: ${band.decisionHigh}) — intermediate values were not evaluated; validate the real value before committing.`;
}

/** Bound-scenario disclosures (P1-UI5-3): engine reconciliations + tracked-candidate eligibility. */
export function rangeDisclosures(c: RangeComputation): string[] {
  const out: string[] = [];
  for (const a of c.boundAdjustments) {
    const label = ADJUSTMENT_FIELD_LABELS[a.field] ?? a.field;
    out.push(
      `${a.scenario === "low" ? "Low" : "High"} scenario: ${label} entered as ${fmt(a.entered)}; calculated as ${fmt(a.calculated)} by engine reconciliation — the band reflects the calculated value.`
    );
  }
  if (c.trackedEligibility && (!c.trackedEligibility.low || !c.trackedEligibility.high)) {
    const where =
      !c.trackedEligibility.low && !c.trackedEligibility.high
        ? "either bound"
        : !c.trackedEligibility.low
          ? "the low bound"
          : "the high bound";
    out.push(
      `The tracked self-host configuration is not recommendation-eligible at ${where}; its fleet and cost bands are unavailable (the bound amounts remain diagnostic audit output, never a qualified comparison).`
    );
  }
  return out;
}

const fmt = (v: number): string => new Intl.NumberFormat("en-US").format(v);
