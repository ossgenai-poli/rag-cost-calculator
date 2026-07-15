// ============================================================================
// narrate(structured) — DETERMINISTIC narrative generator. Template over STRUCTURED
// fields only (fleet-explain precedent): no invented facts, prices, alternatives or
// before/after deltas; no reconstructed math. Candidate facts come ONLY from
// servingFacts, workload facts ONLY from effectiveWorkload, disclosures ONLY from
// inputAdjustments. Pure — byte-identical for identical structured input. See
// docs/ux-v2/phase1/DESIGN.md §5.
// ============================================================================
import type {
  Card, CandidateEvaluation, EffectiveConfidence, NarratedCard, NarratedRecommendationResult,
  StructuredRecommendationResult,
} from "./schema";
import { CONFIDENCE_RANK, RECOMMENDATION_CAPTION } from "./schema";
import { costComparatorValid } from "./decision";

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

// Customer-readable labels for adjustment fields (P2-NARR-1). This is static template copy (a copy
// deck), not a data mapping — the raw field paths remain in the structured `inputAdjustments` audit data.
const ADJUSTMENT_FIELD_LABELS: Record<string, string> = {
  "retrieval.topN": "Context chunks sent to the model",
  gpuUptimeHoursPerMonth: "GPU fleet uptime hours/month",
  "queries/month": "Queries/month",
  documents: "Documents",
  "tokens/doc": "Tokens per document",
  "output tokens": "Output tokens",
  "prompt overhead": "Prompt overhead",
  "max context": "Max context",
  "max concurrency": "Max concurrency",
  "overhead %": "Overhead %",
  "query tokens": "Query tokens",
};

function adjustmentsDisclosure(r: StructuredRecommendationResult): string {
  if (r.inputAdjustments.length === 0) return "";
  const parts = r.inputAdjustments.map((a) => `${ADJUSTMENT_FIELD_LABELS[a.field] ?? a.field} ${a.entered}→${a.calculated}`);
  return ` Input adjustments applied: ${parts.join("; ")}.`;
}

/** The unique effective-confidence tokens of the candidates that REACHED the evidence gate
 *  (technically feasible + SLA-qualified), strongest-first then alphabetical — never invented
 *  (P1-NARR-1). Falls back to all evaluated candidates if none reached the gate. */
function evidenceStatesAtGate(r: StructuredRecommendationResult): EffectiveConfidence[] {
  const reached = r.evaluations.filter((e) => e.technicallyFeasible && e.slaQualified);
  const pool = reached.length > 0 ? reached : r.evaluations;
  const unique = [...new Set(pool.map((e) => e.effectiveConfidence))];
  return unique.sort((a, b) => CONFIDENCE_RANK[b] - CONFIDENCE_RANK[a] || (a < b ? -1 : a > b ? 1 : 0));
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
  const apiLabel = r.apiOption.modelLabel; // trusted PriceBook label (P2-NARR-1); ids stay in the audit structure
  const selfLabel = r.selfHostModelLabel;
  const apiPhrase = `the ${apiLabel} API`;

  let lead: string;
  switch (r.decision.basis) {
    case "self-host-infeasible":
      lead = `Recommendation: use ${apiPhrase}. No modeled self-host configuration for ${selfLabel} is technically feasible for this workload.`;
      break;
    case "no-modeled-candidate":
      lead = `Recommendation: use ${apiPhrase}. ${selfLabel} is self-hostable, but no self-host configuration is currently modeled for it — a catalog-coverage gap, not a technical limitation.`;
      break;
    case "sla":
      lead = `Recommendation: use ${apiPhrase}. The modeled self-host configurations for ${selfLabel} are technically feasible but cannot meet the interactivity / TTFT SLA.`;
      break;
    case "evidence-gap": {
      // P1-NARR-1: report the ACTUAL evidence state(s) of the candidates that reached the evidence gate —
      // exact tokens, never a hardcoded category list.
      const states = evidenceStatesAtGate(r);
      const stateClause = states.length ? ` Available evidence state${states.length > 1 ? "s" : ""}: ${states.join(", ")}.` : "";
      lead = `Recommendation: use ${apiPhrase}. No self-host configuration for ${selfLabel} has qualifying benchmark evidence, so none can be recommended.${stateClause}`;
      break;
    }
    case "comparison-unavailable":
      lead = `Recommendation: undetermined. An evidence-qualified self-host configuration for ${selfLabel} exists, but a trustworthy ${apiLabel} API-vs-self-host cost comparison is unavailable, so no cost winner is asserted.`;
      break;
    case "lower-cost": {
      // P1-NARR-2/P1-NARR-3: explain the cost decision from the EXACT persisted comparator — never from
      // the optimization-selected bestSelfHost — and ONLY after the shared integrity validator confirms
      // EVERY invariant (candidate exists + eligible/qualified, amounts exactly reconcile with the
      // evaluation AND apiOption, it is the deterministic cheapest comparable candidate, the claimed
      // inequality holds). Any failed invariant → neutral wording, no dollar winner, no silent repair.
      if (!costComparatorValid(r.decision, r.apiOption, r.evaluations)) {
        lead = r.decision.choice === "api"
          ? `Recommendation: use ${apiPhrase} (decided on cost; comparison details unavailable — no specific dollar comparison is asserted).`
          : `Recommendation: self-host ${selfLabel} (decided on cost; comparison details unavailable — no specific dollar comparison is asserted).`;
        break;
      }
      const cmp = r.decision.costComparator!;
      const cmpEval = r.evaluations.find((e) => e.config.id === cmp.selfHostCandidateId)!;
      const sf = cmpEval.servingFacts;
      const selfDesc = `self-hosting ${selfLabel} on ${sf.instanceType} (${sf.weightPrecision} weights) at ${usd(cmp.selfHostMonthly)}/month`;
      lead = r.decision.choice === "api"
        ? `Recommendation: use ${apiPhrase} at ${usd(cmp.apiMonthly)}/month — lower-cost than the cheapest qualified self-host option, ${selfDesc}.`
        : `Recommendation: ${selfDesc} — lower-cost than ${apiPhrase} at ${usd(cmp.apiMonthly)}/month.`;
      break;
    }
  }

  // Cross-model caveat (P2-NARR-1): comparing costs across two DIFFERENT models never establishes
  // capability/quality equivalence.
  const bothModels = r.apiOption.modelId !== r.effectiveWorkload.generation.llmModelId
    ? ` (compared models: ${apiLabel} via API vs self-hosting ${selfLabel}). This compares the selected models' costs; capability and quality equivalence are not established by this calculator.`
    : "";
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
    selfHostModelLabel: r.selfHostModelLabel,
    effectiveWorkload: r.effectiveWorkload,
    inputAdjustments: r.inputAdjustments,
    pricing: r.pricing,
  };
}
