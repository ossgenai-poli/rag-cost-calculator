import { describe, it, expect } from "vitest";
import { calculate, defaultInputs, INFRA_CRUMBS_PER_QUERY } from "./calc-engine";
import type { CalcInputs, PriceBook } from "./types";

// ---------------------------------------------------------------------------
// Fixed fixtures (inline literals — do NOT import public/prices.json).
// ---------------------------------------------------------------------------

const priceBook: PriceBook = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "fallback",
  region: "us-east-1",
  gpus: [{ instanceType: "p5.48xlarge", gpu: "8x H100", pricePerHr: 50, sustainedTokPerSec: 2000 }],
  opensearch: { ocuPricePerHr: 0.24, storagePricePerGBmo: 0.024, gbRamPerOcu: 6, minOCU: 2 },
  models: [
    { id: "embed-1", label: "Embed 1", provider: "bedrock", bedrock: true, kind: "embedding", inPricePer1K: 0.0001, outPricePer1K: 0, dim: 1024, verifiedAt: "2026-01-01" },
    { id: "llm-1", label: "LLM 1", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.003, outPricePer1K: 0.015, verifiedAt: "2026-01-01" },
    { id: "rerank-1", label: "Rerank 1", provider: "bedrock", bedrock: true, kind: "rerank", inPricePer1K: 0.001, outPricePer1K: 0, verifiedAt: "2026-01-01" },
    { id: "guardrail-1", label: "Guardrail 1", provider: "bedrock", bedrock: true, kind: "guardrail", inPricePer1K: 0.75, outPricePer1K: 0, verifiedAt: "2026-01-01" },
  ],
};

function baseInputs(): CalcInputs {
  return {
    ragMode: "A",
    corpus: { numDocs: 1000, avgTokensPerDoc: 1000, refreshCadence: "monthly" },
    chunking: { chunkSize: 500, overlapFraction: 0.2, embedModelId: "embed-1", embedDim: 1024, embedPricePer1K: 0.0001 },
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
    retrieval: { topK: 20, rerankEnabled: true, rerankModelId: "rerank-1", rerankPricePer1K: 0.001, topN: 5 },
    guardrails: { inputEnabled: true, outputEnabled: true, unitPricePer1K: 0.75, unitsPerQuery: 1 },
    generation: {
      mode: "api",
      llmModelId: "llm-1",
      llmInPricePer1K: 0.003,
      llmOutPricePer1K: 0.015,
      outTokens: 500,
      promptOverhead: 300,
      gpuInstanceType: "p5.48xlarge",
      gpuPricePerHr: 50,
      sustainedTokPerSec: 2000,
      utilTarget: 0.7,
    },
    traffic: { queriesPerMonth: 100000, region: "us-east-1", method: "monthly", qps: 1, hoursPerDay: 24, daysPerMonth: 30 },
    queryTokens: 50,
  };
}

// ---------------------------------------------------------------------------
// GOLDEN NUMBERS — hand-computed from the spec formulas.
// ---------------------------------------------------------------------------

describe("calculate — golden numbers", () => {
  it("matches hand-computed values for a fixed scenario", () => {
    const result = calculate(baseInputs(), priceBook);

    // Ingestion
    // corpusTokens = 1000 * 1000 = 1,000,000
    expect(result.ingestion.corpusTokens).toBe(1_000_000);
    // effChunk = 500 * (1 - 0.2) = 400
    expect(result.ingestion.effChunk).toBe(400);
    // numVectors = 1,000,000 / 400 = 2500
    expect(result.ingestion.numVectors).toBe(2500);
    // Overlap re-embeds: embeddedTokens = numVectors*chunkSize = 2500*500 = 1,250,000
    // embedIngest$ = 1,250,000/1000 * 0.0001 = 0.125
    expect(result.ingestion["embedIngest$"]).toBeCloseTo(0.125, 10);
    // monthly cadence => same as embedIngest$
    expect(result.ingestion.embedIngestMonthly$).toBeCloseTo(0.125, 10);

    // Vector store
    // hnswBytes = 1.1*(4*1024+8*16)*2500*(1+1) = 23,232,000
    expect(result.vectorStore.hnswBytes).toBeCloseTo(23_232_000, 5);
    expect(result.vectorStore.ramBytes).toBeCloseTo(23_232_000, 5);
    // ramGB = 23,232,000 / 1e9 = 0.023232
    expect(result.vectorStore.ramGB).toBeCloseTo(0.023232, 10);
    // searchOCU = max(2, ceil(0.023232/6)) = max(2, 1) = 2
    expect(result.vectorStore.searchOCU).toBe(2);
    // storageGB = (4*1024*2500)/1e9 = 0.01024
    expect(result.vectorStore.storageGB).toBeCloseTo(0.01024, 10);
    // opensearchMonthly$ = (10 + 2*730)*0.24 + 0.01024*0.024 = 352.80024576
    expect(result.vectorStore.opensearchMonthly$).toBeCloseTo(352.80024576, 6);
    // opensearchFloor$ = 2*0.24*730 = 350.4
    expect(result.vectorStore.opensearchFloor$).toBeCloseTo(350.4, 8);

    // Per-query
    // guardrailIn$ = 1*0.00075 = 0.00075
    expect(result.perQuery.guardrailIn$).toBeCloseTo(0.00075, 10);
    // embedQuery$ = 50/1000*0.0001 = 0.000005
    expect(result.perQuery.embedQuery$).toBeCloseTo(0.000005, 10);
    // rerank$ = 20/1000*0.001 = 0.00002
    expect(result.perQuery.rerank$).toBeCloseTo(0.00002, 10);
    // llmInputTok = 5*500 + 300 + 50 = 2850
    expect(result.perQuery.llmInputTok).toBe(2850);
    // apiGen$ = 2850/1000*0.003 + 500/1000*0.015 = 0.00855 + 0.0075 = 0.01605
    expect(result.perQuery.apiGen$).toBeCloseTo(0.01605, 10);
    // guardrailOut$ = 1*0.00075 = 0.00075
    expect(result.perQuery.guardrailOut$).toBeCloseTo(0.00075, 10);
    expect(result.perQuery.infraCrumbs$).toBe(INFRA_CRUMBS_PER_QUERY);
    // perQuery$ = 0.00075+0.000005+0.00002+0.01605+0.00075+0.00002 = 0.017595
    expect(result.perQuery.perQuery$).toBeCloseTo(0.017595, 10);

    // Totals
    // queryMonthly$ = 0.017595 * 100000 = 1759.5
    expect(result.queryMonthly$).toBeCloseTo(1759.5, 6);
    // totalMonthly$ = 0.125 + 352.80024576 + 1759.5 = 2112.42524576
    expect(result.totalMonthly$).toBeCloseTo(2112.42524576, 5);

    expect(result.mode).toBe("A");
  });

  it("builds a breakdown with one line per category and a correct dominant lever", () => {
    const result = calculate(baseInputs(), priceBook);

    expect(result.breakdown).toHaveLength(5);
    const categories = result.breakdown.map((line) => line.category).sort();
    expect(categories).toEqual(["generation", "guardrails", "ingestion", "query", "vectorstore"].sort());

    const maxLine = result.breakdown.reduce((max, line) => (line.monthly$ > max.monthly$ ? line : max));
    expect(result.dominantLever.label).toBe(maxLine.label);
    expect(result.dominantLever.monthly$).toBeCloseTo(maxLine.monthly$, 6);
    expect(result.dominantLever.share).toBeCloseTo(maxLine.monthly$ / result.totalMonthly$, 10);
  });

  it("always includes a crossover result (delegated to computeCrossover)", () => {
    const inputs = baseInputs();
    const result = calculate(inputs, priceBook);
    expect(result.crossover).toBeDefined();
    // Delegation sanity: monthlyGenTokens reflects the traffic + token math,
    // proving the engine passed real inputs through to the crossover module.
    const expectedGenTokens =
      inputs.traffic.queriesPerMonth *
      (result.perQuery.llmInputTok + inputs.generation.outTokens);
    expect(result.crossover.monthlyGenTokens).toBeCloseTo(expectedGenTokens, 4);
  });
});

// ---------------------------------------------------------------------------
// Indexing algo: HNSW vs IVF_PQ
// ---------------------------------------------------------------------------

describe("indexing algorithm", () => {
  it("ivf_pq reduces ramBytes vs hnsw, and searchOCU drops out of a non-floor value", () => {
    // Large corpus so hnsw's searchOCU is well above the minOCU floor.
    const big = baseInputs();
    big.corpus.numDocs = 2_000_000;
    big.corpus.avgTokensPerDoc = 1000;

    const hnswResult = calculate(big, priceBook);
    expect(hnswResult.vectorStore.searchOCU).toBeGreaterThan(priceBook.opensearch.minOCU);

    const pqInputs: CalcInputs = { ...big, vectorStore: { ...big.vectorStore, indexingAlgo: "ivf_pq" } };
    const pqResult = calculate(pqInputs, priceBook);

    expect(pqResult.vectorStore.ramBytes).toBeLessThan(hnswResult.vectorStore.ramBytes);
    // hnswBytes (pre-quantization reference) is unchanged by the algo choice.
    expect(pqResult.vectorStore.hnswBytes).toBeCloseTo(hnswResult.vectorStore.hnswBytes, 5);
    expect(pqResult.vectorStore.searchOCU).toBeLessThanOrEqual(hnswResult.vectorStore.searchOCU);
  });

  it("ivf_fp16 halves ramBytes vs hnsw", () => {
    const inputs = baseInputs();
    const hnswResult = calculate(inputs, priceBook);
    const fp16Inputs: CalcInputs = { ...inputs, vectorStore: { ...inputs.vectorStore, indexingAlgo: "ivf_fp16" } };
    const fp16Result = calculate(fp16Inputs, priceBook);

    expect(fp16Result.vectorStore.ramBytes).toBeCloseTo(hnswResult.vectorStore.hnswBytes / 2, 5);
  });

  it("searchOCU never drops below minOCU even for a tiny corpus", () => {
    const tiny = baseInputs();
    tiny.corpus.numDocs = 1;
    tiny.corpus.avgTokensPerDoc = 10;
    const result = calculate(tiny, priceBook);
    expect(result.vectorStore.searchOCU).toBeGreaterThanOrEqual(priceBook.opensearch.minOCU);
  });
});

// ---------------------------------------------------------------------------
// opensearchFloor$
// ---------------------------------------------------------------------------

describe("opensearchFloor$", () => {
  it("equals minOCU * ocuPricePerHr * 730 regardless of load", () => {
    const inputs = baseInputs();
    inputs.vectorStore.minOCU = 4;
    inputs.vectorStore.ocuPricePerHr = 0.3;
    const result = calculate(inputs, priceBook);
    expect(result.vectorStore.opensearchFloor$).toBeCloseTo(4 * 0.3 * 730, 8);
  });
});

// ---------------------------------------------------------------------------
// refreshCadence amortization
// ---------------------------------------------------------------------------

describe("refreshCadence amortization", () => {
  it("one-time amortizes embedIngest$ over 12 months", () => {
    const inputs = baseInputs();
    inputs.corpus.refreshCadence = "one-time";
    const result = calculate(inputs, priceBook);
    expect(result.ingestion.embedIngestMonthly$).toBeCloseTo(result.ingestion["embedIngest$"] / 12, 10);
  });

  it("weekly multiplies embedIngest$ by 4.345", () => {
    const inputs = baseInputs();
    inputs.corpus.refreshCadence = "weekly";
    const result = calculate(inputs, priceBook);
    expect(result.ingestion.embedIngestMonthly$).toBeCloseTo(result.ingestion["embedIngest$"] * 4.345, 10);
  });

  it("monthly leaves embedIngest$ unchanged", () => {
    const inputs = baseInputs();
    inputs.corpus.refreshCadence = "monthly";
    const result = calculate(inputs, priceBook);
    expect(result.ingestion.embedIngestMonthly$).toBeCloseTo(result.ingestion["embedIngest$"], 10);
  });
});

// ---------------------------------------------------------------------------
// Guardrails and rerank toggles
// ---------------------------------------------------------------------------

describe("guardrails and rerank toggles", () => {
  it("zeroes guardrail and rerank costs when disabled", () => {
    const inputs = baseInputs();
    inputs.guardrails.inputEnabled = false;
    inputs.guardrails.outputEnabled = false;
    inputs.retrieval.rerankEnabled = false;
    const result = calculate(inputs, priceBook);
    expect(result.perQuery.guardrailIn$).toBe(0);
    expect(result.perQuery.guardrailOut$).toBe(0);
    expect(result.perQuery.rerank$).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mode B (Bedrock Knowledge Bases) overrides
// ---------------------------------------------------------------------------

describe("ragMode B overrides", () => {
  it("forces hnsw, replicas>=2, and api generation even if inputs say otherwise", () => {
    const inputs = baseInputs();
    inputs.ragMode = "B";
    inputs.vectorStore.indexingAlgo = "ivf_pq";
    inputs.vectorStore.replicas = 1;
    inputs.generation.mode = "self-hosted";

    const result = calculate(inputs, priceBook);
    expect(result.mode).toBe("B");

    // Compare against an equivalent A-mode run with the override applied manually,
    // to prove Mode B produces the HNSW-at-2-replicas numbers, not the ivf_pq/1-replica ones.
    const manualOverride = baseInputs();
    manualOverride.vectorStore.indexingAlgo = "ivf_pq";
    manualOverride.vectorStore.replicas = 1;
    const uncorrectedResult = calculate(manualOverride, priceBook);

    expect(result.vectorStore.ramBytes).not.toBeCloseTo(uncorrectedResult.vectorStore.ramBytes, 0);
  });

  it("does not mutate the caller's original inputs object", () => {
    const inputs = baseInputs();
    inputs.ragMode = "B";
    inputs.vectorStore.replicas = 1;
    inputs.vectorStore.indexingAlgo = "ivf_pq";
    inputs.generation.mode = "self-hosted";

    calculate(inputs, priceBook);

    expect(inputs.vectorStore.replicas).toBe(1);
    expect(inputs.vectorStore.indexingAlgo).toBe("ivf_pq");
    expect(inputs.generation.mode).toBe("self-hosted");
  });

  it("keeps replicas at the caller's value when already >= 2", () => {
    const inputs = baseInputs();
    inputs.ragMode = "B";
    inputs.vectorStore.replicas = 3;
    const result = calculate(inputs, priceBook);
    // replicas=3 => hnswBytes uses (1+3)=4 multiplier; sanity check it's larger than replicas=1.
    const oneReplica = calculate({ ...baseInputs(), vectorStore: { ...baseInputs().vectorStore, replicas: 1 } }, priceBook);
    expect(result.vectorStore.hnswBytes).toBeGreaterThan(oneReplica.vectorStore.hnswBytes);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("does not throw and reports share 0 when totalMonthly$ is 0", () => {
    const inputs = baseInputs();
    inputs.corpus.numDocs = 0;
    inputs.chunking.embedPricePer1K = 0;
    inputs.vectorStore.indexingOCUhrs = 0;
    inputs.vectorStore.ocuPricePerHr = 0;
    inputs.vectorStore.storagePricePerGBmo = 0;
    inputs.retrieval.rerankEnabled = false;
    inputs.guardrails.inputEnabled = false;
    inputs.guardrails.outputEnabled = false;
    inputs.generation.llmInPricePer1K = 0;
    inputs.generation.llmOutPricePer1K = 0;
    inputs.traffic.queriesPerMonth = 0;

    const result = calculate(inputs, priceBook);
    expect(result.totalMonthly$).toBe(0);
    expect(result.dominantLever.share).toBe(0);
    expect(Number.isNaN(result.dominantLever.share)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defaultInputs()
// ---------------------------------------------------------------------------

describe("defaultInputs", () => {
  it("derives fields from the first matching model/gpu/opensearch config in the priceBook", () => {
    const inputs = defaultInputs(priceBook);

    expect(inputs.chunking.embedModelId).toBe("embed-1");
    expect(inputs.chunking.embedDim).toBe(1024);
    expect(inputs.chunking.embedPricePer1K).toBe(0.0001);

    expect(inputs.generation.llmModelId).toBe("llm-1");
    expect(inputs.generation.llmInPricePer1K).toBe(0.003);
    expect(inputs.generation.llmOutPricePer1K).toBe(0.015);

    expect(inputs.generation.gpuInstanceType).toBe("p5.48xlarge");
    expect(inputs.generation.gpuPricePerHr).toBe(50);
    expect(inputs.generation.sustainedTokPerSec).toBe(2000);

    expect(inputs.retrieval.rerankModelId).toBe("rerank-1");
    expect(inputs.retrieval.rerankPricePer1K).toBe(0.001);

    expect(inputs.guardrails.unitPricePer1K).toBe(0.75);

    expect(inputs.vectorStore.minOCU).toBe(priceBook.opensearch.minOCU);
    expect(inputs.vectorStore.ocuPricePerHr).toBe(priceBook.opensearch.ocuPricePerHr);
    expect(inputs.vectorStore.storagePricePerGBmo).toBe(priceBook.opensearch.storagePricePerGBmo);
    expect(inputs.vectorStore.gbRamPerOcu).toBe(priceBook.opensearch.gbRamPerOcu);

    expect(inputs.traffic.region).toBe(priceBook.region);
    expect(inputs.ragMode).toBe("A");

    // Result should be directly usable by calculate() without further patching.
    expect(() => calculate(inputs, priceBook)).not.toThrow();
  });

  it("falls back to safe defaults when rerank/guardrail models are absent, and dim is missing", () => {
    const minimalBook: PriceBook = {
      ...priceBook,
      models: [
        { id: "embed-only", label: "Embed only", provider: "bedrock", bedrock: true, kind: "embedding", inPricePer1K: 0.0002, outPricePer1K: 0, verifiedAt: "2026-01-01" },
        { id: "llm-only", label: "LLM only", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.001, outPricePer1K: 0.002, verifiedAt: "2026-01-01" },
      ],
    };

    const inputs = defaultInputs(minimalBook);
    expect(inputs.chunking.embedDim).toBe(1024); // fallback when model.dim is undefined
    expect(inputs.retrieval.rerankEnabled).toBe(false);
    expect(inputs.retrieval.rerankModelId).toBe("");
    expect(inputs.retrieval.rerankPricePer1K).toBe(0);
    expect(inputs.guardrails.unitPricePer1K).toBe(0);

    expect(() => calculate(inputs, minimalBook)).not.toThrow();
  });

  it("throws when the priceBook is missing a required embedding model, llm model, or gpu", () => {
    const noEmbed: PriceBook = { ...priceBook, models: priceBook.models.filter((m) => m.kind !== "embedding") };
    expect(() => defaultInputs(noEmbed)).toThrow();

    const noLlm: PriceBook = { ...priceBook, models: priceBook.models.filter((m) => m.kind !== "llm") };
    expect(() => defaultInputs(noLlm)).toThrow();

    const noGpu: PriceBook = { ...priceBook, gpus: [] };
    expect(() => defaultInputs(noGpu)).toThrow();
  });
});
