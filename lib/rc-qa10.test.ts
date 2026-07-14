// rc-qa-10 — display-honesty regressions (INF-005…INF-010).
// The engine was right in rc-qa-9; the EXPLANATION was wrong. These tests pin the
// shared fleet-explain helper (which the UI renders verbatim) to the authoritative
// CrossoverResult so the displayed arithmetic can never contradict the fleet again.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculate, defaultInputs } from "./calc-engine";
import { applyGpuSelection } from "./ui-logic";
import { explainFleetSizing, prefillWording, heuristicPrefillRange } from "./fleet-explain";
import { assumptionsToJson, buildReport } from "./share";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const useGpu = (i: CalcInputs, t: string) => {
  const g = priceBook.gpus.find((x) => x.instanceType === t)!;
  i.generation = applyGpuSelection(i.generation, g);
};
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// QA's canonical prefill-bound reproduction (DeepSeek, p6, INT4, 200M q/mo, 2,910/500).
function prefillBound(): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  useGpu(i, "p6-b200.48xlarge");
  i.generation.weightBits = 4;
  i.generation.outTokens = 500;
  i.traffic.queriesPerMonth = 200_000_000;
  i.traffic.peakFactor = 1;
  return i;
}
// QA's exact-measured reproduction: llmInputTok = 1,024 (50 + 150 + 4×206), OSL 1,024.
function exactMeasured(): CalcInputs {
  const i = prefillBound();
  i.generation.outTokens = 1024;
  i.queryTokens = 50;
  i.generation.promptOverhead = 150;
  i.retrieval.topN = 4;
  i.chunking.chunkSize = 206;
  return i;
}
// No-benchmark heuristic path (Nemotron has no InferenceX key).
function heuristic(): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "nemotron-3-ultra-oss";
  useGpu(i, "p5.48xlarge");
  i.traffic.queriesPerMonth = 5_000_000;
  return i;
}

describe("INF-005 — the displayed fleet equation reconciles with the engine", () => {
  it("prefill-bound: binding-dim demand ÷ (capacity × util target) reproduces the fleet exactly", () => {
    const c = calculate(prefillBound(), priceBook).crossover;
    const eq = explainFleetSizing(c);
    expect(eq.dimension).toBe("prefill");
    expect(eq.reconciles).toBe(true);
    // The equation's own terms recompute the engine's numbers.
    expect(Math.ceil(eq.peakDemandTokS / (eq.perReplicaTokS * eq.utilTarget))).toBe(eq.throughputReplicas);
    expect(eq.throughputReplicas * eq.instancesPerReplica).toBe(c.throughputInstances);
    expect(eq.requiredBoxes).toBe(c.requiredInstances);
    expect(eq.peakDemandTokS).toBe(c.peakPrefillDemand); // INPUT tok/s, not output
    expect(eq.utilTarget).toBeCloseTo(c.utilTargetUsed, 12);
  });

  it("the rc-qa-9 false arithmetic (output demand ÷ decode capacity, no target) does NOT give the fleet", () => {
    const c = calculate(prefillBound(), priceBook).crossover;
    const falseReplicas = Math.ceil(c.peakDecodeDemand / c.capacity.perReplicaDecodeTokS); // "38,052 ÷ 1,311 ≈ 29"
    const eq = explainFleetSizing(c);
    expect(falseReplicas).not.toBe(eq.throughputReplicas); // ~29 vs 86 — the defect QA caught
  });

  it("decode-bound heuristic and exact-measured cases also reconcile", () => {
    for (const inputs of [exactMeasured(), heuristic()]) {
      const c = calculate(inputs, priceBook).crossover;
      const eq = explainFleetSizing(c);
      expect(eq.reconciles).toBe(true);
      expect(eq.throughputReplicas * eq.instancesPerReplica).toBe(c.throughputInstances);
      expect(eq.requiredBoxes).toBe(c.requiredInstances);
    }
  });

  it("Markdown export carries the binding-dimension equation with the same numbers", () => {
    const i = prefillBound();
    const r = calculate(i, priceBook);
    const eq = explainFleetSizing(r.crossover);
    const md = buildReport(i, r, priceBook, "2026-01-01");
    expect(md).toContain("Fleet equation (prefill-bound):");
    expect(md).toContain(`${Math.round(eq.peakDemandTokS).toLocaleString()} input tok/s`);
    expect(md).toContain(`${eq.throughputReplicas} replica(s) for throughput`);
    expect(md).toContain(`${eq.requiredBoxes} boxes required`);
  });

  it("the UI renders the shared helper, not a hardcoded decode equation", () => {
    const panel = src("../components/ResultsPanel.tsx");
    expect(panel).toContain("explainFleetSizing"); // shared helper wired in
    expect(panel).toContain("fleetEq.peakDemandTokS");
    // The rc-qa-9 false pattern — decode demand ÷ decode capacity → combined count — is gone.
    expect(panel).not.toMatch(/peakDecodeDemand\)\.toLocaleString\(\)\} output tok\/s ÷/);
  });
});

describe("INF-006 — prefill wording matches its actual provenance", () => {
  it("exact measured ISL ⇒ 'measured' (never called estimated)", () => {
    const c = calculate(exactMeasured(), priceBook).crossover;
    expect(c.capacity.source).toBe("measured");
    expect(c.capacity.prefillEstimated).toBe(false);
    expect(c.capacity.prefillIslScale).toBeCloseTo(1, 6);
    expect(prefillWording(c)).toBe("measured");
  });

  it("measured at another ISL and scaled ⇒ 'measured-scaled', source stays extrapolated", () => {
    const c = calculate(prefillBound(), priceBook).crossover;
    expect(c.capacity.prefillEstimated).toBe(false);
    expect(c.capacity.prefillIslScale!).toBeGreaterThan(1.02); // 2,910 vs 1,024 bucket
    expect(prefillWording(c)).toBe("measured-scaled");
    expect(c.capacity.source).toBe("extrapolated");
  });

  it("no-benchmark heuristic ⇒ 'estimated'", () => {
    const c = calculate(heuristic(), priceBook).crossover;
    expect(c.capacity.prefillEstimated).toBe(true);
    expect(prefillWording(c)).toBe("estimated");
  });

  it("the UI no longer hardcodes 'estimated' whenever prefill binds", () => {
    const panel = src("../components/ResultsPanel.tsx");
    expect(panel).toContain('prefillProv === "measured"');
    expect(panel).toContain('prefillProv === "measured-scaled"');
    expect(panel).toContain('prefillProv === "estimated"');
  });
});

describe("INF-007 — heuristic prefill uncertainty range is surfaced", () => {
  it("helper resolves low/base/high capacity into a fleet band; base is the headline", () => {
    const c = calculate(heuristic(), priceBook).crossover;
    const hr = heuristicPrefillRange(c)!;
    expect(hr).toBeTruthy();
    expect(hr.perReplicaLowTokS).toBeLessThan(hr.perReplicaBaseTokS);
    expect(hr.perReplicaBaseTokS).toBeLessThan(hr.perReplicaHighTokS);
    expect(hr.fleetMinReplicas).toBeLessThanOrEqual(hr.fleetBaseReplicas);
    expect(hr.fleetBaseReplicas).toBeLessThanOrEqual(hr.fleetMaxReplicas);
    // The headline fleet really is sized from the base estimate.
    const eq = explainFleetSizing(c);
    expect(hr.fleetBaseReplicas).toBe(eq.throughputReplicas);
  });

  it("JSON export serializes the COMPLETE helper result incl. the fleet band; null on measured paths", () => {
    const iH = heuristic();
    const rH = calculate(iH, priceBook);
    const jH = JSON.parse(assumptionsToJson(iH, priceBook, "2026-01-01", rH));
    const pr = jH.fleet.capacity.prefillRange;
    const hr = heuristicPrefillRange(rH.crossover)!;
    expect(pr).toBeTruthy();
    expect(pr.perReplicaLowTokS).toBeGreaterThan(0);
    expect(pr.note).toMatch(/base estimate/i);
    // The QA gap: the resulting FLEET band must be serialized, not just capacity.
    expect(pr.ratioUsed).toBe(hr.ratioUsed);
    expect(pr.fleetMinReplicas).toBe(hr.fleetMinReplicas);
    expect(pr.fleetBaseReplicas).toBe(hr.fleetBaseReplicas);
    expect(pr.fleetMaxReplicas).toBe(hr.fleetMaxReplicas);
    // The headline fleet really is the base estimate → the engine's throughput replicas.
    expect(pr.fleetBaseReplicas).toBe(explainFleetSizing(rH.crossover).throughputReplicas);
    const iM = exactMeasured();
    const rM = calculate(iM, priceBook);
    const jM = JSON.parse(assumptionsToJson(iM, priceBook, "2026-01-01", rM));
    expect(jM.fleet.capacity.prefillRange).toBeNull();
  });

  it("range appears in the Markdown report", () => {
    const i = heuristic();
    const md = buildReport(i, calculate(i, priceBook), priceBook, "2026-01-01");
    expect(md).toContain("Heuristic prefill range:");
    expect(md).toMatch(/\(headline\)/);
  });

  it("a positive heuristic verdict stays qualified", () => {
    const c = calculate(heuristic(), priceBook).crossover;
    if (c.verdict === "self-host efficient") expect(c.verdictQualified).toBe(true);
  });
});

describe("INF-008 — the planning disclaimer appears on the heuristic card too", () => {
  it("ResultsPanel renders the disclaimer in BOTH grounded-card branches", () => {
    const panel = src("../components/ResultsPanel.tsx");
    const hits = panel.match(/Planning capacity, not an availability or tail-latency guarantee/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2); // measured card + heuristic fallback card
  });
});

describe("INF-009 — InferenceX is badged as an independent benchmark, not AWS published", () => {
  it("the Inference benchmarks section uses the benchmark badge and the legend defines it", () => {
    const toolbar = src("../components/Toolbar.tsx");
    expect(toolbar).toMatch(/Inference benchmarks \(GPU sizing\) <SourceBadge kind="benchmark" \/>/);
    expect(toolbar).toContain("independent benchmark");
    expect(toolbar).not.toMatch(/Inference benchmarks[^\n]*kind="published"/);
  });
});

describe("INF-010 — aggregated topology never reads as double the GPUs", () => {
  it("aggregated deployments say the SAME GPUs handle prefill and decode", () => {
    const c = calculate(exactMeasured(), priceBook).crossover;
    const topo = c.capacity.benchmarkProvenance!.topology;
    expect(topo).toContain("GPUs handle prefill and decode (aggregated)");
    expect(topo).not.toMatch(/prefill \w* ?\+/); // no "8 prefill + 8 decode" plus-sign form
  });

  it("every baked (aggregated) curve renders without the plus-sign double-count", () => {
    // All current baked series are disagg=false; none may produce "X prefill ... + Y decode".
    const models = ["deepseek-v4-pro-oss", "minimax-m3-oss"];
    for (const m of models) {
      const i = exactMeasured();
      i.generation.llmModelId = m;
      if (m === "minimax-m3-oss") i.generation.weightBits = 8;
      const c = calculate(i, priceBook).crossover;
      if (c.capacity.benchmarkProvenance) {
        expect(c.capacity.benchmarkProvenance.topology).not.toMatch(/prefill GPUs? \+/);
      }
    }
  });
});
