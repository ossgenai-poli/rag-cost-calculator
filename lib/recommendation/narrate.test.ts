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
  it("R1: API wins; names claude-fable-5 API vs deepseek-v4-pro-oss / p6-b200 self-host", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    expect(n.decision.choice).toBe("api");
    expect(n.decision.rationale).toMatch(/^Recommendation: use the claude-fable-5 API/);
    expect(n.decision.rationale).toContain("deepseek-v4-pro-oss");
    expect(n.decision.rationale).toContain("p6-b200.48xlarge");
    expect(n.decision.rationale).not.toMatch(/Recommendation: self-host/);
    // bestSelfHost is still described (as the best self-host option), with fleet.equation verbatim
    expect(n.bestSelfHost!.bindingConstraint).toContain("221461 prefill tok/s");
    expect(n.bestSelfHost!.bindingConstraint).toContain("Confidence: measured-scaled");
    expect(n.bestSelfHost!.tradeoff).toContain("p6-b200.48xlarge");
    expect(n.bestSelfHost!.tradeoff).toContain("on-demand base rate");
  });

  it("R3/R4: evidence-gap; does NOT compare the heuristic dollar figure as a qualified decision", () => {
    for (const cand of [C.h200Int4, C.h100Int4]) {
      mockedCatalog.mockReturnValue([cand]);
      const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
      expect(n.decision).toMatchObject({ choice: "api", basis: "evidence-gap" });
      expect(n.decision.rationale).toContain("qualifying benchmark evidence");
      expect(n.bestSelfHost).toBeNull();
      expect(n.decision.rationale).not.toMatch(/554,420|522,330|lower-cost/); // heuristic $ never a qualified comparison
    }
  });

  it("experimental R1: unbenchmarked/evidence-gap; registry limit is internal, not customer input", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const n = narrate(recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "evidence-gap" });
    expect(n.decision.rationale).toContain("internal evidence-metadata limitation");
    expect(n.decision.rationale).not.toMatch(/invalid (request|input)|your input/i);
  });

  it("low-TTFT: API due to SLA, not technical infeasibility", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.ttftTargetMs = 100;
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "sla" });
    expect(n.decision.rationale).toContain("cannot meet the interactivity / TTFT SLA");
    expect(n.decision.rationale).not.toMatch(/infeasible/);
  });

  it("no-modeled-candidate: coverage gap, not 'cannot self-host'", () => {
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]);
    const w = dsv4Workload(); w.generation.llmModelId = "minimax-m3-oss";
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.decision).toMatchObject({ choice: "api", basis: "no-modeled-candidate" });
    expect(n.decision.rationale).toContain("catalog-coverage gap");
    expect(n.decision.rationale).not.toMatch(/cannot self-host|not self-hostable/i);
  });

  it("alternate API model identity is named", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "claude-opus-4-8";
    const n = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(n.apiOption.modelId).toBe("claude-opus-4-8");
    expect(n.decision.rationale).toContain("the claude-opus-4-8 API");
  });

  it("input adjustments (topN clamp, uptime cap, 0→730) are disclosed from inputAdjustments", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w1 = dsv4Workload(); w1.retrieval.topK = 3; w1.retrieval.topN = 9; w1.generation.gpuUptimeHoursPerMonth = 1000;
    expect(narrate(recommend({ workload: w1, optimizeFor: "cost" })).decision.rationale).toContain("retrieval.topN 9→3");
    expect(narrate(recommend({ workload: w1, optimizeFor: "cost" })).decision.rationale).toContain("gpuUptimeHoursPerMonth 1000→730");
    const w2 = dsv4Workload(); w2.generation.gpuUptimeHoursPerMonth = 0;
    expect(narrate(recommend({ workload: w2, optimizeFor: "cost" })).decision.rationale).toContain("gpuUptimeHoursPerMonth 0→730");
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
      apiOption: { modelId: "claude-fable-5", monthlyCost: null, priceState: "no-price", comparisonQualified: false },
      bestSelfHost: null, alternatives: [], rejected: [], evaluations: [], mode: "control",
      effectiveWorkload: { generation: { llmModelId: "deepseek-v4-pro-oss" } },
      inputAdjustments: [], pricing: { source: "fallback", asOf: "2026-07-14", region: "us-east-1", gpuPriceSource: "fallback" },
    } as unknown as StructuredRecommendationResult;
    const n = narrate(fixture);
    expect(n.decision.rationale).toContain("undetermined");
    expect(n.decision.rationale).toContain("no cost winner is asserted");
    expect(n.decision.rationale).not.toMatch(/lower-cost/);
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
