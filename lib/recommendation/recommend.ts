// ============================================================================
// recommend() — the Phase-1 headless recommendation sweep (concern E). STRUCTURED
// output only (no prose — narrate() renders later). Composes the frozen rc-qa-11
// engine (feasibility/sizing/cost + capacity.source evidence) and, in experimental
// mode, the approved benchmark registry (additive, demote-only). Changes neither.
// See docs/ux-v2/phase1/DESIGN.md §3-§4.
// ============================================================================
import type { CalcInputs, CalcResult, CapacityResult, PriceBook } from "../types";
import { calculate } from "../calc-engine";
import { applyGpuSelection } from "../ui-logic";
import { explainFleetSizing } from "../fleet-explain";
import { resolveOperatingPoint } from "../benchmark-registry";
import pricesJson from "../../public/prices.json";

import type {
  ApiOption, Card, CandidateConfig, CandidateEvaluation, EffectiveConfidence, EngineConfidence,
  ReasonCode, RecommendationRequest, RegistryEvidence, Rejection, StructuredRecommendationResult, Verdict,
} from "./schema";
import { loadCandidateCatalog } from "./candidate-catalog";
import { buildRegistryRequest } from "./registry-request";
import { reconcileConfidence } from "./reconcile";
import { deriveDecision } from "./decision";
import { rankSelfHost } from "./ranking";

/** capacity.source → engine evidence state. `extrapolated` splits: a real measured curve scaled across
 *  ISL (same model+precision) is `measured-scaled`; a PRECISION substitution is weaker `extrapolated`. */
export function engineConfidenceFrom(cap: CapacityResult): EngineConfidence {
  switch (cap.source) {
    case "measured":
      return "measured";
    case "proxy":
      return "proxy";
    case "heuristic":
      return "heuristic";
    case "extrapolated": {
      const precisionSubstituted =
        cap.precisionUsed != null && cap.precisionRequested != null && cap.precisionUsed !== cap.precisionRequested;
      return precisionSubstituted ? "extrapolated" : "measured-scaled";
    }
  }
}

/** Map the frozen crossover's first infeasibility to a technical rejection code. */
function technicalReason(calc: CalcResult): { code: ReasonCode; message: string } {
  const cap = calc.crossover.capacity;
  if (cap.contextOverflow) {
    return { code: "context-window-overflow", message: `context needs ${cap.contextRequiredTokens} tok > configured ${cap.maxContextConfigured}` };
  }
  const inf = calc.crossover.infeasibility[0];
  const msg = inf?.message ?? "not feasible on the current serving topology";
  const code: ReasonCode =
    inf && /node|multi-node|topology/i.test(inf.code + inf.message)
      ? "node-count-exceeds-topology"
      : inf && /fleet|instances|practical/i.test(inf.code + inf.message)
        ? "fleet-exceeds-practical-limit"
        : "model-does-not-fit-serving-group";
  return { code, message: msg };
}

function buildRegistryEvidence(candidate: CandidateConfig, inputs: CalcInputs, calc: CalcResult): RegistryEvidence {
  const res = resolveOperatingPoint(buildRegistryRequest(candidate, inputs, calc), { mode: "experimental" });
  return {
    status: res.status,
    confidence: res.confidence,
    differsFromControl: res.differsFromControl,
    reasons: res.reasons,
    transformations: res.provenance ? (res.provenance.full.transformations as RegistryEvidence["transformations"]) : undefined,
    provenance: res.provenance,
  };
}

/** Evaluate ONE candidate exactly once (one calculate() per candidate). Deterministic. */
export function evaluateCandidate(
  candidate: CandidateConfig,
  workload: CalcInputs,
  priceBook: PriceBook,
  mode: "control" | "experimental"
): CandidateEvaluation {
  const gpu = priceBook.gpus.find((g) => g.instanceType === candidate.instanceType);
  if (!gpu) throw new Error(`evaluateCandidate: instance ${candidate.instanceType} not in price book`);

  // Build inputs with the SAME pure transforms the app selector uses (QA-014). Do not mutate `workload`.
  const inputs: CalcInputs = { ...workload, generation: applyGpuSelection({ ...workload.generation }, gpu) };
  inputs.generation.weightBits = candidate.weightBits;
  inputs.generation.kvBits = candidate.kvBits;
  inputs.generation.mode = "self-hosted";

  const calc = calculate(inputs, priceBook); // ← the ONE economics computation for this candidate
  const cap = calc.crossover.capacity;
  const cx = calc.crossover;

  const engineConfidence = engineConfidenceFrom(cap);
  const registry = mode === "experimental" ? buildRegistryEvidence(candidate, inputs, calc) : undefined;
  const effectiveConfidence: EffectiveConfidence = reconcileConfidence(engineConfidence, registry, mode);

  // Gates (technicalFeasible EXCLUDES price — rev-2 #2).
  const technicallyFeasible = cx.feasible && !cap.contextOverflow;
  const slaQualified = technicallyFeasible && cap.slaAchievable && cap.ttftMet && cap.interactivityMet;
  const evidenceQualified =
    (effectiveConfidence === "measured" || effectiveConfidence === "measured-scaled") && cap.benchmarkAvailable;
  const recommendationEligible = technicallyFeasible && slaQualified && evidenceQualified;

  const priceQualified = !cx.ownedCapacity && Number.isFinite(cx.selfHostedMonthly$) && cx.selfHostedMonthly$ > 0;
  const apiMonthly = Number.isFinite(cx.apiMonthly$) && cx.apiMonthly$ > 0 ? cx.apiMonthly$ : null;
  const comparisonQualified = priceQualified && apiMonthly != null;
  const selfHostMonthly = priceQualified ? cx.selfHostedMonthly$ : null;

  const verdict: Verdict = !technicallyFeasible
    ? "infeasible"
    : selfHostMonthly == null || apiMonthly == null
      ? "undetermined"
      : cx.verdict === "self-host efficient"
        ? "self-host-efficient"
        : "api-wins";

  // First-match rejection order (DESIGN §4): technical → sla → evidence. Only the PRIMARY code is set.
  const rejections: Array<{ code: ReasonCode; message: string }> = [];
  if (!technicallyFeasible) rejections.push(technicalReason(calc));
  else if (!slaQualified) rejections.push({ code: "sla-unmet-ttft-or-streaming", message: `no operating point meets the ${inputs.generation.ttftTargetMs}ms P99 TTFT / ${inputs.generation.interactivityTarget} tok/s streaming SLA` });
  else if (!evidenceQualified) rejections.push({ code: "evidence-below-threshold", message: `evidence is ${effectiveConfidence} (not measured/measured-scaled on a real applicable benchmark)` });

  const eq = explainFleetSizing(cx);
  return {
    config: candidate,
    technicallyFeasible,
    slaQualified,
    evidenceQualified,
    priceQualified,
    comparisonQualified,
    recommendationEligible,
    engineConfidence,
    registry,
    effectiveConfidence,
    fleet: {
      boxes: cx.boxes,
      bindingDim: cx.bindingDim,
      equation: `${Math.round(eq.peakDemandTokS)} ${eq.dimension} tok/s ÷ (${Math.round(eq.perReplicaTokS)} × ${eq.utilTarget}) → ${eq.throughputReplicas} replica(s) → ${cx.boxes} boxes`,
    },
    cost: { selfHostMonthly, apiMonthly, verdict },
    ttftS: Number.isFinite(cap.ttftS) ? cap.ttftS : null,
    ttftPercentile: cap.ttftPercentile ?? null,
    rejections,
  };
}

function toCard(kind: Card["kind"], e: CandidateEvaluation, bestCost: number | null): Card {
  const costMonthly = e.cost.selfHostMonthly;
  const costDeltaVsBest = costMonthly != null && bestCost != null ? costMonthly - bestCost : null;
  return { kind, config: e.config, costMonthly, costDeltaVsBest, confidence: e.effectiveConfidence };
}

const byId = (a: { config: CandidateConfig }, b: { config: CandidateConfig }) =>
  a.config.id < b.config.id ? -1 : a.config.id > b.config.id ? 1 : 0;

/**
 * PUBLIC recommend() — the ONLY entry. Loads the pinned catalog internally, filters to the workload's
 * EXACT model, evaluates each candidate once, reconciles evidence, ranks, and derives the top-level
 * decision. STRUCTURED result only. No caller catalog injection exists.
 */
export function recommend(req: RecommendationRequest): StructuredRecommendationResult {
  const priceBook = pricesJson as unknown as PriceBook;
  const mode: "control" | "experimental" = req.experimentalProvenance ? "experimental" : "control";
  const modelId = req.workload.generation.llmModelId;

  // Exact-model filter (rev-2 #3) — the sweep varies only infra/precision.
  const candidates = loadCandidateCatalog().filter((c) => c.llmModelId === modelId);

  // Evaluate each candidate EXACTLY ONCE.
  const evaluations = candidates.map((c) => evaluateCandidate(c, req.workload, priceBook, mode));

  // The API option is model+workload-dependent (GPU-independent), so it is identical across candidates.
  const apiMonthly = evaluations.find((e) => e.cost.apiMonthly != null)?.cost.apiMonthly
    ?? (candidates.length === 0 ? apiMonthlyForWorkload(req.workload, priceBook) : null);
  const apiOption: ApiOption = {
    modelId,
    monthlyCost: apiMonthly,
    priceState: apiMonthly != null ? "priced" : "no-price",
    comparisonQualified: apiMonthly != null,
  };

  const decision = deriveDecision(evaluations, apiOption);

  // Ranking (deterministic total order); best-first over eligible candidates.
  const ranked = rankSelfHost(evaluations, req.optimizeFor);
  const best = ranked[0] ?? null;
  const bestCost = best?.cost.selfHostMonthly ?? null;
  const bestSelfHost = best ? toCard("best-self-host", best, bestCost) : null;

  // Alternatives: best eligible per axis, included only when a DISTINCT candidate id (rev-5).
  const alternatives: Card[] = [];
  const shownIds = new Set<string>(best ? [best.config.id] : []);
  const addAxis = (kind: Card["kind"], axis: Parameters<typeof rankSelfHost>[1]) => {
    const top = rankSelfHost(evaluations, axis)[0];
    if (top && !shownIds.has(top.config.id)) {
      shownIds.add(top.config.id);
      alternatives.push(toCard(kind, top, bestCost));
    }
  };
  addAxis("lowest-cost", "cost");
  addAxis("highest-confidence", "confidence");
  addAxis("lowest-latency", "latency");

  // Rejections — every ineligible candidate, primary reason, sorted for determinism.
  const rejected: Rejection[] = evaluations
    .filter((e) => !e.recommendationEligible)
    .map((e) => ({ config: e.config, code: e.rejections[0].code, message: e.rejections[0].message }))
    .sort(byId);

  const result: StructuredRecommendationResult = {
    decision,
    apiOption,
    bestSelfHost,
    alternatives,
    rejected,
    evaluations: [...evaluations].sort(byId), // deterministic regardless of catalog order
    mode,
  };
  if (mode === "experimental") {
    const differs = evaluations.some((e) => e.registry?.differsFromControl);
    result.controlComparison = { differs, cause: differs ? "new-data" : "none" };
  }
  return result;
}

/** API monthly for a workload when there are no candidates (edge case only). One calc, GPU-independent. */
function apiMonthlyForWorkload(workload: CalcInputs, priceBook: PriceBook): number | null {
  const cx = calculate(workload, priceBook).crossover;
  return Number.isFinite(cx.apiMonthly$) && cx.apiMonthly$ > 0 ? cx.apiMonthly$ : null;
}
