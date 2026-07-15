// Top-level API-vs-self-host decision — deterministic precedence (DESIGN §4.2). Pure function of the
// per-candidate evaluations plus the structured API option. `optimizeFor` does NOT enter here: it only
// ranks self-host candidates; the top-level choice is eligibility + a trustworthy cost comparison.
import type { ApiOption, CandidateEvaluation, Decision } from "./schema";

/** Precedence (first match wins): self-host-infeasible → sla → evidence-gap → comparison-unavailable →
 *  lower-cost. Overlapping conditions can never produce a nondeterministic basis. */
export function deriveDecision(evals: CandidateEvaluation[], api: ApiOption): Decision {
  const feasible = evals.filter((e) => e.technicallyFeasible);
  if (feasible.length === 0) return { choice: "api", basis: "self-host-infeasible" };

  const slaOk = feasible.filter((e) => e.slaQualified);
  if (slaOk.length === 0) return { choice: "api", basis: "sla" };

  const evidenceOk = slaOk.filter((e) => e.evidenceQualified);
  if (evidenceOk.length === 0) return { choice: "api", basis: "evidence-gap" };

  // An evidence-qualified self-host exists — decide on a TRUSTWORTHY cost comparison only.
  const priced = evidenceOk.filter((e) => e.priceQualified && e.cost.selfHostMonthly != null);
  if (api.monthlyCost == null || priced.length === 0) {
    return { choice: "undetermined", basis: "comparison-unavailable" };
  }

  // Compare the API price against the CHEAPEST evidence-qualified self-host (self-host's best economic
  // case). If even that is dearer than API, API wins; otherwise self-host wins.
  const cheapestSelfHost = Math.min(...priced.map((e) => e.cost.selfHostMonthly as number));
  return api.monthlyCost <= cheapestSelfHost
    ? { choice: "api", basis: "lower-cost" }
    : { choice: "self-host", basis: "lower-cost" };
}
