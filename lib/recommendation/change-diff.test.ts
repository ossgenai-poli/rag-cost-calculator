// change-diff tests — diffs STRUCTURED results produced by the approved sweep (module-mocked catalog,
// same pattern as the other recommendation tests). Never inspects narrative prose. Includes the
// P1-DIFF-1 completeness guard: EVERY leaf path of a real control AND experimental result is mutated
// and must produce at least one coded change (identical:false).
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
import type { StructuredRecommendationResult } from "./schema";
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
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k]);
  }
  return o;
}

function r1(experimental = false): StructuredRecommendationResult {
  mockedCatalog.mockReturnValue([C.b200Int4]);
  return recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: experimental });
}

describe("change-diff — identity, determinism, immutability", () => {
  it("identical R1 results → empty diff (identical means COMPLETE canonical equality)", () => {
    const a = r1();
    const b = r1();
    const d = diffRecommendations(a, b);
    expect(d.identical).toBe(true);
    expect(d.changes).toEqual([]);
  });

  it("deterministic ordering + serialized output; inputs never mutated (deep-frozen)", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const b = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    const aSnap = JSON.stringify(a);
    const bSnap = JSON.stringify(b);
    deepFreeze(a);
    deepFreeze(b);
    const d1 = diffRecommendations(a, b);
    const d2 = diffRecommendations(a, b);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
    expect(JSON.stringify(a)).toBe(aSnap);
    expect(JSON.stringify(b)).toBe(bSnap);
    expect(JSON.stringify(d1)).not.toMatch(/NaN/);
    expect(d1.identical).toBe(false);
  });
});

describe("change-diff — P1-DIFF-1 completeness", () => {
  it("TTFT target 2,000→3,000ms (same recommendation) → effective-workload-changed, NEVER identical", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.ttftTargetMs = 3000;
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    expect(d.identical).toBe(false);
    expect(change(d, "effective-workload-changed")).toBeDefined();
  });

  it("COMPLETENESS GUARD: mutating EVERY leaf path of control AND experimental results yields ≥1 coded change", () => {
    // Walks every primitive leaf of two real results; each single-leaf mutation must be detected.
    // A future schema field is auto-covered (its leaves appear in the walk) — and the compile-time
    // `satisfies Record<keyof …, ChangeCode>` maps in change-diff.ts force a reason-code mapping.
    const leafPaths = (o: unknown, base: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] => {
      if (o === null || typeof o !== "object") { out.push(base); return out; }
      const entries = Array.isArray(o) ? o.map((v, i) => [i, v] as const) : Object.entries(o);
      if (entries.length === 0) { out.push(base); return out; } // empty object/array = a leaf value itself
      for (const [k, v] of entries) leafPaths(v, [...base, k], out);
      return out;
    };
    const setPath = (o: unknown, path: (string | number)[], v: unknown) => {
      let cur = o as Record<string | number, unknown>;
      for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
      cur[path[path.length - 1]] = v;
    };
    const getPath = (o: unknown, path: (string | number)[]) => path.reduce<unknown>((x, k) => (x as Record<string | number, unknown>)[k], o);
    const mutate = (v: unknown): unknown => {
      if (typeof v === "number") return v + 1;
      if (typeof v === "boolean") return !v;
      if (typeof v === "string") return `${v}·MUTATED`;
      return "MUTATED"; // null / empty object / empty array
    };
    // Test-local canonical mirror (same policy: undefined props omitted, undefined entries/non-finite →
    // null, sorted keys) — used to assert every emitted payload pair is canonically DIFFERENT.
    const canon = (v: unknown): string => {
      if (v === undefined || v === null) return "null";
      if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
      if (typeof v !== "object") return JSON.stringify(v);
      if (Array.isArray(v)) return `[${v.map((x) => canon(x === undefined ? null : x)).join(",")}]`;
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
    };
    for (const experimental of [false, true]) {
      const base = r1(experimental);
      const paths = leafPaths(clone(base));
      expect(paths.length).toBeGreaterThan(50); // sanity: the walk saw a real result
      for (const path of paths) {
        const mutated = clone(base);
        setPath(mutated, path, mutate(getPath(mutated, path)));
        const d = diffRecommendations(base, mutated);
        expect(d.identical, `path ${path.join(".")} must not be identical`).toBe(false);
        expect(d.changes.length, `path ${path.join(".")} must emit ≥1 coded change`).toBeGreaterThan(0);
        // invariant: never identical:false with empty changes; every payload pair canonically differs
        for (const ch of d.changes) {
          expect(canon(ch.before), `path ${path.join(".")} · ${ch.code}/${ch.field} payloads must differ`).not.toBe(canon(ch.after));
        }
      }
    }
  });

  it("STRUCTURAL GUARD: reorder / optional-presence / duplicates / simultaneous composite changes", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    // array reorder → equal under the documented non-semantic-order rule
    const reordered = clone(a);
    reordered.evaluations.reverse();
    expect(diffRecommendations(a, reordered)).toEqual({ identical: true, changes: [] });
    // duplicate candidate identity → fail closed
    const dup = clone(a);
    dup.evaluations.push(clone(dup.evaluations[0]));
    expect(() => diffRecommendations(a, dup)).toThrow(/duplicate candidate id/);
    // optional-property presence (absent vs explicit undefined) → equal
    const undef = { ...clone(a), controlComparison: undefined };
    expect(diffRecommendations(a, undef)).toEqual({ identical: true, changes: [] });
    // simultaneous changes inside one composite field are ALL represented
    const multi = clone(a);
    multi.apiOption.priceState = "no-price";
    multi.apiOption.comparisonQualified = false;
    multi.apiOption.monthlyCost = null;
    const d = diffRecommendations(a, multi);
    expect(change(d, "api-option-changed", "apiOption.priceState")).toBeDefined();
    expect(change(d, "api-option-changed", "apiOption.comparisonQualified")).toBeDefined();
    expect(change(d, "cost-changed", "apiOption.monthlyCost")).toBeDefined();
  });

  it("evaluations reordered → identical:true with no changes (order is non-semantic, ID-normalized)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = clone(a);
    b.evaluations.reverse();
    const d = diffRecommendations(a, b);
    expect(d.identical).toBe(true);
    expect(d.changes).toEqual([]);
  });

  it("nested optional (registry.transformations) absent vs explicit undefined → consistently equal", () => {
    const a = r1(true); // experimental: registry present; transformations key exists with undefined value
    const b = clone(a); // JSON clone DROPS undefined-valued keys → absent representation
    const d = diffRecommendations(a, b);
    expect(d.identical).toBe(true);
    expect(d.changes).toEqual([]);
  });

  it("P2-DIFF-2: rejection code + message changed together → BOTH primary transition AND full details", () => {
    mockedCatalog.mockReturnValue([C.b200Fp8]); // rejected: evidence-below-threshold
    const a = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const b = clone(a);
    b.evaluations[0].rejections = [{ code: "sla-unmet-ttft-or-streaming", message: "entirely new message" }];
    const d = diffRecommendations(a, b);
    expect(change(d, "rejection-changed", "rejections[0].code")).toMatchObject({
      before: "evidence-below-threshold",
      after: "sla-unmet-ttft-or-streaming",
    });
    const details = change(d, "rejection-details-changed", "rejections")!;
    expect((details.before as Array<{ code: string; message: string }>)[0].code).toBe("evidence-below-threshold");
    expect((details.after as Array<{ code: string; message: string }>)[0].message).toBe("entirely new message");
  });

  it("serving-facts-only change → serving-facts-changed", () => {
    const a = r1();
    const b = clone(a);
    b.evaluations[0].servingFacts.gpuPricePerHr = 999;
    const d = diffRecommendations(a, b);
    expect(change(d, "serving-facts-changed")).toMatchObject({ candidateId: C.b200Int4.id, field: "servingFacts" });
  });

  it("TTFT-only change → latency-changed", () => {
    const a = r1();
    const b = clone(a);
    b.evaluations[0].ttftS = 1.9;
    expect(change(diffRecommendations(a, b), "latency-changed", "ttftS")).toMatchObject({ before: 1.22, after: 1.9 });
    const c = clone(a);
    c.evaluations[0].ttftPercentile = "p95";
    expect(change(diffRecommendations(a, c), "latency-changed", "ttftPercentile")).toBeDefined();
  });

  it("registry reasons/transformations/provenance-only changes → provenance-changed", () => {
    const a = r1(true);
    const b = clone(a);
    b.evaluations[0].registry!.reasons = [{ code: "x", dimension: "d", message: "changed" }];
    expect(change(diffRecommendations(a, b), "provenance-changed", "registry.reasons")).toBeDefined();
    const c = clone(a);
    c.evaluations[0].registry!.differsFromControl = !c.evaluations[0].registry!.differsFromControl;
    expect(change(diffRecommendations(a, c), "provenance-changed", "registry.differsFromControl")).toBeDefined();
  });

  it("same candidate id with changed config → candidate-config-changed", () => {
    const a = r1();
    const b = clone(a);
    (b.evaluations[0].config as { label: string }).label = "renamed";
    expect(change(diffRecommendations(a, b), "candidate-config-changed", "config")).toMatchObject({ candidateId: C.b200Int4.id });
  });

  it("bestSelfHost card change with SAME candidate id → best-self-host-changed (full cards)", () => {
    const a = r1();
    const b = clone(a);
    (b.bestSelfHost as { confidence: string }).confidence = "extrapolated";
    const ch = change(diffRecommendations(a, b), "best-self-host-changed")!;
    expect((ch.before as { confidence: string }).confidence).toBe("measured-scaled");
    expect((ch.after as { confidence: string }).confidence).toBe("extrapolated");
  });

  it("modelLabel-only / selfHostModelLabel / priceState / comparisonQualified / controlComparison / alternatives changes are detected", () => {
    const a = r1(true); // experimental → controlComparison present
    const lbl = clone(a); lbl.apiOption.modelLabel = "Renamed";
    expect(change(diffRecommendations(a, lbl), "model-label-changed", "apiOption.modelLabel")).toBeDefined();
    const shl = clone(a); shl.selfHostModelLabel = "Renamed";
    expect(change(diffRecommendations(a, shl), "model-label-changed", "selfHostModelLabel")).toBeDefined();
    const ps = clone(a); ps.apiOption.priceState = "no-price";
    expect(change(diffRecommendations(a, ps), "api-option-changed", "apiOption.priceState")).toBeDefined();
    const cq = clone(a); cq.apiOption.comparisonQualified = false;
    expect(change(diffRecommendations(a, cq), "api-option-changed", "apiOption.comparisonQualified")).toBeDefined();
    const cc = clone(a); cc.controlComparison = { differs: true, cause: "new-data" };
    expect(change(diffRecommendations(a, cc), "control-comparison-changed")).toBeDefined();
    const alt = clone(a); alt.alternatives = [{ kind: "lowest-cost", config: a.evaluations[0].config, costMonthly: 1, costDeltaVsBest: 0, confidence: "heuristic" }];
    expect(change(diffRecommendations(a, alt), "alternatives-changed")).toBeDefined();
    const rej = clone(a); rej.rejected = [];
    expect(change(diffRecommendations(a, rej), "rejection-details-changed", "rejected")).toBeDefined();
  });
});

describe("change-diff — required change classes", () => {
  it("workload-volume change (R1→R5) → fleet + cost changes with before/after values", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const b = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    const fleet = change(d, "fleet-changed", "fleet.boxes")!;
    expect(fleet.candidateId).toBe(C.b200Int4.id);
    expect(fleet.before).toBe(87);
    expect(fleet.after).toBe(4);
    const cost = change(d, "cost-changed", "cost.selfHostMonthly")!;
    expect(Math.round(cost.before as number)).toBe(7_176_630);
    expect(Math.round(cost.after as number)).toBe(329_960);
    expect(change(d, "fleet-equation-changed", "fleet.equation")).toBeDefined();
  });

  it("control → experimental → mode/confidence/gate/decision/best-self-host/comparator changes", () => {
    const a = r1();
    const b = r1(true);
    const d = diffRecommendations(a, b);
    expect(change(d, "mode-changed")).toMatchObject({ before: "control", after: "experimental" });
    expect(change(d, "confidence-changed", "effectiveConfidence")).toMatchObject({ before: "measured-scaled", after: "unbenchmarked" });
    expect(change(d, "confidence-changed", "registry.status")).toMatchObject({ before: null, after: "invalid-request" });
    expect(change(d, "gate-changed", "evidenceQualified")).toMatchObject({ before: true, after: false });
    expect(change(d, "gate-changed", "recommendationEligible")).toMatchObject({ before: true, after: false });
    expect(change(d, "decision-changed")).toMatchObject({ before: { choice: "api", basis: "lower-cost" }, after: { choice: "api", basis: "evidence-gap" } });
    const bsh = change(d, "best-self-host-changed")!;
    expect((bsh.before as { config: { id: string } }).config.id).toBe(C.b200Int4.id); // FULL card, not just the id
    expect(bsh.after).toBeNull();
    expect(change(d, "comparator-changed")).toBeDefined();
    expect(change(d, "rejection-changed")).toMatchObject({ before: null, after: "evidence-below-threshold" });
  });

  it("API comparison model change → api-model-changed (+ API cost changes)", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.generation.apiComparisonModelId = "claude-opus-4-8";
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const d = diffRecommendations(a, b);
    expect(change(d, "api-model-changed")).toMatchObject({
      before: { modelId: "claude-fable-5", modelLabel: "Claude Fable 5 (Bedrock)" },
      after: { modelId: "claude-opus-4-8", modelLabel: "Claude Opus 4.8 (Bedrock)" },
    });
    expect(change(d, "cost-changed", "apiOption.monthlyCost")).toBeDefined();
  });

  it("topN + uptime adjustments → adjustments-changed with the structured lists", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const w = dsv4Workload();
    w.retrieval.topK = 3;
    w.retrieval.topN = 9;
    w.generation.gpuUptimeHoursPerMonth = 1000;
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const adj = change(diffRecommendations(a, b), "adjustments-changed")!;
    expect(adj.before).toEqual([]);
    expect(adj.after).toContainEqual({ field: "gpuUptimeHoursPerMonth", entered: 1000, calculated: 730 });
    expect(adj.after).toContainEqual({ field: "retrieval.topN", entered: 9, calculated: 3 });
  });

  it("pricing provenance change → pricing-changed per field, nothing else invented", () => {
    const a = r1();
    const b = { ...a, pricing: { ...a.pricing, source: "live" as const, asOf: "2026-08-01T00:00:00.000Z" } };
    const d = diffRecommendations(a, b);
    expect(change(d, "pricing-changed", "pricing.source")).toMatchObject({ before: "fallback", after: "live" });
    expect(change(d, "pricing-changed", "pricing.asOf")).toBeDefined();
    expect(codes(d)).toEqual(["pricing-changed", "pricing-changed"]);
  });

  it("candidate added / removed carry the FULL deep-copied evaluation snapshot (P2-DIFF-1)", () => {
    const a = r1();
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const b = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const dAdd = diffRecommendations(a, b);
    const added = change(dAdd, "candidate-added")!;
    expect(added.candidateId).toBe(C.b200Fp8.id);
    expect(added.before).toBeNull();
    const snap = added.after as { config: { id: string }; engineConfidence: string; fleet: { boxes: number } };
    expect(snap.config.id).toBe(C.b200Fp8.id); // full evaluation, self-contained
    expect(snap.engineConfidence).toBe("extrapolated");
    expect(snap.fleet.boxes).toBe(87);
    // deep copy, not an alias into the input result
    expect(added.after).not.toBe(b.evaluations.find((e) => e.config.id === C.b200Fp8.id));
    const dRem = diffRecommendations(b, a);
    const removed = change(dRem, "candidate-removed")!;
    expect((removed.before as { config: { id: string } }).config.id).toBe(C.b200Fp8.id);
    expect(removed.after).toBeNull();
  });

  it("decision choice/basis + comparator change (via a structured fixture)", () => {
    const a = r1();
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
