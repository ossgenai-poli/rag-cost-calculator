import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MODEL_PRICES, GPU_DEFAULTS } from "./model-prices";

// QA-001 guard: the committed static fallback (public/prices.json) must stay in
// sync with the authoritative catalog (lib/model-prices.ts) that runtime uses.
// If a nightly refresh (or a hand-edit) ever reintroduces an obsolete catalog,
// this test fails CI — static and runtime deployments can't silently diverge.
const prices = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "prices.json"),
    "utf8"
  )
);

describe("catalog consistency — public/prices.json vs authoritative lib/model-prices.ts", () => {
  it("has identical model ids (same set, same order)", () => {
    expect(prices.models.map((m: { id: string }) => m.id)).toEqual(MODEL_PRICES.map((m) => m.id));
  });

  it("has identical GPU instance types", () => {
    expect(prices.gpus.map((g: { instanceType: string }) => g.instanceType)).toEqual(
      GPU_DEFAULTS.map((g) => g.instanceType)
    );
  });

  it("carries model metadata that grounding/self-host depend on (paramsB, inferencexKey)", () => {
    for (const m of MODEL_PRICES.filter((x) => x.kind === "llm" && x.selfHostable)) {
      const snap = prices.models.find((p: { id: string }) => p.id === m.id);
      expect(snap, `missing model in prices.json: ${m.id}`).toBeTruthy();
      expect(snap.paramsB).toBe(m.paramsB);
      expect(snap.inferencexKey).toBe(m.inferencexKey);
      expect(snap.benchmarkProvenance).toBe(m.benchmarkProvenance);
    }
  });

  it("includes managedKb pricing and is not an obsolete catalog", () => {
    expect(prices.managedKb).toBeTruthy();
    const ids = prices.models.map((m: { id: string }) => m.id);
    // Obsolete markers that a stale refresh script used to reintroduce.
    expect(ids).not.toContain("qwen2.5-72b-bedrock");
    expect(prices.gpus.map((g: { instanceType: string }) => g.instanceType)).not.toContain("p4d.24xlarge");
  });
});
