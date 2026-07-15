// Narrative generator tests. narrate() consumes STRUCTURED fields only. The catalog is module-mocked
// per case (via the sweep) so structured facts come from the real approved sweep.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./candidate-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-catalog")>();
  return { ...actual, loadCandidateCatalog: vi.fn(actual.loadCandidateCatalog) };
});

import { recommend } from "./recommend";
import { narrate } from "./narrate";
import { loadCandidateCatalog, PINNED_CANDIDATES } from "./candidate-catalog";
import { defaultInputs } from "../calc-engine";
import type { CalcInputs, PriceBook } from "../types";
import type { StructuredRecommendationResult } from "./schema";
import pricesJson from "../../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const mockedCatalog = vi.mocked(loadCandidateCatalog);
beforeEach(() => mockedCatalog.mockReset());

const C = {
  b200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!,
  h200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5e.48xlarge·w4kv16")!,
  h100Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5.48xlarge·w4kv16")!,
};
function dsv4Workload(volume = 200_000_000): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  i.generation.outTokens = 500;
  i.traffic.queriesPerMonth = volume;
  i.traffic.peakFactor = 1;
  return i;
}
const allNarratedStrings = (n: ReturnType<typeof narrate>): string[] => {
  const s = [n.caption, n.decision.rationale];
  if (n.bestSelfHost) s.push(n.bestSelfHost.bindingConstraint, n.bestSelfHost.tradeoff);
  for (const a of n.alternatives) s.push(a.bindingConstraint, a.tradeoff);
  return s;
};

describe("narrate — decision leads; both models named; bestSelfHost never the overall rec when api", () => {
  it("R1: API wins; names Claude Fable API vs DeepSeek/B200 self-host (trusted labels, cheapest comparator)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    expect(n.decision.choice).toBe("api");
    expect(n.decision.rationale).toMatch(/^Recommendation: use the Claude Fable 5 \(Bedrock\) API/);
    expect(n.decision.rationale).toContain("DeepSeek-V4-Pro (open weights)");
    expect(n.decision.rationale).toContain("p6-b200.48xlarge");
    expect(n.decision.rationale).toContain("cheapest qualified self-host option"); // comparator-based phrase
    expect(n.decision.rationale).not.toMatch(/Recommendation: self-host/);
    // customer labels in prose; raw ids stay in the audit structure (P2-NARR-1)
    expect(n.decision.rationale).not.toMatch(/claude-fable-5|deepseek-v4-pro-oss/);
    expect(n.apiOption.modelId).toBe("claude-fable-5");
    // cross-model caveat present when the compared models differ
    expect(n.decision.rationale).toContain("capability and quality equivalence are not established");
    // bestSelfHost is still described (as the best self-host option), with fleet.equation verbatim
    expect(n.bestSelfHost!.bindingConstraint).toContain("221461 prefill tok/s");
    expect(n.bestSelfHost!.bindingConstraint).toContain("Confidence: measured-scaled");
    expect(n.bestSelfHost!.tradeoff).toContain("p6-b200.48xlarge");
    expect(n.bestSelfHost!.tradeoff).toContain("on-demand base rate");
  });

  it("R3/R4: evidence-gap names the ACTUAL evidence state (heuristic); no heuristic-$ comparison", () => {
    for (const cand of [C.h200Int4, C.h100Int4]) {
      mockedCatalog.mockReturnValue([cand]);
      const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
      expect(n.decision).toMatchObject({ choice: "api", basis: "evidence-gap" });
      expect(n.decision.rationale).toContain("qualifying benchmark evidence");
      expect(n.decision.rationale).toContain("Available evidence state: heuristic"); // P1-NARR-1: derived, exact
      expect(n.bestSelfHost).toBeNull();
      expect(n.decision.rationale).not.toMatch(/554,420|522,330|lower-cost/); // heuristic $ never a qualified comparison
    }
  });

  it("experimental R1: evidence state says unbenchmarked — never a hardcoded heuristic/extrapolated claim", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "evidence-gap" });
    expect(n.decision.rationale).toContain("Available evidence state: unbenchmarked"); // P1-NARR-1
    expect(n.decision.rationale).not.toMatch(/heuristic|extrapolated/); // no invented categories
    expect(n.decision.rationale).toContain("internal evidence-metadata limitation");
    expect(n.decision.rationale).not.toMatch(/invalid (request|input)|your input/i);
  });

  it("P1-NARR-1: a mixed fixture lists the actual unique evidence states deterministically", () => {
    mockedCatalog.mockReturnValue([C.h200Int4, C.h100Int4]);
    const s = recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true });
    // H200/H100 heuristic engine state is demoted to unbenchmarked by the pinned registry; force a mixed
    // set by narrating a fixture that combines both states at the gate.
    const mixed = {
      ...s,
      evaluations: [
        { ...s.evaluations[0], effectiveConfidence: "heuristic" },
        { ...s.evaluations[1], effectiveConfidence: "unbenchmarked" },
      ],
    } as typeof s;
    const n = narrate(mixed);
    expect(n.decision.rationale).toContain("Available evidence states: heuristic, unbenchmarked"); // rank-desc, stable
    expect(JSON.stringify(narrate(mixed))).toBe(JSON.stringify(narrate(mixed))); // deterministic
  });

  it("low-TTFT: API due to SLA, not technical infeasibility", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.ttftTargetMs = 100;
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "sla" });
    expect(n.decision.rationale).toContain("cannot meet the interactivity / TTFT SLA");
    expect(n.decision.rationale).not.toMatch(/infeasible/);
  });

  it("P1-UI-4: API-only model → availability wording; NEVER 'technically (in)feasible'", () => {
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]);
    const w = dsv4Workload(); w.generation.llmModelId = "claude-opus-4-8";
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "self-host-unavailable", availability: { reason: "api-only" } });
    expect(n.decision.rationale).toContain("This model is available through the API only; self-host weights are not available, so no self-host cost comparison was performed.");
    expect(n.decision.rationale).not.toMatch(/technically\s+(in)?feasible/i);
  });

  it("P1-UI-4: genuine infeasibility keeps its own wording (states not conflated)", () => {
    // Structured fixture: self-hostable model, basis self-host-infeasible → the technical wording.
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]);
    const s = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const shaped = { ...s, decision: { choice: "api" as const, basis: "self-host-infeasible" as const } };
    const n = narrate(shaped);
    expect(n.decision.rationale).toContain("is technically feasible for this workload");
    expect(n.decision.rationale).not.toContain("available through the API only");
  });

  it("no-modeled-candidate: coverage gap, not 'cannot self-host'", () => {
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]);
    const w = dsv4Workload(); w.generation.llmModelId = "minimax-m3-oss";
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "no-modeled-candidate" });
    expect(n.decision.rationale).toContain("catalog-coverage gap");
    expect(n.decision.rationale).not.toMatch(/cannot self-host|not self-hostable/i);
  });

  it("alternate API model identity is named (trusted label; id preserved in structure)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "claude-opus-4-8";
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.apiOption.modelId).toBe("claude-opus-4-8");
    expect(n.apiOption.modelLabel).toBe("Claude Opus 4.8 (Bedrock)");
    expect(n.decision.rationale).toContain("the Claude Opus 4.8 (Bedrock) API");
  });

  it("same-model comparison carries NO cross-model caveat", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "deepseek-v4-pro-oss"; // same model via API
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision.rationale).not.toContain("capability and quality equivalence");
  });

  it("input adjustments (topN clamp, uptime cap, 0→730) are disclosed from inputAdjustments", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w1 = dsv4Workload(); w1.retrieval.topK = 3; w1.retrieval.topN = 9; w1.generation.gpuUptimeHoursPerMonth = 1000;
    // Customer-readable labels in prose (P2-NARR-1); raw field paths stay in the structured audit data.
    const r1 = recommend({ workload: w1, optimizeFor: "cost" });
    expect(narrate(r1).decision.rationale).toContain("Context chunks sent to the model 9→3");
    expect(narrate(r1).decision.rationale).toContain("GPU fleet uptime hours/month 1000→730");
    expect(r1.inputAdjustments).toContainEqual({ field: "retrieval.topN", entered: 9, calculated: 3 }); // raw path preserved
    const w2 = dsv4Workload(); w2.generation.gpuUptimeHoursPerMonth = 0;
    expect(narrate(recommend({ workload: w2, optimizeFor: "cost" })).decision.rationale).toContain("GPU fleet uptime hours/month 0→730");
  });

  it("fallback pricing is disclosed; never claims 'live'", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    expect(n.decision.rationale).toContain("committed reference (fallback)");
    expect(n.decision.rationale).not.toMatch(/\blive price book\b/);
    expect(n.decision.rationale).toContain("us-east-1");
  });

  it("comparison-unavailable: no cost winner asserted (narrate over a structured fixture)", () => {
    const fixture = {
      decision: { choice: "undetermined", basis: "comparison-unavailable" },
      apiOption: { modelId: "claude-fable-5", modelLabel: "Claude Fable 5 (Bedrock)", monthlyCost: null, priceState: "no-price", comparisonQualified: false },
      bestSelfHost: null, alternatives: [], rejected: [], evaluations: [], mode: "control",
      selfHostModelLabel: "DeepSeek-V4-Pro (open weights)",
      effectiveWorkload: { generation: { llmModelId: "deepseek-v4-pro-oss" } },
      inputAdjustments: [], pricing: { source: "fallback", asOf: "2026-07-14", region: "us-east-1", gpuPriceSource: "fallback" },
    } as unknown as StructuredRecommendationResult;
    const n = narrate(fixture);
    expect(n.decision.rationale).toContain("undetermined");
    expect(n.decision.rationale).toContain("no cost winner is asserted");
    expect(n.decision.rationale).not.toMatch(/lower-cost/);
  });
});

describe("narrate — P1-NARR-2: cost prose uses the persisted comparator, never bestSelfHost", () => {
  // Synthetic multi-candidate structured fixtures: the optimization-selected bestSelfHost differs from the
  // cheapest comparison-qualified comparator.
  const sf = (inst: string) => ({ instanceType: inst, gpuSku: "B200", weightBits: 4, kvBits: 16, weightPrecision: "fp4", kvPrecision: "bf16", gpuPricePerHr: 113, gpuPriceSource: "fallback", gpuPricingModel: "on-demand", uptimeHours: 730, utilTarget: 0.7 });
  const ev = (id: string, inst: string, selfCost: number) => ({
    config: { id, llmModelId: "deepseek-v4-pro-oss", instanceType: inst, gpuSku: "B200", weightBits: 4, kvBits: 16, label: id },
    technicallyFeasible: true, slaQualified: true, evidenceQualified: true, priceQualified: true, comparisonQualified: true,
    recommendationEligible: true, engineConfidence: "measured-scaled", effectiveConfidence: "measured-scaled",
    fleet: { boxes: 10, bindingDim: "prefill", equation: "eq" },
    cost: { selfHostMonthly: selfCost, apiMonthly: 6_492_000, verdict: "api-wins" },
    servingFacts: sf(inst), ttftS: 1.0, ttftPercentile: "p99", rejections: [],
  });
  const base = (decision: object, evals: object[], bestId: string) => ({
    decision,
    apiOption: { modelId: "claude-fable-5", modelLabel: "Claude Fable 5 (Bedrock)", monthlyCost: 6_492_000, priceState: "priced", comparisonQualified: true },
    bestSelfHost: { kind: "best-self-host", config: (evals.find((e: any) => e.config.id === bestId) as any).config, costMonthly: 7_176_630, costDeltaVsBest: 0, confidence: "measured-scaled" },
    alternatives: [], rejected: [], evaluations: evals, mode: "control",
    selfHostModelLabel: "DeepSeek-V4-Pro (open weights)",
    effectiveWorkload: { generation: { llmModelId: "deepseek-v4-pro-oss" } },
    inputAdjustments: [], pricing: { source: "fallback", asOf: "2026-07-14", region: "us-east-1", gpuPriceSource: "fallback" },
  }) as unknown as StructuredRecommendationResult;

  it("self-host wins: names the CHEAPEST comparator ($5.0M), not the optimization-selected bestSelfHost ($7.18M)", () => {
    const evals = [ev("dear-best", "p6-b200.48xlarge", 7_176_630), ev("cheap-cmp", "p5e.48xlarge", 5_000_000)];
    const n = narrate(base({ choice: "self-host", basis: "lower-cost", costComparator: { selfHostCandidateId: "cheap-cmp", selfHostMonthly: 5_000_000, apiMonthly: 6_492_000 } }, evals, "dear-best"));
    expect(n.decision.rationale).toContain("$5,000,000/month");
    expect(n.decision.rationale).toContain("p5e.48xlarge"); // the comparator's instance
    expect(n.decision.rationale).not.toContain("$7,176,630"); // never the dearer bestSelfHost
    // the claimed inequality holds: 5,000,000 < 6,492,000
    expect(n.decision.rationale).toContain("lower-cost than the Claude Fable 5 (Bedrock) API at $6,492,000/month");
  });

  it("API wins: compares against the cheapest comparator and the inequality holds", () => {
    const evals = [ev("dear-best", "p6-b200.48xlarge", 8_000_000), ev("cheap-cmp", "p5e.48xlarge", 7_000_000)];
    const n = narrate(base({ choice: "api", basis: "lower-cost", costComparator: { selfHostCandidateId: "cheap-cmp", selfHostMonthly: 7_000_000, apiMonthly: 6_492_000 } }, evals, "dear-best"));
    expect(n.decision.rationale).toContain("use the Claude Fable 5 (Bedrock) API at $6,492,000/month");
    expect(n.decision.rationale).toContain("cheapest qualified self-host option");
    expect(n.decision.rationale).toContain("$7,000,000/month"); // the comparator, not the $8M bestSelfHost
    expect(n.decision.rationale).not.toContain("$8,000,000");
  });

  it("absent/inconsistent comparator → neutral wording, no dollar winner asserted", () => {
    const evals = [ev("only", "p6-b200.48xlarge", 7_176_630)];
    // comparator id that does not exist in evaluations → fail closed to neutral
    const n = narrate(base({ choice: "api", basis: "lower-cost", costComparator: { selfHostCandidateId: "ghost", selfHostMonthly: 1, apiMonthly: 6_492_000 } }, evals, "only"));
    expect(n.decision.rationale).toContain("comparison details unavailable");
    expect(n.decision.rationale).not.toMatch(/lower-cost than/);
    // inconsistent amounts (claimed inequality violated) → also neutral
    const n2 = narrate(base({ choice: "api", basis: "lower-cost", costComparator: { selfHostCandidateId: "only", selfHostMonthly: 1_000_000, apiMonthly: 6_492_000 } }, evals, "only"));
    expect(n2.decision.rationale).toContain("comparison details unavailable"); // 6.49M ≤ 1M is false → fail closed
  });

  it("P1-NARR-3: tampered comparator API amount ($1 vs apiOption $6.492M) → neutral", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const s = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    (s.decision.costComparator as any).apiMonthly = 1; // tamper: apiOption.monthlyCost stays 6,492,000
    const n = narrate(s);
    expect(n.decision.rationale).toContain("comparison details unavailable");
    expect(n.decision.rationale).not.toContain("$1/month");
    expect(n.decision.rationale).not.toMatch(/lower-cost than/);
  });

  it("P1-NARR-3: a rejected/evidence-unqualified candidate as comparator → neutral (never recommended)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.h200Int4]);
    const s = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const h200 = s.evaluations.find((e) => e.config.id === C.h200Int4.id)!; // heuristic, recommendationEligible=false
    expect(h200.recommendationEligible).toBe(false);
    s.decision = {
      choice: "self-host",
      basis: "lower-cost",
      costComparator: { selfHostCandidateId: h200.config.id, selfHostMonthly: h200.cost.selfHostMonthly!, apiMonthly: s.apiOption.monthlyCost! },
    };
    const n = narrate(s); // amounts reconcile and the inequality holds — eligibility alone must fail it closed
    expect(n.decision.rationale).toContain("comparison details unavailable");
    expect(n.decision.rationale).not.toContain("$554,420");
    expect(n.decision.rationale).not.toMatch(/lower-cost than/);
  });

  it("P1-NARR-3: a valid but NON-CHEAPEST qualified candidate as comparator → neutral", () => {
    // Both candidates fully eligible/qualified; comparator points at the dearer one with amounts that
    // reconcile and an inequality that holds — but it is not the deterministic cheapest → neutral.
    const evals = [ev("cheap", "p5e.48xlarge", 5_000_000), ev("dear", "p6-b200.48xlarge", 7_176_630)];
    const n = narrate(base({ choice: "api", basis: "lower-cost", costComparator: { selfHostCandidateId: "dear", selfHostMonthly: 7_176_630, apiMonthly: 6_492_000 } }, evals, "dear"));
    expect(n.decision.rationale).toContain("comparison details unavailable");
    expect(n.decision.rationale).not.toContain("$7,176,630");
    expect(n.decision.rationale).not.toMatch(/lower-cost than/);
  });
});

describe("narrate — determinism + prose hygiene", () => {
  it("byte-identical narration for identical structured input", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.h200Int4, C.h100Int4]);
    const s = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(JSON.stringify(narrate(s))).toBe(JSON.stringify(narrate(s)));
  });
  it("no NaN/undefined; no unsupported Measured or percentile claim; no contradictory recommendation", () => {
    for (const set of [[C.b200Int4], [C.h200Int4], [C.b200Int4, C.h200Int4, C.h100Int4]]) {
      mockedCatalog.mockReturnValue(set);
      const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
      for (const str of allNarratedStrings(n)) {
        expect(str).not.toMatch(/NaN|undefined/);
        // "Measured" must only appear as the measured/measured-scaled confidence token
        if (/measured/i.test(str)) expect(str).toMatch(/Confidence: measured(-scaled)?|confidence measured(-scaled)?/);
        // percentile only when supported (heuristic cards carry no p99 claim)
        if (n.bestSelfHost && n.bestSelfHost.confidence === "heuristic") expect(str).not.toMatch(/P99|P95/);
      }
      if (n.decision.choice === "api") expect(n.decision.rationale).not.toMatch(/Recommendation: self-host/);
    }
  });
});
