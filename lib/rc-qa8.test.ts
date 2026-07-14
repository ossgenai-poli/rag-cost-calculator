// rc-qa-8 regressions — sensitivity must not report a FALSE 0% for a lever whose
// +10% bump would be clamped at its supported maximum (P2-1).
import { describe, it, expect } from "vitest";
import { defaultInputs, INPUT_MAXIMA } from "./calc-engine";
import { computeSensitivity } from "./sensitivity";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const rowFor = (rows: ReturnType<typeof computeSensitivity>, label: string) =>
  rows.find((r) => r.label === label)!;

describe("P2-1 — capped sensitivity levers are labeled 'at max', not a false 0%", () => {
  it("queries/month at its cap ⇒ atCap (not a misleading ~0%)", () => {
    const i: CalcInputs = defaultInputs(priceBook);
    i.traffic.queriesPerMonth = INPUT_MAXIMA.queriesPerMonth; // at cap
    const q = rowFor(computeSensitivity(i, priceBook), "Queries / month");
    expect(q.atCap).toBe(true);
    expect(q.deltaPct).toBe(0); // reported value is not treated as a real response
  });

  it("prompt overhead and user-query tokens at their caps ⇒ atCap", () => {
    const i: CalcInputs = defaultInputs(priceBook);
    i.generation.promptOverhead = INPUT_MAXIMA.promptOverhead;
    i.queryTokens = INPUT_MAXIMA.queryTokens;
    const rows = computeSensitivity(i, priceBook);
    expect(rowFor(rows, "System prompt tokens").atCap).toBe(true);
    expect(rowFor(rows, "User query length").atCap).toBe(true);
  });

  it("output length and document count at their caps ⇒ atCap", () => {
    const i: CalcInputs = defaultInputs(priceBook);
    i.generation.outTokens = INPUT_MAXIMA.outTokens;
    i.corpus.numDocs = INPUT_MAXIMA.numDocs;
    const rows = computeSensitivity(i, priceBook);
    expect(rowFor(rows, "Output length").atCap).toBe(true);
    expect(rowFor(rows, "Number of documents").atCap).toBe(true);
  });

  it("normal in-range inputs produce NO atCap rows and a real queries response", () => {
    const i: CalcInputs = defaultInputs(priceBook);
    i.traffic.queriesPerMonth = 1_000_000; // well below cap
    const rows = computeSensitivity(i, priceBook);
    expect(rows.some((r) => r.atCap)).toBe(false);
    // Queries is a linear driver — its measured response must be clearly non-zero.
    expect(Math.abs(rowFor(rows, "Queries / month").deltaPct)).toBeGreaterThan(0.01);
  });

  it("capped levers sort to the bottom but stay visible", () => {
    const i: CalcInputs = defaultInputs(priceBook);
    i.traffic.queriesPerMonth = INPUT_MAXIMA.queriesPerMonth;
    const rows = computeSensitivity(i, priceBook);
    const firstCapIdx = rows.findIndex((r) => r.atCap);
    const lastNonCapIdx = rows.map((r) => !!r.atCap).lastIndexOf(false);
    expect(firstCapIdx).toBeGreaterThan(lastNonCapIdx); // all atCap rows are after non-capped ones
    expect(rows.some((r) => r.label === "Queries / month")).toBe(true); // still present
  });
});
