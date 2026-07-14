// Regression coverage for the rc-qa-1 QA findings (#25, #27, #28).
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { inputsToCsv, assumptionsToJson, buildReport } from "./share";
import { GPU_COMMITMENT_DISCOUNT, effectiveGpuHourly } from "./self-host";
import { effectiveRequiredInstances } from "./grounding";
import { coerceInputs } from "./share";
import { buildScenarios } from "./scenarios";
import type { CalcInputs, GroundingResult, PriceBook } from "./types";
import pricesJson from "../public/prices.json";
import legacyFixture from "../docs/fixtures/legacy-saved-scenario.json";

const priceBook = pricesJson as unknown as PriceBook;

function selfHosted(over: (i: CalcInputs) => void): CalcInputs {
  const i = defaultInputs(priceBook);
  i.generation.mode = "self-hosted";
  i.generation.llmModelId = "deepseek-v4-pro-oss";
  i.generation.gpuInstanceType = "p6-b200.48xlarge";
  i.generation.weightBits = 4;
  over(i);
  return i;
}

describe("#27 — GPU commitment models have distinct discounts", () => {
  it("Standard RI 1-yr and Compute Savings Plan 1-yr are NOT identical", () => {
    expect(GPU_COMMITMENT_DISCOUNT["savings-1yr"]).not.toBe(GPU_COMMITMENT_DISCOUNT["reserved-1yr"]);
  });

  it("discounts are strictly ordered on-demand < savings-1yr < reserved-1yr < reserved-3yr < spot", () => {
    const d = GPU_COMMITMENT_DISCOUNT;
    expect(d["on-demand"]).toBeLessThan(d["savings-1yr"]);
    expect(d["savings-1yr"]).toBeLessThan(d["reserved-1yr"]);
    expect(d["reserved-1yr"]).toBeLessThan(d["reserved-3yr"]);
    expect(d["reserved-3yr"]).toBeLessThan(d["spot"]);
  });

  it("effective $/hr differs between savings-1yr and reserved-1yr", () => {
    expect(effectiveGpuHourly(100, "savings-1yr")).not.toBeCloseTo(
      effectiveGpuHourly(100, "reserved-1yr"),
      6
    );
  });
});

describe("#28 — CSV cost breakdown rows are in canonical (spec) order", () => {
  it("matches docs/EXPORT_SPEC.md ordering regardless of cost magnitude", () => {
    const result = calculate(defaultInputs(priceBook), priceBook);
    const csv = inputsToCsv(result, defaultInputs(priceBook));
    const lines = csv.split("\n");
    const headerIdx = lines.findIndex((l) => l.startsWith("Component,"));
    expect(headerIdx).toBeGreaterThan(-1);
    const componentLabels = lines
      .slice(headerIdx + 1)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.split(",")[0].replace(/^"|"$/g, ""));
    // Canonical order (generation label varies by mode, so match by prefix).
    expect(componentLabels[0]).toMatch(/^Ingestion/);
    expect(componentLabels[1]).toMatch(/^Vector store/);
    expect(componentLabels[2]).toBe("Reranking");
    expect(componentLabels[3]).toMatch(/^(Generation|GPU infrastructure)/);
    expect(componentLabels[4]).toBe("Guardrails");
    expect(componentLabels[5]).toMatch(/^Query overhead/);
    expect(componentLabels[6]).toMatch(/^Operations/);
  });
});

describe("#25 — required-instance figure is reconciled to grounding when available", () => {
  const flat = 6;
  it("uses the grounded minInstances (not the flat estimate) when available", () => {
    const grounded = { available: true, minInstances: 15 } as unknown as GroundingResult;
    expect(effectiveRequiredInstances(grounded, flat)).toBe(15);
  });

  it("falls back to the flat throughput estimate when grounding is unavailable", () => {
    const ungrounded = { available: false } as unknown as GroundingResult;
    expect(effectiveRequiredInstances(ungrounded, flat)).toBe(flat);
  });

  it("never yields a value below the grounded requirement (no ≥15-vs-≥6 conflict)", () => {
    const grounded = { available: true, minInstances: 15 } as unknown as GroundingResult;
    expect(effectiveRequiredInstances(grounded, flat)).toBeGreaterThanOrEqual(15);
  });
});

describe("rc-qa-2 round 2 — end-user AWS decision findings", () => {
  it("P1-a: under-provisioned GPU comparison auto-sizes (no cheap-but-inadequate savings)", () => {
    const i = selfHosted((x) => {
      x.traffic.queriesPerMonth = 100_000_000;
      x.generation.numInstances = 2;
    });
    const r = calculate(i, priceBook);
    // Billed fleet auto-sizes above the entered 2, so cost reflects a fleet that
    // can actually serve the load — not the misleading 2-box figure.
    expect(r.crossover.autoSized).toBe(true);
    expect(r.crossover.boxes).toBeGreaterThan(2);
    const gpuScenario = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    const oneBoxIllusion =
      r.ingestion.embedIngestMonthly$ + r.vectorStore.opensearchMonthly$ + 2 * r.crossover.gpuMonthly$;
    expect(gpuScenario.monthly!).toBeGreaterThan(oneBoxIllusion);
    expect(gpuScenario.note).toMatch(/auto-sized/i);
  });

  it("P1-b: grounded throughput scales with uptime and peak; effRequired is the max", () => {
    const full = calculate(selfHosted((x) => { x.traffic.queriesPerMonth = 200_000_000; }), priceBook).grounding;
    const halfUptime = calculate(selfHosted((x) => { x.traffic.queriesPerMonth = 200_000_000; x.generation.gpuUptimeHoursPerMonth = 365; }), priceBook).grounding;
    const peaky = calculate(selfHosted((x) => { x.traffic.queriesPerMonth = 200_000_000; x.traffic.peakFactor = 2; }), priceBook).grounding;
    expect(halfUptime.minInstancesThroughput!).toBeGreaterThan(full.minInstancesThroughput!);
    expect(peaky.minInstancesThroughput!).toBeGreaterThan(full.minInstancesThroughput!);
    // effectiveRequiredInstances returns the LARGER of grounded and flat.
    const grounded = { available: true, minInstances: 4 } as unknown as GroundingResult;
    expect(effectiveRequiredInstances(grounded, 9)).toBe(9); // flat larger → flat
    expect(effectiveRequiredInstances(grounded, 2)).toBe(4); // grounded larger → grounded
  });

  it("P1-c: Bedrock GPT-5.5 / GPT-5.4 rates match AWS us-east-1", () => {
    const m = (id: string) => priceBook.models.find((x) => x.id === id)!;
    expect(m("gpt-5.5-bedrock").inPricePer1K).toBeCloseTo(0.0055, 6);
    expect(m("gpt-5.5-bedrock").outPricePer1K).toBeCloseTo(0.033, 6);
    expect(m("gpt-5.4-bedrock").inPricePer1K).toBeCloseTo(0.00275, 6);
    expect(m("gpt-5.4-bedrock").outPricePer1K).toBeCloseTo(0.0165, 6);
  });

  it("P1-d: ops/overhead is in every scenario — the selected one reconciles with the headline", () => {
    const i = selfHosted((x) => {
      x.traffic.queriesPerMonth = 5_000_000;
      x.ops.networkingMonthly$ = 500;
      x.ops.observabilityMonthly$ = 300;
      x.ops.overheadPct = 20;
    });
    const r = calculate(i, priceBook);
    const selected = buildScenarios(r, i).find((s) => s.highlight)!;
    expect(selected.id).toBe("self-built-gpu");
    expect(selected.monthly!).toBeCloseTo(r.totalMonthly$, 4); // headline == its scenario
  });

  it("P2-a/b: uptime clamps to 730 and instances floor to an integer at the calc boundary", () => {
    const r = calculate(
      selfHosted((x) => {
        x.generation.gpuUptimeHoursPerMonth = 2000; // impossible
        x.generation.numInstances = 2.5; // non-integer
        x.traffic.queriesPerMonth = 1_000_000;
      }),
      priceBook
    );
    // 2.5 floored to 2 (unless auto-sized higher); never a fractional box.
    expect(Number.isInteger(r.crossover.boxes)).toBe(true);
    expect(r.crossover.userInstances).toBe(2);
    // Uptime clamp: gpuMonthly = effectiveHourly × min(730, uptime). At on-demand,
    // that's the full-month cost, not the 2000-hour inflated cost.
    const perBox = r.crossover.gpuMonthly$;
    const onDemand = priceBook.gpus.find((g) => g.instanceType === "p6-b200.48xlarge")!.pricePerHr;
    expect(perBox).toBeLessThanOrEqual(onDemand * 730 + 1);
  });

  it("P2-a/b: coerceInputs clamps a crafted link (uptime 5000, instances 3.9)", () => {
    const base = defaultInputs(priceBook) as unknown as Record<string, any>;
    base.generation.gpuUptimeHoursPerMonth = 5000;
    base.generation.numInstances = 3.9;
    const coerced = coerceInputs(base)!;
    expect(coerced.generation.gpuUptimeHoursPerMonth).toBe(730);
    expect(coerced.generation.numInstances).toBe(3);
  });

  it("P2-d: a $0 GPU rate is flagged as owned capacity (not a real saving)", () => {
    const r = calculate(
      selfHosted((x) => {
        x.generation.gpuPricePerHr = 0;
        x.traffic.queriesPerMonth = 1_000_000;
      }),
      priceBook
    );
    expect(r.crossover.ownedCapacity).toBe(true);
  });
});

describe("rc-qa-3 refinements — entered vs billed fleet, manual cap, M in exports", () => {
  const heavy = (over: (i: CalcInputs) => void = () => {}) =>
    selfHosted((i) => {
      i.traffic.queriesPerMonth = 100_000_000;
      i.generation.numInstances = 2;
      over(i);
    });

  it("auto-size ON: entered count is preserved; billed count exceeds it", () => {
    const r = calculate(heavy(), priceBook);
    expect(r.crossover.userInstances).toBe(2); // never silently changed
    expect(r.crossover.boxes).toBeGreaterThan(2);
    expect(r.crossover.autoSized).toBe(true);
    expect(r.crossover.feasible).toBe(true);
  });

  it("manual cap OFF + insufficient: infeasible, savings suppressed", () => {
    const i = heavy((x) => { x.generation.autoSizeFleet = false; });
    const r = calculate(i, priceBook);
    expect(r.crossover.boxes).toBe(2); // billed exactly what was entered
    expect(r.crossover.feasible).toBe(false);
    const gpu = buildScenarios(r, i).find((s) => s.id === "self-built-gpu")!;
    expect(gpu.monthly).toBeNull(); // suppressed
    expect(gpu.diffPct).toBeNull(); // no savings claim
    expect(gpu.difference).toMatch(/infeasible/i);
  });

  it("manual cap OFF + sufficient: feasible, billed exactly the entered count", () => {
    const i = heavy((x) => { x.generation.autoSizeFleet = false; });
    // First find how many are actually required, then provision exactly that.
    const need = calculate(i, priceBook).crossover.requiredInstances;
    i.generation.numInstances = need;
    const r = calculate(i, priceBook);
    expect(r.crossover.feasible).toBe(true);
    expect(r.crossover.boxes).toBe(need);
    expect(r.crossover.autoSized).toBe(false); // entered == billed → no notice
  });

  it("exports carry the billed fleet M (JSON fleet block + MD auto-size line)", () => {
    const i = heavy();
    const r = calculate(i, priceBook);
    const json = JSON.parse(assumptionsToJson(i, priceBook, "2026-01-01", r));
    expect(json.fleet.enteredInstances).toBe(2);
    expect(json.fleet.billedInstances).toBe(r.crossover.boxes);
    expect(json.fleet.autoSized).toBe(true);
    const md = buildReport(i, r, priceBook, "2026-01-01");
    expect(md).toMatch(new RegExp(`auto-sized from 2 to ${r.crossover.boxes}`, "i"));
  });
});

describe("L4 — legacy saved scenario coerces + backfills newer fields", () => {
  it("the committed fixture loads without crash and defaults the missing fields", () => {
    const stored = legacyFixture as Array<{ inputs: unknown }>;
    const coerced = coerceInputs(stored[0].inputs);
    expect(coerced).not.toBeNull();
    // Newer fields absent from the legacy blob are backfilled by the schema.
    expect(coerced!.managedKb).toBeDefined();
    expect(coerced!.ops).toBeDefined();
    expect(coerced!.generation.interactivityTarget).toBeGreaterThan(0);
  });
});
