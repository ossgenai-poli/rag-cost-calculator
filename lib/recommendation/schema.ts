// ============================================================================
// recommendation/schema — contracts for the Phase-1 headless recommendation
// layer (concern E). EXPERIMENTAL, additive. Composes the frozen rc-qa-11 engine
// (feasibility/sizing/cost + capacity.source evidence) and the approved benchmark
// registry (additive provenance only); changes neither. See docs/ux-v2/phase1/DESIGN.md.
//
// rev-2 (final contract cleanup):
//  1. deterministic decision precedence + `comparison-unavailable` basis; `customer-preference`
//     removed from the top-level derivation.
//  2. missing price is NOT technical infeasibility — `priceQualified`/`comparisonQualified` are
//     separate; costs are `number | null` (no $0 sentinel).
//  3. `optimizeFor` ranks self-host candidates ONLY; the API option is represented STRUCTURALLY
//     (`apiOption`); the sweep varies only infra/precision of the workload's EXACT model.
//  4. registry provenance uses the registry's EXPORTED safe types (via the registry's public index).
//  5. `recommend()` returns STRUCTURED facts only; `narrate()` renders prose (separate result types).
// ============================================================================
import type { CalcInputs } from "../types";
// Safe registry types — imported through the registry's public index ONLY (never a deep path).
import type { SelectionResult, ConfidenceCategory, Reason, Transformation, ProvenanceView } from "../benchmark-registry";

/** Customer optimization preference (Stage A). Orders the EVIDENCE-QUALIFIED SELF-HOST candidates only —
 *  it never flips the top-level API/self-host decision (there are no comparable API latency/confidence
 *  metrics in Phase 1; see DESIGN §4.2). */
export type OptimizeFor = "cost" | "latency" | "confidence" | "predictability";

/** One point in the sweep — a PINNED, curated supported-catalog record (not caller-supplied). Resolves to
 *  an EXACT model + a reviewed AWS instance + its curated accelerator SKU (owner Q6). */
export interface CandidateConfig {
  /** Stable, deterministic canonical id: `${llmModelId}·${instanceType}·w${weightBits}kv${kvBits}`. */
  id: string;
  llmModelId: string;
  instanceType: string;
  gpuSku: string; // curated reviewed accelerator (e.g. "B200") — used to build the registry request
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

/** Deterministic rank (higher = stronger). Used by reconciliation (§3.1) and ranking (§4.1). */
export const CONFIDENCE_RANK: Record<EffectiveConfidence, number> = {
  measured: 5,
  "measured-scaled": 4,
  extrapolated: 3,
  proxy: 2,
  heuristic: 1,
  unbenchmarked: 0,
};

/** Structured rejection reason — the union from 17-quality-gate.md plus the evidence-gate code.
 *  Missing evidence is `evidence-below-threshold`, NEVER a technical-infeasibility code. Missing PRICE is
 *  not a rejection reason at all (it affects the decision, not eligibility — rev-2 #2). */
export type ReasonCode =
  | "model-does-not-fit-serving-group"
  | "node-count-exceeds-topology"
  | "no-compatible-runtime-or-precision"
  | "sla-unmet-ttft-or-streaming"
  | "context-window-overflow"
  | "evidence-topology-mismatch"
  | "fleet-exceeds-practical-limit"
  | "evidence-below-threshold"; // proxy/heuristic/substituted/unbenchmarked → never a primary recommendation

/** Per-candidate self-host-vs-API verdict. `undetermined` when a price is missing on either side. */
export type Verdict = "api-wins" | "self-host-efficient" | "infeasible" | "undetermined";

// ---------------------------------------------------------------------------
// (1) Top-level API-vs-self-host decision — deterministic precedence (DESIGN §4.2)
// ---------------------------------------------------------------------------

export type DecisionChoice = "api" | "self-host" | "undetermined";

/** Deterministic precedence (first match wins):
 *  self-host-infeasible → sla → evidence-gap → comparison-unavailable → lower-cost. */
export type DecisionBasis =
  | "self-host-infeasible" // no technically feasible self-host candidate
  | "sla" // feasible exist but none satisfy the SLA
  | "evidence-gap" // SLA-qualified exist but none are evidence-qualified
  | "comparison-unavailable" // evidence-qualified exists but a trustworthy cost comparison is unavailable
  | "lower-cost"; // a trustworthy cost comparison decided it

/** Structured facts only — NO prose (narrate() adds the rationale). */
export interface Decision {
  choice: DecisionChoice;
  basis: DecisionBasis;
}

/** The API delivery option, represented structurally (rev-2 #3) — not just a rationale string. */
export interface ApiOption {
  modelId: string;
  monthlyCost: number | null; // null ⇒ no usable API price (never a $0 sentinel)
  priceState: "priced" | "no-price";
  comparisonQualified: boolean; // an API price exists to compare a self-host option against
}

// ---------------------------------------------------------------------------
// (4) Registry provenance — the registry's EXPORTED safe types
// ---------------------------------------------------------------------------

/** Additive registry provenance (experimental mode ONLY). NEVER promotes; can only demote the effective
 *  confidence (approval note). Uses the registry's exported contracts verbatim so the trust panel and the
 *  narrative keep full fidelity (status, category, reasons, transformations, provenance identifiers). */
export interface RegistryEvidence {
  status: SelectionResult["status"];
  confidence: ConfidenceCategory | "unbenchmarked";
  differsFromControl: boolean;
  reasons: Reason[];
  transformations?: Transformation[];
  provenance?: ProvenanceView;
}

// ---------------------------------------------------------------------------
// (2)/(6) Structured per-candidate evaluation
// ---------------------------------------------------------------------------

/** The reconciled fleet-sizing equation (fleet-explain precedent) — rendered verbatim by narrate(). */
export interface FleetReconciliation {
  boxes: number;
  bindingDim: "prefill" | "decode";
  equation: string;
}

/** Self-host vs API cost — both nullable (rev-2 #2), no $0 sentinel. */
export interface CostComparison {
  selfHostMonthly: number | null;
  apiMonthly: number | null;
  verdict: Verdict;
}

/** Per-candidate evaluation — the full audit record and the STRUCTURED input to narrate(). */
export interface CandidateEvaluation {
  config: CandidateConfig;

  // (2) DISTINCT gate results — technical feasibility EXCLUDES price (rev-2 #2).
  technicallyFeasible: boolean; // model fit + topology + context + runtime/precision + practical fleet limit
  slaQualified: boolean; // P99 TTFT + streaming target + N+1
  evidenceQualified: boolean; // effectiveConfidence ∈ {measured, measured-scaled} on a real applicable benchmark
  priceQualified: boolean; // a usable self-host price exists
  comparisonQualified: boolean; // priceQualified AND an API price exists to compare against
  recommendationEligible: boolean; // technicallyFeasible && slaQualified && evidenceQualified

  // (3) SEPARATE confidence representations.
  engineConfidence: EngineConfidence; // frozen capacity.source
  registry?: RegistryEvidence; // experimental mode only
  effectiveConfidence: EffectiveConfidence; // reconciliation of engine + registry (control: = engine)

  // (6) structured explanation inputs.
  fleet: FleetReconciliation;
  cost: CostComparison;
  ttftS: number | null;
  ttftPercentile: string | null;

  /** Empty ⇒ recommendation-eligible. The FIRST failing gate sets the primary code (index 0). */
  rejections: Array<{ code: ReasonCode; message: string }>;
}

// ---------------------------------------------------------------------------
// (5) Presentation — STRUCTURED (recommend) vs NARRATED (narrate)
// ---------------------------------------------------------------------------

/** `best-self-host` = the best evidence-qualified self-host config (NOT the overall recommendation). */
export type CardKind = "best-self-host" | "lowest-cost" | "highest-confidence" | "lowest-latency";

/** Structured card — NO prose. */
export interface Card {
  kind: CardKind;
  config: CandidateConfig;
  costMonthly: number | null;
  costDeltaVsBest: number | null; // 0 for the best-self-host card; null when either side has no price
  confidence: EffectiveConfidence;
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

/** STRUCTURED recommendation output from recommend() — facts only, no prose (rev-2 #5).
 *  `bestSelfHost === null` is an HONEST empty state. The overall answer is `decision`. */
export interface StructuredRecommendationResult {
  decision: Decision;
  apiOption: ApiOption;
  bestSelfHost: Card | null;
  alternatives: Card[]; // lowest-cost / highest-confidence / lowest-latency — only a DISTINCT candidate id
  rejected: Rejection[];
  evaluations: CandidateEvaluation[];
  mode: "control" | "experimental";
  controlComparison?: ControlComparison;
}

/** The request carries ONLY workload + preference (rev-2 #3). The curated candidate catalog is pinned and
 *  loaded internally, then FILTERED to the workload's EXACT model (no cross-model recommendations in
 *  Phase 1 — that needs a separate quality-equivalence contract). */
export interface RecommendationRequest {
  workload: CalcInputs;
  optimizeFor: OptimizeFor;
  /** Default false → pure frozen-engine composition (rollback state). True → attach registry provenance
   *  and DEMOTE effective confidence (never promote). */
  experimentalProvenance?: boolean;
}

// ---------------------------------------------------------------------------
// Narrated layer — narrate(structured) → NarratedRecommendationResult
// ---------------------------------------------------------------------------

export interface NarratedDecision extends Decision {
  rationale: string;
}
export interface NarratedCard extends Card {
  bindingConstraint: string;
  tradeoff: string;
}
export interface NarratedRecommendationResult {
  caption: string;
  decision: NarratedDecision;
  apiOption: ApiOption;
  bestSelfHost: NarratedCard | null;
  alternatives: NarratedCard[];
  rejected: Rejection[];
  evaluations: CandidateEvaluation[];
  mode: "control" | "experimental";
  controlComparison?: ControlComparison;
}

export const RECOMMENDATION_CAPTION =
  "Recommended among currently modeled and evidence-qualified AWS configurations.";
