// ============================================================================
// recommend() — the Phase-1 headless recommendation sweep (concern E). STRUCTURED
// output only (no prose — narrate() renders later). Composes the frozen rc-qa-11
// engine (feasibility/sizing/cost + capacity.source evidence) and, in experimental
// mode, the approved benchmark registry (additive, demote-only). Changes neither.
// See docs/ux-v2/phase1/DESIGN.md §3-§4.
// ============================================================================
import type { CalcInputs, CalcResult, CapacityResult, CrossoverResult, PriceBook } from "../types";
import { calculate, normalizeInputs, inputClampNotes } from "../calc-engine";
import { applyGpuSelection } from "../ui-logic";
import { explainFleetSizing } from "../fleet-explain";
import { resolveOperatingPoint } from "../benchmark-registry";

import type {
  ApiOption, Card, CandidateConfig, CandidateEvaluation, EffectiveConfidence, EngineConfidence,
  InputAdjustment, OptimizeFor, PricingProvenance, ReasonCode, RecommendationRequest, RegistryEvidence,
  Rejection, StructuredRecommendationResult, Verdict,
} from "./schema";
import { loadCandidateCatalog } from "./candidate-catalog";
import { loadPriceBook } from "./price-book";
import { buildRegistryRequest } from "./registry-request";
import { reconcileConfidence } from "./reconcile";
import { deriveDecision } from "./decision";
import { rankSelfHost } from "./ranking";

const UPTIME_CAP_HOURS = 730; // the engine caps GPU uptime at 730 h/mo (crossover HOURS_PER_MONTH)
const OPTIMIZE_FOR = new Set<OptimizeFor>(["cost", "latency", "confidence", "predictability"]);

// SLA-related engine infeasibility codes — these are NOT technical infeasibility (P1-1).
const SLA_CODES = new Set(["ttft", "interactivity", "concurrency-below-min"]);
// Structured engine-code → rejection-code map (NEVER a message regex — P1-1).
const ENGINE_CODE_TO_REASON: Record<string, ReasonCode> = {
  "context-overflow": "context-window-overflow",
  "manual-cap": "fleet-exceeds-practical-limit",
};

/**
 * capacity.source → engine evidence state, from STRUCTURED fields only (P1-4). `measured-scaled` requires
 * a TRACEABLE, same-precision, ISL-scaled measurement: real benchmark provenance, a real measured prefill
 * (not estimated), a defined ISL scale, and requested precision == used precision. Anything else
 * (partial topology, untraceable provenance, precision/other substitution) stays `extrapolated`.
 */
export function engineConfidenceFrom(cap: CapacityResult): EngineConfidence {
  switch (cap.source) {
    case "measured":
      return "measured";
    case "proxy":
      return "proxy";
    case "heuristic":
      return "heuristic";
    case "extrapolated": {
      const traceable = !!cap.benchmarkProvenance && cap.benchmarkAvailable === true && cap.prefillEstimated === false;
      const islScaled = cap.prefillIslScale != null && Number.isFinite(cap.prefillIslScale);
      const precisionKnownAndMatched =
        cap.precisionUsed != null && cap.precisionRequested != null && cap.precisionUsed === cap.precisionRequested;
      return traceable && islScaled && precisionKnownAndMatched ? "measured-scaled" : "extrapolated";
    }
  }
}

/** Structured technical rejection (excludes SLA/TTFT/interactivity — P1-1). null ⇒ technically feasible. */
function technicalRejection(cx: CrossoverResult, cap: CapacityResult): { code: ReasonCode; message: string } | null {
  if (cap.contextOverflow) {
    const m = cx.infeasibility.find((x) => x.code === "context-overflow");
    return { code: "context-window-overflow", message: m?.message ?? `context ${Math.round(cap.contextRequiredTokens)} tok exceeds ${cap.maxContextConfigured}` };
  }
  const tech = cx.infeasibility.find((x) => !SLA_CODES.has(x.code) && x.code !== "context-overflow");
  if (tech) return { code: ENGINE_CODE_TO_REASON[tech.code] ?? "model-does-not-fit-serving-group", message: tech.message };
  return null;
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

/** Everything a single candidate produces — the public evaluation plus the reconciliation inputs. */
interface CandidateRun {
  evaluation: CandidateEvaluation;
  effectiveInputs: CalcInputs; // the normalized inputs the engine actually used
  gpuPriceSource: CrossoverResult["gpuPriceSource"];
}

function runCandidate(candidate: CandidateConfig, workload: CalcInputs, priceBook: PriceBook, mode: "control" | "experimental"): CandidateRun {
  const gpu = priceBook.gpus.find((g) => g.instanceType === candidate.instanceType);
  if (!gpu) throw new Error(`runCandidate: instance ${candidate.instanceType} not in price book`);

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

  // Gates — technical EXCLUDES both price AND SLA (P1-1/P1-2).
  const techReject = technicalRejection(cx, cap);
  const technicallyFeasible = techReject === null;
  const slaQualified = technicallyFeasible && cap.slaAchievable && cap.ttftMet && cap.interactivityMet && cap.concWithinLimit;
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
  if (techReject) rejections.push(techReject);
  else if (!slaQualified) rejections.push({ code: "sla-unmet-ttft-or-streaming", message: `no operating point meets the ${inputs.generation.ttftTargetMs}ms P99 TTFT / ${inputs.generation.interactivityTarget} tok/s streaming SLA (TTFT ${cap.ttftS.toFixed(2)}s)` });
  else if (!evidenceQualified) rejections.push({ code: "evidence-below-threshold", message: `evidence is ${effectiveConfidence} (not measured/measured-scaled on a real applicable benchmark)` });

  const eq = explainFleetSizing(cx);
  const evaluation: CandidateEvaluation = {
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
  return { evaluation, effectiveInputs: calc.effectiveInputs, gpuPriceSource: cx.gpuPriceSource };
}

/** Evaluate one candidate (public/test surface). */
export function evaluateCandidate(candidate: CandidateConfig, workload: CalcInputs, priceBook: PriceBook, mode: "control" | "experimental"): CandidateEvaluation {
  return runCandidate(candidate, workload, priceBook, mode).evaluation;
}

function toCard(kind: Card["kind"], e: CandidateEvaluation, bestCost: number | null): Card {
  const costMonthly = e.cost.selfHostMonthly;
  const costDeltaVsBest = costMonthly != null && bestCost != null ? costMonthly - bestCost : null;
  return { kind, config: e.config, costMonthly, costDeltaVsBest, confidence: e.effectiveConfidence };
}

const byId = (a: { config: CandidateConfig }, b: { config: CandidateConfig }) =>
  a.config.id < b.config.id ? -1 : a.config.id > b.config.id ? 1 : 0;

/** Fail-closed boundary validation of the public request (P1-3). */
function validateRequest(req: RecommendationRequest): void {
  if (!req || typeof req !== "object") throw new Error("recommend: request object required");
  if (!OPTIMIZE_FOR.has(req.optimizeFor)) throw new Error(`recommend: invalid optimizeFor "${String(req.optimizeFor)}"`);
  if (req.experimentalProvenance != null && typeof req.experimentalProvenance !== "boolean") throw new Error("recommend: experimentalProvenance must be a boolean");
  if (!req.workload || typeof req.workload !== "object" || !req.workload.generation || typeof req.workload.generation.llmModelId !== "string") {
    throw new Error("recommend: a workload with generation.llmModelId is required");
  }
}

/** Reconcile the entered-vs-calculated adjustments the customer should see (P1-6). GPU-independent. */
function inputAdjustmentsFor(workload: CalcInputs): InputAdjustment[] {
  const adj: InputAdjustment[] = inputClampNotes(workload).map((n) => ({ field: n.field, entered: n.entered, calculated: n.calculated }));
  const uptime = workload.generation.gpuUptimeHoursPerMonth;
  if (Number.isFinite(uptime) && uptime > UPTIME_CAP_HOURS) adj.push({ field: "gpuUptimeHoursPerMonth", entered: uptime, calculated: UPTIME_CAP_HOURS });
  return adj;
}

/**
 * PUBLIC recommend() — the ONLY entry. Loads the pinned catalog + trusted price book internally, filters
 * to the workload's EXACT model, evaluates each candidate once, reconciles evidence + effective inputs +
 * pricing, ranks, and derives the top-level decision. STRUCTURED result only. No caller injection exists.
 */
export function recommend(req: RecommendationRequest): StructuredRecommendationResult {
  validateRequest(req);
  const priceBook = loadPriceBook();
  const mode: "control" | "experimental" = req.experimentalProvenance ? "experimental" : "control";
  const modelId = req.workload.generation.llmModelId;
  const model = priceBook.models.find((m) => m.id === modelId);
  const modelSelfHostable = !!model && model.kind === "llm" && model.selfHostable === true;

  // Exact-model filter (rev-2 #3) — the sweep varies only infra/precision.
  const candidates = loadCandidateCatalog().filter((c) => c.llmModelId === modelId);

  // Evaluate each candidate EXACTLY ONCE.
  const runs = candidates.map((c) => runCandidate(c, req.workload, priceBook, mode));
  const evaluations = runs.map((r) => r.evaluation);

  // Reconcile the effective workload ONCE and assert consistency across candidates (P1-6).
  const shareKey = (i: CalcInputs) => JSON.stringify([i.traffic.queriesPerMonth, i.generation.outTokens, i.generation.promptOverhead, i.generation.maxContextLen, i.generation.maxConcurrentSeqs, i.queryTokens]);
  const shared = new Set(runs.map((r) => shareKey(r.effectiveInputs)));
  if (shared.size > 1) throw new Error("recommend: normalized workload inputs diverge across candidates");
  // GPU-INDEPENDENT normalized workload (deterministic regardless of catalog order) — the per-candidate
  // GPU/precision are audited via `evaluations`, not here.
  const effectiveWorkload = normalizeInputs(req.workload);
  const inputAdjustments = inputAdjustmentsFor(req.workload);

  // API cost is model+workload-dependent (GPU-independent) → assert identical across candidates (P2-1).
  const apiValues = new Set(evaluations.map((e) => e.cost.apiMonthly).filter((v): v is number => v != null).map((v) => Math.round(v)));
  if (apiValues.size > 1) throw new Error("recommend: API cost diverges across exact-model candidates");
  const apiMonthly = evaluations.find((e) => e.cost.apiMonthly != null)?.cost.apiMonthly
    ?? (candidates.length === 0 ? apiMonthlyForWorkload(req.workload, priceBook) : null);
  const apiOption: ApiOption = {
    modelId,
    monthlyCost: apiMonthly,
    priceState: apiMonthly != null ? "priced" : "no-price",
    comparisonQualified: apiMonthly != null,
  };

  const decision = deriveDecision(evaluations, apiOption, { modelSelfHostable });

  // Ranking (deterministic total order); best-first over eligible candidates.
  const ranked = rankSelfHost(evaluations, req.optimizeFor);
  const best = ranked[0] ?? null;
  const bestCost = best?.cost.selfHostMonthly ?? null;
  const bestSelfHost = best ? toCard("best-self-host", best, bestCost) : null;

  // Alternatives: best eligible per axis, included only when a DISTINCT candidate id (rev-5).
  const alternatives: Card[] = [];
  const shownIds = new Set<string>(best ? [best.config.id] : []);
  const addAxis = (kind: Card["kind"], axis: OptimizeFor) => {
    const top = rankSelfHost(evaluations, axis)[0];
    if (top && !shownIds.has(top.config.id)) {
      shownIds.add(top.config.id);
      alternatives.push(toCard(kind, top, bestCost));
    }
  };
  addAxis("lowest-cost", "cost");
  addAxis("highest-confidence", "confidence");
  addAxis("lowest-latency", "latency");

  const rejected: Rejection[] = evaluations
    .filter((e) => !e.recommendationEligible)
    .map((e) => ({ config: e.config, code: e.rejections[0].code, message: e.rejections[0].message }))
    .sort(byId);

  // Pricing provenance — reconciled gpu-price source across candidates (P1-6).
  const gpuSources = new Set(runs.map((r) => r.gpuPriceSource));
  const gpuPriceSource: PricingProvenance["gpuPriceSource"] =
    gpuSources.size === 0 ? "fallback" : gpuSources.size === 1 ? [...gpuSources][0] : "mixed";
  const pricing: PricingProvenance = { source: priceBook.source, asOf: priceBook.updatedAt, region: priceBook.region, gpuPriceSource };

  const result: StructuredRecommendationResult = {
    decision,
    apiOption,
    bestSelfHost,
    alternatives,
    rejected,
    evaluations: [...evaluations].sort(byId), // deterministic regardless of catalog order
    mode,
    effectiveWorkload,
    inputAdjustments,
    pricing,
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
