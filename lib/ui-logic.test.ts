import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { deriveDisplayMetrics } from "./derived";
import { buildScenarios } from "./scenarios";
import { encodeInputs, decodeInputs } from "./share";
import { computeSensitivity } from "./sensitivity";
import type { CalcInputs, PriceBook } from "./types";

const priceBook: PriceBook = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "fallback",
  region: "us-east-1",
  gpus: [{ instanceType: "p5.48xlarge", gpu: "8x H100", pricePerHr: 55.04, sustainedTokPerSec: 2600, totalMemGB: 640 }],
  opensearch: { ocuPricePerHr: 0.24, storagePricePerGBmo: 0.024, gbRamPerOcu: 6, minOCU: 2 },
  models: [
    { id: "embed-1", label: "Embed 1", provider: "bedrock", bedrock: true, kind: "embedding", inPricePer1K: 0.00002, outPricePer1K: 0, dim: 1024, verifiedAt: "2026-01-01" },
    { id: "llm-1", label: "LLM 1", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.015, outPricePer1K: 0.075, verifiedAt: "2026-01-01" },
    { id: "rerank-1", label: "Rerank 1", provider: "bedrock", bedrock: true, kind: "rerank", inPricePer1K: 0.001, outPricePer1K: 0, verifiedAt: "2026-01-01" },
    { id: "guard-1", label: "Guard 1", provider: "bedrock", bedrock: true, kind: "guardrail", inPricePer1K: 0.75, outPricePer1K: 0, verifiedAt: "2026-01-01" },
  ],
};

function base(): CalcInputs {
  return defaultInputs(priceBook);
}

// ---------------------------------------------------------------------------
// deriveDisplayMetrics
// ---------------------------------------------------------------------------

describe("deriveDisplayMetrics", () => {
  it("computes per-query, per-1k, annualized, and the token split", () => {
    const inputs = base(); // 100k queries, topN 5, chunk 512, overhead 300, query 50, out 500
    const result = calculate(inputs, priceBook);
    const m = deriveDisplayMetrics(result, inputs);

    expect(m.costPerQuery).toBeCloseTo(result.totalMonthly$ / 100000, 12);
    expect(m.costPer1000).toBeCloseTo(m.costPerQuery * 1000, 12);
    expect(m.annualized).toBeCloseTo(result.totalMonthly$ * 12, 8);

    // token construction: 5*512 + 300 + 50 = 2910 input; 500 output; 3410 total
    expect(m.tokenConstruction.retrievedContext).toBe(2560);
    expect(m.tokenConstruction.totalInput).toBe(2910);
    expect(m.tokenConstruction.output).toBe(500);
    expect(m.tokenConstruction.totalModel).toBe(3410);

    expect(m.monthlyInputTokens).toBe(2910 * 100000); // 291M
    expect(m.monthlyOutputTokens).toBe(500 * 100000); // 50M
    expect(m.monthlyLlmTokens).toBeCloseTo(3410 * 100000, 4); // 341M
  });

  it("flags zero traffic and the min-OCU floor", () => {
    const zero = { ...base(), traffic: { ...base().traffic, queriesPerMonth: 0 } };
    const m = deriveDisplayMetrics(calculate(zero, priceBook), zero);
    expect(m.hasTraffic).toBe(false);
    expect(m.costPerQuery).toBe(0);

    // default 10k-doc corpus sits on the min-OCU floor
    const m2 = deriveDisplayMetrics(calculate(base(), priceBook), base());
    expect(m2.vectorStoreFloored).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildScenarios
// ---------------------------------------------------------------------------

describe("buildScenarios", () => {
  it("baseline is complete; managed KB is incomplete; GPU carries a diff", () => {
    const inputs = base();
    const result = calculate(inputs, priceBook);
    const scenarios = buildScenarios(result, inputs);
    const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));

    expect(byId["self-built-api"].monthly).toBeCloseTo(result.totalMonthly$, 6);
    expect(byId["self-built-api"].complete).toBe(true);

    expect(byId["bedrock-kb-api"].monthly).toBeNull();
    expect(byId["bedrock-kb-api"].complete).toBe(false);
    expect(byId["bedrock-kb-api"].highlight).toBe(false);

    // Self-built + GPU = infra (non-generation) + self-hosted box cost
    const generationMonthly = result.perQuery.apiGen$ * inputs.traffic.queriesPerMonth;
    const infraNonGen = result.totalMonthly$ - generationMonthly;
    expect(byId["self-built-gpu"].monthly).toBeCloseTo(
      infraNonGen + result.crossover.selfHostedMonthly$,
      4
    );
    expect(byId["self-built-gpu"].difference).toMatch(/^[+-]\d+%$/);
  });
});

// ---------------------------------------------------------------------------
// share encode/decode
// ---------------------------------------------------------------------------

function b64url(json: string): string {
  return Buffer.from(json, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("share encode/decode", () => {
  it("round-trips inputs losslessly", () => {
    const inputs = base();
    const decoded = decodeInputs(encodeInputs(inputs));
    expect(decoded).toEqual(inputs);
  });

  it("rejects malformed and out-of-range payloads", () => {
    expect(decodeInputs("!!!not-base64!!!")).toBeNull();
    expect(decodeInputs(undefined)).toBeNull();
    const bad = { ...base(), traffic: { ...base().traffic, queriesPerMonth: -5 } };
    expect(decodeInputs(encodeInputs(bad as CalcInputs))).toBeNull();
  });

  it("upgrades a legacy link missing the QPS fields with defaults", () => {
    const inputs = base();
    // Simulate a pre-versioning link: raw inputs, no traffic.method/qps envelope.
    const legacyTraffic = { queriesPerMonth: 250000, region: "us-east-1" };
    const legacy = { ...inputs, traffic: legacyTraffic };
    const decoded = decodeInputs(b64url(JSON.stringify(legacy)));
    expect(decoded).not.toBeNull();
    expect(decoded!.traffic.queriesPerMonth).toBe(250000);
    expect(decoded!.traffic.method).toBe("monthly");
    expect(decoded!.traffic.qps).toBe(1);
    expect(decoded!.vectorStore.qpsPerOcu).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeSensitivity
// ---------------------------------------------------------------------------

describe("computeSensitivity", () => {
  it("ranks levers by impact; output length beats doc count in a gen-dominated default", () => {
    const inputs = base();
    const rows = computeSensitivity(inputs, priceBook);
    expect(rows.length).toBeGreaterThan(0);
    // sorted by absolute impact, descending
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1].deltaPct)).toBeGreaterThanOrEqual(Math.abs(rows[i].deltaPct));
    }
    const out = rows.find((r) => r.label === "Output length")!;
    const docs = rows.find((r) => r.label === "Number of documents")!;
    // Generation dominates, so answer length moves the total far more than corpus size.
    expect(Math.abs(out.deltaPct)).toBeGreaterThan(Math.abs(docs.deltaPct));
  });
});
