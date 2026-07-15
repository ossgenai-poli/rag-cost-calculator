// Top-level API-vs-self-host decision — deterministic precedence (DESIGN §4.2). Pure function of the
// per-candidate evaluations plus the structured API option. `optimizeFor` does NOT enter here (it only
// ranks self-host candidates; the top-level choice is eligibility + a trustworthy cost comparison).
import type { ApiOption, CandidateEvaluation, Decision } from "./schema";

export interface DecideOptions {
  /** Whether the workload's model is self-hostable at all. Distinguishes a coverage gap (P1-2) from
   *  genuine infeasibility when there are zero candidates. */
  modelSelfHostable: boolean;
}

/** Precedence (first match wins): no-modeled-candidate → self-host-infeasible → sla → evidence-gap →
 *  comparison-unavailable → lower-cost. Overlapping conditions never produce a nondeterministic basis. */
export function deriveDecision(evals: CandidateEvaluation[], api: ApiOption, opts: DecideOptions): Decision {
  // Zero candidates: a self-hostable model with no pinned candidate is a COVERAGE gap (P1-2), not
  // infeasibility; a non-self-hostable model genuinely cannot self-host.
  if (evals.length === 0) {
    return { choice: "api", basis: opts.modelSelfHostable ? "no-modeled-candidate" : "self-host-infeasible" };
  }

  const feasible = evals.filter((e) => e.technicallyFeasible);
  if (feasible.length === 0) return { choice: "api", basis: "self-host-infeasible" };

  const slaOk = feasible.filter((e) => e.slaQualified);
  if (slaOk.length === 0) return { choice: "api", basis: "sla" };

  const evidenceOk = slaOk.filter((e) => e.evidenceQualified);
  if (evidenceOk.length === 0) return { choice: "api", basis: "evidence-gap" };

  // A cost decision REQUIRES a trustworthy comparison on BOTH sides (P1-5): the API option must be
  // comparison-qualified, and there must be an evidence-qualified self-host that is itself
  // comparison-qualified (its own self-host AND API price present). Otherwise: comparison-unavailable.
  const comparable = evidenceOk.filter((e) => e.comparisonQualified && e.priceQualified && e.cost.selfHostMonthly != null);
  if (!api.comparisonQualified || api.monthlyCost == null || comparable.length === 0) {
    return { choice: "undetermined", basis: "comparison-unavailable" };
  }

  // Compare API against the CHEAPEST comparison-qualified self-host (self-host's best economic case),
  // with a deterministic cost → config-id tie-break. The EXACT comparator is persisted structurally
  // (P1-NARR-2) so narration/change-diff explain the decision from what it was actually derived from —
  // never from the optimization-selected bestSelfHost, which may be a different (dearer) candidate.
  const cheapest = [...comparable].sort((a, b) => {
    const c = (a.cost.selfHostMonthly as number) - (b.cost.selfHostMonthly as number);
    if (c) return c;
    return a.config.id < b.config.id ? -1 : a.config.id > b.config.id ? 1 : 0;
  })[0];
  const costComparator = {
    selfHostCandidateId: cheapest.config.id,
    selfHostMonthly: cheapest.cost.selfHostMonthly as number,
    apiMonthly: api.monthlyCost,
  };
  return api.monthlyCost <= costComparator.selfHostMonthly
    ? { choice: "api", basis: "lower-cost", costComparator }
    : { choice: "self-host", basis: "lower-cost", costComparator };
}
