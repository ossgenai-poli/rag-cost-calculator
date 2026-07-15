// change-diff tests — diffs STRUCTURED results produced by the approved sweep (module-mocked catalog,
// same pattern as the other recommendation tests). Never inspects narrative prose.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./candidate-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-catalog")>();
  return { ...actual, loadCandidateCatalog: vi.fn(actual.loadCandidateCatalog) };
});

import { recommend } from "./recommend";
import { diffRecommendations } from "./change-diff";
import { loadCandidateCatalog, PINNED_CANDIDATES } from "./candidate-catalog";
import { defaultInputs } from "../calc-engine";
import type { CalcInputs, PriceBook } from "../types";
import pricesJson from "../../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const mockedCatalog = vi.mocked(loadCandidateCatalog);
beforeEach(() => mockedCatalog.mockReset());

const C = {
  b200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!,
  b200Fp8: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w8kv16")!,
};
function dsv4Workload(volume = 200_000_000): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  i.generation.outTokens = 500;
  i.traffic.queriesPerMonth = volume;
  i.traffic.peakFactor = 1;
  return i;
}
const codes = (d: ReturnType<typeof diffRecommendations>) => d.changes.map((c) => c.code);
const change = (d: ReturnType<typeof diffRecommendations>, code: string, field?: string) =>
  d.changes.find((c) => c.code === code && (field === undefined || c.field === field));
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k]);
  }
  return o;
}

describe("change-diff — identity, determinism, immutability", () => {
  it("identical R1 results → empty diff", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    expect(d.identical).toBe(true);
    expect(d.changes).toEqual([]);
  });

  it("deterministic ordering + serialized output; inputs are never mutated (deep-frozen)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    const aSnap = JSON.stringify(a);
    const bSnap = JSON.stringify(b);
    deepFreeze(a);
    deepFreeze(b); // any mutation attempt would throw in strict mode
    const d1 = diffRecommendations(a, b);
    const d2 = diffRecommendations(a, b);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2)); // byte-identical serialization
    expect(JSON.stringify(a)).toBe(aSnap); // inputs untouched
    expect(JSON.stringify(b)).toBe(bSnap);
    // no NaN/undefined anywhere in the serialized diff
    expect(JSON.stringify(d1)).not.toMatch(/NaN|undefined/);
  });
});

describe("change-diff — required change classes", () => {
  it("workload-volume change (R1→R5) → fleet + cost changes with before/after values", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    const fleet = change(d, "fleet-changed", "fleet.boxes")!;
    expect(fleet.candidateId).toBe(C.b200Int4.id);
    expect(fleet.before).toBe(87);
    expect(fleet.after).toBe(4);
    const cost = change(d, "cost-changed", "cost.selfHostMonthly")!;
    expect(Math.round(cost.before as number)).toBe(7_176_630);
    expect(Math.round(cost.after as number)).toBe(329_960);
  });

  it("control → experimental → mode/confidence/gate/decision/best-self-host/comparator changes", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true });
    const d = diffRecommendations(a, b);
    expect(change(d, "mode-changed")).toMatchObject({ before: "control", after: "experimental" });
    expect(change(d, "confidence-changed", "effectiveConfidence")).toMatchObject({ before: "measured-scaled", after: "unbenchmarked" });
    expect(change(d, "confidence-changed", "registry.status")).toMatchObject({ before: null, after: "invalid-request" });
    expect(change(d, "gate-changed", "evidenceQualified")).toMatchObject({ before: true, after: false });
    expect(change(d, "gate-changed", "recommendationEligible")).toMatchObject({ before: true, after: false });
    expect(change(d, "decision-changed")).toMatchObject({ before: { choice: "api", basis: "lower-cost" }, after: { choice: "api", basis: "evidence-gap" } });
    expect(change(d, "best-self-host-changed")).toMatchObject({ before: C.b200Int4.id, after: null });
    expect(change(d, "comparator-changed")).toBeDefined(); // comparator → null (no lower-cost basis)
    expect(change(d, "rejection-changed")).toMatchObject({ before: null, after: "evidence-below-threshold" });
  });

  it("API comparison model change → api-model-changed (+ API cost changes)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const w = dsv4Workload(); w.generation.apiComparisonModelId = "claude-opus-4-8";
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    expect(change(d, "api-model-changed")).toMatchObject({
      before: { modelId: "claude-fable-5", modelLabel: "Claude Fable 5 (Bedrock)" },
      after: { modelId: "claude-opus-4-8", modelLabel: "Claude Opus 4.8 (Bedrock)" },
    });
    expect(change(d, "cost-changed", "apiOption.monthlyCost")).toBeDefined();
  });

  it("topN + uptime adjustments → adjustments-changed with the structured lists", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const w = dsv4Workload(); w.retrieval.topK = 3; w.retrieval.topN = 9; w.generation.gpuUptimeHoursPerMonth = 1000;
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const adj = change(diffRecommendations(a, b), "adjustments-changed")!;
    expect(adj.before).toEqual([]);
    expect(adj.after).toContainEqual({ field: "gpuUptimeHoursPerMonth", entered: 1000, calculated: 730 });
    expect(adj.after).toContainEqual({ field: "retrieval.topN", entered: 9, calculated: 3 });
  });

  it("pricing provenance change → pricing-changed per field", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = { ...a, pricing: { ...a.pricing, source: "live" as const, asOf: "2026-08-01T00:00:00.000Z" } };
    const d = diffRecommendations(a, b);
    expect(change(d, "pricing-changed", "pricing.source")).toMatchObject({ before: "fallback", after: "live" });
    expect(change(d, "pricing-changed", "pricing.asOf")).toBeDefined();
    expect(codes(d)).toEqual(["pricing-changed", "pricing-changed"]); // nothing else invented
  });

  it("candidate added / removed", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const b = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const dAdd = diffRecommendations(a, b);
    expect(change(dAdd, "candidate-added")).toMatchObject({ candidateId: C.b200Fp8.id, before: null, after: C.b200Fp8.id });
    const dRem = diffRecommendations(b, a);
    expect(change(dRem, "candidate-removed")).toMatchObject({ candidateId: C.b200Fp8.id, before: C.b200Fp8.id, after: null });
  });

  it("decision choice/basis + comparator change (via a structured pricing-book-independent fixture)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    // Clone and flip the decision (as a cheaper self-host book would produce) — diff must report both.
    const b = {
      ...a,
      decision: {
        choice: "self-host" as const,
        basis: "lower-cost" as const,
        costComparator: { selfHostCandidateId: C.b200Int4.id, selfHostMonthly: 5_000_000, apiMonthly: 6_492_000 },
      },
    };
    const d = diffRecommendations(a, b);
    expect(change(d, "decision-changed")).toMatchObject({ before: { choice: "api" }, after: { choice: "self-host" } });
    const cmp = change(d, "comparator-changed")!;
    expect((cmp.after as { selfHostMonthly: number }).selfHostMonthly).toBe(5_000_000);
    expect((cmp.before as { selfHostMonthly: number }).selfHostMonthly).toBeCloseTo(7_176_630, 0);
  });
});
