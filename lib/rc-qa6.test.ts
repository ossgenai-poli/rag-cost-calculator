// rc-qa-6 regressions — P0 prefill break-even, scenario reason codes, override
// provenance, model context ceilings, prefill/decode utilization, clamp transparency.
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs, inputClampNotes, INPUT_MAXIMA } from "./calc-engine";
import { buildScenarios } from "./scenarios";
import { assumptionsToJson, buildReport } from "./share";
import { applyGpuSelection } from "./ui-logic";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const useGpu = (i: CalcInputs, t: string) => {
  i.generation = applyGpuSelection(i.generation, priceBook.gpus.find((g) => g.instanceType === t)!);
};
function ds(over: (i: CalcInputs) => void): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  useGpu(i, "p6-b200.48xlarge");
  i.generation.weightBits = 4;
  over(i);
  return i;
}

describe("P0 — break-even feasibility checks prefill AND decode", () => {
  const prefillHeavy = (over: (i: CalcInputs) => void = () => {}) =>
    ds((i) => {
      i.generation.outTokens = 0;
      i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 10; i.chunking.chunkSize = 2000;
      i.generation.maxContextLen = 32768; i.traffic.queriesPerMonth = 100_000_000;
      over(i);
    });

  it("output=0, input>0: break-even is prefill-bound (not the old decode-only 0%)", () => {
    const c = calculate(prefillHeavy(), priceBook).crossover;
    expect(c.breakEvenBindingDim).toBe("prefill");
    expect(c.utilAtBreakEven).toBeGreaterThan(0); // NOT the old zero
  });

  it("output=0 with cheap API ⇒ prefill break-even overloads ⇒ infeasible, verdict API-wins", () => {
    const c = calculate(prefillHeavy((i) => {
      i.generation.apiComparisonInPricePer1K = 0.00002;
      i.generation.apiComparisonOutPricePer1K = 0.00002;
    }), priceBook).crossover;
    expect(c.utilAtBreakEven).toBeGreaterThan(1);
    expect(c.breakEvenFeasible).toBe(false);
    expect(c.verdict).toBe("API wins in practice below sustained load");
  });

  it("input=0, output>0: break-even is decode-bound", () => {
    const c = calculate(ds((i) => {
      i.generation.outTokens = 1024; i.generation.promptOverhead = 0;
      i.corpus.numDocs = 0; i.corpus.avgTokensPerDoc = 0; i.retrieval.topN = 0; i.chunking.chunkSize = 1; i.queryTokens = 0;
      i.traffic.queriesPerMonth = 50_000_000;
    }), priceBook).crossover;
    expect(c.breakEvenBindingDim).toBe("decode");
  });

  it("mixed workload where prefill binds vs decode binds is reflected in bindingDim", () => {
    const prefill = calculate(ds((i) => { i.generation.outTokens = 50; i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 15; i.chunking.chunkSize = 2000; i.generation.maxContextLen = 65536; i.traffic.queriesPerMonth = 100_000_000; }), priceBook).crossover;
    const decode = calculate(ds((i) => { i.generation.outTokens = 4000; i.corpus.avgTokensPerDoc = 200; i.retrieval.topN = 1; i.chunking.chunkSize = 200; i.traffic.queriesPerMonth = 100_000_000; }), priceBook).crossover;
    expect(prefill.bindingDim).toBe("prefill");
    expect(decode.bindingDim).toBe("decode");
  });

  it("break-even needing more than the fixed fleet is infeasible (both dims checked)", () => {
    const c = calculate(prefillHeavy((i) => {
      i.generation.apiComparisonInPricePer1K = 0.00001;
      i.generation.apiComparisonOutPricePer1K = 0.00001;
    }), priceBook).crossover;
    expect(c.breakEvenFeasible).toBe(false);
    expect(c.verdict).not.toBe("self-host efficient");
  });
});

describe("P1 — scenario rows use coded infeasibility reasons", () => {
  it("a TTFT-infeasible GPU scenario does NOT say 'raise instances'", () => {
    const i = ds((x) => { x.generation.outTokens = 500; x.generation.ttftTargetMs = 100; x.traffic.queriesPerMonth = 200_000_000; });
    const r = calculate(i, priceBook);
    const gpu = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    expect(gpu.complete).toBe(false);
    expect(gpu.note).toMatch(/TTFT/i);
    expect(gpu.note).not.toMatch(/raise instances|enable auto-size/i);
  });

  it("a context-overflow GPU scenario carries the context reason, not an instance count", () => {
    const i = ds((x) => { x.generation.outTokens = 10000; x.generation.maxContextLen = 8192; x.corpus.avgTokensPerDoc = 2000; x.retrieval.topN = 10; x.chunking.chunkSize = 2000; x.traffic.queriesPerMonth = 5_000_000; });
    const r = calculate(i, priceBook);
    const gpu = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    expect(gpu.note).toMatch(/context/i);
    expect(gpu.note).not.toMatch(/raise instances/i);
  });
});

describe("P1 — manual GPU price override provenance", () => {
  it("editing the $/hr sets gpuPriceSource=override, qualifies the verdict, and exports it", () => {
    const i = ds((x) => { x.generation.outTokens = 500; x.generation.gpuPricePerHr = 1.23; x.traffic.queriesPerMonth = 10_000_000; });
    const r = calculate(i, priceBook);
    expect(r.crossover.gpuPriceSource).toBe("override");
    if (r.crossover.verdict === "self-host efficient") expect(r.crossover.verdictQualified).toBe(true);
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(json.fleet.gpuPriceSource).toBe("override");
    expect(buildReport(i, r, priceBook, "2026-01-01")).toMatch(/price source: override/);
  });

  it("an unedited catalog price is NOT an override", () => {
    const c = calculate(ds((x) => { x.generation.outTokens = 500; x.traffic.queriesPerMonth = 10_000_000; }), priceBook).crossover;
    expect(c.gpuPriceSource).not.toBe("override");
  });
});

describe("P1 — model context ceilings", () => {
  it("every catalog LLM declares a maxContextTokens", () => {
    const llms = priceBook.models.filter((m) => m.kind === "llm");
    expect(llms.length).toBeGreaterThan(0);
    for (const m of llms) expect(m.maxContextTokens).toBeGreaterThan(0);
  });

  it("the model's max context is enforced even when the config allows more", () => {
    const i = ds((x) => {
      x.generation.outTokens = 200000; // pushes input+output past DeepSeek's 163,840 max
      x.generation.maxContextLen = 500000; // config would allow it…
      x.corpus.avgTokensPerDoc = 2000; x.retrieval.topN = 4; x.chunking.chunkSize = 2000;
      x.traffic.queriesPerMonth = 5_000_000;
    });
    const c = calculate(i, priceBook).crossover;
    expect(c.capacity.maxContextConfigured).toBe(163840); // clamped to the model max
    expect(c.capacity.contextOverflow).toBe(true);
    expect(c.feasible).toBe(false);
  });
});

describe("P2 — prefill+decode utilization reporting", () => {
  it("a prefill-heavy zero-output workload reports non-zero PREFILL utilization", () => {
    const c = calculate(ds((i) => {
      i.generation.outTokens = 0; i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 10; i.chunking.chunkSize = 2000;
      i.generation.maxContextLen = 32768; i.traffic.queriesPerMonth = 100_000_000;
    }), priceBook).crossover;
    expect(c.utilAvg).toBe(0); // decode util is genuinely zero…
    expect(c.utilAvgPrefill).toBeGreaterThan(0); // …but prefill util is not
    expect(c.bindingDim).toBe("prefill");
    expect(Number.isFinite(c.utilPeakPostLoss)).toBe(true);
  });
});

describe("P2 — extreme-input transparency", () => {
  it("an over-max input is reported as entered-vs-calculated (not silently clamped)", () => {
    const i = ds((x) => { x.traffic.queriesPerMonth = 1e308; });
    const notes = inputClampNotes(i);
    const q = notes.find((n) => n.field === "queries/month")!;
    expect(q).toBeDefined();
    expect(q.entered).toBe(1e308);
    expect(q.calculated).toBe(INPUT_MAXIMA.queriesPerMonth);
    // and the calc stays finite
    expect(Number.isFinite(calculate(i, priceBook).totalMonthly$)).toBe(true);
  });

  it("in-range inputs produce no clamp notes", () => {
    expect(inputClampNotes(ds((x) => { x.traffic.queriesPerMonth = 1_000_000; }))).toHaveLength(0);
  });
});
