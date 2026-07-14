// Acceptance tests for the GPU-001…GPU-007 capacity-model remediation (rc-qa-4).
// Exact expected values for the DeepSeek concurrency/crossover case and the GLM
// long-context KV case are pinned here (computed from the baked InferenceX data).
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { buildScenarios } from "./scenarios";
import { buildReport, assumptionsToJson } from "./share";
import { applyGpuSelection } from "./ui-logic";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;

// QA-014: select a GPU exactly like the UI — instance type, price and throughput
// move together, so a fixture can never pair p6 performance with p5 price.
function useGpu(i: CalcInputs, instanceType: string) {
  const g = priceBook.gpus.find((x) => x.instanceType === instanceType)!;
  i.generation = applyGpuSelection(i.generation, g);
}

function sh(over: (i: CalcInputs) => void): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  over(i);
  return i;
}

// The canonical DeepSeek reproduction (concurrency-capped, HA on).
function deepseek(over: (i: CalcInputs) => void = () => {}): CalcInputs {
  return sh((i) => {
    i.generation.llmModelId = "deepseek-v4-pro-oss";
    useGpu(i, "p6-b200.48xlarge");
    i.generation.weightBits = 4;
    i.generation.outTokens = 500;
    i.generation.interactivityTarget = 30;
    i.traffic.queriesPerMonth = 200_000_000;
    i.traffic.peakFactor = 1;
    over(i);
  });
}

describe("GPU-001 — grounded capacity drives utilization + break-even (not generic)", () => {
  it("DeepSeek repro: utilization comes from the MEASURED operating point, not sustainedTokPerSec", () => {
    const r = calculate(deepseek(), priceBook);
    const c = r.crossover;
    expect(c.capacity.source).not.toBe("heuristic"); // benchmark-driven
    expect(c.capacity.chosenConcurrency).toBe(32); // GPU-002 cap honored (default 32)
    // Decode capacity = measured OUTPUT tok/s/GPU (output_tput_per_gpu), not the
    // total-throughput figure the old build mislabeled as decode (INF-002).
    expect(Math.round(c.capacity.perGpuDecodeTokS)).toBe(164); // measured decode @ conc 32
    expect(Math.round(c.avgDecodeDemand)).toBe(38052);
    // This input-heavy RAG workload (2,910 in / 500 out) is PREFILL-bound: the
    // fleet is sized by input throughput, so the BINDING (prefill) dimension lands
    // at/below the 70% target and decode runs slacker (INF-002).
    expect(c.prefillBinds).toBe(true);
    expect(c.bindingDim).toBe("prefill");
    expect(c.utilAvgPrefill).toBeGreaterThan(0.5);
    expect(c.utilAvgPrefill).toBeLessThanOrEqual(0.72); // sized to the 70% target
    expect(c.utilAvg).toBeLessThan(c.utilAvgPrefill); // decode is not the binding dim
  });

  it("break-even feasibility uses the same authoritative capacity", () => {
    const c = calculate(deepseek(), priceBook).crossover;
    // utilAtBreakEven is derived from provided (measured) capacity — internally consistent.
    expect(c.utilAtBreakEven).toBeGreaterThan(0);
    expect(Number.isFinite(c.utilAtBreakEven)).toBe(true);
  });
});

describe("GPU-001/DeepSeek — exact crossover figures", () => {
  it("p6 price + PREFILL-bound utilTarget sizing ⇒ 86 throughput + 1 N+1 HA = 87 boxes (QA-014/GPU-009/INF-002)", () => {
    const i = deepseek();
    const c = calculate(i, priceBook).crossover;
    expect(i.generation.gpuPricePerHr).toBe(113); // QA-014: p6 price, NOT the p5 $55
    // Input-heavy RAG binds on PREFILL. Fleet = ceil(prefill demand / (perReplica
    // prefill capacity × 0.7)), sized from the ISL-scaled measured input throughput
    // (INF-002) — no longer the fixed-8× decode heuristic.
    expect(c.bindingDim).toBe("prefill");
    expect(c.throughputInstances).toBe(86);
    expect(c.replicas).toBe(87); // +1 N+1 HA
    expect(c.instancesPerReplica).toBe(1);
    expect(c.haReplicasAdded).toBe(1);
    expect(c.requiredInstances).toBe(87);
    expect(c.boxes).toBe(87);
    expect(c.usableReplicas).toBe(87);
    expect(c.strandedBoxes).toBe(0);
    expect(c.feasible).toBe(true);
  });
});

describe("GPU-002 — concurrency constrains the benchmark point", () => {
  it("reducing maxConcurrentSeqs to 1 uses the conc-1 point (~22.8 tok/s/GPU) ⇒ far more boxes", () => {
    const c16 = calculate(deepseek(), priceBook).crossover;
    const c1 = calculate(deepseek((i) => (i.generation.maxConcurrentSeqs = 1)), priceBook).crossover;
    expect(c1.capacity.chosenConcurrency).toBe(1);
    expect(c1.capacity.perGpuDecodeTokS).toBeLessThan(30); // ~22.8
    expect(c1.requiredInstances).toBeGreaterThan(c16.requiredInstances * 5);
  });

  it("the selected benchmark concurrency never exceeds the configured maximum", () => {
    for (const mc of [1, 4, 8, 16, 32]) {
      const c = calculate(deepseek((i) => (i.generation.maxConcurrentSeqs = mc)), priceBook).crossover;
      expect(c.capacity.chosenConcurrency).toBeLessThanOrEqual(mc);
    }
  });
});

describe("GPU-003 — KV precision independent of weight precision", () => {
  const glmKV = (kvBits: number) =>
    calculate(
      sh((i) => {
        i.generation.llmModelId = "glm-5.2-oss";
        useGpu(i, "p5.48xlarge");
        i.generation.weightBits = 4;
        i.generation.kvBits = kvBits;
        i.generation.maxContextLen = 131072;
        i.generation.maxConcurrentSeqs = 16;
        i.traffic.queriesPerMonth = 1_000_000;
      }),
      priceBook
    ).crossover.capacity;

  it("BF16 KV ≈ 2× FP8 KV while weights are unchanged (INT4)", () => {
    const bf16 = glmKV(16);
    const fp8 = glmKV(8);
    expect(Math.round(bf16.weightsGB)).toBe(200);
    expect(Math.round(fp8.weightsGB)).toBe(200); // weights independent of KV
    expect(bf16.kvCacheGB).toBeCloseTo(fp8.kvCacheGB * 2, 0);
  });

  it("GLM INT4 weights + BF16 KV @ 128K × 16 ⇒ ~790 GB KV, memory floor 2 × p5", () => {
    const cap = glmKV(16);
    expect(Math.round(cap.weightsGB)).toBe(200);
    expect(Math.round(cap.kvCacheGB)).toBe(790);
    expect(cap.memoryFloorBoxes).toBe(2);
    expect(cap.weightPrecisionBits).toBe(4);
    expect(cap.kvPrecisionBits).toBe(16);
  });
});

describe("GPU-004 — TTFT gate", () => {
  it("a point whose TTFT exceeds the target is rejected (no positive verdict)", () => {
    const c = calculate(deepseek((i) => (i.generation.ttftTargetMs = 100)), priceBook).crossover;
    expect(c.capacity.ttftS).toBeGreaterThan(0.1);
    expect(c.capacity.ttftMet).toBe(false);
    expect(c.capacity.slaAchievable).toBe(false);
    expect(c.feasible).toBe(false);
    expect(c.verdict).not.toBe("self-host efficient");
  });

  it("the SLA-met case keeps a positive verdict at the default 2 s target", () => {
    const c = calculate(deepseek(), priceBook).crossover;
    expect(c.capacity.ttftMet).toBe(true);
    expect(c.capacity.slaAchievable).toBe(true);
  });
});

describe("GPU-005/006 — topology, extrapolation labels, replica granularity", () => {
  // MiniMax with matching precision (FP8) and input near the 8192 bucket.
  const minimax = (over: (i: CalcInputs) => void = () => {}) =>
    calculate(
      sh((i) => {
        i.generation.llmModelId = "minimax-m3-oss";
        useGpu(i, "p6-b200.48xlarge");
        i.generation.weightBits = 8;
        i.corpus.avgTokensPerDoc = 2000;
        i.retrieval.topK = 8;
        i.retrieval.topN = 4;
        i.chunking.chunkSize = 2048; // input ≈ 8.5K → 8192 bucket
        i.generation.outTokens = 1024; // matches the 8192/1024 OSL bucket
        i.traffic.queriesPerMonth = 500_000_000;
        over(i);
      }),
      priceBook
    ).crossover;

  it("exact 64-GPU topology STAYS measured when model/precision/sequence match", () => {
    const c = minimax();
    expect(c.capacity.gpusInConfig).toBe(64);
    expect(c.capacity.instancesPerReplica).toBe(8); // ceil(64/8) = one 8-box serving group
    expect(c.capacity.seqUsed).toBe("8192/1024");
    expect(c.capacity.source).toBe("measured"); // whole-box multiple + matching precision/seq
    expect(c.capacity.extrapolationReasons).toHaveLength(0);
    // The multi-replica linear-scaling assumption is surfaced as a NOTE, not a downgrade.
    expect(c.capacity.note ?? "").toMatch(/linear scaling/i);
  });

  it("a sequence mismatch downgrades the SAME 64-GPU config to extrapolated, with a reason", () => {
    const c = minimax((i) => {
      i.retrieval.topN = 4;
      i.chunking.chunkSize = 700; // input ≈ 2.9K → between buckets, >2× the 1024 bucket
    });
    expect(c.capacity.gpusInConfig).toBe(64);
    expect(c.capacity.source).toBe("extrapolated");
    expect(c.capacity.extrapolationReasons.join(" ")).toMatch(/not close/i);
  });

  it("fleet size respects replica granularity (whole serving groups)", () => {
    const c = minimax();
    expect(c.requiredInstances % c.instancesPerReplica).toBe(0);
    expect(c.boxes % c.instancesPerReplica).toBe(0);
  });

  it("a precision/length substitution downgrades 'measured' to 'extrapolated'", () => {
    // DeepSeek default input (2910) is far from the 1024 bucket → extrapolated.
    const c = calculate(deepseek(), priceBook).crossover;
    expect(c.capacity.source).toBe("extrapolated");
    expect(c.capacity.extrapolationReasons.length).toBeGreaterThan(0);
  });
});

describe("GPU-006 — HA adds physical capacity, not just a percentage", () => {
  it("N+1 HA raises the billed fleet and cost vs HA off (1-box replica)", () => {
    const on = calculate(deepseek((i) => (i.generation.haEnabled = true)), priceBook).crossover;
    const off = calculate(deepseek((i) => (i.generation.haEnabled = false)), priceBook).crossover;
    expect(on.replicas).toBe(off.replicas + 1);
    expect(on.requiredInstances).toBeGreaterThan(off.requiredInstances);
    expect(on.selfHostedMonthly$).toBeGreaterThan(off.selfHostedMonthly$);
  });

  it("N+1 adds exactly ONE complete serving group — 8 boxes for an 8-box replica", () => {
    const cfg = (ha: boolean) => (i: CalcInputs) => {
      i.generation.llmModelId = "minimax-m3-oss";
      useGpu(i, "p6-b200.48xlarge");
      i.generation.weightBits = 8;
      i.generation.haEnabled = ha;
      i.corpus.avgTokensPerDoc = 2000;
      i.retrieval.topN = 4;
      i.chunking.chunkSize = 2048;
      i.traffic.queriesPerMonth = 2_000_000_000;
    };
    const on = calculate(sh(cfg(true)), priceBook).crossover;
    const off = calculate(sh(cfg(false)), priceBook).crossover;
    expect(on.instancesPerReplica).toBe(8); // 64-GPU replica = 8 boxes
    expect(on.replicas).toBe(off.replicas + 1); // exactly one extra replica
    expect(on.haReplicasAdded).toBe(1);
    // …which is one COMPLETE serving group = 8 boxes, not a fractional/percentage add.
    expect(on.requiredInstances - off.requiredInstances).toBe(on.instancesPerReplica);
    expect(on.requiredInstances - off.requiredInstances).toBe(8);
  });
});

describe("provenance gate — non-measured capacity never gives an UNCONDITIONAL positive", () => {
  it("a proxy-capacity positive verdict is flagged qualified", () => {
    const c = calculate(
      sh((i) => {
        i.generation.llmModelId = "glm-5.2-oss"; // benchmarkProvenance: proxy
        useGpu(i, "p6-b200.48xlarge");
        i.generation.weightBits = 4;
        i.traffic.queriesPerMonth = 200_000_000; // high enough that self-host is efficient
      }),
      priceBook
    ).crossover;
    expect(c.capacity.source).toBe("proxy");
    expect(c.verdict).toBe("self-host efficient");
    expect(c.verdictQualified).toBe(true); // positive, but qualified
  });

  it("a heuristic (no benchmark) positive verdict is flagged qualified", () => {
    // Nemotron has no InferenceX key → heuristic capacity.
    const c = calculate(
      sh((i) => {
        i.generation.llmModelId = "nemotron-3-ultra-oss";
        useGpu(i, "p5.48xlarge");
        i.traffic.queriesPerMonth = 5_000_000;
      }),
      priceBook
    ).crossover;
    expect(c.capacity.source).toBe("heuristic");
    if (c.verdict === "self-host efficient") expect(c.verdictQualified).toBe(true);
  });

  it("ONLY a measured-capacity positive verdict is unqualified", () => {
    const c = calculate(
      sh((i) => {
        i.generation.llmModelId = "deepseek-v4-pro-oss";
        useGpu(i, "p6-b200.48xlarge");
        i.generation.weightBits = 4;
        i.corpus.avgTokensPerDoc = 2000;
        i.retrieval.topN = 4;
        i.chunking.chunkSize = 2048; // input ≈ 8192 bucket
        i.generation.outTokens = 1024; // matches OSL bucket → measured
        i.traffic.queriesPerMonth = 10_000_000; // light → efficient + feasible
      }),
      priceBook
    ).crossover;
    expect(c.capacity.source).toBe("measured");
    if (c.verdict === "self-host efficient") expect(c.verdictQualified).toBe(false);
  });
});

describe("GPU-007 — $0 owned capacity with real traffic stays a complete scenario", () => {
  it("owned capacity: non-zero traffic is NOT 'no volume'; hardware $0; no like-for-like %", () => {
    const i = sh((x) => {
      x.generation.llmModelId = "deepseek-v4-pro-oss";
      useGpu(x, "p6-b200.48xlarge");
      x.generation.gpuPricePerHr = 0;
      x.traffic.queriesPerMonth = 1_000_000;
    });
    const r = calculate(i, priceBook);
    expect(r.crossover.ownedCapacity).toBe(true);
    const gpu = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    expect(gpu.monthly).not.toBeNull(); // complete — infra + ops shown
    expect(gpu.complete).toBe(true);
    expect(gpu.diffPct).toBeNull(); // not a like-for-like saving
    expect(gpu.difference).toMatch(/owned capacity/i);
    expect(gpu.note).not.toMatch(/no generation volume/i);
  });
});

describe("GPU consistency — one capacity source across UI/scenarios/exports/verdict", () => {
  it("report + JSON + scenarios all reflect the same capacity source, verdict and billed fleet", () => {
    const i = deepseek();
    const r = calculate(i, priceBook);
    const md = buildReport(i, r, priceBook, "2026-01-01");
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(md).toMatch(new RegExp(`Capacity source:\\*\\* ${r.crossover.capacity.source}`));
    expect(json.fleet.capacity.source).toBe(r.crossover.capacity.source);
    expect(json.fleet.billedInstances).toBe(r.crossover.boxes);
    expect(json.fleet.replicas).toBe(r.crossover.replicas);
    const gpu = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    expect(gpu.note).toContain(`${r.crossover.boxes} ×`);
  });
});
