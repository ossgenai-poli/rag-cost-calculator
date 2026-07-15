// Phase-1 recommendation SWEEP acceptance tests. The candidate catalog is module-mocked (per case) so
// the PUBLIC recommend() still exposes no caller injection. Numbers are anchored to the signed-off
// rc-qa-11 reference cases R1-R5 (docs/ux-v2/18-reference-cases.md).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./candidate-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-catalog")>();
  return { ...actual, loadCandidateCatalog: vi.fn(actual.loadCandidateCatalog) };
});
// Spy seam for P2-1: wrap calculate() (calls through) so we can count invocations; keep everything else real.
vi.mock("../calc-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../calc-engine")>();
  return { ...actual, calculate: vi.fn(actual.calculate) };
});

import { recommend, evaluateCandidate } from "./recommend";
import { deriveDecision } from "./decision";
import { loadCandidateCatalog, validateCandidateCatalog, PINNED_CANDIDATES } from "./candidate-catalog";
import { defaultInputs, calculate } from "../calc-engine";
import type { CalcInputs, PriceBook } from "../types";
import type { CandidateConfig } from "./schema";
import pricesJson from "../../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const mockedCatalog = vi.mocked(loadCandidateCatalog);
beforeEach(() => mockedCatalog.mockReset());

const C = {
  b200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!,
  b200Fp8: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w8kv16")!,
  h200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5e.48xlarge·w4kv16")!,
  h100Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5.48xlarge·w4kv16")!,
};

/** The canonical dsv4 workload (18-reference-cases §canonical). GPU/precision are set per candidate. */
function dsv4Workload(volume = 200_000_000): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  i.generation.outTokens = 500;
  i.traffic.queriesPerMonth = volume;
  i.traffic.peakFactor = 1;
  return i;
}

describe("sweep — R1-R5 reference cases (decision + bestSelfHost)", () => {
  it("R1: api/lower-cost; bestSelfHost=p6-b200; 87 boxes; $7,176,630; prefill; measured-scaled", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.decision).toMatchObject({ choice: "api", basis: "lower-cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    expect(r.bestSelfHost!.confidence).toBe("measured-scaled");
    const ev = r.evaluations[0];
    expect(ev.fleet.boxes).toBe(87);
    expect(ev.fleet.bindingDim).toBe("prefill");
    expect(Math.round(ev.cost.selfHostMonthly!)).toBe(7_176_630);
    expect(Math.round(ev.cost.apiMonthly!)).toBe(6_492_000);
    expect(ev.recommendationEligible).toBe(true);
  });

  it("R2: FP8 rejected evidence-below-threshold; INT4 remains bestSelfHost", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    const fp8 = r.rejected.find((x) => x.config.id === C.b200Fp8.id)!;
    expect(fp8.code).toBe("evidence-below-threshold");
    const fp8ev = r.evaluations.find((e) => e.config.id === C.b200Fp8.id)!;
    expect(fp8ev.engineConfidence).toBe("extrapolated"); // fp4 substituted for fp8
    expect(fp8ev.technicallyFeasible).toBe(true);
    expect(fp8ev.evidenceQualified).toBe(false);
    expect(r.decision).toMatchObject({ choice: "api", basis: "lower-cost" });
  });

  it("R3: H200 technicallyFeasible=true, evidenceQualified=false; api/evidence-gap; bestSelfHost=null", () => {
    mockedCatalog.mockReturnValue([C.h200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const ev = r.evaluations[0];
    expect(ev.technicallyFeasible).toBe(true);
    expect(ev.evidenceQualified).toBe(false);
    expect(ev.engineConfidence).toBe("heuristic");
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
    expect(r.rejected[0].code).toBe("evidence-below-threshold");
  });

  it("R4: H100 behaves like R3 (heuristic → evidence-gap, bestSelfHost=null)", () => {
    mockedCatalog.mockReturnValue([C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.evaluations[0].technicallyFeasible).toBe(true);
    expect(r.evaluations[0].evidenceQualified).toBe(false);
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
  });

  it("R5: api/lower-cost; bestSelfHost=p6-b200; 4 boxes; $329,960", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    expect(r.decision).toMatchObject({ choice: "api", basis: "lower-cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    expect(r.evaluations[0].fleet.boxes).toBe(4);
    expect(Math.round(r.evaluations[0].cost.selfHostMonthly!)).toBe(329_960);
  });
});

describe("sweep — experimental mode preserves unbenchmarked (approval limitation)", () => {
  it("pinned registry → effectiveConfidence=unbenchmarked, zero qualified, api/evidence-gap", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true });
    const ev = r.evaluations[0];
    expect(ev.engineConfidence).toBe("measured-scaled"); // engine unchanged
    expect(ev.effectiveConfidence).toBe("unbenchmarked"); // registry demotes; no silent reuse
    expect(ev.evidenceQualified).toBe(false);
    expect(ev.registry).toBeDefined();
    expect(ev.registry!.status).toMatch(/invalid-request|unbenchmarked/); // internal evidence-metadata gap
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
  });
});

describe("sweep — gate separation, comparison, determinism, injection, single-eval", () => {
  it("missing self-host price does NOT change technicallyFeasible (rev-2 #2)", () => {
    const zeroPriced: PriceBook = { ...priceBook, gpus: priceBook.gpus.map((g) => (g.instanceType === "p6-b200.48xlarge" ? { ...g, pricePerHr: 0 } : g)) };
    const ev = evaluateCandidate(C.b200Int4, dsv4Workload(), zeroPriced, "control");
    expect(ev.technicallyFeasible).toBe(true);
    expect(ev.priceQualified).toBe(false);
    expect(ev.cost.selfHostMonthly).toBeNull();
  });

  it("no API/self-host comparison is made when the self-host price is missing (comparisonQualified=false)", () => {
    const zeroPriced: PriceBook = { ...priceBook, gpus: priceBook.gpus.map((g) => (g.instanceType === "p6-b200.48xlarge" ? { ...g, pricePerHr: 0 } : g)) };
    const ev = evaluateCandidate(C.b200Int4, dsv4Workload(), zeroPriced, "control");
    expect(ev.evidenceQualified).toBe(true); // still evidence-qualified…
    expect(ev.comparisonQualified).toBe(false); // …but not comparable
    const d = deriveDecision([ev], { modelId: "deepseek-v4-pro-oss", modelLabel: "DeepSeek-V4-Pro (open weights)", monthlyCost: 6_492_000, priceState: "priced", comparisonQualified: true }, { modelSelfHostable: true });
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });

  it("optimizeFor does not flip the API/self-host decision (single eligible catalog)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    const base = dsv4Workload();
    for (const axis of ["cost", "latency", "confidence", "predictability"] as const) {
      const r = recommend({ workload: base, optimizeFor: axis });
      expect(r.decision).toMatchObject({ choice: "api", basis: "lower-cost" });
      expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id); // only evidence-qualified config
    }
  });

  it("catalog order (shuffled/reversed) → byte-identical output", () => {
    const forward = [C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4];
    mockedCatalog.mockReturnValue(forward);
    const a = JSON.stringify(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    mockedCatalog.mockReturnValue([...forward].reverse());
    const b = JSON.stringify(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    expect(a).toBe(b);
  });

  it("public recommend() ignores any injected caller catalog (uses the internal loader only)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const bogus = { id: "x", llmModelId: "deepseek-v4-pro-oss", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, label: "bogus" };
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost", candidates: [bogus, bogus, bogus] } as any);
    expect(r.evaluations.length).toBe(1); // the internal catalog, not the injected 3
    expect(r.evaluations[0].config.id).toBe(C.b200Int4.id);
  });

  it("every candidate is evaluated exactly once (no duplicate economics)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.evaluations.length).toBe(4);
    expect(new Set(r.evaluations.map((e) => e.config.id)).size).toBe(4);
  });

  it("P1-1: low-TTFT B200 → technicallyFeasible=true, slaQualified=false, sla-unmet, api/sla (not a technical/fleet code)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.ttftTargetMs = 100; // ~1.22s actual TTFT can't meet a 100ms SLA
    const r = recommend({ workload: w, optimizeFor: "cost" });
    const ev = r.evaluations[0];
    expect(ev.technicallyFeasible).toBe(true); // SLA failure is NOT technical infeasibility
    expect(ev.slaQualified).toBe(false);
    expect(ev.rejections[0].code).toBe("sla-unmet-ttft-or-streaming"); // structured code, not a fleet regex
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "sla" });
  });

  it("P1-2: self-hostable model with no pinned candidate → api/no-modeled-candidate (zero evaluations)", () => {
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]); // only deepseek candidates
    const w = dsv4Workload();
    w.generation.llmModelId = "minimax-m3-oss"; // self-hostable, but not in the pinned dsv4 catalog
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.evaluations.length).toBe(0);
    expect(r.decision).toEqual({ choice: "api", basis: "no-modeled-candidate" });
  });

  it("P1-2: a non-self-hostable (API-only) model → api/self-host-infeasible", () => {
    mockedCatalog.mockReturnValue([...PINNED_CANDIDATES]);
    const w = dsv4Workload();
    w.generation.llmModelId = "claude-opus-4-8"; // API-only (selfHostable falsy)
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.decision).toEqual({ choice: "api", basis: "self-host-infeasible" });
  });

  it("P1-3: an invalid optimizeFor is rejected at the public boundary", () => {
    expect(() => recommend({ workload: dsv4Workload(), optimizeFor: "bogus" as any })).toThrow(/invalid optimizeFor/);
  });

  it("P1-6: result carries effectiveWorkload, input adjustments (730 uptime cap) and pricing provenance", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.gpuUptimeHoursPerMonth = 1000; // > 730 cap
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.effectiveWorkload).toBeDefined();
    expect(r.inputAdjustments).toContainEqual({ field: "gpuUptimeHoursPerMonth", entered: 1000, calculated: 730 });
    expect(r.pricing.source).toBe("fallback");
    expect(r.pricing.region).toBe("us-east-1");
    expect(typeof r.pricing.asOf).toBe("string");
    expect(["live", "fallback", "override", "mixed"]).toContain(r.pricing.gpuPriceSource);
  });

  it("P2-1: calculate() is invoked exactly once per candidate (spy)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    vi.mocked(calculate).mockClear();
    recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(vi.mocked(calculate)).toHaveBeenCalledTimes(4);
  });

  it("P2-1: API cost is identical across exact-model candidates (else fail closed)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const apis = new Set(r.evaluations.map((e) => Math.round(e.cost.apiMonthly!)));
    expect(apis.size).toBe(1);
  });
});

describe("HOLD-2 — trusted pricing, effective workload, complete validation", () => {
  it("P1-2: hidden workload price fields cannot change the result or provenance", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const normal = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const w = dsv4Workload();
    w.generation.apiComparisonInPricePer1K = 999; // tamper
    w.generation.apiComparisonOutPricePer1K = 999;
    w.generation.llmInPricePer1K = 999;
    w.generation.llmOutPricePer1K = 999;
    const tampered = recommend({ workload: w, optimizeFor: "cost" });
    expect(tampered.decision).toMatchObject({ choice: "api", basis: "lower-cost" }); // NOT flipped to self-host
    expect(Math.round(tampered.apiOption.monthlyCost!)).toBe(6_492_000); // trusted price, not 999-inflated
    expect(tampered.pricing.source).toBe("fallback");
    expect(JSON.stringify(tampered.evaluations[0].cost)).toBe(JSON.stringify(normal.evaluations[0].cost));
  });

  it("P1-3: effectiveWorkload reflects the engine's internal adjustments and agrees with every adjustment", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.gpuUptimeHoursPerMonth = 1000; // capped to 730
    w.retrieval.topK = 3;
    w.retrieval.topN = 9; // clamped to 3
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.effectiveWorkload.generation.gpuUptimeHoursPerMonth).toBe(730);
    expect(r.effectiveWorkload.retrieval.topN).toBe(3);
    expect(r.inputAdjustments).toContainEqual({ field: "gpuUptimeHoursPerMonth", entered: 1000, calculated: 730 });
    expect(r.inputAdjustments).toContainEqual({ field: "retrieval.topN", entered: 9, calculated: 3 });
    // every adjustment agrees with the effective workload
    const path = (o: any, p: string) => p.split(".").reduce((x, k) => x?.[k], o);
    const map: Record<string, string> = { gpuUptimeHoursPerMonth: "generation.gpuUptimeHoursPerMonth", "retrieval.topN": "retrieval.topN" };
    for (const a of r.inputAdjustments) {
      if (map[a.field]) expect(path(r.effectiveWorkload, map[a.field])).toBe(a.calculated);
    }
  });

  it("P1-4: invalid nested enums are rejected at the boundary", () => {
    const w1 = dsv4Workload(); (w1.corpus as any).refreshCadence = "bogus";
    expect(() => recommend({ workload: w1, optimizeFor: "cost" })).toThrow(/refreshCadence/);
    const w2 = dsv4Workload(); (w2.vectorStore as any).indexingAlgo = "bogus";
    expect(() => recommend({ workload: w2, optimizeFor: "cost" })).toThrow(/indexingAlgo/);
  });

  it("P1-4: an unknown llm model is rejected (never a fabricated priced API option)", () => {
    const w = dsv4Workload(); w.generation.llmModelId = "not-a-real-model";
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/unknown llm model/);
  });

  it("P1-4: an unknown apiComparisonModelId is rejected", () => {
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "not-a-real-model";
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/unknown apiComparisonModelId/);
  });

  it("P1-4: ragMode 'B' (managed KB) fails closed — no contradictory self-host output", () => {
    const w = dsv4Workload(); w.ragMode = "B";
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/ragMode 'B'.*not supported/);
  });
});

describe("HOLD-3 — API comparison identity + complete boundary validation", () => {
  it("P1-1: apiOption.modelId is the COMPARED API model, not the self-host model", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.apiOption.modelId).toBe(r.effectiveWorkload.generation.apiComparisonModelId); // both "claude-fable-5"
    expect(r.apiOption.modelId).not.toBe("deepseek-v4-pro-oss"); // not the self-host model
    // self-host identity is still present structurally
    expect(r.evaluations[0].config.llmModelId).toBe("deepseek-v4-pro-oss");
    expect(r.effectiveWorkload.generation.llmModelId).toBe("deepseek-v4-pro-oss");
  });

  it("P1-1: a valid alternate LLM comparison reports THAT LLM and its trusted price", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "claude-opus-4-8"; // a different real LLM
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.apiOption.modelId).toBe("claude-opus-4-8");
    expect(r.apiOption.monthlyCost!).toBeGreaterThan(0);
  });

  it("P1-1: an embedding/rerank comparison id fails closed (kind must be llm)", () => {
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "titan-embed-v2"; // embedding, not llm
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/must be a model with kind "llm"/);
  });

  it("P2: an empty apiComparisonModelId normalizes to the selected LLM (frozen-calculator default)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "";
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.apiOption.modelId).toBe("deepseek-v4-pro-oss"); // the selected LLM
  });

  it("P1-2: invalid gpuPricingModel is rejected (never a silent on-demand fallback)", () => {
    const w = dsv4Workload(); (w.generation as any).gpuPricingModel = "bogus";
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/gpuPricingModel/);
  });
  it("P1-2: invalid traffic.method is rejected", () => {
    const w = dsv4Workload(); (w.traffic as any).method = "bogus";
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/traffic.method/);
  });
  it("P1-2: negative peakFactor is rejected", () => {
    const w = dsv4Workload(); w.traffic.peakFactor = -1;
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/peakFactor/);
  });
  it("P1-2: utilTarget=0 is rejected (must be in (0,1])", () => {
    const w = dsv4Workload(); w.generation.utilTarget = 0;
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/utilTarget/);
  });
  it("P1-2: negative topK/topN are rejected", () => {
    const w = dsv4Workload(); w.retrieval.topK = -1; w.retrieval.topN = -2;
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/topK|topN/);
  });
  it("P1-2: negative gpuUptimeHoursPerMonth is rejected (no silent 730 fallback)", () => {
    const w = dsv4Workload(); w.generation.gpuUptimeHoursPerMonth = -5;
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).toThrow(/gpuUptimeHoursPerMonth/);
  });
  it("P1-2: intentional topN>topK and uptime>730 are still accepted (reconciled, not rejected)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload(); w.retrieval.topK = 3; w.retrieval.topN = 9; w.generation.gpuUptimeHoursPerMonth = 1000;
    expect(() => recommend({ workload: w, optimizeFor: "cost" })).not.toThrow();
  });
});

describe("HOLD-4 — effectiveWorkload is workload-only; candidate facts live on servingFacts", () => {
  it("P1-1: caller GPU/price fields never appear as calculated candidate facts", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.gpuInstanceType = "p5.48xlarge"; // a real-but-different instance (overridden by the candidate)
    w.generation.gpuPricePerHr = 999;
    w.generation.sustainedTokPerSec = 1;
    const r = recommend({ workload: w, optimizeFor: "cost" });
    // effectiveWorkload has NO candidate-varying GPU/precision fields
    const g = r.effectiveWorkload.generation as any;
    for (const f of ["gpuInstanceType", "gpuPricePerHr", "sustainedTokPerSec", "weightBits", "kvBits"]) expect(g[f]).toBeUndefined();
    // servingFacts reflect the PINNED candidate + trusted price, not the caller's
    const sf = r.evaluations[0].servingFacts;
    expect(sf.instanceType).toBe("p6-b200.48xlarge");
    expect(sf.gpuSku).toBe("B200");
    expect(sf.weightBits).toBe(4);
    expect(sf.gpuPricePerHr).toBe(113); // trusted p6-b200 $/hr, never the caller's 999
    expect(sf.gpuPricePerHr).not.toBe(999);
  });

  it("P1-1: servingFacts reconcile with the exact calculate() input across all candidates", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.h200Int4, C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const byId = Object.fromEntries(r.evaluations.map((e) => [e.config.id, e]));
    expect(byId[C.b200Int4.id].servingFacts.instanceType).toBe("p6-b200.48xlarge");
    expect(byId[C.h200Int4.id].servingFacts.instanceType).toBe("p5e.48xlarge");
    expect(byId[C.h100Int4.id].servingFacts.instanceType).toBe("p5.48xlarge");
    for (const e of r.evaluations) expect(e.servingFacts.gpuSku).toBe(e.config.gpuSku);
  });

  it("P1-2: gpuUptimeHoursPerMonth=0 discloses the 0→730 default (never silent)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.gpuUptimeHoursPerMonth = 0;
    const r = recommend({ workload: w, optimizeFor: "cost" });
    expect(r.effectiveWorkload.generation.gpuUptimeHoursPerMonth).toBe(730);
    expect(r.inputAdjustments).toContainEqual({ field: "gpuUptimeHoursPerMonth", entered: 0, calculated: 730 });
    expect(r.evaluations[0].servingFacts.uptimeHours).toBe(730);
  });

  it("cleanup: weightBits/kvBits must be exact supported values; a made-up instance fails closed", () => {
    const w1 = dsv4Workload(); w1.generation.weightBits = 3;
    expect(() => recommend({ workload: w1, optimizeFor: "cost" })).toThrow(/weightBits must be one of/);
    const w2 = dsv4Workload(); w2.generation.kvBits = 7;
    expect(() => recommend({ workload: w2, optimizeFor: "cost" })).toThrow(/kvBits must be one of/);
    const w3 = dsv4Workload(); w3.generation.gpuInstanceType = "made-up";
    expect(() => recommend({ workload: w3, optimizeFor: "cost" })).toThrow(/unknown generation.gpuInstanceType/);
  });
});

describe("catalog validation fails closed", () => {
  const good = PINNED_CANDIDATES[0];
  const clone = (o: CandidateConfig): CandidateConfig => JSON.parse(JSON.stringify(o));
  it("the pinned catalog loads and validates", () => {
    expect(validateCandidateCatalog(PINNED_CANDIDATES, priceBook).length).toBe(PINNED_CANDIDATES.length);
  });
  it("empty set", () => expect(() => validateCandidateCatalog([], priceBook)).toThrow());
  it("duplicate", () => expect(() => validateCandidateCatalog([good, clone(good)], priceBook)).toThrow());
  it("unsupported model", () => {
    const bad = clone(good); bad.llmModelId = "no-such-model"; bad.id = `no-such-model·${bad.instanceType}·w${bad.weightBits}kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/unsupported model/);
  });
  it("unknown instance", () => {
    const bad = clone(good); bad.instanceType = "zz.unknown"; bad.id = `${bad.llmModelId}·zz.unknown·w${bad.weightBits}kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/unknown AWS instance/);
  });
  it("invalid precision", () => {
    const bad = clone(good); bad.weightBits = 3 as number; bad.id = `${bad.llmModelId}·${bad.instanceType}·w3kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/invalid weightBits/);
  });
  it("non-canonical id", () => {
    const bad = clone(good); bad.id = "not-canonical";
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/non-canonical id/);
  });
  it("malformed field", () => {
    const bad = clone(good); (bad as any).gpuSku = 123;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/malformed gpuSku/);
  });
  it("P1-3: gpuSku that does not match the reviewed accelerator (p6-b200 claiming H100)", () => {
    const bad = clone(good); bad.gpuSku = "H100"; // p6-b200 is B200
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/does not match the reviewed accelerator/);
  });
  it("P1-3: the pinned catalog and its entries are frozen (immutable)", () => {
    expect(Object.isFrozen(PINNED_CANDIDATES)).toBe(true);
    expect(Object.isFrozen(PINNED_CANDIDATES[0])).toBe(true);
    expect(() => { (PINNED_CANDIDATES[0] as any).gpuSku = "X"; }).toThrow();
    const validated = validateCandidateCatalog(PINNED_CANDIDATES, priceBook);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated[0])).toBe(true);
  });
});
