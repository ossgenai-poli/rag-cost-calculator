// Regression coverage for the rc-qa-1 QA findings (#25, #27, #28).
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs } from "./calc-engine";
import { inputsToCsv } from "./share";
import { GPU_COMMITMENT_DISCOUNT, effectiveGpuHourly } from "./self-host";
import { effectiveRequiredInstances } from "./grounding";
import { coerceInputs } from "./share";
import type { GroundingResult, PriceBook } from "./types";
import pricesJson from "../public/prices.json";
import legacyFixture from "../docs/fixtures/legacy-saved-scenario.json";

const priceBook = pricesJson as unknown as PriceBook;

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
