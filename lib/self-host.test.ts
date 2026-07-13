import { describe, it, expect } from "vitest";
import { modelMemoryGB, modelWeightsGB, instancesToLoad } from "./self-host";
import { computeCrossover } from "./crossover";
import type { CalcInputs, PerQueryResult, PriceBook } from "./types";

describe("self-host GPU sizing", () => {
  it("weights and serving memory scale with params (FP16)", () => {
    expect(modelWeightsGB(671)).toBeCloseTo(1342, 6); // 671B × 2 bytes
    expect(modelMemoryGB(671)).toBeCloseTo(1610.4, 4); // × 1.2 overhead
  });

  it("instancesToLoad is the ceil of model memory over instance HBM", () => {
    // 671B ≈ 1610 GB; p5 = 640 GB -> 3 boxes; p5e = 1128 GB -> 2 boxes
    expect(instancesToLoad(671, 640)).toBe(3);
    expect(instancesToLoad(671, 1128)).toBe(2);
    expect(instancesToLoad(235, 640)).toBe(1); // 235B ≈ 564 GB fits one p5
  });

  it("returns 1 when params or instance memory are unknown (never lowers box count)", () => {
    expect(instancesToLoad(undefined, 640)).toBe(1);
    expect(instancesToLoad(671, 0)).toBe(1);
    expect(instancesToLoad(0, 640)).toBe(1);
  });
});

describe("crossover memory floor", () => {
  const priceBook: PriceBook = {
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "fallback",
    region: "us-east-1",
    gpus: [{ instanceType: "p5.48xlarge", gpu: "8x H100 80GB", pricePerHr: 55.04, sustainedTokPerSec: 2600, totalMemGB: 640 }],
    opensearch: { ocuPricePerHr: 0.24, storagePricePerGBmo: 0.024, gbRamPerOcu: 6, minOCU: 2 },
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
      guardrails: { inputEnabled: false, outputEnabled: false, unitPricePer1K: 0, unitsPerQuery: 0 },
      generation: {
        mode: "self-hosted", llmModelId: "big-oss", llmInPricePer1K: 0.00055, llmOutPricePer1K: 0.00219,
        outTokens: 200, promptOverhead: 100, gpuInstanceType: "p5.48xlarge", gpuPricePerHr: 55.04,
        sustainedTokPerSec: 2600, utilTarget: 0.7,
      },
      traffic: { queriesPerMonth: 1000, region: "us-east-1", method: "monthly", qps: 1, hoursPerDay: 24, daysPerMonth: 30 },
      queryTokens: 50,
    };
  }

  const perQuery: PerQueryResult = {
    guardrailIn$: 0, embedQuery$: 0, rerank$: 0, llmInputTok: 800, apiGen$: 0.0005, guardrailOut$: 0, infraCrumbs$: 0, perQuery$: 0.0005,
  };

  it("forces at least the memory-required boxes even at trivial traffic", () => {
    // 1000 queries/mo is far below one box of throughput, but a 671B model still
    // needs 3 × p5 just to load -> boxes = 3, cost = 3 × (55.04 × 730).
    const r = computeCrossover(inputs(), priceBook, perQuery);
    expect(r.boxes).toBe(3);
    expect(r.selfHostedMonthly$).toBeCloseTo(3 * 55.04 * 730, 4);
  });
});
