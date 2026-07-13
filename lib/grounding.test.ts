import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { operatingPointAt, getBenchmarkCurve } from "./benchmarks";
import { MODEL_PRICES, GPU_DEFAULTS, OPENSEARCH_DEFAULTS, MANAGED_KB_PRICING } from "./model-prices";
import type { PriceBook } from "./types";

const priceBook: PriceBook = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "fallback",
  region: "us-east-1",
  gpus: GPU_DEFAULTS,
  opensearch: OPENSEARCH_DEFAULTS,
  managedKb: MANAGED_KB_PRICING,
  models: MODEL_PRICES,
};

// A synthetic curve: interactivity falls as concurrency (and per-GPU throughput) rise.
const CURVE = [
  { conc: 1, intvty: 100, tputPerGpu: 20, ttft: 0.2 },
  { conc: 2, intvty: 50, tputPerGpu: 40, ttft: 0.3 },
  { conc: 4, intvty: 25, tputPerGpu: 70, ttft: 0.4 },
];

describe("operatingPointAt", () => {
  it("interpolates per-GPU throughput at an interactivity target", () => {
    // target 75 between 100 and 50 → t=(100-75)/(100-50)=0.5 → tput=lerp(20,40,.5)=30
    const op = operatingPointAt(CURVE, 75);
    expect(op.tputPerGpu).toBeCloseTo(30, 6);
    expect(op.slaAchievable).toBe(true);
  });
  it("flags SLA not achievable when target exceeds the best point", () => {
    const op = operatingPointAt(CURVE, 120);
    expect(op.slaAchievable).toBe(false);
    expect(op.tputPerGpu).toBe(20); // best interactivity point (conc 1)
  });
  it("uses max throughput when the target is easily met", () => {
    const op = operatingPointAt(CURVE, 10);
    expect(op.tputPerGpu).toBe(70); // highest-concurrency point
    expect(op.slaAchievable).toBe(true);
  });
});

describe("getBenchmarkCurve", () => {
  it("returns a curve for a measured model/GPU and null for unknown", () => {
    expect(getBenchmarkCurve("dsv4", "p6-b200.48xlarge", 4, 1024, 1024)).not.toBeNull();
    expect(getBenchmarkCurve("nonexistent", "p6-b200.48xlarge", 4, 1024, 1024)).toBeNull();
    // GLM proxy key resolves on B200
    expect(getBenchmarkCurve("glm5", "p6-b200.48xlarge", 8, 1024, 1024)).not.toBeNull();
    // H100 has no data for our models → null
    expect(getBenchmarkCurve("dsv4", "p5.48xlarge", 4, 1024, 1024)).toBeNull();
  });
});

function selfHostInputs(modelId: string) {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = modelId;
  i.generation.gpuInstanceType = "p6-b200.48xlarge";
  i.generation.weightBits = 4;
  i.generation.interactivityTarget = 30;
  return i;
}

describe("computeGrounding (via calculate)", () => {
  it("grounds a measured model and flags under-provisioning at high QPS", () => {
    const i = selfHostInputs("deepseek-v4-pro-oss");
    i.traffic.queriesPerMonth = 200_000_000; // heavy load
    i.generation.numInstances = 1;
    const g = calculate(i, priceBook).grounding;
    expect(g.available).toBe(true);
    expect(g.provenance).toBe("measured");
    expect(g.tputPerGpu).toBeGreaterThan(0);
    expect(g.minInstances).toBe(Math.max(g.minInstancesThroughput!, g.minInstancesMemory!, 1));
    expect(g.underProvisioned).toBe(g.provisionedInstances! < g.minInstances!);
    // heavy load ⇒ throughput floor dominates and exceeds a 1-box fleet
    expect(g.minInstancesThroughput!).toBeGreaterThan(1);
    expect(g.underProvisioned).toBe(true);
  });

  it("labels GLM-5.2 a proxy and marks Nemotron/Kimi unavailable", () => {
    expect(calculate(selfHostInputs("glm-5.2-oss"), priceBook).grounding.provenance).toBe("proxy");
    const nemo = calculate(selfHostInputs("nemotron-3-ultra-oss"), priceBook).grounding;
    expect(nemo.available).toBe(false);
    expect(nemo.provenance).toBe("estimate");
    expect(calculate(selfHostInputs("kimi-k2.6-oss"), priceBook).grounding.available).toBe(false);
  });

  it("higher interactivity target ⇒ fewer tok/s/GPU ⇒ at least as many GPUs", () => {
    const base = selfHostInputs("deepseek-v4-pro-oss");
    base.traffic.queriesPerMonth = 50_000_000;
    const lax = { ...base, generation: { ...base.generation, interactivityTarget: 10 } };
    const strict = { ...base, generation: { ...base.generation, interactivityTarget: 80 } };
    const gLax = calculate(lax, priceBook).grounding;
    const gStrict = calculate(strict, priceBook).grounding;
    expect(gStrict.tputPerGpu!).toBeLessThanOrEqual(gLax.tputPerGpu!);
    expect(gStrict.minInstancesThroughput!).toBeGreaterThanOrEqual(gLax.minInstancesThroughput!);
  });
});
