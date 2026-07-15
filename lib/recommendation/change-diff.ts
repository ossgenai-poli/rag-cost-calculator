// ============================================================================
// change-diff — deterministic, reason-coded diff of two STRUCTURED recommendation
// results (DESIGN §6). Compares StructuredRecommendationResult objects only —
// NEVER narrative prose. Pure: no Date/random, inputs are never mutated, identical
// inputs produce an empty diff, ordering and serialized output are deterministic,
// and every before/after value is null-safe (no NaN/undefined, no invented
// explanations — codes + structured values only).
// ============================================================================
import type { CandidateEvaluation, StructuredRecommendationResult } from "./schema";

export type ChangeCode =
  | "decision-changed"
  | "comparator-changed"
  | "api-model-changed"
  | "best-self-host-changed"
  | "mode-changed"
  | "pricing-changed"
  | "adjustments-changed"
  | "candidate-added"
  | "candidate-removed"
  | "gate-changed"
  | "rejection-changed"
  | "confidence-changed"
  | "fleet-changed"
  | "cost-changed";

/** One coded change. Result-level changes carry candidateId=null; per-candidate changes carry the
 *  stable candidate id. `before`/`after` are structured values (deep-copied, never aliased), with
 *  `null` for absent — never undefined/NaN. */
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

// Deterministic presentation order for codes (result-level first, then per-candidate groups).
const CODE_ORDER: ChangeCode[] = [
  "mode-changed", "decision-changed", "comparator-changed", "api-model-changed", "best-self-host-changed",
  "pricing-changed", "adjustments-changed", "candidate-added", "candidate-removed",
  "gate-changed", "rejection-changed", "confidence-changed", "fleet-changed", "cost-changed",
];

/** null-safe normalization: undefined → null; non-finite numbers → null (never emit NaN). */
function norm(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}
/** Deep copy a structured value so a change record never aliases (or can mutate) an input object. */
function copy(v: unknown): unknown {
  const n = norm(v);
  return n === null || typeof n !== "object" ? n : JSON.parse(JSON.stringify(n));
}
const same = (a: unknown, b: unknown) => JSON.stringify(copy(a)) === JSON.stringify(copy(b));

/** Diff two structured recommendation results. Pure; deterministic; inputs untouched. */
export function diffRecommendations(
  prev: StructuredRecommendationResult,
  next: StructuredRecommendationResult
): RecommendationDiff {
  const changes: RecommendationChange[] = [];
  const add = (code: ChangeCode, scope: "result" | "candidate", candidateId: string | null, field: string | null, before: unknown, after: unknown) =>
    changes.push({ code, scope, candidateId, field, before: copy(before), after: copy(after) });

  // ---- result-level ----
  if (prev.mode !== next.mode) add("mode-changed", "result", null, "mode", prev.mode, next.mode);

  if (prev.decision.choice !== next.decision.choice || prev.decision.basis !== next.decision.basis) {
    add("decision-changed", "result", null, "decision",
      { choice: prev.decision.choice, basis: prev.decision.basis },
      { choice: next.decision.choice, basis: next.decision.basis });
  }
  if (!same(prev.decision.costComparator ?? null, next.decision.costComparator ?? null)) {
    add("comparator-changed", "result", null, "decision.costComparator", prev.decision.costComparator ?? null, next.decision.costComparator ?? null);
  }

  if (prev.apiOption.modelId !== next.apiOption.modelId) {
    add("api-model-changed", "result", null, "apiOption.modelId",
      { modelId: prev.apiOption.modelId, modelLabel: prev.apiOption.modelLabel },
      { modelId: next.apiOption.modelId, modelLabel: next.apiOption.modelLabel });
  }
  if (norm(prev.apiOption.monthlyCost) !== norm(next.apiOption.monthlyCost)) {
    add("cost-changed", "result", null, "apiOption.monthlyCost", prev.apiOption.monthlyCost, next.apiOption.monthlyCost);
  }

  const prevBest = prev.bestSelfHost?.config.id ?? null;
  const nextBest = next.bestSelfHost?.config.id ?? null;
  if (prevBest !== nextBest) add("best-self-host-changed", "result", null, "bestSelfHost", prevBest, nextBest);

  for (const k of ["source", "asOf", "region", "gpuPriceSource"] as const) {
    if (prev.pricing[k] !== next.pricing[k]) add("pricing-changed", "result", null, `pricing.${k}`, prev.pricing[k], next.pricing[k]);
  }

  if (!same(prev.inputAdjustments, next.inputAdjustments)) {
    add("adjustments-changed", "result", null, "inputAdjustments", prev.inputAdjustments, next.inputAdjustments);
  }

  // ---- per-candidate (matched by stable config.id) ----
  const prevById = new Map(prev.evaluations.map((e) => [e.config.id, e]));
  const nextById = new Map(next.evaluations.map((e) => [e.config.id, e]));
  const allIds = [...new Set([...prevById.keys(), ...nextById.keys()])].sort();

  for (const id of allIds) {
    const p = prevById.get(id);
    const n = nextById.get(id);
    if (p && !n) { add("candidate-removed", "candidate", id, null, id, null); continue; }
    if (!p && n) { add("candidate-added", "candidate", id, null, null, id); continue; }
    diffCandidate(p!, n!, add);
  }

  // Deterministic total order: result-level (candidateId null → "") first, then candidate id, then
  // code order, then field.
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

  return { identical: changes.length === 0, changes };
}

function diffCandidate(
  p: CandidateEvaluation,
  n: CandidateEvaluation,
  add: (code: ChangeCode, scope: "candidate", candidateId: string, field: string, before: unknown, after: unknown) => void
): void {
  const id = p.config.id;

  // gates
  for (const k of ["technicallyFeasible", "slaQualified", "evidenceQualified", "priceQualified", "comparisonQualified", "recommendationEligible"] as const) {
    if (p[k] !== n[k]) add("gate-changed", "candidate", id, k, p[k], n[k]);
  }
  // primary rejection reason
  const pr = p.rejections[0]?.code ?? null;
  const nr = n.rejections[0]?.code ?? null;
  if (pr !== nr) add("rejection-changed", "candidate", id, "rejections[0].code", pr, nr);

  // confidence / evidence state (engine + effective + registry)
  if (p.engineConfidence !== n.engineConfidence) add("confidence-changed", "candidate", id, "engineConfidence", p.engineConfidence, n.engineConfidence);
  if (p.effectiveConfidence !== n.effectiveConfidence) add("confidence-changed", "candidate", id, "effectiveConfidence", p.effectiveConfidence, n.effectiveConfidence);
  const prs = p.registry?.status ?? null;
  const nrs = n.registry?.status ?? null;
  if (prs !== nrs) add("confidence-changed", "candidate", id, "registry.status", prs, nrs);
  const prc = p.registry?.confidence ?? null;
  const nrc = n.registry?.confidence ?? null;
  if (prc !== nrc) add("confidence-changed", "candidate", id, "registry.confidence", prc, nrc);

  // fleet sizing
  if (p.fleet.boxes !== n.fleet.boxes) add("fleet-changed", "candidate", id, "fleet.boxes", p.fleet.boxes, n.fleet.boxes);
  if (p.fleet.bindingDim !== n.fleet.bindingDim) add("fleet-changed", "candidate", id, "fleet.bindingDim", p.fleet.bindingDim, n.fleet.bindingDim);

  // costs (null-safe)
  if (norm(p.cost.selfHostMonthly) !== norm(n.cost.selfHostMonthly)) add("cost-changed", "candidate", id, "cost.selfHostMonthly", p.cost.selfHostMonthly, n.cost.selfHostMonthly);
  if (norm(p.cost.apiMonthly) !== norm(n.cost.apiMonthly)) add("cost-changed", "candidate", id, "cost.apiMonthly", p.cost.apiMonthly, n.cost.apiMonthly);
  if (p.cost.verdict !== n.cost.verdict) add("cost-changed", "candidate", id, "cost.verdict", p.cost.verdict, n.cost.verdict);
}
