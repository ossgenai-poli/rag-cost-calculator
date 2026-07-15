// Iteration-5 tests — unknown & range handling (doc 08): bands are REAL engine recomputes at the
// bounds (asserted equal to independent recommend() runs — never percentage guesses); two separate
// confidence channels; largest modeled range effect as a bounded controlled sensitivity recompute;
// decision stability across the combined envelope; range risk line + export band block. No mocks.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate } from "../../lib/recommendation";
import { computeRanges, rangeBoundsValid, RANGE_PRESETS, type RangeComputation } from "./ranges";
import { riskLines } from "./risks";
import { buildReport } from "./report";
import { DecisionSummary } from "./DecisionSummary";
import { RangeBandPanel } from "./RangeBandPanel";
import { AdvisorInputs, type AdvisorState } from "./AdvisorInputs";
import { buildWorkload, DEFAULT_STATE } from "../../app/advisor/page";
import type { PriceBook } from "../../lib/types";
import pricesJson from "../../public/prices.json";

const priceBook = pricesJson as unknown as PriceBook;
const B200 = "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16";
const rec = (s: AdvisorState) => recommend({ workload: buildWorkload(s), optimizeFor: s.optimizeFor });
const VOL = { low: 80_000_000, high: 480_000_000 };
const volState: AdvisorState = { ...DEFAULT_STATE, ranges: { volume: VOL } };
const compute = (s: AdvisorState): RangeComputation => computeRanges(s, s.ranges, rec(s), buildWorkload)!;

describe("range recompute — bands ARE real engine runs at the bounds (doc 08)", () => {
  it("volume range: band values equal INDEPENDENT engine runs at low/high (never extrapolated)", () => {
    const c = compute(volState);
    const lowR = rec({ ...DEFAULT_STATE, volume: VOL.low });
    const highR = rec({ ...DEFAULT_STATE, volume: VOL.high });
    const at = (r: ReturnType<typeof rec>) => r.evaluations.find((e) => e.config.id === B200)!;
    expect(c.band.fleet).toEqual({ low: at(lowR).fleet.boxes, base: 87, high: at(highR).fleet.boxes });
    expect(c.band.selfHost).toEqual({
      low: at(lowR).cost.selfHostMonthly!, base: at(rec(DEFAULT_STATE)).cost.selfHostMonthly!, high: at(highR).cost.selfHostMonthly!,
    });
    expect(c.band.api).toEqual({ low: lowR.apiOption.monthlyCost!, base: 6_492_000, high: highR.apiOption.monthlyCost! });
    // the band is real: low < base < high for a volume range
    expect(c.band.fleet!.low).toBeLessThan(87);
    expect(c.band.fleet!.high).toBeGreaterThan(87);
    // decision stability is DERIVED from the structured decisions at the bounds, not asserted a priori
    expect(c.band.decisionLow).toBe(lowR.decision.choice);
    expect(c.band.decisionHigh).toBe(highR.decision.choice);
    expect(c.band.stable).toBe(c.band.decisionLow === c.band.decisionBase && c.band.decisionHigh === c.band.decisionBase);
  });
  it("combined envelope = ONE controlled recompute with every range input at its bound", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, ranges: { volume: VOL, topN: { low: 3, high: 8 } } };
    const c = compute(s);
    const allLow = rec({ ...DEFAULT_STATE, volume: VOL.low, topN: 3 });
    const allHigh = rec({ ...DEFAULT_STATE, volume: VOL.high, topN: 8 });
    const at = (r: ReturnType<typeof rec>) => r.evaluations.find((e) => e.config.id === B200)!;
    expect(c.band.fleet!.low).toBe(at(allLow).fleet.boxes);
    expect(c.band.fleet!.high).toBe(at(allHigh).fleet.boxes);
  });
  it("largest modeled range effect: per-input CONTROLLED recompute picks the biggest fleet mover, serialized {input, bounds, effect}", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, ranges: { volume: VOL, topN: { low: 3, high: 8 } } };
    const c = compute(s);
    expect(c.largestEffect).not.toBeNull();
    const at = (r: ReturnType<typeof rec>) => r.evaluations.find((e) => e.config.id === B200)!;
    const volEffect = Math.abs(at(rec({ ...DEFAULT_STATE, volume: VOL.high })).fleet.boxes - at(rec({ ...DEFAULT_STATE, volume: VOL.low })).fleet.boxes);
    const topNEffect = Math.abs(at(rec({ ...DEFAULT_STATE, topN: 8 })).fleet.boxes - at(rec({ ...DEFAULT_STATE, topN: 3 })).fleet.boxes);
    const expectedField = volEffect >= topNEffect ? "volume" : "topN";
    expect(c.largestEffect!.field).toBe(expectedField);
    expect(Math.abs(c.largestEffect!.fleetHigh - c.largestEffect!.fleetLow)).toBe(Math.max(volEffect, topNEffect));
    expect(c.largestEffect!.bounds).toEqual(expectedField === "volume" ? VOL : { low: 3, high: 8 });
  });
  it("single range: no largest-effect line (it would be trivially that input); no ranges: null computation", () => {
    expect(compute(volState).largestEffect).toBeNull();
    expect(computeRanges(DEFAULT_STATE, {}, rec(DEFAULT_STATE), buildWorkload)).toBeNull();
  });
  it("deterministic: identical input → byte-identical computation", () => {
    expect(JSON.stringify(compute(volState))).toBe(JSON.stringify(compute(volState)));
  });
  it("API-only model: fleet/self-host bands fail closed to null; the API band still recomputes", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, modelId: "claude-opus-4-8", ranges: { volume: VOL } };
    const c = compute(s);
    expect(c.band.fleet).toBeNull();
    expect(c.band.selfHost).toBeNull();
    expect(c.band.api).not.toBeNull();
    expect(c.band.api!.low).toBeLessThan(c.band.api!.high);
  });
});

describe("range presets & validation (doc 08 values; never block)", () => {
  it("documented preset values: outTokens ~150/500/1,200; topN 3/4/8; volume pilot = the doc's example row", () => {
    expect(RANGE_PRESETS.outTokens[0]).toMatchObject({ low: 150, base: 500, high: 1200 });
    expect(RANGE_PRESETS.topN[0]).toMatchObject({ low: 3, base: 4, high: 8 });
    expect(RANGE_PRESETS.volume.find((p) => p.id === "pilot")).toMatchObject({ low: 200_000, base: 500_000, high: 1_200_000 });
    expect(RANGE_PRESETS.volume.map((p) => p.id)).toEqual(["pilot", "department", "org-wide"]);
  });
  it("bounds validate as a pair: low < high, at or above the field minimum, finite", () => {
    expect(rangeBoundsValid("volume", { low: 1, high: 2 })).toBe(true);
    expect(rangeBoundsValid("volume", { low: 0, high: 2 })).toBe(false); // below min 1
    expect(rangeBoundsValid("volume", { low: 5, high: 5 })).toBe(false); // low must be < high
    expect(rangeBoundsValid("volume", { low: Number.NaN, high: 2 })).toBe(false);
    expect(rangeBoundsValid("topN", { low: 0, high: 8 })).toBe(true); // topN min is 0
  });
  it("the affordance renders: toggle when no range; low/high inputs + presets + clear when active", () => {
    const closed = renderToStaticMarkup(
      <AdvisorInputs state={DEFAULT_STATE} defaults={DEFAULT_STATE} models={priceBook.models} selfHostAvailable={true} fieldErrors={{}} onChange={() => {}} />
    );
    expect(closed).toContain('data-testid="range-toggle-volume"');
    expect(closed).toContain("I’m not sure — use a range");
    const open = renderToStaticMarkup(
      <AdvisorInputs state={volState} defaults={DEFAULT_STATE} models={priceBook.models} selfHostAvailable={true} fieldErrors={{}} onChange={() => {}} />
    );
    expect(open).toContain('data-testid="range-control-volume"');
    expect(open).toContain('data-testid="range-low-volume"');
    expect(open).toContain('data-testid="range-preset-volume-pilot"');
    expect(open).toContain('data-testid="range-clear-volume"');
    expect(open).toContain("drives the headline");
  });
});

describe("range presentation — base + band, two confidence channels, about-qualifier", () => {
  const narrated = () => narrate(rec(volState));
  it("RangeBandPanel: real band values, separate confidence channels, stability wording from structured decisions", () => {
    const c = compute(volState);
    const html = renderToStaticMarkup(<RangeBandPanel result={narrated()} computation={c} />);
    expect(html).toContain("Range view — about, not exact");
    expect(html).toContain("Evidence confidence:</span> measured-scaled");
    expect(html).toContain("Input confidence:</span> 1 of 3 range-capable inputs are ranges");
    expect(html).toContain(`(base 87)`);
    expect(html).toContain("real recomputes, never percentage estimates");
    expect(html).toContain(
      c.band.stable
        ? `The modeled decision (${c.band.decisionBase}) is unchanged at both ends`
        : "The modeled decision CHANGES within your range"
    );
  });
  it("DecisionSummary carries the about-chip ONLY when ranges are active (heading name stays clean)", () => {
    const withChip = renderToStaticMarkup(<DecisionSummary result={narrated()} rangesActive={true} />);
    expect(withChip).toContain('data-testid="range-chip"');
    expect(withChip).toContain("≈ about — inputs include ranges; base case shown");
    expect(withChip).toMatch(/<h2[^>]*id="decision-heading"[^>]*>Lowest modeled cost: API<\/h2>/);
    const without = renderToStaticMarkup(<DecisionSummary result={narrated()} />);
    expect(without).not.toContain('data-testid="range-chip"');
  });
  it("risks gain the input-ranges line only while ranges are active", () => {
    const n = narrated();
    const withLine = riskLines(n, { rangeLabels: ["Questions per month"] });
    expect(withLine.map((l) => l.key)).toContain("input-ranges");
    expect(withLine.find((l) => l.key === "input-ranges")!.text).toContain("Customer ranges, not firm values: Questions per month.");
    expect(riskLines(n).map((l) => l.key)).not.toContain("input-ranges");
  });
  it("export: about-qualifier in §1, the band block in §3 (same values), the §6 line; deterministic; absent without ranges", () => {
    const c = compute(volState);
    const n = narrated();
    const md = buildReport(n, { ranges: c });
    expect(md).toContain("About, not exact — inputs include customer ranges (Questions per month)");
    expect(md).toContain("Range view — combined envelope");
    expect(md).toContain(`- Fleet: ${new Intl.NumberFormat("en-US").format(c.band.fleet!.low)}–${new Intl.NumberFormat("en-US").format(c.band.fleet!.high)} boxes (base 87)`);
    expect(md).toContain("- Input confidence: 1 of 3 range-capable inputs are ranges.");
    expect(md).toContain("Customer ranges, not firm values: Questions per month.");
    expect(md).toBe(buildReport(n, { ranges: c })); // byte-identical
    const plain = buildReport(n);
    expect(plain).not.toContain("Range view — combined envelope");
    expect(plain).not.toContain("About, not exact");
  });
});
