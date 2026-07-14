import { describe, it, expect } from "vitest";
import { serviceMemoryGB, modelWeightsGB, kvCacheGB, instancesToLoad, precisionThroughputFactor } from "./self-host";
import { computeCrossover } from "./crossover";
import { computeCapacity } from "./capacity";
import type { CalcInputs, PerQueryResult, PriceBook } from "./types";

describe("self-host GPU sizing", () => {
  it("weights and serving memory scale with params (FP16)", () => {
    expect(modelWeightsGB(671)).toBeCloseTo(1342, 6); // 671B × 2 bytes
    // serving memory (no KV) = weights × 1.15 runtime reserve
    expect(serviceMemoryGB(671)).toBeCloseTo(1543.3, 1);
  });

  it("instancesToLoad is the ceil of serving memory over instance HBM (weights-bound)", () => {
    // 671B FP16 ≈ 1543 GB; p5 = 640 GB -> 3 boxes; p5e = 1128 GB -> 2 boxes
    expect(instancesToLoad(671, 640)).toBe(3);
    expect(instancesToLoad(671, 1128)).toBe(2);
    expect(instancesToLoad(235, 640)).toBe(1); // 235B FP16 ≈ 540 GB fits one p5
  });

  it("returns 1 when params or instance memory are unknown (never lowers box count)", () => {
    expect(instancesToLoad(undefined, 640)).toBe(1);
    expect(instancesToLoad(671, 0)).toBe(1);
    expect(instancesToLoad(0, 640)).toBe(1);
  });

  it("quantization lowers memory and required instances", () => {
    // 671B on a 640 GB box: FP16(16b)->3, FP8(8b)->2, INT4(4b)->1
    expect(instancesToLoad(671, 640, 16)).toBe(3); // 1610 GB
    expect(instancesToLoad(671, 640, 8)).toBe(2); // 805 GB
    expect(instancesToLoad(671, 640, 4)).toBe(1); // 402 GB
    expect(modelWeightsGB(671, 8)).toBeCloseTo(671, 6); // FP8 weights
    expect(serviceMemoryGB(671, 8, 0, 0, 0)).toBeCloseTo(771.65, 2); // × 1.15 reserve
  });

  it("KV cache adds memory at long context — GQA needs more boxes, MLA stays weight-bound", () => {
    // GLM-like GQA (376,832 B/tok) at 128K ctx × 16 concurrency -> ~772 GB KV.
    const glmKv = kvCacheGB(376832, 16, 128000, 16);
    expect(glmKv).toBeCloseTo(771.75, 1);
    // 400B FP16 weights (800 GB) + KV pushes p5 boxes from 2 -> 3.
    expect(instancesToLoad(400, 640, 16, 376832, 128000, 16)).toBe(3);
    expect(instancesToLoad(400, 640, 16)).toBe(2); // weights only

    // MLA (70,272 B/tok) at the same load: ~144 GB KV — a 1T model stays weight-bound.
    expect(instancesToLoad(1000, 640, 16, 70272, 128000, 16)).toBe(4);
    expect(instancesToLoad(1000, 640, 16)).toBe(4);

    // KV precision follows the weight precision: FP8 halves the KV term.
    expect(kvCacheGB(376832, 8, 128000, 16)).toBeCloseTo(glmKv / 2, 4);
  });

  it("lower precision also raises decode throughput", () => {
    expect(precisionThroughputFactor(16)).toBe(1);
    expect(precisionThroughputFactor(8)).toBeGreaterThan(1);
    expect(precisionThroughputFactor(4)).toBeGreaterThan(precisionThroughputFactor(8));
  });
});

describe("crossover memory floor", () => {
  const priceBook: PriceBook = {
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "fallback",
    region: "us-east-1",
    gpus: [{ instanceType: "p5.48xlarge", gpu: "8x H100 80GB", pricePerHr: 55.04, sustainedTokPerSec: 2600, totalMemGB: 640 }],
    opensearch: { ocuPricePerHr: 0.24, storagePricePerGBmo: 0.024, gbRamPerOcu: 6, minOCU: 2 },
    managedKb: { indexStoragePerGBmo: 5, retrievePer1k: 1, agenticRetrievePer1k: 4, verifiedAt: "2026-01-01" },
    models: [
      { id: "big-oss", label: "Big OSS 671B", provider: "oss", bedrock: false, kind: "llm", selfHostable: true, paramsB: 671, inPricePer1K: 0.00055, outPricePer1K: 0.00219, verifiedAt: "2026-01-01" },
    ],
  };

  function inputs(): CalcInputs {
    return {
      ragMode: "A",
      corpus: { numDocs: 1000, avgTokensPerDoc: 500, refreshCadence: "monthly" },
      chunking: { chunkSize: 400, overlapFraction: 0.1, embedModelId: "e", embedDim: 1024, embedPricePer1K: 0.0001 },
      vectorStore: { indexingAlgo: "hnsw", m: 16, replicas: 1, pqCompression: 32, minOCU: 2, ocuPricePerHr: 0.24, storagePricePerGBmo: 0.024, gbRamPerOcu: 6, indexingOCUhrs: 10, qpsPerOcu: 2 },
      retrieval: { topK: 10, rerankEnabled: false, rerankModelId: "", rerankPricePer1K: 0, topN: 5 },
      guardrails: { inputEnabled: false, outputEnabled: false, inputPricePer1KUnits: 0, outputPricePer1KUnits: 0, charsPerTextUnit: 400, charsPerToken: 4 },
      generation: {
        mode: "self-hosted", llmModelId: "big-oss", llmInPricePer1K: 0.00055, llmOutPricePer1K: 0.00219,
        outTokens: 200, promptOverhead: 100, gpuInstanceType: "p5.48xlarge", gpuPricePerHr: 55.04,
        gpuPricingModel: "on-demand", gpuUptimeHoursPerMonth: 730,
        sustainedTokPerSec: 2600, utilTarget: 0.7, numInstances: 1, autoSizeFleet: true, weightBits: 16, kvBits: 16, ttftTargetMs: 2000, haEnabled: false, apiComparisonModelId: "", apiComparisonInPricePer1K: 0, apiComparisonOutPricePer1K: 0, maxContextLen: 8192, maxConcurrentSeqs: 16, interactivityTarget: 30,
      },
      managedKb: { retrievalMode: "standard", underlyingRetrievalsPerCall: 2, indexedDataGB: 50 },
      ops: { networkingMonthly$: 0, observabilityMonthly$: 0, overheadPct: 0 },
      traffic: { queriesPerMonth: 1000, region: "us-east-1", method: "monthly", qps: 1, hoursPerDay: 24, daysPerMonth: 30, peakFactor: 1 },
      queryTokens: 50,
    };
  }

  const perQuery: PerQueryResult = {
    guardrailIn$: 0, embedQuery$: 0, rerank$: 0, llmInputTok: 800, apiGen$: 0.0005, apiComparisonGen$: 0.0005, guardrailOut$: 0, infraCrumbs$: 0, perQuery$: 0.0005,
  };

  it("forces at least the memory-required boxes even at trivial traffic", () => {
    // 1000 queries/mo is far below one box of throughput, but a 671B model still
    // needs 3 × p5 just to load -> boxes = 3, cost = 3 × (55.04 × 730).
    const i = inputs();
    const r = computeCrossover(i, priceBook, perQuery, computeCapacity(i, priceBook, perQuery));
    expect(r.boxes).toBe(3);
    expect(r.selfHostedMonthly$).toBeCloseTo(3 * 55.04 * 730, 4);
  });
});
