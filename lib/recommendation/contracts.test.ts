// Phase-1 contract tests — LOCK the decision precedence, evidence reconciliation, ranking and registry
// mapping BEFORE the sweep is built (reviewer point 6). Pure logic over synthetic fixtures + one real
// registry-incompleteness probe. No engine run needed here (the R1-R5 numeric assertions live with the
// sweep, which drives the frozen calculate()).
import { describe, it, expect } from "vitest";
import type { ApiOption, CandidateEvaluation, RegistryEvidence, StructuredRecommendationResult } from "./schema";
import { deriveDecision } from "./decision";
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
  ttftS: 1.22,
  ttftPercentile: "p99",
  rejections: [],
  ...o,
});
const apiFix = (o: Partial<ApiOption> = {}): ApiOption => ({ modelId: "dsv4", monthlyCost: 6_492_000, priceState: "priced", comparisonQualified: true, ...o });

describe("decision precedence (deterministic, first-match-wins)", () => {
  it("technically infeasible takes precedence over SLA / evidence gap", () => {
    // Even with (contradictory) sla+evidence flags set, infeasibility wins.
    const d = deriveDecision([evalFix({ technicallyFeasible: false })], apiFix());
    expect(d).toEqual({ choice: "api", basis: "self-host-infeasible" });
  });
  it("SLA failure takes precedence over evidence gap", () => {
    const d = deriveDecision([evalFix({ slaQualified: false, evidenceQualified: false })], apiFix());
    expect(d).toEqual({ choice: "api", basis: "sla" });
  });
  it("a heuristic-only candidate → evidence-gap (feasible + SLA, not evidence-qualified)", () => {
    const d = deriveDecision([evalFix({ evidenceQualified: false, engineConfidence: "heuristic", effectiveConfidence: "heuristic" })], apiFix());
    expect(d).toEqual({ choice: "api", basis: "evidence-gap" });
  });
  it("missing self-host price → undetermined / comparison-unavailable", () => {
    const d = deriveDecision([evalFix({ priceQualified: false, cost: { selfHostMonthly: null, apiMonthly: 6_492_000, verdict: "undetermined" } })], apiFix());
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
  it("missing API price → undetermined / comparison-unavailable", () => {
    const d = deriveDecision([evalFix()], apiFix({ monthlyCost: null, priceState: "no-price", comparisonQualified: false }));
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });
  it("R1/R5-shape: evidence-qualified self-host dearer than API → api / lower-cost", () => {
    expect(deriveDecision([evalFix()], apiFix())).toEqual({ choice: "api", basis: "lower-cost" });
  });
  it("an evidence-qualified self-host cheaper than API → self-host / lower-cost", () => {
    const d = deriveDecision([evalFix({ cost: { selfHostMonthly: 100, apiMonthly: 6_492_000, verdict: "self-host-efficient" } })], apiFix());
    expect(d).toEqual({ choice: "self-host", basis: "lower-cost" });
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
    const d1 = deriveDecision([cheapSlow, dearFast], api);
    const d2 = deriveDecision([cheapSlow, dearFast], api);
    expect(d1).toEqual({ choice: "api", basis: "lower-cost" }); // 500 <= 1000
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
    };
    // No `rationale` / `bindingConstraint` / `tradeoff` fields exist on the structured result.
    expect("rationale" in (structured.decision as object)).toBe(false);
    expect(structured.bestSelfHost && "bindingConstraint" in structured.bestSelfHost).toBe(false);
  });
});
