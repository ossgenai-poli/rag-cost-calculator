// Deterministic total order over recommendation-eligible self-host candidates (DESIGN §4.1). No result
// ever depends on catalog iteration order — the final tie-break is the stable canonical id. Pure.
import type { CandidateEvaluation, OptimizeFor } from "./schema";
import { CONFIDENCE_RANK } from "./schema";

/** Ascending numeric compare with `null` sorted LAST (a missing metric can never win). */
function ascNullLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
const costAsc = (a: CandidateEvaluation, b: CandidateEvaluation) => ascNullLast(a.cost.selfHostMonthly, b.cost.selfHostMonthly);
const latAsc = (a: CandidateEvaluation, b: CandidateEvaluation) => ascNullLast(a.ttftS, b.ttftS);
const confDesc = (a: CandidateEvaluation, b: CandidateEvaluation) =>
  CONFIDENCE_RANK[b.effectiveConfidence] - CONFIDENCE_RANK[a.effectiveConfidence];

/** The primary key for the requested optimization axis. */
function axisCompare(a: CandidateEvaluation, b: CandidateEvaluation, optimizeFor: OptimizeFor): number {
  switch (optimizeFor) {
    case "cost":
      return costAsc(a, b);
    case "latency":
      return latAsc(a, b);
    case "confidence":
      return confDesc(a, b);
    case "predictability":
      // Self-host = a fixed provisioned fleet cost (predictable); all candidates here are self-host, so
      // fall back to the cheapest fixed cost.
      return costAsc(a, b);
  }
}

/** Full comparator (DESIGN §4.1): eligibility → axis → effective confidence → secondary (cost, then
 *  latency) → stable id. */
export function compareCandidates(a: CandidateEvaluation, b: CandidateEvaluation, optimizeFor: OptimizeFor): number {
  const elig = (b.recommendationEligible ? 1 : 0) - (a.recommendationEligible ? 1 : 0);
  if (elig) return elig;
  const axis = axisCompare(a, b, optimizeFor);
  if (axis) return axis;
  const conf = confDesc(a, b);
  if (conf) return conf;
  const cost = costAsc(a, b);
  if (cost) return cost;
  const lat = latAsc(a, b);
  if (lat) return lat;
  return a.config.id < b.config.id ? -1 : a.config.id > b.config.id ? 1 : 0;
}

/** Recommendation-eligible candidates, best-first. `[0]` (if any) is the bestSelfHost. */
export function rankSelfHost(evals: CandidateEvaluation[], optimizeFor: OptimizeFor): CandidateEvaluation[] {
  return evals.filter((e) => e.recommendationEligible).sort((a, b) => compareCandidates(a, b, optimizeFor));
}
