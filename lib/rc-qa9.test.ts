// rc-qa-9 — inference-hardening regressions (INF-001…INF-004).
//  INF-001 auditable benchmark provenance
//  INF-002 real (measured, ISL-scaled) prefill throughput — no fixed 8× ratio
//  INF-003 TTFT is the P99 tail and is labelled as such
//  INF-004 planning-capacity disclaimer in card + exports
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { assumptionsToJson, buildReport } from "./share";
import { applyGpuSelection } from "./ui-logic";
import { listBakedBenchmarks } from "./benchmarks";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";
import benchData from "./benchmarks-data.json";

const priceBook = pricesJson as unknown as PriceBook;
const useGpu = (i: CalcInputs, t: string) => {
  const g = priceBook.gpus.find((x) => x.instanceType === t)!;
  i.generation = applyGpuSelection(i.generation, g);
};
function sh(over: (i: CalcInputs) => void): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  over(i);
  return i;
}
// Input-heavy RAG on DeepSeek (measured model), long retrieved context.
function deepseek(over: (i: CalcInputs) => void = () => {}): CalcInputs {
  return sh((i) => {
    i.generation.llmModelId = "deepseek-v4-pro-oss";
    useGpu(i, "p6-b200.48xlarge");
    i.generation.weightBits = 4;
    i.generation.outTokens = 500;
    i.traffic.queriesPerMonth = 200_000_000;
    over(i);
  });
}
// A config that lands squarely on the measured 8192/1024 MiniMax curve.
function minimaxMeasured(over: (i: CalcInputs) => void = () => {}): CalcInputs {
  return sh((i) => {
    i.generation.llmModelId = "minimax-m3-oss";
    useGpu(i, "p6-b200.48xlarge");
    i.generation.weightBits = 8;
    i.corpus.avgTokensPerDoc = 2000;
    i.retrieval.topK = 8;
    i.retrieval.topN = 4;
    i.chunking.chunkSize = 2048; // input ≈ 8.5K → 8192 bucket
    i.generation.outTokens = 1024; // matches 8192/1024 OSL
    i.traffic.queriesPerMonth = 500_000_000;
    over(i);
  });
}

describe("INF-001 — benchmark provenance is independently auditable", () => {
  it("every baked curve carries a traceable run URL + recipe commit", () => {
    const baked = listBakedBenchmarks();
    expect(baked.length).toBeGreaterThan(0);
    for (const b of baked) {
      expect(b.runUrl).toMatch(/^https:\/\/github\.com\/.+\/actions\/runs\/\d+/);
      expect(b.commit).toMatch(/^[0-9a-f]{20,}/);
      expect(b.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("a measured point exposes full provenance (run, commit, date, image, topology)", () => {
    const cap = calculate(minimaxMeasured(), priceBook).crossover.capacity;
    expect(cap.source).toBe("measured");
    const p = cap.benchmarkProvenance!;
    expect(p).toBeTruthy();
    expect(p.runUrl).toMatch(/actions\/runs\//);
    expect(p.commit.length).toBeGreaterThanOrEqual(20);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(p.image).toContain("vllm");
    expect(p.topology).toMatch(/prefill/);
    expect(p.methodologyUrl).toMatch(/^https:\/\//);
  });

  it("JSON + Markdown exports carry the provenance and the run URL", () => {
    const i = minimaxMeasured();
    const r = calculate(i, priceBook);
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(json.fleet.capacity.provenance.runUrl).toBe(r.crossover.capacity.benchmarkProvenance!.runUrl);
    expect(json.fleet.capacity.provenance.commit).toBe(r.crossover.capacity.benchmarkProvenance!.commit);
    const md = buildReport(i, r, priceBook, "2026-01-01");
    expect(md).toContain("Benchmark provenance:");
    expect(md).toContain(r.crossover.capacity.benchmarkProvenance!.runUrl);
  });
});

describe("INF-002 — prefill throughput is measured, not a fixed 8×", () => {
  it("benchmark path reports real per-GPU prefill throughput and is not flagged estimated", () => {
    const cap = calculate(minimaxMeasured(), priceBook).crossover.capacity;
    expect(cap.prefillEstimated).toBe(false);
    expect(cap.perGpuPrefillTokS).toBeGreaterThan(0);
    // At the 8192/1024 bucket, input tok/s ≫ output tok/s (prefill-dominated) — the
    // OPPOSITE of the flat-1× short-input case, proving it is not a constant ratio.
    expect(cap.perGpuPrefillTokS!).toBeGreaterThan(cap.perGpuDecodeTokS * 3);
  });

  it("input-heavy RAG is prefill-bound; longer retrieved context grows the fleet", () => {
    const short = calculate(deepseek((i) => { i.chunking.chunkSize = 400; i.retrieval.topN = 3; }), priceBook).crossover;
    const long = calculate(deepseek((i) => { i.chunking.chunkSize = 1200; i.retrieval.topN = 8; }), priceBook).crossover;
    expect(long.bindingDim).toBe("prefill");
    // More input tokens per query ⇒ more prefill demand ⇒ a strictly larger fleet.
    expect(long.avgPrefillDemand).toBeGreaterThan(short.avgPrefillDemand);
    expect(long.requiredInstances).toBeGreaterThan(short.requiredInstances);
  });

  it("no-benchmark heuristic sizes prefill from ISL/OSL (not 8×) and reports a range", () => {
    // Nemotron has no InferenceX key → heuristic capacity path.
    const cap = calculate(
      sh((i) => {
        i.generation.llmModelId = "nemotron-3-ultra-oss";
        useGpu(i, "p5.48xlarge");
        i.traffic.queriesPerMonth = 5_000_000;
      }),
      priceBook
    ).crossover.capacity;
    expect(cap.source).toBe("heuristic");
    expect(cap.prefillEstimated).toBe(true);
    expect(cap.prefillRatioUsed).toBeGreaterThan(0);
    expect(cap.perReplicaPrefillTokSLow).toBeGreaterThan(0);
    expect(cap.perReplicaPrefillTokSHigh!).toBeGreaterThan(cap.perReplicaPrefillTokSLow!);
  });

  it("a heuristic (estimated-prefill) positive verdict is always qualified", () => {
    const c = calculate(
      sh((i) => {
        i.generation.llmModelId = "nemotron-3-ultra-oss";
        useGpu(i, "p5.48xlarge");
        i.traffic.queriesPerMonth = 5_000_000;
      }),
      priceBook
    ).crossover;
    if (c.verdict === "self-host efficient") expect(c.verdictQualified).toBe(true);
  });
});

describe("INF-003 — TTFT is the P99 tail and is labelled", () => {
  it("baked TTFT is the P99 column (≫ the median), not the median", () => {
    // dsv4 fp4 1024/1024 @ conc 8: p99_ttft = 3.22 s (median was ~0.285 s).
    const pt = (benchData as any).models.dsv4.b200.fp4["1024/1024"].points.find((p: any) => p.conc === 8);
    expect(pt.ttft).toBeCloseTo(3.22, 2);
    expect((benchData as any).models.dsv4.b200.fp4["1024/1024"].provenance.ttftPercentile).toBe("p99");
  });

  it("capacity + exports label the statistic as P99", () => {
    const i = minimaxMeasured();
    const r = calculate(i, priceBook);
    expect(r.crossover.capacity.ttftPercentile).toBe("p99");
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(json.fleet.capacity.ttftPercentile).toBe("p99");
    expect(buildReport(i, r, priceBook, "2026-01-01")).toContain("P99 TTFT");
  });

  it("the TTFT SLA gate compares the P99 tail — a tight tail budget is infeasible", () => {
    const c = calculate(minimaxMeasured((i) => (i.generation.ttftTargetMs = 100)), priceBook).crossover;
    expect(c.capacity.ttftS).toBeGreaterThan(0.1);
    expect(c.capacity.ttftMet).toBe(false);
    expect(c.feasible).toBe(false);
  });
});

describe("INF-004 — planning-capacity disclaimer travels with the result", () => {
  it("JSON and Markdown exports both carry the disclaimer", () => {
    const i = deepseek();
    const r = calculate(i, priceBook);
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(json.fleet.disclaimer).toMatch(/planning capacity/i);
    expect(json.fleet.disclaimer).toMatch(/not an availability or tail-latency guarantee/i);
    expect(buildReport(i, r, priceBook, "2026-01-01")).toMatch(/planning capacity, not an availability/i);
  });
});
