// ============================================================================
// change-diff — deterministic, reason-coded diff of two STRUCTURED recommendation
// results (DESIGN §6/§10.7-10.8). Compares StructuredRecommendationResult objects
// only — NEVER narrative prose. Pure: no Date/random, inputs are never mutated,
// ordering and serialization are deterministic, every before/after value is
// null-safe (no NaN/undefined, no invented explanations).
//
// COMPLETENESS CONTRACT (P1-DIFF-1): every field of StructuredRecommendationResult
// and CandidateEvaluation is covered by a reason code, enforced at COMPILE TIME by
// `satisfies Record<keyof …, ChangeCode>` coverage maps — adding a schema field
// without mapping it breaks the build. At runtime, each field is compared by
// canonical (sorted-key) equality; when a field differs and its fine-grained
// handler emits nothing, a coarse change with the field's mapped code and the FULL
// deep-copied before/after is emitted — so a JSON-unequal result can never produce
// an empty diff. `identical` is the canonical equality of the COMPLETE results,
// not "no observers fired".
// ============================================================================
import type {
  ApiOption, CandidateEvaluation, CostComparison, Decision, FleetReconciliation, PricingProvenance,
  RegistryEvidence, StructuredRecommendationResult,
} from "./schema";

export type ChangeCode =
  | "mode-changed"
  | "decision-changed"
  | "comparator-changed"
  | "api-model-changed"
  | "api-option-changed"
  | "model-label-changed"
  | "best-self-host-changed"
  | "alternatives-changed"
  | "rejection-details-changed"
  | "control-comparison-changed"
  | "effective-workload-changed"
  | "adjustments-changed"
  | "pricing-changed"
  | "candidate-added"
  | "candidate-removed"
  | "candidate-config-changed"
  | "gate-changed"
  | "rejection-changed"
  | "confidence-changed"
  | "provenance-changed"
  | "fleet-changed"
  | "fleet-equation-changed"
  | "latency-changed"
  | "serving-facts-changed"
  | "cost-changed";

/** One coded change. Result-level changes carry candidateId=null; per-candidate changes carry the
 *  stable candidate id. `before`/`after` are structured values (deep-copied, never aliased), with
 *  `null` for absent — never undefined/NaN. Added/removed candidates carry the FULL evaluation
 *  snapshot on the populated side (P2-DIFF-1). */
export interface RecommendationChange {
  code: ChangeCode;
  scope: "result" | "candidate";
  candidateId: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
}

export interface RecommendationDiff {
  identical: boolean;
  changes: RecommendationChange[];
}

// ---------------------------------------------------------------------------
// Compile-time completeness maps (P1-DIFF-1 guard). Every key of the contract
// MUST appear here — a new schema field without a mapping fails typecheck.
// ---------------------------------------------------------------------------
const RESULT_FIELD_CODES = {
  decision: "decision-changed",
  apiOption: "api-option-changed",
  bestSelfHost: "best-self-host-changed",
  alternatives: "alternatives-changed",
  rejected: "rejection-details-changed",
  evaluations: "candidate-added", // handled per-candidate (added/removed/field diffs)
  mode: "mode-changed",
  controlComparison: "control-comparison-changed",
  selfHostModelLabel: "model-label-changed",
  effectiveWorkload: "effective-workload-changed",
  inputAdjustments: "adjustments-changed",
  pricing: "pricing-changed",
} as const satisfies Record<keyof StructuredRecommendationResult, ChangeCode>;

const CANDIDATE_FIELD_CODES = {
  config: "candidate-config-changed",
  technicallyFeasible: "gate-changed",
  slaQualified: "gate-changed",
  evidenceQualified: "gate-changed",
  priceQualified: "gate-changed",
  comparisonQualified: "gate-changed",
  recommendationEligible: "gate-changed",
  engineConfidence: "confidence-changed",
  registry: "provenance-changed",
  effectiveConfidence: "confidence-changed",
  fleet: "fleet-changed",
  cost: "cost-changed",
  servingFacts: "serving-facts-changed",
  ttftS: "latency-changed",
  ttftPercentile: "latency-changed",
  rejections: "rejection-details-changed",
} as const satisfies Record<keyof CandidateEvaluation, ChangeCode>;

const DECISION_FIELD_CODES = {
  choice: "decision-changed",
  basis: "decision-changed",
  costComparator: "comparator-changed",
} as const satisfies Record<keyof Decision, ChangeCode>;
void DECISION_FIELD_CODES;

const API_OPTION_FIELD_CODES = {
  modelId: "api-model-changed",
  modelLabel: "model-label-changed",
  monthlyCost: "cost-changed",
  priceState: "api-option-changed",
  comparisonQualified: "api-option-changed",
} as const satisfies Record<keyof ApiOption, ChangeCode>;

const PRICING_FIELD_CODES = {
  source: "pricing-changed",
  asOf: "pricing-changed",
  region: "pricing-changed",
  gpuPriceSource: "pricing-changed",
} as const satisfies Record<keyof PricingProvenance, ChangeCode>;

const FLEET_FIELD_CODES = {
  boxes: "fleet-changed",
  bindingDim: "fleet-changed",
  equation: "fleet-equation-changed",
} as const satisfies Record<keyof FleetReconciliation, ChangeCode>;

const COST_FIELD_CODES = {
  selfHostMonthly: "cost-changed",
  apiMonthly: "cost-changed",
  verdict: "cost-changed",
} as const satisfies Record<keyof CostComparison, ChangeCode>;

const REGISTRY_FIELD_CODES = {
  status: "confidence-changed",
  confidence: "confidence-changed",
  differsFromControl: "provenance-changed",
  reasons: "provenance-changed",
  transformations: "provenance-changed",
  provenance: "provenance-changed",
} as const satisfies Record<keyof RegistryEvidence, ChangeCode>;

// Deterministic presentation order (result-level first, then per-candidate groups).
const CODE_ORDER: ChangeCode[] = [
  "mode-changed", "decision-changed", "comparator-changed", "api-model-changed", "api-option-changed",
  "model-label-changed", "best-self-host-changed", "alternatives-changed", "control-comparison-changed",
  "effective-workload-changed", "adjustments-changed", "pricing-changed",
  "candidate-added", "candidate-removed",
  "candidate-config-changed", "gate-changed", "rejection-changed", "rejection-details-changed",
  "confidence-changed", "provenance-changed", "fleet-changed", "fleet-equation-changed",
  "latency-changed", "serving-facts-changed", "cost-changed",
];

// ---------------------------------------------------------------------------
// Null-safe canonical equality + deep copies
// ---------------------------------------------------------------------------
/** undefined → null; non-finite numbers → null (never emit NaN). */
function norm(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}
/** Canonical (sorted-key) serialization — key-order independent, deterministic. */
function canonical(v: unknown): string {
  const n = norm(v);
  if (n === null || typeof n !== "object") return JSON.stringify(n);
  if (Array.isArray(n)) return `[${n.map(canonical).join(",")}]`;
  const o = n as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Deep copy so a change record never aliases (or can mutate) an input object. */
function copy(v: unknown): unknown {
  const n = norm(v);
  return n === null || typeof n !== "object" ? n : JSON.parse(JSON.stringify(n));
}

// ---------------------------------------------------------------------------
// diffRecommendations
// ---------------------------------------------------------------------------
export function diffRecommendations(
  prev: StructuredRecommendationResult,
  next: StructuredRecommendationResult
): RecommendationDiff {
  const changes: RecommendationChange[] = [];
  const add = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, field: string | null, before: unknown, after: unknown) =>
    changes.push({ code, scope, candidateId, field, before: copy(before), after: copy(after) });

  /** Compare one field; run the fine handler; if it emitted nothing, emit the coarse fallback so a
   *  differing field can NEVER pass silently. */
  const field = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, name: string, before: unknown, after: unknown, fine?: () => void) => {
    if (same(before, after)) return;
    const start = changes.length;
    fine?.();
    if (changes.length === start) add(code, scope, candidateId, name, before, after);
  };

  // ---- result-level: EVERY key of RESULT_FIELD_CODES ----
  for (const key of Object.keys(RESULT_FIELD_CODES) as Array<keyof StructuredRecommendationResult>) {
    if (key === "evaluations") continue; // handled per-candidate below
    const b = prev[key];
    const a = next[key];
    switch (key) {
      case "decision":
        field("decision-changed", "result", null, "decision", b, a, () => {
          if (prev.decision.choice !== next.decision.choice || prev.decision.basis !== next.decision.basis) {
            add("decision-changed", "result", null, "decision",
              { choice: prev.decision.choice, basis: prev.decision.basis },
              { choice: next.decision.choice, basis: next.decision.basis });
          }
          if (!same(prev.decision.costComparator ?? null, next.decision.costComparator ?? null)) {
            add("comparator-changed", "result", null, "decision.costComparator", prev.decision.costComparator ?? null, next.decision.costComparator ?? null);
          }
        });
        break;
      case "apiOption":
        field("api-option-changed", "result", null, "apiOption", b, a, () => {
          const p = prev.apiOption;
          const n = next.apiOption;
          if (p.modelId !== n.modelId) {
            add("api-model-changed", "result", null, "apiOption.modelId",
              { modelId: p.modelId, modelLabel: p.modelLabel }, { modelId: n.modelId, modelLabel: n.modelLabel });
          } else if (p.modelLabel !== n.modelLabel) {
            add("model-label-changed", "result", null, "apiOption.modelLabel", p.modelLabel, n.modelLabel);
          }
          if (norm(p.monthlyCost) !== norm(n.monthlyCost)) add(API_OPTION_FIELD_CODES.monthlyCost, "result", null, "apiOption.monthlyCost", p.monthlyCost, n.monthlyCost);
          if (p.priceState !== n.priceState) add(API_OPTION_FIELD_CODES.priceState, "result", null, "apiOption.priceState", p.priceState, n.priceState);
          if (p.comparisonQualified !== n.comparisonQualified) add(API_OPTION_FIELD_CODES.comparisonQualified, "result", null, "apiOption.comparisonQualified", p.comparisonQualified, n.comparisonQualified);
        });
        break;
      case "bestSelfHost":
        field("best-self-host-changed", "result", null, "bestSelfHost", b, a, () => {
          // Fully-guarded id access: a malformed/absent card must fall through to the coarse
          // full-before/after fallback, never throw.
          const pid = prev.bestSelfHost?.config?.id ?? null;
          const nid = next.bestSelfHost?.config?.id ?? null;
          if (pid !== nid) add("best-self-host-changed", "result", null, "bestSelfHost", pid, nid);
          // same id but a changed card → coarse fallback fires (full cards) via the wrapper.
        });
        break;
      case "pricing":
        field("pricing-changed", "result", null, "pricing", b, a, () => {
          for (const k of Object.keys(PRICING_FIELD_CODES) as Array<keyof PricingProvenance>) {
            if (prev.pricing[k] !== next.pricing[k]) add("pricing-changed", "result", null, `pricing.${k}`, prev.pricing[k], next.pricing[k]);
          }
        });
        break;
      case "rejected":
        field("rejection-details-changed", "result", null, "rejected", b, a);
        break;
      default:
        // mode / controlComparison / selfHostModelLabel / effectiveWorkload / inputAdjustments /
        // alternatives — coarse, full before/after.
        field(RESULT_FIELD_CODES[key], "result", null, key, b, a);
    }
  }

  // ---- per-candidate (matched by stable config.id) ----
  const prevById = new Map(prev.evaluations.map((e) => [e.config.id, e]));
  const nextById = new Map(next.evaluations.map((e) => [e.config.id, e]));
  const allIds = [...new Set([...prevById.keys(), ...nextById.keys()])].sort();

  for (const id of allIds) {
    const p = prevById.get(id);
    const n = nextById.get(id);
    // P2-DIFF-1: added/removed events carry the FULL evaluation snapshot on the populated side.
    if (p && !n) { add("candidate-removed", "candidate", id, null, p, null); continue; }
    if (!p && n) { add("candidate-added", "candidate", id, null, null, n); continue; }
    diffCandidate(p!, n!, field);
  }

  // Deterministic total order: result-level (candidateId "" ) → candidate id → code order → field.
  changes.sort((a, b) => {
    const ca = a.candidateId ?? "";
    const cb = b.candidateId ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    const oa = CODE_ORDER.indexOf(a.code);
    const ob = CODE_ORDER.indexOf(b.code);
    if (oa !== ob) return oa - ob;
    const fa = a.field ?? "";
    const fb = b.field ?? "";
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  // identical = canonical equality of the COMPLETE results (P1-DIFF-1) — never merely "no observers".
  return { identical: same(prev, next), changes };
}

function diffCandidate(
  p: CandidateEvaluation,
  n: CandidateEvaluation,
  field: (code: ChangeCode, scope: "candidate", candidateId: string, name: string, before: unknown, after: unknown, fine?: () => void) => void
): void {
  const id = p.config.id;

  for (const key of Object.keys(CANDIDATE_FIELD_CODES) as Array<keyof CandidateEvaluation>) {
    const b = p[key];
    const a = n[key];
    switch (key) {
      case "fleet":
        field("fleet-changed", "candidate", id, "fleet", b, a, () => {
          for (const k of Object.keys(FLEET_FIELD_CODES) as Array<keyof FleetReconciliation>) {
            if (p.fleet[k] !== n.fleet[k]) field(FLEET_FIELD_CODES[k], "candidate", id, `fleet.${k}`, p.fleet[k], n.fleet[k]);
          }
        });
        break;
      case "cost":
        field("cost-changed", "candidate", id, "cost", b, a, () => {
          for (const k of Object.keys(COST_FIELD_CODES) as Array<keyof CostComparison>) {
            if (norm(p.cost[k]) !== norm(n.cost[k])) field("cost-changed", "candidate", id, `cost.${k}`, p.cost[k], n.cost[k]);
          }
        });
        break;
      case "registry":
        field("provenance-changed", "candidate", id, "registry", b, a, () => {
          for (const k of Object.keys(REGISTRY_FIELD_CODES) as Array<keyof RegistryEvidence>) {
            field(REGISTRY_FIELD_CODES[k], "candidate", id, `registry.${k}`, p.registry?.[k] ?? null, n.registry?.[k] ?? null);
          }
        });
        break;
      case "rejections":
        field("rejection-details-changed", "candidate", id, "rejections", b, a, () => {
          const pc = p.rejections[0]?.code ?? null;
          const nc = n.rejections[0]?.code ?? null;
          if (pc !== nc) field("rejection-changed", "candidate", id, "rejections[0].code", pc, nc);
          // message-only / secondary changes → coarse rejection-details-changed via the wrapper.
        });
        break;
      default:
        // config / gates / engineConfidence / effectiveConfidence / servingFacts / ttftS /
        // ttftPercentile — one coded change with the field name and full before/after.
        field(CANDIDATE_FIELD_CODES[key], "candidate", id, key, b, a);
    }
  }
}
