// ============================================================================
// narrate(structured) — DETERMINISTIC narrative generator. Template over STRUCTURED
// fields only (fleet-explain precedent): no invented facts, prices, alternatives or
// before/after deltas; no reconstructed math. Candidate facts come ONLY from
// servingFacts, workload facts ONLY from effectiveWorkload, disclosures ONLY from
// inputAdjustments. Pure — byte-identical for identical structured input. See
// docs/ux-v2/phase1/DESIGN.md §5.
// ============================================================================
import type {
  Card, CandidateEvaluation, NarratedCard, NarratedRecommendationResult, StructuredRecommendationResult,
} from "./schema";
import { RECOMMENDATION_CAPTION } from "./schema";

/** Deterministic thousands formatting (no locale/ICU dependence). */
function commas(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return r < 0 ? `-${s}` : s;
}
/** USD, never emitting NaN/undefined. */
function usd(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `$${commas(n)}` : "unavailable";
}
const REAL_PERCENTILES = new Set(["p50", "p90", "p95", "p99"]);

/** Base/on-demand GPU rate + purchasing model — NEVER called a discounted "effective rate" (pricing
 *  wording guard). servingFacts.gpuPricePerHr is the base on-demand rate. */
function gpuPriceWords(sf: CandidateEvaluation["servingFacts"]): string {
  const base = `${usd(sf.gpuPricePerHr)}/hr on-demand base rate`;
  return sf.gpuPricingModel && sf.gpuPricingModel !== "on-demand" ? `${base} (purchasing model: ${sf.gpuPricingModel})` : base;
}

/** TTFT clause only when the structured percentile explicitly supports P50/P90/P95/P99 (never invented). */
function ttftClause(e: CandidateEvaluation): string {
  if (e.ttftS != null && Number.isFinite(e.ttftS) && e.ttftPercentile && REAL_PERCENTILES.has(e.ttftPercentile)) {
    return `; ${e.ttftPercentile.toUpperCase()} TTFT ${e.ttftS.toFixed(2)}s`;
  }
  return "";
}

function narrateCard(card: Card, r: StructuredRecommendationResult): NarratedCard {
  const e = r.evaluations.find((x) => x.config.id === card.config.id)!;
  const sf = e.servingFacts;
  const conf = card.confidence; // EXACT token: measured | measured-scaled | extrapolated | proxy | heuristic | unbenchmarked
  const bindingConstraint = `${e.fleet.bindingDim}-bound — ${e.fleet.equation}${ttftClause(e)}. Confidence: ${conf}.`;
  const tradeoff = `${sf.instanceType} · ${sf.weightPrecision} weights / ${sf.kvPrecision} KV · ${e.fleet.boxes} box(es) · ${usd(e.cost.selfHostMonthly)}/month · GPU ${gpuPriceWords(sf)} · confidence ${conf}.`;
  return { ...card, bindingConstraint, tradeoff };
}

function pricingDisclosure(r: StructuredRecommendationResult): string {
  const p = r.pricing;
  const src = p.source === "live" ? "live" : "committed reference (fallback)"; // never claim "live" when fallback
  return `Pricing: ${src} price book as of ${p.asOf} for ${p.region}; GPU price source: ${p.gpuPriceSource}.`;
}

function adjustmentsDisclosure(r: StructuredRecommendationResult): string {
  if (r.inputAdjustments.length === 0) return "";
  const parts = r.inputAdjustments.map((a) => `${a.field} ${a.entered}→${a.calculated}`);
  return ` Input adjustments applied: ${parts.join("; ")}.`;
}

function registryLimitationNote(r: StructuredRecommendationResult): string {
  if (r.mode !== "experimental") return "";
  const demoted = r.evaluations.some((e) => e.effectiveConfidence === "unbenchmarked" && e.registry);
  if (!demoted) return "";
  // An incomplete/invalid-request from the registry is an INTERNAL evidence-metadata gap, not a customer
  // input error (approval note / registry-status presentation guard).
  return " In experimental mode the cross-source benchmark registry could not corroborate the modeled configuration(s) — an internal evidence-metadata limitation (e.g. no reviewed AWS-host or prefix-cache facts), not a problem with the request — so evidence confidence is held at unbenchmarked.";
}

function decisionRationale(r: StructuredRecommendationResult): string {
  const apiModel = r.apiOption.modelId;
  const selfModel = r.effectiveWorkload.generation.llmModelId;
  const apiPhrase = `the ${apiModel} API`;
  const best = r.bestSelfHost ? r.evaluations.find((e) => e.config.id === r.bestSelfHost!.config.id) : undefined;

  let lead: string;
  switch (r.decision.basis) {
    case "self-host-infeasible":
      lead = `Recommendation: use ${apiPhrase}. No modeled self-host configuration for ${selfModel} is technically feasible for this workload.`;
      break;
    case "no-modeled-candidate":
      lead = `Recommendation: use ${apiPhrase}. ${selfModel} is self-hostable, but no self-host configuration is currently modeled for it — a catalog-coverage gap, not a technical limitation.`;
      break;
    case "sla":
      lead = `Recommendation: use ${apiPhrase}. The modeled self-host configurations for ${selfModel} are technically feasible but cannot meet the interactivity / TTFT SLA.`;
      break;
    case "evidence-gap":
      lead = `Recommendation: use ${apiPhrase}. No self-host configuration for ${selfModel} has qualifying benchmark evidence (only heuristic/extrapolated estimates), so none can be recommended.`;
      break;
    case "comparison-unavailable":
      lead = `Recommendation: undetermined. An evidence-qualified self-host configuration for ${selfModel} exists, but a trustworthy ${apiModel} API-vs-self-host cost comparison is unavailable, so no cost winner is asserted.`;
      break;
    case "lower-cost": {
      const sf = best?.servingFacts;
      const selfDesc = sf && best
        ? `self-hosting ${selfModel} on ${sf.instanceType} (${sf.weightPrecision} weights) at ${usd(best.cost.selfHostMonthly)}/month`
        : `the self-host option`;
      lead = r.decision.choice === "api"
        ? `Recommendation: use ${apiPhrase} at ${usd(r.apiOption.monthlyCost)}/month — lower-cost than ${selfDesc}.`
        : `Recommendation: ${selfDesc} — lower-cost than ${apiPhrase} at ${usd(r.apiOption.monthlyCost)}/month.`;
      break;
    }
  }

  const bothModels = apiModel !== selfModel ? ` (compared models: ${apiModel} via API vs self-hosting ${selfModel}).` : "";
  return `${lead}${bothModels}${registryLimitationNote(r)}${adjustmentsDisclosure(r)} ${pricingDisclosure(r)}`;
}

/** Render the structured recommendation into deterministic narrative copy. */
export function narrate(r: StructuredRecommendationResult): NarratedRecommendationResult {
  return {
    caption: RECOMMENDATION_CAPTION,
    decision: { ...r.decision, rationale: decisionRationale(r) },
    apiOption: r.apiOption,
    bestSelfHost: r.bestSelfHost ? narrateCard(r.bestSelfHost, r) : null,
    alternatives: r.alternatives.map((c) => narrateCard(c, r)),
    rejected: r.rejected,
    evaluations: r.evaluations,
    mode: r.mode,
    controlComparison: r.controlComparison,
    effectiveWorkload: r.effectiveWorkload,
    inputAdjustments: r.inputAdjustments,
    pricing: r.pricing,
  };
}
