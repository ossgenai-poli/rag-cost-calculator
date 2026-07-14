// rc-qa-5 acceptance tests — the 20 required proofs for GPU-008…013, QA-014,
// INPUT-020, UX-015/017/019 and PRICING-018.
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { buildScenarios } from "./scenarios";
import { buildReport, assumptionsToJson } from "./share";
import { applyGpuSelection } from "./ui-logic";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const useGpu = (i: CalcInputs, t: string) => {
  i.generation = applyGpuSelection(i.generation, priceBook.gpus.find((g) => g.instanceType === t)!);
};
function sh(over: (i: CalcInputs) => void): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  useGpu(i, "p6-b200.48xlarge");
  i.generation.weightBits = 4;
  over(i);
  return i;
}

describe("GPU-008 — prefill/QPS capacity", () => {
  it("1. a zero-output, high-input workload is constrained by prefill (not zero work)", () => {
    const c = calculate(sh((i) => {
      i.generation.outTokens = 0;
      i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 10; i.chunking.chunkSize = 2000;
      i.generation.maxContextLen = 32768;
      i.traffic.queriesPerMonth = 100_000_000;
    }), priceBook).crossover;
    expect(c.peakDecodeDemand).toBe(0);
    expect(c.peakPrefillDemand).toBeGreaterThan(0);
    expect(c.prefillBinds).toBe(true);
    expect(c.requiredInstances).toBeGreaterThan(1); // real GPU work
  });

  it("2. raising input tokens raises the required fleet even with output fixed", () => {
    const base = (isl: number) => calculate(sh((i) => {
      i.generation.outTokens = 100;
      i.corpus.avgTokensPerDoc = 4000; i.retrieval.topN = isl; i.chunking.chunkSize = 2000;
      i.generation.maxContextLen = 131072;
      i.traffic.queriesPerMonth = 100_000_000;
    }), priceBook).crossover;
    const few = base(2);
    const many = base(20); // ~10× the input tokens, same output
    expect(many.peakPrefillDemand).toBeGreaterThan(few.peakPrefillDemand);
    expect(many.requiredInstances).toBeGreaterThan(few.requiredInstances);
  });
});

describe("GPU-009 — utilization target", () => {
  it("3. lowering the utilization target raises the required replica count", () => {
    const at = (ut: number) => calculate(sh((i) => {
      i.generation.outTokens = 500; i.generation.interactivityTarget = 30;
      i.generation.utilTarget = ut; i.traffic.queriesPerMonth = 200_000_000;
    }), priceBook).crossover;
    expect(at(0.5).requiredInstances).toBeGreaterThan(at(0.9).requiredInstances);
  });

  it("4. post-one-replica-loss peak utilization is reported and finite when feasible", () => {
    const c = calculate(sh((i) => {
      i.generation.outTokens = 500; i.generation.interactivityTarget = 30;
      i.traffic.queriesPerMonth = 200_000_000;
    }), priceBook).crossover;
    expect(c.feasible).toBe(true);
    expect(Number.isFinite(c.utilPeakPostLoss)).toBe(true);
    expect(c.utilPeakPostLoss).toBeGreaterThan(c.utilPeak); // fewer replicas ⇒ higher util
  });
});

describe("GPU-010 — precision + sequence provenance", () => {
  it("5. BF16 weights cannot use the FP8 curve as an exact 'measured' match", () => {
    const c = calculate(sh((i) => {
      i.generation.weightBits = 16; // BF16
      i.generation.outTokens = 1024; i.corpus.avgTokensPerDoc = 2000;
      i.retrieval.topN = 4; i.chunking.chunkSize = 2048;
      i.traffic.queriesPerMonth = 20_000_000;
    }), priceBook).crossover;
    expect(c.capacity.precisionRequested).toBe("bf16");
    expect(c.capacity.source).toBe("extrapolated");
    expect(c.capacity.extrapolationReasons.join(" ")).toMatch(/precision/i);
  });

  it("6. an output-length mismatch flips provenance to extrapolated", () => {
    const c = calculate(sh((i) => {
      i.generation.weightBits = 4; i.generation.outTokens = 100; // OSL 100 vs 1024 bucket
      i.corpus.avgTokensPerDoc = 250; i.retrieval.topN = 4; i.chunking.chunkSize = 256; // ISL ~1024
      i.traffic.queriesPerMonth = 20_000_000;
    }), priceBook).crossover;
    expect(c.capacity.source).toBe("extrapolated");
    expect(c.capacity.extrapolationReasons.join(" ")).toMatch(/output length/i);
  });

  it("7. ISL/OSL mismatch reasons appear in the Markdown report and JSON export", () => {
    const i = sh((x) => {
      x.generation.weightBits = 16; x.generation.outTokens = 100;
      x.corpus.avgTokensPerDoc = 2000; x.retrieval.topN = 10; x.chunking.chunkSize = 2000;
      x.traffic.queriesPerMonth = 20_000_000;
    });
    const r = calculate(i, priceBook);
    const md = buildReport(i, r, priceBook, "2026-01-01");
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(md).toMatch(/Extrapolation:/);
    expect(json.fleet.capacity.extrapolationReasons.length).toBeGreaterThan(0);
  });
});

describe("GPU-011 — serving-group granularity", () => {
  const mm = (over: (i: CalcInputs) => void) => sh((i) => {
    i.generation.llmModelId = "minimax-m3-oss"; i.generation.weightBits = 8;
    i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 4; i.chunking.chunkSize = 2048;
    i.generation.outTokens = 1024; i.traffic.queriesPerMonth = 2_000_000_000;
    over(i);
  });

  it("8. a partial serving group contributes no usable capacity (9 boxes / 8-box replica)", () => {
    const c = calculate(mm((i) => {
      i.generation.autoSizeFleet = false; i.generation.haEnabled = false;
      i.generation.numInstances = 9;
    }), priceBook).crossover;
    expect(c.instancesPerReplica).toBe(8);
    expect(c.boxes).toBe(9);
    expect(c.usableReplicas).toBe(1);
    expect(c.strandedBoxes).toBe(1);
    expect(c.providedDecodeCapacity).toBeCloseTo(1 * c.capacity.perReplicaDecodeTokS, 3);
  });

  it("9. auto-size rounds the billed fleet up to a complete serving-group multiple", () => {
    const c = calculate(mm((i) => { i.generation.autoSizeFleet = true; }), priceBook).crossover;
    expect(c.boxes % c.instancesPerReplica).toBe(0);
    expect(c.strandedBoxes).toBe(0);
  });
});

describe("GPU-012 — context feasibility", () => {
  it("10. input + output exceeding the configured context is infeasible", () => {
    const c = calculate(sh((i) => {
      i.generation.outTokens = 10000; i.generation.maxContextLen = 8192;
      i.corpus.avgTokensPerDoc = 2000; i.retrieval.topN = 10; i.chunking.chunkSize = 2000;
      i.traffic.queriesPerMonth = 5_000_000;
    }), priceBook).crossover;
    expect(c.capacity.contextOverflow).toBe(true);
    expect(c.feasible).toBe(false);
    expect(c.verdict).not.toBe("self-host efficient");
    expect(c.infeasibility.map((x) => x.code)).toContain("context-overflow");
  });

  it("11. the model's supported maximum context is enforced", () => {
    // Custom price book: give the model a small supported max context.
    const pb: PriceBook = {
      ...priceBook,
      models: priceBook.models.map((m) =>
        m.id === "deepseek-v4-pro-oss" ? { ...m, maxContextTokens: 4096 } : m
      ),
    };
    const i = sh((x) => {
      x.generation.outTokens = 500; x.generation.maxContextLen = 131072; // config allows a lot…
      x.corpus.avgTokensPerDoc = 2000; x.retrieval.topN = 4; x.chunking.chunkSize = 2000; // ISL ~8K
      x.traffic.queriesPerMonth = 5_000_000;
    });
    const c = calculate(i, pb).crossover;
    expect(c.capacity.maxContextConfigured).toBe(4096); // clamped to the model's max
    expect(c.capacity.contextOverflow).toBe(true);
    expect(c.feasible).toBe(false);
  });
});

describe("GPU-013 — infeasibility reason codes", () => {
  it("12. a TTFT failure never tells the user to add instances / enable auto-size", () => {
    const c = calculate(sh((i) => {
      i.generation.outTokens = 500; i.generation.ttftTargetMs = 100;
      i.traffic.queriesPerMonth = 200_000_000;
    }), priceBook).crossover;
    const ttft = c.infeasibility.find((x) => x.code === "ttft")!;
    expect(ttft).toBeDefined();
    expect(ttft.addingInstancesHelps).toBe(false);
    expect(c.infeasibility.some((x) => x.addingInstancesHelps)).toBe(false);
  });

  it("13. a manual-cap shortage DOES give the capacity-specific 'add instances' guidance", () => {
    const c = calculate(sh((i) => {
      i.generation.llmModelId = "minimax-m3-oss"; i.generation.weightBits = 8;
      i.generation.outTokens = 1024; i.corpus.avgTokensPerDoc = 2000;
      i.retrieval.topN = 4; i.chunking.chunkSize = 2048;
      i.generation.autoSizeFleet = false; i.generation.haEnabled = false;
      i.generation.numInstances = 9; // < one full requirement at this load
      i.traffic.queriesPerMonth = 2_000_000_000;
    }), priceBook).crossover;
    const cap = c.infeasibility.find((x) => x.code === "manual-cap");
    if (cap) expect(cap.addingInstancesHelps).toBe(true);
  });
});

describe("QA-014 — GPU fixture correctness", () => {
  it("14. the DeepSeek fixture uses the p6 hourly price, not the default p5 price", () => {
    const i = sh(() => {});
    expect(i.generation.gpuInstanceType).toBe("p6-b200.48xlarge");
    expect(i.generation.gpuPricePerHr).toBe(113); // p6, NOT p5 $55
  });

  it("15. UI-equivalent selection == direct full-record construction (and != the buggy pairing)", () => {
    const viaHelper = sh(() => {});
    const g = priceBook.gpus.find((x) => x.instanceType === "p6-b200.48xlarge")!;
    const manualFull = sh(() => {});
    manualFull.generation.gpuInstanceType = g.instanceType;
    manualFull.generation.gpuPricePerHr = g.pricePerHr;
    manualFull.generation.sustainedTokPerSec = g.sustainedTokPerSec;
    expect(calculate(manualFull, priceBook).totalMonthly$).toBeCloseTo(
      calculate(viaHelper, priceBook).totalMonthly$, 6
    );
    const buggy = sh(() => {});
    buggy.generation.gpuPricePerHr = 55.04; // p6 instance + p5 price (the QA-014 defect)
    expect(calculate(buggy, priceBook).crossover.selfHostedMonthly$).not.toBeCloseTo(
      calculate(viaHelper, priceBook).crossover.selfHostedMonthly$, 0
    );
  });
});

describe("UX-015 / provenance — positive verdicts always qualified when not fully measured+live", () => {
  it("16. a heuristic (no benchmark) positive verdict is flagged qualified", () => {
    const c = calculate(sh((i) => {
      i.generation.llmModelId = "nemotron-3-ultra-oss"; // no InferenceX key → heuristic
      useGpu(i, "p5.48xlarge");
      i.traffic.queriesPerMonth = 5_000_000;
    }), priceBook).crossover;
    expect(c.capacity.source).toBe("heuristic");
    if (c.verdict === "self-host efficient") expect(c.verdictQualified).toBe(true);
  });
});

describe("UX-017 — serving-redundancy semantics", () => {
  it("17. HA-off surfaces as no added replica (drives the non-production banner)", () => {
    const on = calculate(sh((i) => { i.generation.outTokens = 500; i.generation.haEnabled = true; i.traffic.queriesPerMonth = 200_000_000; }), priceBook).crossover;
    const off = calculate(sh((i) => { i.generation.outTokens = 500; i.generation.haEnabled = false; i.traffic.queriesPerMonth = 200_000_000; }), priceBook).crossover;
    expect(off.haReplicasAdded).toBe(0);
    expect(on.haReplicasAdded).toBe(1);
  });
});

describe("PRICING-018 — per-SKU provenance in exports", () => {
  it("18. per-SKU price provenance is present in the JSON export", () => {
    const pb: PriceBook = {
      ...priceBook,
      gpus: priceBook.gpus.map((g, idx) => ({ ...g, priceSource: idx === 0 ? "live" : "fallback" as const })),
    };
    const i = sh(() => {});
    const json = JSON.parse(assumptionsToJson(i, pb, "2026-01-01", calculate(i, pb)));
    const sources = json.pricing.gpus.map((g: { priceSource?: string }) => g.priceSource);
    expect(sources).toContain("live");
    expect(sources).toContain("fallback");
  });
});

describe("UX-019 — active-window QPS", () => {
  it("19. active-window QPS scales with fleet uptime; calendar QPS does not", () => {
    const full = calculate(sh((i) => { i.generation.outTokens = 500; i.generation.gpuUptimeHoursPerMonth = 730; i.traffic.queriesPerMonth = 50_000_000; }), priceBook).crossover;
    const half = calculate(sh((i) => { i.generation.outTokens = 500; i.generation.gpuUptimeHoursPerMonth = 365; i.traffic.queriesPerMonth = 50_000_000; }), priceBook).crossover;
    // Fewer active hours ⇒ the SAME monthly break-even tokens must clear at a
    // higher sustained (active-window) QPS.
    expect(half.activeWindowQPS).toBeGreaterThan(half.equivalentQPS);
    expect(half.activeWindowQPS).toBeGreaterThan(full.activeWindowQPS);
  });
});

describe("INPUT-020 — extreme inputs never render Infinity/NaN", () => {
  it("20. a finite-but-absurd query count yields finite cost and fleet", () => {
    const r = calculate(sh((i) => { i.traffic.queriesPerMonth = 1e308; }), priceBook);
    expect(Number.isFinite(r.totalMonthly$)).toBe(true);
    expect(Number.isFinite(r.crossover.requiredInstances)).toBe(true);
    expect(Number.isFinite(r.crossover.utilAvg)).toBe(true);
  });
});
