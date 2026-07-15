// ============================================================================
// change-diff — deterministic, reason-coded diff of two STRUCTURED recommendation
// results (DESIGN §6/§10.7-10.9). Compares StructuredRecommendationResult objects
// only — NEVER narrative prose. Pure: no Date/random, inputs are never mutated,
// ordering and serialization are deterministic, every before/after value is
// null-safe (no NaN/undefined, no invented explanations).
//
// COMPLETENESS CONTRACT (P1-DIFF-1/P1-DIFF-2):
// - Every field of StructuredRecommendationResult and CandidateEvaluation is
//   covered by a reason code, enforced at COMPILE TIME by `satisfies Record<keyof …,
//   ChangeCode>` maps — adding a schema field without a mapping breaks the build.
// - ONE recursive normalization policy is shared by equality AND emitted copies:
//   undefined object properties are OMITTED, undefined array entries become null,
//   non-finite numbers become null, object keys are sorted. Absent vs explicitly
//   undefined are therefore EQUAL everywhere.
// - `evaluations` order is NON-SEMANTIC: identity comparison sorts them by the
//   canonical candidate id (a pure reorder is identical:true). Duplicate candidate
//   ids FAIL CLOSED (throw) before any map is built.
// - No emitted change can carry canonically equal before/after payloads.
// - Defensive invariant: semantically unequal results ALWAYS produce ≥1 change —
//   a `result-changed` catch-all fires if no finer event was emitted. The diff can
//   never return identical:false with an empty change list.
// ============================================================================
import type {
  ApiOption, CandidateEvaluation, CostComparison, Decision, FleetReconciliation, PricingProvenance,
  RegistryEvidence, StructuredRecommendationResult,
} from "./schema";

export type ChangeCode =
  | "result-changed" // defensive catch-all — semantically unequal but no finer event (should not occur)
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
 *  stable candidate id. `before`/`after` are normalized structured values (deep-copied, never aliased,
 *  never canonically equal to each other). Added/removed candidates carry the FULL evaluation snapshot
 *  on the populated side (P2-DIFF-1). */
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
  "result-changed",
  "mode-changed", "decision-changed", "comparator-changed", "api-model-changed", "api-option-changed",
  "model-label-changed", "best-self-host-changed", "alternatives-changed", "control-comparison-changed",
  "effective-workload-changed", "adjustments-changed", "pricing-changed",
  "candidate-added", "candidate-removed",
  "candidate-config-changed", "gate-changed", "rejection-changed", "rejection-details-changed",
  "confidence-changed", "provenance-changed", "fleet-changed", "fleet-equation-changed",
  "latency-changed", "serving-facts-changed", "cost-changed",
];

// ---------------------------------------------------------------------------
// ONE shared recursive normalization (P1-DIFF-2): undefined object properties are
// OMITTED, undefined array entries → null, non-finite numbers → null, keys sorted.
// canonical() (equality) and copy() (emitted payloads) implement the SAME policy.
// ---------------------------------------------------------------------------
function canonical(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x === undefined ? null : x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Deep copy under the SAME normalization policy (JSON round-trip: drops undefined properties, turns
 *  undefined array entries and non-finite numbers into null). Never aliases an input object. */
function copy(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  if (typeof v !== "object") return v;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "number" && !Number.isFinite(val) ? null : val)));
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const byId = (a: CandidateEvaluation, b: CandidateEvaluation) => (a.config.id < b.config.id ? -1 : a.config.id > b.config.id ? 1 : 0);

/** Identity view: evaluations order is NON-SEMANTIC → compare with a sorted copy (inputs untouched). */
function identityView(r: StructuredRecommendationResult): StructuredRecommendationResult {
  return Array.isArray(r.evaluations) ? { ...r, evaluations: [...r.evaluations].sort(byId) } : r;
}

/** Duplicate candidate ids FAIL CLOSED — Map-keying would silently collapse them (P1-DIFF-2). */
function assertUniqueIds(r: StructuredRecommendationResult, which: string): void {
  if (!Array.isArray(r.evaluations)) return;
  const ids = r.evaluations.map((e) => e.config.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`change-diff: duplicate candidate id(s) in ${which}.evaluations: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// diffRecommendations
// ---------------------------------------------------------------------------
export function diffRecommendations(
  prev: StructuredRecommendationResult,
  next: StructuredRecommendationResult
): RecommendationDiff {
  assertUniqueIds(prev, "prev");
  assertUniqueIds(next, "next");

  const changes: RecommendationChange[] = [];
  /** Emit one change. Guard: NEVER emit a change whose normalized before/after are equal. */
  const add = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, field: string | null, before: unknown, after: unknown) => {
    if (same(before, after)) return;
    changes.push({ code, scope, candidateId, field, before: copy(before), after: copy(after) });
  };

  /** Compare one field; run the fine handler; if it emitted nothing, emit the coarse fallback so a
   *  differing field can NEVER pass silently. */
  const field = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, name: string, before: unknown, after: unknown, fine?: () => void) => {
    if (same(before, after)) return;
    const start = changes.length;
    fine?.();
    if (changes.length === start) add(code, scope, candidateId, name, before, after);
  };

  /** Generic composite diff: compare EVERY subkey (union of both sides) so a fine handler can never
   *  suppress an unrepresented change inside its composite field (P2-DIFF-2). Unknown/future keys fall
   *  back to `fallbackCode`. Only used when BOTH sides are plain objects; otherwise the caller's coarse
   *  fallback fires. */
  const diffSub = (
    b: unknown, a: unknown, map: Partial<Record<string, ChangeCode>>, fallbackCode: ChangeCode,
    prefix: string, scope: "result" | "candidate", candidateId: string | null, skip: ReadonlySet<string> = new Set()
  ) => {
    if (!isObj(b) || !isObj(a)) return; // caller's coarse fallback handles non-object shapes
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    for (const k of keys) {
      if (skip.has(k)) continue;
      add(map[k] ?? fallbackCode, scope, candidateId, `${prefix}.${k}`, b[k], a[k]);
    }
  };

  // ---- result-level: EVERY key of RESULT_FIELD_CODES ----
  for (const key of Object.keys(RESULT_FIELD_CODES) as Array<keyof StructuredRecommendationResult>) {
    if (key === "evaluations") continue; // handled per-candidate below
    const b = prev[key];
    const a = next[key];
    switch (key) {
      case "decision":
        field("decision-changed", "result", null, "decision", b, a, () => {
          if (!isObj(b) || !isObj(a)) return;
          if (prev.decision.choice !== next.decision.choice || prev.decision.basis !== next.decision.basis) {
            add("decision-changed", "result", null, "decision",
              { choice: prev.decision.choice, basis: prev.decision.basis },
              { choice: next.decision.choice, basis: next.decision.basis });
          }
          add("comparator-changed", "result", null, "decision.costComparator", prev.decision.costComparator ?? null, next.decision.costComparator ?? null);
          diffSub(b, a, DECISION_FIELD_CODES, "decision-changed", "decision", "result", null, new Set(["choice", "basis", "costComparator"]));
        });
        break;
      case "apiOption":
        field("api-option-changed", "result", null, "apiOption", b, a, () => {
          if (!isObj(b) || !isObj(a)) return;
          const p = prev.apiOption;
          const n = next.apiOption;
          if (p.modelId !== n.modelId) {
            add("api-model-changed", "result", null, "apiOption.modelId",
              { modelId: p.modelId, modelLabel: p.modelLabel }, { modelId: n.modelId, modelLabel: n.modelLabel });
          } else if (p.modelLabel !== n.modelLabel) {
            add("model-label-changed", "result", null, "apiOption.modelLabel", p.modelLabel, n.modelLabel);
          }
          diffSub(b, a, API_OPTION_FIELD_CODES, "api-option-changed", "apiOption", "result", null, new Set(["modelId", "modelLabel"]));
        });
        break;
      case "bestSelfHost":
        // Uniform semantics: ONE event carrying the FULL before/after cards (or null) — an id change
        // never suppresses the rest of the card's content.
        add("best-self-host-changed", "result", null, "bestSelfHost", b ?? null, a ?? null);
        break;
      case "pricing":
        field("pricing-changed", "result", null, "pricing", b, a, () => {
          diffSub(b, a, PRICING_FIELD_CODES, "pricing-changed", "pricing", "result", null);
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

  // ---- per-candidate (matched by stable config.id; order non-semantic) ----
  const prevById = new Map((Array.isArray(prev.evaluations) ? prev.evaluations : []).map((e) => [e.config.id, e]));
  const nextById = new Map((Array.isArray(next.evaluations) ? next.evaluations : []).map((e) => [e.config.id, e]));
  const allIds = [...new Set([...prevById.keys(), ...nextById.keys()])].sort();

  for (const id of allIds) {
    const p = prevById.get(id);
    const n = nextById.get(id);
    // P2-DIFF-1: added/removed events carry the FULL evaluation snapshot on the populated side.
    if (p && !n) { add("candidate-removed", "candidate", id, null, p, null); continue; }
    if (!p && n) { add("candidate-added", "candidate", id, null, null, n); continue; }
    diffCandidate(p!, n!, add, field, diffSub);
  }

  // Deterministic total order: result-level (candidateId "") → candidate id → code order → field.
  changes.sort((x, y) => {
    const cx = x.candidateId ?? "";
    const cy = y.candidateId ?? "";
    if (cx !== cy) return cx < cy ? -1 : 1;
    const ox = CODE_ORDER.indexOf(x.code);
    const oy = CODE_ORDER.indexOf(y.code);
    if (ox !== oy) return ox - oy;
    const fx = x.field ?? "";
    const fy = y.field ?? "";
    return fx < fy ? -1 : fx > fy ? 1 : 0;
  });

  // identical = canonical equality of the COMPLETE results under the shared normalization, with the
  // non-semantic evaluations order normalized (P1-DIFF-2).
  const identical = same(identityView(prev), identityView(next));

  // Defensive invariant: semantically unequal results must NEVER yield an empty change list.
  if (!identical && changes.length === 0) {
    changes.push({ code: "result-changed", scope: "result", candidateId: null, field: null, before: copy(prev), after: copy(next) });
  }

  return { identical, changes };
}

type AddFn = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, field: string | null, before: unknown, after: unknown) => void;
type FieldFn = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, name: string, before: unknown, after: unknown, fine?: () => void) => void;
type DiffSubFn = (b: unknown, a: unknown, map: Partial<Record<string, ChangeCode>>, fallbackCode: ChangeCode, prefix: string, scope: "result" | "candidate", candidateId: string | null, skip?: ReadonlySet<string>) => void;

function diffCandidate(p: CandidateEvaluation, n: CandidateEvaluation, add: AddFn, field: FieldFn, diffSub: DiffSubFn): void {
  const id = p.config.id;

  for (const key of Object.keys(CANDIDATE_FIELD_CODES) as Array<keyof CandidateEvaluation>) {
    const b = p[key];
    const a = n[key];
    switch (key) {
      case "fleet":
        field("fleet-changed", "candidate", id, "fleet", b, a, () => {
          diffSub(b, a, FLEET_FIELD_CODES, "fleet-changed", "fleet", "candidate", id);
        });
        break;
      case "cost":
        field("cost-changed", "candidate", id, "cost", b, a, () => {
          diffSub(b, a, COST_FIELD_CODES, "cost-changed", "cost", "candidate", id);
        });
        break;
      case "registry":
        field("provenance-changed", "candidate", id, "registry", b, a, () => {
          // absent side treated as {} so per-subfield events still fire on introduce/remove.
          const bo = isObj(b) ? b : b == null ? {} : null;
          const ao = isObj(a) ? a : a == null ? {} : null;
          if (bo === null || ao === null) return; // garbage shape → coarse fallback
          diffSub(bo, ao, REGISTRY_FIELD_CODES, "provenance-changed", "registry", "candidate", id);
        });
        break;
      case "rejections":
        // P2-DIFF-2: the primary code transition AND the complete details are BOTH preserved — a fine
        // event never suppresses the rest of the composite. rejection-details-changed accompanies ANY
        // rejections difference (including code-only, where the code is part of the details).
        if (!same(b, a)) {
          const pc = Array.isArray(b) ? (b[0] as { code?: string } | undefined)?.code ?? null : null;
          const nc = Array.isArray(a) ? (a[0] as { code?: string } | undefined)?.code ?? null : null;
          if (pc !== nc) add("rejection-changed", "candidate", id, "rejections[0].code", pc, nc);
          add("rejection-details-changed", "candidate", id, "rejections", b, a);
        }
        break;
      default:
        // config / gates / engineConfidence / effectiveConfidence / servingFacts / ttftS /
        // ttftPercentile — one coded change with the field name and full before/after.
        field(CANDIDATE_FIELD_CODES[key], "candidate", id, key, b, a);
    }
  }
}
