// Phase-1 contract tests — LOCK the decision precedence, evidence reconciliation, ranking and registry
// mapping BEFORE the sweep is built (reviewer point 6). Pure logic over synthetic fixtures + one real
// registry-incompleteness probe. No engine run needed here (the R1-R5 numeric assertions live with the
// sweep, which drives the frozen calculate()).
import { describe, it, expect } from "vitest";
import type { ApiOption, CandidateEvaluation, RegistryEvidence, StructuredRecommendationResult } from "./schema";
import { deriveDecision } from "./decision";
import { engineConfidenceFrom } from "./recommend";
import type { CapacityResult } from "../types";
import { reconcileConfidence } from "./reconcile";
import { rankSelfHost } from "./ranking";
import { buildRegistryRequest } from "./registry-request";
import { resolveOperatingPoint } from "../benchmark-registry";

const evalFix = (o: Partial<CandidateEvaluation> = {}): CandidateEvaluation => ({
  config: { id: "c", llmModelId: "dsv4", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, label: "p6-b200 · INT4" },
  technicallyFeasible: true,
  slaQualified: true,
  evidenceQualified: true,
  priceQualified: true,
  comparisonQualified: true,
  recommendationEligible: true,
  engineConfidence: "measured-scaled",
  effectiveConfidence: "measured-scaled",
  fleet: { boxes: 87, bindingDim: "prefill", equation: "" },
  cost: { selfHostMonthly: 7_176_630, apiMonthly: 6_492_000, verdict: "api-wins" },
  servingFacts: { instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, weightPrecision: "fp4", kvPrecision: "bf16", gpuPricePerHr: 113, gpuPriceSource: "fallback", gpuPricingModel: "on-demand", uptimeHours: 730, utilTarget: 0.7 },
  ttftS: 1.22,
  ttftPercentile: "p99",
  rejections: [],
  ...o,
});
const apiFix = (o: Partial<ApiOption> = {}): ApiOption => ({ modelId: "dsv4", modelLabel: "DeepSeek-V4-Pro (open weights)", monthlyCost: 6_492_000, priceState: "priced", comparisonQualified: true, ...o });

describe("decision precedence (deterministic, first-match-wins)", () => {
  it("technically infeasible takes precedence over SLA / evidence gap", () => {
    // Even with (contradictory) sla+evidence flags set, infeasibility wins.
    const d = deriveDecision([evalFix({ technicallyFeasible: false })], apiFix(), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "api", basis: "self-host-infeasible" });
  });
  it("SLA failure takes precedence over evidence gap", () => {
    const d = deriveDecision([evalFix({ slaQualified: false, evidenceQualified: false })], apiFix(), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "api", basis: "sla" });
  });
  it("a heuristic-only candidate → evidence-gap (feasible + SLA, not evidence-qualified)", () => {
    const d = deriveDecision([evalFix({ evidenceQualified: false, engineConfidence: "heuristic", effectiveConfidence: "heuristic" })], apiFix(), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "api", basis: "evidence-gap" });
  });
  it("missing self-host price → undetermined / comparison-unavailable", () => {
    const d = deriveDecision([evalFix({ priceQualified: false, comparisonQualified: false, cost: { selfHostMonthly: null, apiMonthly: 6_492_000, verdict: "undetermined" } })], apiFix(), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
  it("missing API price → undetermined / comparison-unavailable", () => {
    const d = deriveDecision([evalFix()], apiFix({ monthlyCost: null, priceState: "no-price", comparisonQualified: false }), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
  it("R1/R5-shape: evidence-qualified self-host dearer than API → api / lower-cost (+ persisted comparator)", () => {
    const d = deriveDecision([evalFix()], apiFix(), { modelSelfHostable: true });
    expect(d).toMatchObject({ choice: "api", basis: "lower-cost" });
    expect(d.costComparator).toEqual({ selfHostCandidateId: "c", selfHostMonthly: 7_176_630, apiMonthly: 6_492_000 });
  });
  it("an evidence-qualified self-host cheaper than API → self-host / lower-cost (+ persisted comparator)", () => {
    const d = deriveDecision([evalFix({ cost: { selfHostMonthly: 100, apiMonthly: 6_492_000, verdict: "self-host-efficient" } })], apiFix(), { modelSelfHostable: true });
    expect(d).toMatchObject({ choice: "self-host", basis: "lower-cost" });
    expect(d.costComparator).toEqual({ selfHostCandidateId: "c", selfHostMonthly: 100, apiMonthly: 6_492_000 });
  });
  it("P1-NARR-2: the comparator is the CHEAPEST qualified self-host with a cost→id tie-break", () => {
    const cheap = evalFix({ config: { ...evalFix().config, id: "b-cheap" }, cost: { selfHostMonthly: 5_000_000, apiMonthly: 6_492_000, verdict: "self-host-efficient" } });
    const dear = evalFix({ config: { ...evalFix().config, id: "a-dear" }, cost: { selfHostMonthly: 7_176_630, apiMonthly: 6_492_000, verdict: "api-wins" } });
    const d = deriveDecision([dear, cheap], apiFix(), { modelSelfHostable: true });
    expect(d).toMatchObject({ choice: "self-host", basis: "lower-cost" });
    expect(d.costComparator!.selfHostCandidateId).toBe("b-cheap"); // cheapest, not first/alphabetical
    // exact cost tie → lexicographic id tie-break
    const tie1 = evalFix({ config: { ...evalFix().config, id: "z" }, cost: { selfHostMonthly: 100, apiMonthly: 6_492_000, verdict: "self-host-efficient" } });
    const tie2 = evalFix({ config: { ...evalFix().config, id: "a" }, cost: { selfHostMonthly: 100, apiMonthly: 6_492_000, verdict: "self-host-efficient" } });
    expect(deriveDecision([tie1, tie2], apiFix(), { modelSelfHostable: true }).costComparator!.selfHostCandidateId).toBe("a");
  });
  it("non-lower-cost bases carry NO comparator", () => {
    expect(deriveDecision([evalFix({ evidenceQualified: false })], apiFix(), { modelSelfHostable: true }).costComparator).toBeUndefined();
  });
});

describe("optimizeFor ranks self-host candidates but never flips the top-level decision", () => {
  const cheapSlow = evalFix({ config: { ...evalFix().config, id: "a" }, cost: { selfHostMonthly: 1000, apiMonthly: 500, verdict: "api-wins" }, ttftS: 2.0 });
  const dearFast = evalFix({ config: { ...evalFix().config, id: "b" }, cost: { selfHostMonthly: 2000, apiMonthly: 500, verdict: "api-wins" }, ttftS: 0.5 });
  const api = apiFix({ monthlyCost: 500 });
  it("bestSelfHost changes with the axis", () => {
    expect(rankSelfHost([cheapSlow, dearFast], "cost")[0].config.id).toBe("a");
    expect(rankSelfHost([cheapSlow, dearFast], "latency")[0].config.id).toBe("b");
  });
  it("the API/self-host decision is identical across axes (uses the cheapest self-host vs API)", () => {
    const d1 = deriveDecision([cheapSlow, dearFast], api, { modelSelfHostable: true });
    const d2 = deriveDecision([cheapSlow, dearFast], api, { modelSelfHostable: true });
    expect(d1).toMatchObject({ choice: "api", basis: "lower-cost" }); // 500 <= 1000
    expect(d1.costComparator!.selfHostCandidateId).toBe("a"); // the CHEAPEST, regardless of axis
    expect(d2).toEqual(d1);
  });
  it("null TTFT ranks last for latency", () => {
    const noTtft = evalFix({ config: { ...evalFix().config, id: "z" }, ttftS: null });
    expect(rankSelfHost([noTtft, dearFast], "latency")[0].config.id).toBe("b");
  });
});

describe("evidence reconciliation (demote-only)", () => {
  const unben: RegistryEvidence = { status: "unbenchmarked", confidence: "unbenchmarked", differsFromControl: true, reasons: [] };
  it("control mode returns the engine confidence unchanged", () => {
    expect(reconcileConfidence("measured-scaled", unben, "control")).toBe("measured-scaled");
  });
  it("experimental + registry unbenchmarked → effectiveConfidence unbenchmarked", () => {
    expect(reconcileConfidence("measured-scaled", unben, "experimental")).toBe("unbenchmarked");
  });
  it("the registry can never PROMOTE (a strong registry class does not raise a heuristic engine result)", () => {
    const strong: RegistryEvidence = { status: "selected", confidence: "open-reproducible", differsFromControl: false, reasons: [] };
    expect(reconcileConfidence("heuristic", strong, "experimental")).toBe("heuristic");
  });
  it("the registry demotes to the WORSE of the two", () => {
    const proxy: RegistryEvidence = { status: "selected", confidence: "proxy", differsFromControl: false, reasons: [] };
    expect(reconcileConfidence("measured", proxy, "experimental")).toBe("proxy");
  });
});

describe("registry mapping stays honest — incomplete mapping is invalid/unbenchmarked", () => {
  const candidate = { id: "c", llmModelId: "dsv4", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, label: "p6-b200 · INT4" };
  const workload = { generation: { outTokens: 500, ttftTargetMs: 2000, interactivityTarget: 30 } } as any;
  const calc = { perQuery: { llmInputTok: 2910 }, crossover: { capacity: { gpusInConfig: 8, chosenConcurrency: 8, framework: "trt", benchmarkProvenance: undefined } } } as any;
  const req = buildRegistryRequest(candidate, workload, calc);

  it("leaves unknown decision-critical fields UNSET (never invented)", () => {
    expect(req.checkpoint).toBeUndefined();
    expect(req.prefixCache).toBeUndefined();
    expect(req.specDecode).toBeUndefined();
    expect(req.parallelism).toBeUndefined();
  });
  it("the registry rejects the incomplete request (invalid-request, not a fabricated selection)", () => {
    const res = resolveOperatingPoint(req, { mode: "experimental" });
    expect(res.status).toBe("invalid-request");
  });
});

describe("P1-4 — engine evidence classification requires a traceable, allowed transformation", () => {
  // A measured-scaled RESULT must be a traceable, same-precision, ISL-scaled measurement.
  const capBase = (o: Partial<CapacityResult>): CapacityResult => ({
    source: "extrapolated", benchmarkAvailable: true, prefillEstimated: false, prefillIslScale: 2.84,
    precisionUsed: "fp4", precisionRequested: "fp4",
    extrapolationReasons: ["input length 2910 not close to benchmarked ISL 1024"], // permitted sequence-length transform
    benchmarkProvenance: { source: "InferenceX", sourceUrl: "u", methodologyUrl: "m", asOf: "2026-07-14", runId: "1", runUrl: "r", commit: "c", date: "d", image: "i", specMethod: "none", disagg: false, topology: "t" },
    ...o,
  } as CapacityResult);
  it("traceable, same-precision, ISL-scaled → measured-scaled (R1 behavior preserved)", () => {
    expect(engineConfidenceFrom(capBase({}))).toBe("measured-scaled");
  });
  it("untraceable provenance (no benchmarkProvenance) → extrapolated (fails evidence)", () => {
    expect(engineConfidenceFrom(capBase({ benchmarkProvenance: undefined }))).toBe("extrapolated");
  });
  it("estimated prefill (partial/untraceable) → extrapolated", () => {
    expect(engineConfidenceFrom(capBase({ prefillEstimated: true }))).toBe("extrapolated");
  });
  it("no ISL-scale transform recorded → extrapolated", () => {
    expect(engineConfidenceFrom(capBase({ prefillIslScale: undefined }))).toBe("extrapolated");
  });
  it("precision substitution (fp4 used for fp8) → extrapolated", () => {
    expect(engineConfidenceFrom(capBase({ precisionRequested: "fp8" }))).toBe("extrapolated");
  });
  it("HOLD-2 P1-1: a partial/non-whole topology reason → extrapolated, even with traceable provenance + ISL scale", () => {
    expect(engineConfidenceFrom(capBase({ extrapolationReasons: ["benchmark used 4 of 8 GPUs per box (partial box)"] }))).toBe("extrapolated");
    expect(engineConfidenceFrom(capBase({ extrapolationReasons: ["benchmark topology (64 GPUs) does not map to whole 8-GPU boxes"] }))).toBe("extrapolated");
    // mixed: a permitted sequence reason PLUS a disallowed topology reason → still extrapolated (EVERY reason must be permitted).
    expect(engineConfidenceFrom(capBase({ extrapolationReasons: ["input length 2910 not close to benchmarked ISL 1024", "benchmark used 4 of 8 GPUs per box (partial box)"] }))).toBe("extrapolated");
  });
  it("HOLD-2 P1-1: untraceable-provenance reason → extrapolated", () => {
    expect(engineConfidenceFrom(capBase({ extrapolationReasons: ["benchmark provenance is not traceable to a specific run"] }))).toBe("extrapolated");
  });
  it("heuristic / proxy stay themselves", () => {
    expect(engineConfidenceFrom(capBase({ source: "heuristic" }))).toBe("heuristic");
    expect(engineConfidenceFrom(capBase({ source: "proxy" }))).toBe("proxy");
  });
});

describe("P1-5 — deriveDecision requires comparisonQualified on BOTH sides", () => {
  it("candidate comparisonQualified=false (prices present) → comparison-unavailable", () => {
    const ev = evalFix({ comparisonQualified: false }); // priceQualified/costs still present
    expect(deriveDecision([ev], apiFix(), { modelSelfHostable: true })).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
  it("API comparisonQualified=false (monthlyCost present) → comparison-unavailable", () => {
    expect(deriveDecision([evalFix()], apiFix({ comparisonQualified: false }), { modelSelfHostable: true })).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
});

describe("P1-2/P1-UI-4 — availability vs coverage gap vs genuine infeasibility (never conflated)", () => {
  it("self-hostable model, no candidate → no-modeled-candidate", () => {
    expect(deriveDecision([], apiFix(), { modelSelfHostable: true })).toEqual({ choice: "api", basis: "no-modeled-candidate" });
  });
  it("non-self-hostable (API-only) model → self-host-unavailable with a reason code — NEVER infeasible", () => {
    const d = deriveDecision([], apiFix(), { modelSelfHostable: false });
    expect(d).toEqual({ choice: "api", basis: "self-host-unavailable", availability: { reason: "api-only" } });
  });
  it("availability is decided BEFORE technical feasibility (even with candidates present)", () => {
    // Contradictory fixture: candidates exist but the catalog says the model is not self-hostable —
    // the trusted availability fact wins, and the basis is unavailable, not any feasibility state.
    const d = deriveDecision([evalFix({ technicallyFeasible: false })], apiFix(), { modelSelfHostable: false });
    expect(d.basis).toBe("self-host-unavailable");
    expect(d.availability).toEqual({ reason: "api-only" });
  });
  it("genuine technical failure (self-hostable, candidates all infeasible) STAYS self-host-infeasible", () => {
    const d = deriveDecision([evalFix({ technicallyFeasible: false })], apiFix(), { modelSelfHostable: true });
    expect(d).toEqual({ choice: "api", basis: "self-host-infeasible" });
    expect(d.availability).toBeUndefined();
  });
});

describe("structured recommender carries NO prose (reviewer point 5)", () => {
  it("a StructuredRecommendationResult compiles and holds only facts", () => {
    const structured: StructuredRecommendationResult = {
      decision: { choice: "api", basis: "lower-cost" },
      apiOption: apiFix(),
      bestSelfHost: { kind: "best-self-host", config: evalFix().config, costMonthly: 7_176_630, costDeltaVsBest: 0, confidence: "measured-scaled" },
      alternatives: [],
      rejected: [],
      evaluations: [evalFix()],
      mode: "control",
      selfHostModelLabel: "DeepSeek-V4-Pro (open weights)",
      effectiveWorkload: {} as any,
      inputAdjustments: [],
      pricing: { source: "fallback", asOf: "2026-07-14", region: "us-east-1", gpuPriceSource: "fallback" },
    };
    // No `rationale` / `bindingConstraint` / `tradeoff` fields exist on the structured result.
    expect("rationale" in (structured.decision as object)).toBe(false);
    expect(structured.bestSelfHost && "bindingConstraint" in structured.bestSelfHost).toBe(false);
  });
});
