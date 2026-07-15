// ============================================================================
// recommendation/schema — contracts for the Phase-1 headless recommendation
// layer (concern E). EXPERIMENTAL, additive. This layer COMPOSES the frozen
// rc-qa-11 engine (feasibility/sizing/cost + capacity.source evidence) and the
// approved benchmark registry (additive provenance only); it changes neither.
// See docs/ux-v2/phase1/DESIGN.md.
// ============================================================================
import type { CalcInputs } from "../types";

/** Customer optimization preference (Stage A). Orders the survivors of the hard gates. */
export type OptimizeFor = "cost" | "latency" | "confidence" | "predictability";

/** One point in the sweep — a supported-catalog record. Must resolve to an EXACT model
 *  (never a model-class) and a concrete AWS instance (owner Q6). */
export interface CandidateConfig {
  /** Stable, deterministic id: `${llmModelId}·${instanceType}·w${weightBits}kv${kvBits}`. */
  id: string;
  llmModelId: string;
  instanceType: string;
  weightBits: number; // 4 | 8 | 16
  kvBits: number; // 8 | 16
  label: string; // human label, e.g. "p6-b200 · INT4"
}

/** Evidence confidence — mapped 1:1 from the frozen `capacity.source` (+ substitution reasons).
 *  `measured-scaled` is the engine's `extrapolated` with a REAL measured islScale (not a substitution). */
export type Confidence = "measured" | "measured-scaled" | "extrapolated" | "proxy" | "heuristic";

/** Structured rejection reason — the union from 17-quality-gate.md plus the evidence-gate codes.
 *  Every rejection carries exactly one PRIMARY code (testable). */
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
  | "evidence-below-threshold"; // proxy/heuristic/substituted → never a primary recommendation

export type Verdict = "api-wins" | "self-host-efficient" | "infeasible";

/** Additive cross-source provenance from the approved benchmark registry. Present ONLY when
 *  `experimentalProvenance` is enabled. NEVER overrides the frozen evidence gate — it can demote
 *  confidence or add a caveat, never promote (approval note: preserve `unbenchmarked`). */
export interface ExperimentalProvenance {
  /** The registry's status for this candidate ('selected' | 'unbenchmarked' | 'invalid-request'). */
  registryStatus: string;
  registryConfidence: string;
  /** True when the registry pick differs from the frozen control operating point. */
  differsFromControl: boolean;
  headline?: string;
}

/** Per-candidate evaluation — the full audit record for one point in the sweep. */
export interface CandidateEvaluation {
  config: CandidateConfig;
  feasible: boolean; // crossover.feasible AND all hard gates pass
  confidence: Confidence;
  evidenceQualified: boolean; // confidence ∈ {measured, measured-scaled} on a real applicable benchmark
  fleetBoxes: number; // crossover.boxes (incl. N+1)
  bindingDim: "prefill" | "decode";
  selfHostMonthly: number; // crossover.selfHostedMonthly$
  apiMonthly: number; // API generation $/mo for the same workload
  verdict: Verdict;
  ttftS: number | null; // capacity.ttftS
  ttftPercentile: string | null; // capacity.ttftPercentile
  /** Empty ⇒ passed every gate. The first failing gate sets the primary code (index 0). */
  rejections: Array<{ code: ReasonCode; message: string }>;
  provenance?: ExperimentalProvenance;
}

export type CardKind = "recommended-balanced" | "lowest-cost" | "highest-confidence" | "lowest-latency";

/** A presented option (06-recommendation-presentation.md). */
export interface Card {
  kind: CardKind;
  config: CandidateConfig;
  costMonthly: number;
  costDeltaVsRecommended: number; // 0 for the primary
  confidence: Confidence;
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

/** The full recommendation output. `recommended === null` is an HONEST empty state — no
 *  evidence-qualified option exists (never a fabricated primary). */
export interface RecommendationResult {
  caption: string; // "Recommended among currently modeled and evidence-qualified AWS configurations."
  recommended: Card | null;
  alternatives: Card[]; // lowest-cost / highest-confidence / lowest-latency, only when DISTINCT
  rejected: Rejection[]; // every excluded candidate, reason-coded
  evaluations: CandidateEvaluation[]; // full sweep (audit)
  controlComparison?: ControlComparison;
}

/** The request: a base workload + preference + the curated candidate set to sweep. */
export interface RecommendationRequest {
  /** The customer's workload — the SAME CalcInputs the frozen engine consumes. */
  workload: CalcInputs;
  optimizeFor: OptimizeFor;
  /** Curated supported-catalog candidates (no auto-expansion in v1 — see DESIGN §9). */
  candidates: CandidateConfig[];
  /** Default false → pure frozen-engine composition (the rollback state). True → additionally attach
   *  benchmark-registry provenance + control comparison (never overriding the frozen evidence gate). */
  experimentalProvenance?: boolean;
}

export const RECOMMENDATION_CAPTION =
  "Recommended among currently modeled and evidence-qualified AWS configurations.";
