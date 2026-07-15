// UI iteration 3 tests — the STRUCTURED journey-state contract (utilization, N+1, purchasing as REAL
// engine inputs, verified through real engine outcomes) and family-B operational profiles over the
// approved provenance machinery (mixed-type fields, per-family chips, HA-posture banner). No mocks.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend } from "../../lib/recommendation";
import type { PriceBook } from "../../lib/types";
import pricesJson from "../../public/prices.json";
import {
  OPERATIONAL_PRESETS, RESPONSE_PRESETS, BUSINESS_HOURS_PER_MONTH, initialProvenance, computePreview,
  applyPresetWithProvenance, registerManualEdit, fmtPresetValue, undoPreset,
} from "./presets";
import { PresetBar } from "./PresetBar";
import { AdvisorInputs, type AdvisorState } from "./AdvisorInputs";
import { buildWorkload, DEFAULT_STATE } from "../../app/advisor/page";

const priceBook = pricesJson as unknown as PriceBook;
const B200 = "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16";
const b200 = (r: ReturnType<typeof recommend>) => r.evaluations.find((e) => e.config.id === B200)!;
const balanced = OPERATIONAL_PRESETS.find((p) => p.id === "production-balanced")!;
const prototype = OPERATIONAL_PRESETS.find((p) => p.id === "prototype")!;
const costOptimized = OPERATIONAL_PRESETS.find((p) => p.id === "cost-optimized")!;
const haPosture = OPERATIONAL_PRESETS.find((p) => p.id === "ha-posture")!;
const strict = RESPONSE_PRESETS.find((p) => p.id === "strict-conversational")!;

describe("iteration-3 journey-state contract — REAL engine inputs (verified via engine outcomes)", () => {
  it("buildWorkload maps utilization %, N+1 and purchasing to the engine fields", () => {
    const w = buildWorkload({ ...DEFAULT_STATE, utilTargetPct: 85, haEnabled: false, purchasingModel: "savings-1yr" });
    expect(w.generation.utilTarget).toBeCloseTo(0.85, 10);
    expect(w.generation.haEnabled).toBe(false);
    expect(w.generation.gpuPricingModel).toBe("savings-1yr");
  });
  it("defaults preserve the approved R1 output exactly (70% · N+1 on · on-demand)", () => {
    const r = recommend({ workload: buildWorkload(DEFAULT_STATE), optimizeFor: "cost" });
    expect(b200(r).fleet.boxes).toBe(87);
    expect(Math.round(b200(r).cost.selfHostMonthly!)).toBe(7_176_630);
  });
  it("N+1 off removes the spare box (engine-derived: 87 → 86)", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, haEnabled: false }), optimizeFor: "cost" });
    expect(b200(r).fleet.boxes).toBe(86);
  });
  it("85% utilization shrinks the fleet (engine-derived, not preset-encoded)", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, utilTargetPct: 85 }), optimizeFor: "cost" });
    expect(b200(r).fleet.boxes).toBeLessThan(87);
    expect(b200(r).fleet.boxes).toBeGreaterThan(0);
  });
  it("indicative Savings-Plan pricing changes the ECONOMICS and can flip the decision honestly", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, purchasingModel: "savings-1yr" }), optimizeFor: "cost" });
    const ev = b200(r);
    expect(Math.round(ev.cost.selfHostMonthly!)).toBe(Math.round(7_176_630 * 0.7)); // 30% indicative discount
    expect(r.decision).toMatchObject({ choice: "self-host", basis: "lower-cost" }); // 5.02M < 6.49M
    // serving facts stay honest: base on-demand rate + the purchasing model, never a fake "effective rate"
    expect(ev.servingFacts.gpuPricePerHr).toBe(113);
    expect(ev.servingFacts.gpuPricingModel).toBe("savings-1yr");
  });
  it("invalid operations inputs fail closed through the boundary with friendly field mapping", () => {
    expect(() => recommend({ workload: buildWorkload({ ...DEFAULT_STATE, utilTargetPct: 0 }), optimizeFor: "cost" })).toThrow(/utilTarget/);
    expect(() => recommend({ workload: buildWorkload({ ...DEFAULT_STATE, purchasingModel: "bogus" as never }), optimizeFor: "cost" })).toThrow(/gpuPricingModel/);
  });
});

describe("iteration-3 — family-B operational profiles over the approved provenance machinery", () => {
  it("the six profiles match 07-presets §B (business hours = 220 h/mo, UI3-D1)", () => {
    expect(OPERATIONAL_PRESETS.map((p) => p.id)).toEqual([
      "prototype", "production-balanced", "latency-sensitive", "cost-optimized", "business-hours", "ha-posture",
    ]);
    expect(prototype.fields).toEqual({ utilTargetPct: 85, haEnabled: false, uptimeHours: BUSINESS_HOURS_PER_MONTH, purchasingModel: "on-demand" });
    expect(costOptimized.fields.purchasingModel).toBe("savings-1yr");
    expect(haPosture.banner).toContain("Architecture, security, quota and compliance review are still required");
    expect(haPosture.label).toBe("24×7 · high-availability posture"); // renamed from "regulated" (P2-6)
  });
  it("mixed-type preview: booleans render on/off; enums verbatim; defaults-matching rows are no-change", () => {
    const rows = computePreview(DEFAULT_STATE, initialProvenance().origins, prototype);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.haEnabled.status).toBe("change");
    expect(fmtPresetValue(byField.haEnabled.current)).toBe("on");
    expect(fmtPresetValue(byField.haEnabled.proposed)).toBe("off");
    expect(byField.purchasingModel.status).toBe("no-change"); // on-demand → on-demand
    expect(byField.utilTargetPct.status).toBe("change"); // 70 → 85
  });
  it("families are independent: applying A then B keeps BOTH chips; a manual B-field edit marks only B modified", () => {
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, strict, computePreview(state, prov.origins, strict), {}));
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, balanced, computePreview(state, prov.origins, balanced), {}));
    expect(prov.active.A).toMatchObject({ id: "strict-conversational", modified: false });
    expect(prov.active.B).toMatchObject({ id: "production-balanced", modified: false });
    // manual edit of a B field (utilization) marks only B as modified and invalidates the single undo
    const after = { ...state, utilTargetPct: 60 };
    prov = registerManualEdit(prov, ["utilTargetPct"]);
    expect(prov.active.A).toMatchObject({ modified: false });
    expect(prov.active.B).toMatchObject({ modified: true });
    expect(prov.undo).toBeNull();
    expect(undoPreset(prov)).toBeNull();
    void after;
  });
  it("B→B profile switching produces zero conflicts (preset-origin fields switch normally)", () => {
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, prototype, computePreview(state, prov.origins, prototype), {}));
    const rows = computePreview(state, prov.origins, balanced);
    expect(rows.some((r) => r.status === "conflict")).toBe(false);
  });
  it("the HA-posture banner renders while active — including after a later manual modification", () => {
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, haPosture, computePreview(state, prov.origins, haPosture), {}));
    const html = renderToStaticMarkup(
      <PresetBar state={state} provenance={prov} selfHostAvailable={true} onApply={() => {}} onUndo={() => {}} />
    );
    expect(html).toContain("Architecture, security, quota and compliance review are still required — this preset does not deliver them.");
    // still shown after a manual edit (profile remains active, marked modified)
    const provMod = registerManualEdit(prov, ["utilTargetPct"]);
    const htmlMod = renderToStaticMarkup(
      <PresetBar state={{ ...state, utilTargetPct: 60 }} provenance={provMod} selfHostAvailable={true} onApply={() => {}} onUndo={() => {}} />
    );
    expect(htmlMod).toContain("Architecture, security, quota and compliance review are still required");
    expect(htmlMod).toContain("Modified from 24×7 · high-availability posture");
  });
  it("operational profiles are disabled for API-only models (self-host inputs)", () => {
    const html = renderToStaticMarkup(
      <PresetBar state={DEFAULT_STATE} provenance={initialProvenance()} selfHostAvailable={false} onApply={() => {}} onUndo={() => {}} />
    );
    expect(html).toMatch(/data-testid="preset-production-balanced"[^>]*disabled/);
    expect(html).toContain("not applicable for an API-only model");
    expect(html).not.toMatch(/data-testid="preset-strict-conversational"[^>]*disabled/); // family A stays enabled
  });
});

describe("iteration-3 — operations & purchasing expert controls (a11y + decision support)", () => {
  it("labeled controls with help, indicative-pricing caveat and provenance tags; disabled when API-only", () => {
    const expertState: AdvisorState = { ...DEFAULT_STATE, mode: "expert", purchasingModel: "savings-1yr" };
    const html = renderToStaticMarkup(
      <AdvisorInputs state={expertState} defaults={DEFAULT_STATE} models={priceBook.models} selfHostAvailable={true} fieldErrors={{}} onChange={() => {}} />
    );
    expect(html).toContain('for="adv-util"');
    expect(html).toContain("default 70 (balanced)");
    expect(html).toContain('for="adv-ha"');
    expect(html).toContain("does <em>not</em> establish multi-AZ resilience");
    expect(html).toContain('for="adv-purchasing"');
    expect(html).toContain("Commitment discounts are indicative");
    expect(html).toMatch(/data-testid="provenance-adv-purchasing"[^>]*>customer-entered/); // edited away from default
    expect(html).toMatch(/data-testid="provenance-adv-ha"[^>]*>assumed \(default\)/);
    const apiOnly = renderToStaticMarkup(
      <AdvisorInputs state={expertState} defaults={DEFAULT_STATE} models={priceBook.models} selfHostAvailable={false} fieldErrors={{}} onChange={() => {}} />
    );
    expect(apiOnly).toMatch(/id="adv-util"[^>]*disabled/);
    expect(apiOnly).toMatch(/id="adv-purchasing"[^>]*disabled/);
  });
});
