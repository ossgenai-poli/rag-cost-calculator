// Iteration-5 tests — unknown & range handling (doc 08): bands are REAL engine recomputes at the
// bounds (asserted equal to independent recommend() runs — never percentage guesses); two separate
// confidence channels; largest modeled range effect as a bounded controlled sensitivity recompute;
// decision stability across the combined envelope; range risk line + export band block. No mocks.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate } from "../../lib/recommendation";
import { computeRanges, rangeTripletValid, RANGE_FIELDS, RANGE_PRESETS, type RangeComputation } from "./ranges";
import { riskLines } from "./risks";
import { buildReport } from "./report";
import {
  OPERATIONAL_PRESETS, advisorStatesEqual, applyPresetWithProvenance, changedPresetFields,
  computePreview, initialProvenance, invalidateUndo, registerManualEdit,
} from "./presets";
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
    // scenario agreement is DERIVED from the structured decisions at the bounds, not asserted a priori
    expect(c.band.decisionLow).toBe(lowR.decision.choice);
    expect(c.band.decisionHigh).toBe(highR.decision.choice);
    expect(c.band.sampledPointsAgree).toBe(c.band.decisionLow === c.band.decisionBase && c.band.decisionHigh === c.band.decisionBase);
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
  it("the TRIPLET contract (P1-UI5-1): low ≤ base ≤ high, field minima, integers for counts, finite", () => {
    expect(rangeTripletValid("volume", 1, { low: 1, high: 2 })).toBe(true); // base equal to a boundary is valid
    expect(rangeTripletValid("volume", 2, { low: 1, high: 2 })).toBe(true);
    expect(rangeTripletValid("volume", 3, { low: 1, high: 2 })).toBe(false); // base above high
    expect(rangeTripletValid("volume", 0, { low: 1, high: 2 })).toBe(false); // base below low (also < min)
    expect(rangeTripletValid("volume", 1, { low: 0, high: 2 })).toBe(false); // low below min 1
    expect(rangeTripletValid("volume", 5, { low: 5, high: 5 })).toBe(false); // low must be < high
    expect(rangeTripletValid("volume", 1, { low: Number.NaN, high: 2 })).toBe(false);
    expect(rangeTripletValid("topN", 4, { low: 0, high: 8 })).toBe(true); // topN min is 0
    expect(rangeTripletValid("topN", 4, { low: 3.5, high: 8.2 })).toBe(false); // P2-UI5-1: counts are integers
    expect(rangeTripletValid("outTokens", 500.5, { low: 150, high: 1200 })).toBe(false); // fractional BASE too
    expect(rangeTripletValid("peakFactor", 2, { low: 1.2, high: 3 })).toBe(true); // ratio: fractional allowed
    expect(rangeTripletValid("peakFactor", 2, { low: 0.5, high: 3 })).toBe(false); // ratio min is 1
  });
  it("EXACT repro (P1-UI5-1): base 200,000,000 with range 500–1,000 is INVALID and never reaches compute", () => {
    const bad: AdvisorState = { ...DEFAULT_STATE, ranges: { volume: { low: 500, high: 1000 } } };
    expect(rangeTripletValid("volume", bad.volume, bad.ranges.volume!)).toBe(false);
    expect(() => computeRanges(bad, bad.ranges, rec(DEFAULT_STATE), buildWorkload)).toThrow(/invalid volume triplet/);
    // the control preserves the committed range but flags it (base edited after preset scenario)
    const html = renderToStaticMarkup(
      <AdvisorInputs state={bad} defaults={DEFAULT_STATE} models={priceBook.models} selfHostAvailable={true} fieldErrors={{}} onChange={() => {}} />
    );
    expect(html).toContain('data-testid="range-triplet-error-volume"');
    expect(html).toContain("is outside the committed range");
    expect(html).toContain("the band is paused until the range or the base is adjusted");
  });
  it("base edited AFTER a preset: the preset triplet is valid at apply, invalid after the base moves out", () => {
    const preset = RANGE_PRESETS.volume.find((p) => p.id === "pilot")!;
    expect(rangeTripletValid("volume", preset.base, { low: preset.low, high: preset.high })).toBe(true);
    expect(rangeTripletValid("volume", 5_000_000, { low: preset.low, high: preset.high })).toBe(false);
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
  it("RangeBandPanel: real band values, evidence vs RANGE COVERAGE channels, sampled-scenario wording", () => {
    const c = compute(volState);
    const html = renderToStaticMarkup(<RangeBandPanel result={narrated()} computation={c} />);
    expect(html).toContain("Range view — about, not exact");
    expect(html).toContain("Evidence confidence:</span> measured-scaled");
    // UI5-D3: the count is COVERAGE, never "input confidence"
    expect(html).toContain("Range coverage:</span> 1 of 4 supported uncertainty inputs uses a range");
    expect(html).not.toContain("Input confidence");
    expect(html).toContain(`(base 87)`);
    expect(html).toContain("real recomputes, never percentage estimates");
    // P1-UI5-2: scenario agreement only — never a stability claim
    expect(html).toContain(
      c.band.sampledPointsAgree
        ? `The decision is ${c.band.decisionBase} at the three evaluated scenarios: all-low, base and all-high.`
        : "The decision differs among the evaluated scenarios"
    );
    expect(html).toContain("Intermediate values and combinations were not exhaustively evaluated");
    expect(html).not.toContain("unchanged at both ends");
    expect(html).not.toMatch(/stable across/i);
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
    expect(md).toContain("- Range coverage: 1 of 4 supported uncertainty inputs uses a range.");
    expect(md).toContain("Customer ranges, not firm values: Questions per month.");
    expect(md).toContain("Intermediate values and combinations were not exhaustively evaluated");
    expect(md).not.toContain("unchanged at both ends");
    expect(md).toBe(buildReport(n, { ranges: c })); // byte-identical
    const plain = buildReport(n);
    expect(plain).not.toContain("Range view — combined envelope");
    expect(plain).not.toContain("About, not exact");
  });
});

describe("iteration-5 HOLD — P1-UI5-2: three scenarios are NEVER range stability", () => {
  it("EXACT repro: Top N 0/5/10 agree at api while Top N 7 flips to self-host — no stability claim anywhere", () => {
    // independent interior runs prove the engine is nonlinear inside the range
    expect(rec({ ...DEFAULT_STATE, topN: 7 }).decision.choice).toBe("self-host");
    expect(rec({ ...DEFAULT_STATE, topN: 8 }).decision.choice).toBe("self-host");
    const s: AdvisorState = { ...DEFAULT_STATE, topN: 5, ranges: { topN: { low: 0, high: 10 } } };
    const c = compute(s);
    expect(c.band.decisionLow).toBe("api");
    expect(c.band.decisionBase).toBe("api");
    expect(c.band.decisionHigh).toBe("api");
    expect(c.band.sampledPointsAgree).toBe(true);
    // every surface: scenario wording only, never "stable/unchanged across the range"
    const html = renderToStaticMarkup(<RangeBandPanel result={narrate(rec(s))} computation={c} />);
    const md = buildReport(narrate(rec(s)), { ranges: c });
    for (const text of [html, md]) {
      expect(text).toContain("The decision is api at the three evaluated scenarios: all-low, base and all-high.");
      expect(text).toContain("Intermediate values and combinations were not exhaustively evaluated");
      expect(text).not.toMatch(/stable|unchanged at both ends|across (the|your) range/i);
    }
  });
  it("disagreeing scenarios use the differs wording", () => {
    // topN base 7 = self-host while the 0/10 bounds are api — a real disagreement through the engine.
    const s: AdvisorState = { ...DEFAULT_STATE, topN: 7, ranges: { topN: { low: 0, high: 10 } } };
    const c = compute(s);
    expect(c.band.decisionBase).toBe("self-host");
    expect(c.band.sampledPointsAgree).toBe(false);
    const html = renderToStaticMarkup(<RangeBandPanel result={narrate(rec(s))} computation={c} />);
    expect(html).toContain("The decision differs among the evaluated scenarios (all-low: api · base: self-host · all-high: api)");
    expect(html).toContain("validate the real value before committing");
  });
});

describe("iteration-5 HOLD — P1-UI5-3: reconciled bounds + bound eligibility are disclosed", () => {
  it("Top N high 30 with Top K 20: the high scenario discloses entered 30 → calculated 20 on every surface", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, topN: 5, ranges: { topN: { low: 3, high: 30 } } };
    const c = compute(s);
    expect(c.boundAdjustments).toContainEqual({ scenario: "high", field: "retrieval.topN", entered: 30, calculated: 20 });
    const disclosure = "High scenario: Context chunks sent to the model entered as 30; calculated as 20 by engine reconciliation — the band reflects the calculated value.";
    const n = narrate(rec(s));
    expect(renderToStaticMarkup(<RangeBandPanel result={n} computation={c} />)).toContain(disclosure);
    const md = buildReport(n, { ranges: c });
    expect(md).toContain(disclosure);
    // carried into the risks block too
    expect(md.split("## 6. Risks & exclusions")[1]).toContain(disclosure);
  });
  it("a bound where the tracked candidate is INELIGIBLE (outTokens 20,000 → context overflow): no qualified band", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, ranges: { outTokens: { low: 150, high: 20000 } } };
    // prove the premise with an independent run
    const highEval = rec({ ...DEFAULT_STATE, outTokens: 20000 }).evaluations.find((e) => e.config.id === B200)!;
    expect(highEval.recommendationEligible).toBe(false);
    const c = compute(s);
    expect(c.trackedEligibility).toEqual({ low: true, high: false });
    expect(c.band.fleet).toBeNull();
    expect(c.band.selfHost).toBeNull();
    expect(c.band.api).not.toBeNull(); // the API side still recomputes honestly
    const html = renderToStaticMarkup(<RangeBandPanel result={narrate(rec(s))} computation={c} />);
    expect(html).toContain("not recommendation-eligible at the high bound");
    expect(html).toContain("diagnostic audit output, never a qualified comparison");
    expect(html).toContain("Self-host cost band unavailable");
  });
});

describe("iteration-5 HOLD — P1-UI5-4: ANY later committed edit makes Undo unsafe", () => {
  it("advisorStatesEqual: value equality incl. ranges; a no-op commit compares equal", () => {
    expect(advisorStatesEqual(DEFAULT_STATE, { ...DEFAULT_STATE })).toBe(true);
    expect(advisorStatesEqual(DEFAULT_STATE, { ...DEFAULT_STATE, ranges: {} })).toBe(true);
    expect(advisorStatesEqual(DEFAULT_STATE, { ...DEFAULT_STATE, ranges: { volume: { low: 1, high: 2 } } })).toBe(false);
    expect(advisorStatesEqual(volState, { ...volState, ranges: { volume: { ...VOL } } })).toBe(true);
    expect(advisorStatesEqual(volState, { ...volState, ranges: { volume: { low: VOL.low, high: 1 + VOL.high } } })).toBe(false);
    expect(advisorStatesEqual(DEFAULT_STATE, { ...DEFAULT_STATE, peakFactor: 2 })).toBe(false);
  });
  it("apply profile, then add a range: Undo snapshot dropped (family NOT marked Modified); no-op keeps Undo", () => {
    const costOptimized = OPERATIONAL_PRESETS.find((p) => p.id === "cost-optimized")!;
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, costOptimized, computePreview(state, prov.origins, costOptimized), {}));
    expect(prov.undo).not.toBeNull();
    // the page rule: registerManualEdit for preset fields + invalidateUndo for ANY real change
    const withRange = { ...state, ranges: { ...state.ranges, volume: { ...VOL } } };
    let p = registerManualEdit(prov, changedPresetFields(state, withRange));
    p = advisorStatesEqual(state, withRange) ? p : invalidateUndo(p);
    expect(p.undo).toBeNull(); // Undo can never discard the later range
    expect(p.active.B).toMatchObject({ id: "cost-optimized", modified: false }); // non-preset edit does not mark Modified
    // a no-op commit (blur without change) preserves Undo
    let q = registerManualEdit(prov, changedPresetFields(state, { ...state }));
    q = advisorStatesEqual(state, { ...state }) ? q : invalidateUndo(q);
    expect(q.undo).not.toBeNull();
    // clearing a range later is ALSO a real change
    const cleared = { ...withRange, ranges: {} };
    let r2 = registerManualEdit(p, changedPresetFields(withRange, cleared));
    r2 = advisorStatesEqual(withRange, cleared) ? r2 : invalidateUndo(r2);
    expect(r2.undo).toBeNull();
  });
});

describe("iteration-5 HOLD — UI5-D2: peak-to-average as the fourth uncertainty input", () => {
  it("peakFactor is a REAL engine input; default 1 preserves R1; the illustrative 1.2/2/3 preset exists", () => {
    expect(buildWorkload(DEFAULT_STATE).traffic.peakFactor).toBe(1);
    const r1 = rec(DEFAULT_STATE);
    expect(r1.evaluations.find((e) => e.config.id === B200)!.fleet.boxes).toBe(87); // R1 unchanged
    const spiky = rec({ ...DEFAULT_STATE, peakFactor: 2 });
    expect(spiky.evaluations.find((e) => e.config.id === B200)!.fleet.boxes).toBeGreaterThan(87); // peak sizes the fleet
    expect(RANGE_FIELDS).toEqual(["volume", "outTokens", "topN", "peakFactor"]);
    expect(RANGE_PRESETS.peakFactor[0]).toMatchObject({ low: 1.2, base: 2, high: 3 });
    expect(RANGE_PRESETS.peakFactor[0].label).toContain("illustrative");
    // volume tiers are labeled illustrative with visible numbers (UI5-D1)
    for (const p of RANGE_PRESETS.volume) expect(p.label).toContain("illustrative");
    expect(RANGE_PRESETS.volume[1].label).toBe("Department — illustrative (2M / 5M / 12M)");
  });
  it("a peakFactor range recomputes like any other uncertainty input", () => {
    const s: AdvisorState = { ...DEFAULT_STATE, peakFactor: 2, ranges: { peakFactor: { low: 1.2, high: 3 } } };
    const c = compute(s);
    const at = (pf: number) => rec({ ...DEFAULT_STATE, peakFactor: pf }).evaluations.find((e) => e.config.id === B200)!.fleet.boxes;
    expect(c.band.fleet).toEqual({ low: at(1.2), base: at(2), high: at(3) });
    expect(c.band.fleet!.low).toBeLessThan(c.band.fleet!.high);
  });
});
