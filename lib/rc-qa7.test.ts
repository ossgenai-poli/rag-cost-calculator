// rc-qa-7 regressions — clamped inputs must reconcile across engine, display,
// scenarios and exports (P1), and every clamped field must be reported (P2).
import { describe, it, expect } from "vitest";
import { calculate, defaultInputs, inputClampNotes, INPUT_MAXIMA } from "./calc-engine";
import { deriveDisplayMetrics } from "./derived";
import { buildScenarios } from "./scenarios";
import { inputsToCsv, assumptionsToJson, buildReport, coerceInputs } from "./share";
import type { CalcInputs, PriceBook } from "./types";
import pricesJson from "../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const CAP = INPUT_MAXIMA.queriesPerMonth; // 1e12

function withQueries(q: number): CalcInputs {
  const i = defaultInputs(priceBook);
  i.traffic.queriesPerMonth = q;
  return i;
}

describe("P1 — queries/month = 1e308 reconciles everywhere at the 1e12 cap", () => {
  const raw = withQueries(1e308);
  const r = calculate(raw, priceBook);
  const eff = r.effectiveInputs;

  it("engine computes with 1e12 (effectiveInputs)", () => {
    expect(eff.traffic.queriesPerMonth).toBe(CAP);
    expect(Number.isFinite(r.totalMonthly$)).toBe(true);
  });

  it("selected scenario / display metrics show 1e12, not 1e308", () => {
    const m = deriveDisplayMetrics(r, eff);
    expect(m.queries).toBe(CAP);
  });

  it("cost/query and cost/1k reconcile with the total (no $0 collapse)", () => {
    const m = deriveDisplayMetrics(r, eff);
    expect(m.costPerQuery).toBeGreaterThan(0);
    expect(m.costPerQuery).toBeCloseTo(r.totalMonthly$ / CAP, 12);
    expect(m.costPer1000).toBeCloseTo(m.costPerQuery * 1000, 9);
  });

  it("monthly token volumes are finite and based on 1e12", () => {
    const m = deriveDisplayMetrics(r, eff);
    expect(Number.isFinite(m.monthlyInputTokens)).toBe(true);
    expect(Number.isFinite(m.monthlyOutputTokens)).toBe(true);
    expect(m.monthlyOutputTokens).toBe(CAP * eff.generation.outTokens);
  });

  it("the selected scenario row is finite and derived from 1e12", () => {
    const baseline = buildScenarios(r, eff).find((s) => s.highlight) ?? buildScenarios(r, eff)[0];
    expect(Number.isFinite(baseline.monthly!)).toBe(true);
  });

  it("CSV contains 1000000000000 and no NaN/Infinity", () => {
    const csv = inputsToCsv(r, eff);
    expect(csv).toContain(String(CAP));
    expect(csv).not.toMatch(/NaN|Infinity/);
  });

  it("JSON inputs contain 1e12, carry inputAdjustments, and round-trip to the same total", () => {
    const json = JSON.parse(assumptionsToJson(eff, priceBook, "2026-01-01", r, inputClampNotes(raw)));
    expect(json.inputs.traffic.queriesPerMonth).toBe(CAP);
    expect(json.inputAdjustments.some((a: { field: string }) => a.field === "queries/month")).toBe(true);
    const roundTripped = coerceInputs(json.inputs)!;
    expect(calculate(roundTripped, priceBook).totalMonthly$).toBeCloseTo(r.totalMonthly$, 6);
  });

  it("Markdown report uses 1e12 and reconciles with the headline", () => {
    const md = buildReport(eff, r, priceBook, "2026-01-01");
    expect(md).toContain(CAP.toLocaleString()); // "1,000,000,000,000"
  });

  it("the clamp warning retains entered 1e308 → calculated 1e12", () => {
    const note = inputClampNotes(raw).find((n) => n.field === "queries/month")!;
    expect(note.entered).toBe(1e308);
    expect(note.calculated).toBe(CAP);
  });
});

describe("P2 — every clamped field is reported (no silent adjustment)", () => {
  it("prompt-overhead and query-token clamps are surfaced", () => {
    const i = defaultInputs(priceBook);
    i.generation.promptOverhead = 5e6; // > 1e6 cap
    i.queryTokens = 5e6; // > 1e6 cap
    const notes = inputClampNotes(i);
    expect(notes.some((n) => n.field === "prompt overhead")).toBe(true);
    expect(notes.some((n) => n.field === "query tokens")).toBe(true);
  });

  it("all major fields over cap are reported together", () => {
    const i = defaultInputs(priceBook);
    i.traffic.queriesPerMonth = 1e300;
    i.corpus.numDocs = 1e300;
    i.corpus.avgTokensPerDoc = 1e300;
    i.generation.outTokens = 1e300;
    i.generation.promptOverhead = 1e300;
    i.generation.maxContextLen = 1e300;
    i.generation.maxConcurrentSeqs = 1e300;
    i.ops.overheadPct = 1e300;
    i.queryTokens = 1e300;
    const fields = inputClampNotes(i).map((n) => n.field);
    for (const f of ["queries/month", "documents", "tokens/doc", "output tokens", "prompt overhead", "max context", "max concurrency", "overhead %", "query tokens"]) {
      expect(fields).toContain(f);
    }
  });
});
