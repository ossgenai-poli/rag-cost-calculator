import { describe, it, expect } from "vitest";
import { computeCrossover } from "./crossover";
import type { CalcInputs, PriceBook, PerQueryResult } from "./types";

// Only the fields computeCrossover actually reads are given real values;
// everything else in CalcInputs/PriceBook is filler to satisfy the frozen contract.
function makeInputs(overrides: {
  outTokens: number;
  gpuPricePerHr: number;
  sustainedTokPerSec: number;
  utilTarget?: number;
  queriesPerMonth: number;
  numInstances?: number;
}): CalcInputs {
  return {
    ragMode: "A",
    corpus: { numDocs: 1000, avgTokensPerDoc: 500, refreshCadence: "monthly" },
    chunking: {
      chunkSize: 400,
      overlapFraction: 0.1,
      embedModelId: "titan-embed",
      embedDim: 1536,
      embedPricePer1K: 0.0001,
    },
    vectorStore: {
      indexingAlgo: "hnsw",
      m: 16,
      replicas: 1,
      pqCompression: 32,
      minOCU: 2,
      ocuPricePerHr: 0.24,
      storagePricePerGBmo: 0.024,
      gbRamPerOcu: 6,
      indexingOCUhrs: 10,
      qpsPerOcu: 2,
    },
    retrieval: { topK: 10, rerankEnabled: false, rerankModelId: "", rerankPricePer1K: 0, topN: 5 },
    guardrails: { inputEnabled: false, outputEnabled: false, unitPricePer1K: 0, unitsPerQuery: 0 },
    generation: {
      mode: "self-hosted",
      llmModelId: "test-llm",
      llmInPricePer1K: 0.003,
      llmOutPricePer1K: 0.015,
      outTokens: overrides.outTokens,
      promptOverhead: 100,
      gpuInstanceType: "test.gpu",
      gpuPricePerHr: overrides.gpuPricePerHr,
      sustainedTokPerSec: overrides.sustainedTokPerSec,
      utilTarget: overrides.utilTarget ?? 0.5,
      numInstances: overrides.numInstances ?? 1,
    },
    traffic: {
      queriesPerMonth: overrides.queriesPerMonth,
      region: "us-east-1",
      method: "monthly",
      qps: 1,
      hoursPerDay: 24,
      daysPerMonth: 30,
    },
    queryTokens: 50,
  };
}

function makePerQuery(llmInputTok: number, apiGen$: number): PerQueryResult {
  return {
    guardrailIn$: 0,
    embedQuery$: 0,
    rerank$: 0,
    llmInputTok,
    apiGen$,
    guardrailOut$: 0,
    infraCrumbs$: 0,
    perQuery$: 0,
  };
}

const priceBook = {} as PriceBook; // unused by computeCrossover

describe("computeCrossover", () => {
  it("golden numbers: moderate scenario resolves to 'API wins'", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 5000,
      utilTarget: 0.5,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0.0005); // tokensPerQuery = 1000

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.monthlyGenTokens).toBe(100_000_000); // 100k * 1000
    expect(result.gpuMonthly$).toBeCloseTo(2190, 6); // 3 * 730
    expect(result.capacity100).toBeCloseTo(13_140_000_000, 3); // 5000 * 2,628,000
    expect(result.boxes).toBe(1); // ceil(100M / (13.14B*0.5)) = ceil(0.0152) = 1
    expect(result.selfHostedMonthly$).toBeCloseTo(1 * 2190, 6);
    expect(result.apiBlendedPricePerToken).toBeCloseTo(5e-7, 12);
    expect(result.breakEvenTokens).toBeCloseTo(4_380_000_000, 3); // 2190 / 5e-7
    expect(result.utilAtBreakEven).toBeCloseTo(0.333333, 5); // 4.38B / 13.14B
    expect(result.verdict).toBe("API wins in practice below sustained load");
  });

  it("golden numbers: bigger GPU box relative to API price flips verdict to 'self-host efficient'", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 30, // 10x pricier/larger box than the 'API wins' case
      sustainedTokPerSec: 5000,
      utilTarget: 0.5,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0.0005);

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.gpuMonthly$).toBeCloseTo(21_900, 6); // 30 * 730
    expect(result.breakEvenTokens).toBeCloseTo(43_800_000_000, 2); // 21900 / 5e-7
    expect(result.utilAtBreakEven).toBeCloseTo(3.333333, 5); // 43.8B / 13.14B
    expect(result.verdict).toBe("self-host efficient");
  });

  it("curve is monotonically non-decreasing and visibly stepped for selfHosted$", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 5000,
      utilTarget: 0.5,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0.0005);

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.curve[0].tokens).toBe(0);

    let sawStep = false;
    for (let i = 1; i < result.curve.length; i++) {
      const prev = result.curve[i - 1];
      const cur = result.curve[i];
      expect(cur.tokens).toBeGreaterThanOrEqual(prev.tokens);
      expect(cur.api$).toBeGreaterThanOrEqual(prev.api$);
      expect(cur.selfHosted$).toBeGreaterThanOrEqual(prev.selfHosted$);
      if (cur.selfHosted$ === prev.selfHosted$) sawStep = true; // flat segment = a step
    }
    expect(sawStep).toBe(true);

    // api$ increases linearly; selfHosted$ increases in discrete jumps.
    const uniqueSelfHostedValues = new Set(result.curve.map((p) => p.selfHosted$));
    const uniqueApiValues = new Set(result.curve.map((p) => p.api$));
    expect(uniqueSelfHostedValues.size).toBeLessThan(uniqueApiValues.size);
  });

  it("guards divide-by-zero when apiGen$ (and thus apiBlendedPricePerToken) is 0", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 5000,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0); // apiGen$ = 0

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.apiBlendedPricePerToken).toBe(0);
    expect(result.breakEvenTokens).toBe(0);
    expect(result.equivalentQPS).toBe(0);
    expect(result.utilAtBreakEven).toBe(0);
    expect(result.selfHostedMonthly$).toBe(0);
    expect(result.verdict).toBe("API wins in practice below sustained load");
    expect(result.curve).toEqual([]);
    expect(() => computeCrossover(inputs, priceBook, perQuery)).not.toThrow();
  });

  it("guards divide-by-zero when sustainedTokPerSec (and thus capacity100) is 0", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 0,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0.0005);

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.capacity100).toBe(0);
    expect(result.breakEvenTokens).toBe(0);
    expect(result.utilAtBreakEven).toBe(0);
    expect(result.boxes).toBe(1);
    expect(result.selfHostedMonthly$).toBe(0);
    expect(result.verdict).toBe("API wins in practice below sustained load");
    expect(result.curve).toEqual([]);
    expect(() => computeCrossover(inputs, priceBook, perQuery)).not.toThrow();
  });

  it("guards divide-by-zero when tokensPerQuery is 0 (llmInputTok + outTokens = 0)", () => {
    const inputs = makeInputs({
      outTokens: 0,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 5000,
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(0, 0.0005);

    const result = computeCrossover(inputs, priceBook, perQuery);

    expect(result.apiBlendedPricePerToken).toBe(0);
    expect(result.verdict).toBe("API wins in practice below sustained load");
    expect(() => computeCrossover(inputs, priceBook, perQuery)).not.toThrow();
  });

  it("falls back to 100% utilization when utilTarget is not a positive fraction (defensive against bad input)", () => {
    const inputs = makeInputs({
      outTokens: 200,
      gpuPricePerHr: 3,
      sustainedTokPerSec: 5000,
      utilTarget: 0, // out-of-contract value; contract says (0,1]
      queriesPerMonth: 100_000,
    });
    const perQuery = makePerQuery(800, 0.0005);

    const result = computeCrossover(inputs, priceBook, perQuery);

    // capacityEff falls back to capacity100 * 1, so boxes uses full (not target) capacity.
    expect(result.boxes).toBe(Math.max(1, Math.ceil(result.monthlyGenTokens / result.capacity100)));
    expect(() => computeCrossover(inputs, priceBook, perQuery)).not.toThrow();
  });

  it("billed boxes follow the provisioned fleet, not traffic; high volume shows as throughput demand", () => {
    // A fixed 1-instance fleet is billed the same at 100k and 10M queries — the
    // engine does NOT auto-scale. Instead throughputInstances rises to flag that
    // the fleet is under-provisioned at the higher volume.
    const base = makeInputs({ outTokens: 200, gpuPricePerHr: 3, sustainedTokPerSec: 5000, utilTarget: 0.5, queriesPerMonth: 100_000, numInstances: 1 });
    const highVolume = makeInputs({ outTokens: 200, gpuPricePerHr: 3, sustainedTokPerSec: 5000, utilTarget: 0.5, queriesPerMonth: 100_000_000, numInstances: 1 });
    const perQuery = makePerQuery(800, 0.0005);

    const baseResult = computeCrossover(base, priceBook, perQuery);
    const highVolumeResult = computeCrossover(highVolume, priceBook, perQuery);

    expect(baseResult.boxes).toBe(1);
    expect(highVolumeResult.boxes).toBe(1); // fixed fleet — not auto-scaled
    expect(highVolumeResult.selfHostedMonthly$).toBe(baseResult.selfHostedMonthly$);
    // throughput demand rises, so the fleet is now under-provisioned
    expect(highVolumeResult.throughputInstances).toBeGreaterThan(baseResult.throughputInstances);
    expect(highVolumeResult.throughputInstances).toBeGreaterThan(highVolumeResult.boxes);
    expect(highVolumeResult.verdict).toBe(baseResult.verdict);
  });

  it("provisioning more instances raises billed boxes and cost", () => {
    const one = makeInputs({ outTokens: 200, gpuPricePerHr: 3, sustainedTokPerSec: 5000, queriesPerMonth: 100_000, numInstances: 1 });
    const four = makeInputs({ outTokens: 200, gpuPricePerHr: 3, sustainedTokPerSec: 5000, queriesPerMonth: 100_000, numInstances: 4 });
    const perQuery = makePerQuery(800, 0.0005);

    const r1 = computeCrossover(one, priceBook, perQuery);
    const r4 = computeCrossover(four, priceBook, perQuery);
    expect(r1.boxes).toBe(1);
    expect(r4.boxes).toBe(4);
    expect(r4.selfHostedMonthly$).toBeCloseTo(4 * r1.selfHostedMonthly$, 6);
  });
});
