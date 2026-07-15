// ============================================================================
// recommendation/schema — contracts for the Phase-1 headless recommendation
// layer (concern E). EXPERIMENTAL, additive. This layer COMPOSES the frozen
// rc-qa-11 engine (feasibility/sizing/cost + capacity.source evidence) and the
// approved benchmark registry (additive provenance only); it changes neither.
// See docs/ux-v2/phase1/DESIGN.md.
//
// Revised per the Phase-1 foundation review:
//  (1) API-vs-self-host is the TOP-LEVEL decision; the best self-host config is a
//      separate `bestSelfHost`, never the "overall recommendation" when API wins.
//  (2) technical feasibility, SLA, evidence and recommendation-eligibility are
//      DISTINCT fields — missing evidence is never technical infeasibility.
//  (3) engine / registry / effective confidence are represented separately, and
//      `effectiveConfidence` includes `unbenchmarked` (experimental demotion floor).
//  (4) the candidate catalog is pinned internally — callers supply only workload +
//      preference, never arbitrary evidence-bearing candidates.
//  (5) ranking is a complete deterministic total order (see DESIGN §5).
//  (6) evaluations carry the STRUCTURED fields the narrative consumes.
// ============================================================================
import type { CalcInputs } from "../types";

/** Customer optimization preference (Stage A). Orders the survivors of the hard gates. */
export type OptimizeFor = "cost" | "latency" | "confidence" | "predictability";

/** One point in the sweep — a PINNED supported-catalog record (not caller-supplied). Must resolve to an
 *  EXACT model (never a model-class) and a reviewed AWS instance (owner Q6). */
export interface CandidateConfig {
  /** Stable, deterministic canonical id: `${llmModelId}·${instanceType}·w${weightBits}kv${kvBits}`. */
  id: string;
  llmModelId: string;
  instanceType: string;
  weightBits: number; // 4 | 8 | 16
  kvBits: number; // 8 | 16
  label: string; // human label, e.g. "p6-b200 · INT4"
}

/** Engine evidence state — mapped 1:1 from the frozen `capacity.source`. `measured-scaled` is the
 *  engine's `extrapolated` WITH a real measured islScale (not a precision/model substitution). */
export type EngineConfidence = "measured" | "measured-scaled" | "extrapolated" | "proxy" | "heuristic";

/** EFFECTIVE evidence state after reconciliation. Adds `unbenchmarked` — the experimental demotion floor
 *  the pinned registry produces today (approval note: preserve `unbenchmarked`, never infer). */
export type EffectiveConfidence = EngineConfidence | "unbenchmarked";

/** Deterministic rank (higher = stronger evidence). Used by reconciliation and ranking (DESIGN §3, §5). */
export const CONFIDENCE_RANK: Record<EffectiveConfidence, number> = {
  measured: 5,
  "measured-scaled": 4,
  extrapolated: 3,
  proxy: 2,
  heuristic: 1,
  unbenchmarked: 0,
};

/** Structured rejection reason — the union from 17-quality-gate.md plus the evidence-gate code.
 *  Every rejection carries exactly one PRIMARY code (testable). Missing evidence is
 *  `evidence-below-threshold`, NEVER a technical-infeasibility code. */
export type ReasonCode =
  | "model-does-not-fit-serving-group"
  | "node-count-exceeds-topology"
  | "no-compatible-runtime-or-precision"
  | "sla-unmet-ttft-or-streaming"
  | "context-window-overflow"
  | "evidence-topology-mismatch"
  | "fleet-exceeds-practical-limit"
  | "no-usable-price"
  | "research-only-or-unavailable"
  | "evidence-below-threshold"; // proxy/heuristic/substituted/unbenchmarked → never a primary recommendation

export type Verdict = "api-wins" | "self-host-efficient" | "infeasible";

// ---------------------------------------------------------------------------
// (1) Top-level API-vs-self-host decision
// ---------------------------------------------------------------------------

export type DecisionChoice = "api" | "self-host" | "undetermined";

/** Why the decision went the way it did. `evidence-gap` = API chosen because NO self-host option is
 *  evidence-qualified; `self-host-infeasible` = no self-host option is even technically feasible;
 *  `sla` = the only self-host options miss the SLA; `lower-cost` = a trustworthy cost comparison;
 *  `customer-preference` = the optimization axis overrode a marginal cost delta. */
export type DecisionBasis = "lower-cost" | "evidence-gap" | "self-host-infeasible" | "sla" | "customer-preference";

export interface Decision {
  choice: DecisionChoice;
  basis: DecisionBasis;
  /** Deterministic template string assembled by the narrative generator from structured fields. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// (3) / (6) Structured per-candidate evidence + gate results
// ---------------------------------------------------------------------------

/** Additive registry provenance (experimental mode ONLY). NEVER promotes — it can only demote the
 *  effective confidence (approval note). Reason codes / transformations / headline are preserved for
 *  the narrative generator. */
export interface RegistryEvidence {
  status: "selected" | "unbenchmarked" | "invalid-request";
  /** The registry's ConfidenceCategory, or "unbenchmarked". */
  confidence: string;
  differsFromControl: boolean;
  reasons: Array<{ code: string; dimension: string; message: string }>;
  transformations?: Array<Record<string, unknown>>;
  headline?: string;
}

/** The reconciled fleet-sizing equation (fleet-explain precedent) — rendered verbatim by the narrative. */
export interface FleetReconciliation {
  boxes: number;
  bindingDim: "prefill" | "decode";
  equation: string;
}

export interface CostComparison {
  selfHostMonthly: number;
  apiMonthly: number;
  verdict: Verdict;
}

/** Per-candidate evaluation — the full audit record for one point in the sweep, and the structured
 *  input to the narrative generator (no prose is reverse-engineered). */
export interface CandidateEvaluation {
  config: CandidateConfig;

  // (2) DISTINCT gate results — never conflate "can't run" with "not enough evidence".
  technicallyFeasible: boolean; // engine crossover.feasible + context window + topology + usable price
  slaQualified: boolean; // P99 TTFT + streaming target + N+1 (capacity.*)
  evidenceQualified: boolean; // effectiveConfidence ∈ {measured, measured-scaled} on a real applicable benchmark
  recommendationEligible: boolean; // technicallyFeasible && slaQualified && evidenceQualified

  // (3) SEPARATE confidence representations.
  engineConfidence: EngineConfidence; // from frozen capacity.source
  registry?: RegistryEvidence; // present only in experimental mode
  effectiveConfidence: EffectiveConfidence; // reconciliation of engine + registry (control: = engine)

  // (6) structured explanation inputs.
  fleet: FleetReconciliation;
  cost: CostComparison;
  ttftS: number | null; // capacity.ttftS
  ttftPercentile: string | null; // capacity.ttftPercentile

  /** Empty ⇒ recommendation-eligible. The FIRST failing gate sets the primary code (index 0). */
  rejections: Array<{ code: ReasonCode; message: string }>;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** `best-self-host` = the best evidence-qualified self-host config (NOT the overall recommendation).
 *  Alternatives differ on exactly one axis. */
export type CardKind = "best-self-host" | "lowest-cost" | "highest-confidence" | "lowest-latency";

export interface Card {
  kind: CardKind;
  config: CandidateConfig;
  costMonthly: number;
  costDeltaVsBest: number; // 0 for the best-self-host card
  confidence: EffectiveConfidence;
  bindingConstraint: string; // plain-terms (narrative generator)
  tradeoff: string; // one line (narrative generator)
}

export interface Rejection {
  config: CandidateConfig;
  code: ReasonCode;
  message: string;
}

/** Comparison of the experimental pick against the frozen rc-qa-11 control (experimental mode only). */
export interface ControlComparison {
  differs: boolean;
  cause: "new-data" | "selection-rule" | "none";
}

/** The full recommendation output. `bestSelfHost === null` is an HONEST empty state — no
 *  evidence-qualified self-host config exists (never a fabricated primary). The OVERALL choice lives in
 *  `decision`, separate from the best self-host config. */
export interface RecommendationResult {
  caption: string; // "Recommended among currently modeled and evidence-qualified AWS configurations."
  decision: Decision; // (1) TOP-LEVEL api / self-host / undetermined
  bestSelfHost: Card | null; // (1) best EVIDENCE-QUALIFIED self-host config, or null
  alternatives: Card[]; // lowest-cost / highest-confidence / lowest-latency — only when a DISTINCT candidate id
  rejected: Rejection[]; // every excluded candidate, reason-coded
  evaluations: CandidateEvaluation[]; // full sweep (audit)
  mode: "control" | "experimental";
  controlComparison?: ControlComparison;
}

/** (4) The request carries ONLY the workload + preference. The curated candidate catalog is pinned and
 *  loaded internally by `recommend()` — callers cannot supply arbitrary evidence-bearing candidates
 *  (mirrors the benchmark registry's pinned-catalog trust boundary). Synthetic candidates are injected
 *  only through the internal/test path (DESIGN §4). */
export interface RecommendationRequest {
  /** The customer's workload — the SAME CalcInputs the frozen engine consumes. */
  workload: CalcInputs;
  optimizeFor: OptimizeFor;
  /** Default false → pure frozen-engine composition (the rollback state). True → additionally attach
   *  benchmark-registry provenance and demote effective confidence (never promote). */
  experimentalProvenance?: boolean;
}

export const RECOMMENDATION_CAPTION =
  "Recommended among currently modeled and evidence-qualified AWS configurations.";
