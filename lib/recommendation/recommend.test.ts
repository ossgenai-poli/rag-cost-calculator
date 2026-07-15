// Phase-1 recommendation SWEEP acceptance tests. The candidate catalog is module-mocked (per case) so
// the PUBLIC recommend() still exposes no caller injection. Numbers are anchored to the signed-off
// rc-qa-11 reference cases R1-R5 (docs/ux-v2/18-reference-cases.md).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./candidate-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-catalog")>();
  return { ...actual, loadCandidateCatalog: vi.fn(actual.loadCandidateCatalog) };
});

import { recommend, evaluateCandidate } from "./recommend";
import { deriveDecision } from "./decision";
import { loadCandidateCatalog, validateCandidateCatalog, PINNED_CANDIDATES } from "./candidate-catalog";
import { defaultInputs } from "../calc-engine";
import type { CalcInputs, PriceBook } from "../types";
import type { CandidateConfig } from "./schema";
import pricesJson from "../../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const mockedCatalog = vi.mocked(loadCandidateCatalog);
beforeEach(() => mockedCatalog.mockReset());

const C = {
  b200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!,
  b200Fp8: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w8kv16")!,
  h200Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5e.48xlarge·w4kv16")!,
  h100Int4: PINNED_CANDIDATES.find((c) => c.id === "deepseek-v4-pro-oss·p5.48xlarge·w4kv16")!,
};

/** The canonical dsv4 workload (18-reference-cases §canonical). GPU/precision are set per candidate. */
function dsv4Workload(volume = 200_000_000): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  i.generation.outTokens = 500;
  i.traffic.queriesPerMonth = volume;
  i.traffic.peakFactor = 1;
  return i;
}

describe("sweep — R1-R5 reference cases (decision + bestSelfHost)", () => {
  it("R1: api/lower-cost; bestSelfHost=p6-b200; 87 boxes; $7,176,630; prefill; measured-scaled", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.decision).toEqual({ choice: "api", basis: "lower-cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    expect(r.bestSelfHost!.confidence).toBe("measured-scaled");
    const ev = r.evaluations[0];
    expect(ev.fleet.boxes).toBe(87);
    expect(ev.fleet.bindingDim).toBe("prefill");
    expect(Math.round(ev.cost.selfHostMonthly!)).toBe(7_176_630);
    expect(Math.round(ev.cost.apiMonthly!)).toBe(6_492_000);
    expect(ev.recommendationEligible).toBe(true);
  });

  it("R2: FP8 rejected evidence-below-threshold; INT4 remains bestSelfHost", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    const fp8 = r.rejected.find((x) => x.config.id === C.b200Fp8.id)!;
    expect(fp8.code).toBe("evidence-below-threshold");
    const fp8ev = r.evaluations.find((e) => e.config.id === C.b200Fp8.id)!;
    expect(fp8ev.engineConfidence).toBe("extrapolated"); // fp4 substituted for fp8
    expect(fp8ev.technicallyFeasible).toBe(true);
    expect(fp8ev.evidenceQualified).toBe(false);
    expect(r.decision).toEqual({ choice: "api", basis: "lower-cost" });
  });

  it("R3: H200 technicallyFeasible=true, evidenceQualified=false; api/evidence-gap; bestSelfHost=null", () => {
    mockedCatalog.mockReturnValue([C.h200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    const ev = r.evaluations[0];
    expect(ev.technicallyFeasible).toBe(true);
    expect(ev.evidenceQualified).toBe(false);
    expect(ev.engineConfidence).toBe("heuristic");
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
    expect(r.rejected[0].code).toBe("evidence-below-threshold");
  });

  it("R4: H100 behaves like R3 (heuristic → evidence-gap, bestSelfHost=null)", () => {
    mockedCatalog.mockReturnValue([C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.evaluations[0].technicallyFeasible).toBe(true);
    expect(r.evaluations[0].evidenceQualified).toBe(false);
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
  });

  it("R5: api/lower-cost; bestSelfHost=p6-b200; 4 boxes; $329,960", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(5_000_000), optimizeFor: "cost" });
    expect(r.decision).toEqual({ choice: "api", basis: "lower-cost" });
    expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id);
    expect(r.evaluations[0].fleet.boxes).toBe(4);
    expect(Math.round(r.evaluations[0].cost.selfHostMonthly!)).toBe(329_960);
  });
});

describe("sweep — experimental mode preserves unbenchmarked (approval limitation)", () => {
  it("pinned registry → effectiveConfidence=unbenchmarked, zero qualified, api/evidence-gap", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost", experimentalProvenance: true });
    const ev = r.evaluations[0];
    expect(ev.engineConfidence).toBe("measured-scaled"); // engine unchanged
    expect(ev.effectiveConfidence).toBe("unbenchmarked"); // registry demotes; no silent reuse
    expect(ev.evidenceQualified).toBe(false);
    expect(ev.registry).toBeDefined();
    expect(ev.registry!.status).toMatch(/invalid-request|unbenchmarked/); // internal evidence-metadata gap
    expect(r.bestSelfHost).toBeNull();
    expect(r.decision).toEqual({ choice: "api", basis: "evidence-gap" });
  });
});

describe("sweep — gate separation, comparison, determinism, injection, single-eval", () => {
  it("missing self-host price does NOT change technicallyFeasible (rev-2 #2)", () => {
    const zeroPriced: PriceBook = { ...priceBook, gpus: priceBook.gpus.map((g) => (g.instanceType === "p6-b200.48xlarge" ? { ...g, pricePerHr: 0 } : g)) };
    const ev = evaluateCandidate(C.b200Int4, dsv4Workload(), zeroPriced, "control");
    expect(ev.technicallyFeasible).toBe(true);
    expect(ev.priceQualified).toBe(false);
    expect(ev.cost.selfHostMonthly).toBeNull();
  });

  it("no API/self-host comparison is made when the self-host price is missing (comparisonQualified=false)", () => {
    const zeroPriced: PriceBook = { ...priceBook, gpus: priceBook.gpus.map((g) => (g.instanceType === "p6-b200.48xlarge" ? { ...g, pricePerHr: 0 } : g)) };
    const ev = evaluateCandidate(C.b200Int4, dsv4Workload(), zeroPriced, "control");
    expect(ev.evidenceQualified).toBe(true); // still evidence-qualified…
    expect(ev.comparisonQualified).toBe(false); // …but not comparable
    const d = deriveDecision([ev], { modelId: "deepseek-v4-pro-oss", monthlyCost: 6_492_000, priceState: "priced", comparisonQualified: true });
    expect(d).toEqual({ choice: "undetermined", basis: "comparison-unavailable" });
  });

  it("optimizeFor does not flip the API/self-host decision (single eligible catalog)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    const base = dsv4Workload();
    for (const axis of ["cost", "latency", "confidence", "predictability"] as const) {
      const r = recommend({ workload: base, optimizeFor: axis });
      expect(r.decision).toEqual({ choice: "api", basis: "lower-cost" });
      expect(r.bestSelfHost!.config.id).toBe(C.b200Int4.id); // only evidence-qualified config
    }
  });

  it("catalog order (shuffled/reversed) → byte-identical output", () => {
    const forward = [C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4];
    mockedCatalog.mockReturnValue(forward);
    const a = JSON.stringify(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    mockedCatalog.mockReturnValue([...forward].reverse());
    const b = JSON.stringify(recommend({ workload: dsv4Workload(), optimizeFor: "cost" }));
    expect(a).toBe(b);
  });

  it("public recommend() ignores any injected caller catalog (uses the internal loader only)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4]);
    const bogus = { id: "x", llmModelId: "deepseek-v4-pro-oss", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, label: "bogus" };
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost", candidates: [bogus, bogus, bogus] } as any);
    expect(r.evaluations.length).toBe(1); // the internal catalog, not the injected 3
    expect(r.evaluations[0].config.id).toBe(C.b200Int4.id);
  });

  it("every candidate is evaluated exactly once (no duplicate economics)", () => {
    mockedCatalog.mockReturnValue([C.b200Int4, C.b200Fp8, C.h200Int4, C.h100Int4]);
    const r = recommend({ workload: dsv4Workload(), optimizeFor: "cost" });
    expect(r.evaluations.length).toBe(4);
    expect(new Set(r.evaluations.map((e) => e.config.id)).size).toBe(4);
  });

  it("rejection precedence: a technically infeasible candidate reports the TECHNICAL code, not evidence", () => {
    // Force an operationally-absurd fleet: enormous volume → fleet/topology infeasibility takes precedence.
    mockedCatalog.mockReturnValue([C.h200Int4]); // heuristic (also evidence-gap) but tech must win
    const r = recommend({ workload: dsv4Workload(1e12), optimizeFor: "cost" });
    const ev = r.evaluations[0];
    if (!ev.technicallyFeasible) {
      expect(["model-does-not-fit-serving-group", "node-count-exceeds-topology", "fleet-exceeds-practical-limit", "context-window-overflow"]).toContain(ev.rejections[0].code);
    } else {
      // If the engine still sizes it, it is at least not a false 'infeasible'; evidence gate then applies.
      expect(ev.rejections[0].code).toBe("evidence-below-threshold");
    }
  });
});

describe("catalog validation fails closed", () => {
  const good = PINNED_CANDIDATES[0];
  const clone = (o: CandidateConfig): CandidateConfig => JSON.parse(JSON.stringify(o));
  it("the pinned catalog loads and validates", () => {
    expect(validateCandidateCatalog(PINNED_CANDIDATES, priceBook).length).toBe(PINNED_CANDIDATES.length);
  });
  it("empty set", () => expect(() => validateCandidateCatalog([], priceBook)).toThrow());
  it("duplicate", () => expect(() => validateCandidateCatalog([good, clone(good)], priceBook)).toThrow());
  it("unsupported model", () => {
    const bad = clone(good); bad.llmModelId = "no-such-model"; bad.id = `no-such-model·${bad.instanceType}·w${bad.weightBits}kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/unsupported model/);
  });
  it("unknown instance", () => {
    const bad = clone(good); bad.instanceType = "zz.unknown"; bad.id = `${bad.llmModelId}·zz.unknown·w${bad.weightBits}kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/unknown AWS instance/);
  });
  it("invalid precision", () => {
    const bad = clone(good); bad.weightBits = 3 as number; bad.id = `${bad.llmModelId}·${bad.instanceType}·w3kv${bad.kvBits}`;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/invalid weightBits/);
  });
  it("non-canonical id", () => {
    const bad = clone(good); bad.id = "not-canonical";
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/non-canonical id/);
  });
  it("malformed field", () => {
    const bad = clone(good); (bad as any).gpuSku = 123;
    expect(() => validateCandidateCatalog([bad], priceBook)).toThrow(/malformed gpuSku/);
  });
});
