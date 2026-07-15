// Iteration-3 HOLD acceptance tests (P1-UI3-1 / P1-UI3-2 / P2-UI3-1..3). The pricing qualification is
// STRUCTURED headless output (PricingAssumption + CostComparator.pricingQualification); the UI renders
// it, never reconstructs it. No mocks — real recommend()/narrate()/diffRecommendations().
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate, diffRecommendations } from "../../lib/recommendation";
import { DecisionSummary } from "./DecisionSummary";
import { PresetBar } from "./PresetBar";
import { summarizeChanges } from "./change-summary";
import {
  OPERATIONAL_PRESETS, RESPONSE_PRESETS, initialProvenance, computePreview, applyPresetWithProvenance,
} from "./presets";
import { buildWorkload, DEFAULT_STATE } from "../../app/advisor/page";

const B200 = "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16";
const costOptimized = OPERATIONAL_PRESETS.find((p) => p.id === "cost-optimized")!;
const haPosture = OPERATIONAL_PRESETS.find((p) => p.id === "ha-posture")!;

/** The cost-optimized scenario (85% util · N+1 · 24×7 · savings-1yr) — the exact HOLD repro. */
const costOptState = { ...DEFAULT_STATE, utilTargetPct: 85, haEnabled: true, uptimeHours: 730, purchasingModel: "savings-1yr" as const };
const rCostOpt = () => recommend({ workload: buildWorkload(costOptState), optimizeFor: "cost" });
const rDefault = () => recommend({ workload: buildWorkload(DEFAULT_STATE), optimizeFor: "cost" });

describe("P1-UI3-1 — an indicative discount can NEVER render an unqualified recommendation", () => {
  it("the qualification is STRUCTURED headless output (assumption preserved from the engine)", () => {
    const r = rCostOpt();
    expect(r.decision).toMatchObject({ choice: "self-host", basis: "lower-cost" });
    expect(r.decision.costComparator!.pricingQualification).toBe("indicative-commitment");
    const pa = r.evaluations.find((e) => e.config.id === B200)!.pricingAssumption;
    expect(pa).toMatchObject({
      qualification: "indicative-commitment",
      purchasingModel: "savings-1yr",
      onDemandBaseHourly: 113,
      assumedDiscountPct: 30, // the ENGINE's GPU_COMMITMENT_DISCOUNT — never a component constant
      pricingEstimated: true,
      assumptionSource: "gpu-commitment-discount:savings-1yr",
    });
    expect(pa.modeledEffectiveHourly).toBeCloseTo(113 * 0.7, 10);
  });

  it("hero carries the indicative qualifier; the EXACT discount/utilization assumptions sit adjacent", () => {
    const n = narrate(rCostOpt());
    const html = renderToStaticMarkup(<DecisionSummary result={n} />);
    expect(html).toContain("Indicative modeled cost: Self-host");
    expect(html).not.toContain("Lowest modeled cost: Self-host");
    expect(html).toContain(
      "This result assumes a 30% one-year Savings Plan discount and 85% fleet utilization. It is a planning scenario, not an AWS quote."
    );
    // base rate + modeled planning rate shown AS AN ASSUMPTION, never a quoted effective rate
    expect(html).toContain("$113.00/GPU-hour on-demand base rate");
    expect(html).toContain("$79.10/GPU-hour modeled planning rate");
    expect(html).toContain("an assumption, not a quoted effective rate");
    // narrative is the qualified directional wording
    expect(html).toContain("Under these assumptions, modeled self-host cost is lower");
  });

  it("the rendered assumption equals the STRUCTURED fields (not a duplicated constant)", () => {
    const r = rCostOpt();
    const pa = r.evaluations.find((e) => e.config.id === r.decision.costComparator!.selfHostCandidateId)!.pricingAssumption;
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(r)} />);
    expect(html).toContain(`assumes a ${pa.assumedDiscountPct}% one-year Savings Plan discount`);
    expect(html).toContain(`$${pa.onDemandBaseHourly.toFixed(2)}/GPU-hour on-demand base rate`);
    expect(html).toContain(`$${pa.modeledEffectiveHourly.toFixed(2)}/GPU-hour modeled planning rate`);
  });

  it("a commitment-driven winner can NEVER render 'trustworthy cost comparison' in the change summary", () => {
    const diff = diffRecommendations(rDefault(), rCostOpt());
    const text = summarizeChanges(diff).map((s) => s.text).join(" | ");
    expect(text).toContain("Decision: api (lower-cost) → self-host (lower-cost) — a modeled cost comparison decided it.");
    expect(text).not.toContain("trustworthy");
  });

  it("a reference (on-demand) lower-cost decision keeps the 'trustworthy' meaning", () => {
    // evidence-gap (strict SLA) → back to the R1 default: the decision flips to api/lower-cost on the
    // reference on-demand book rate.
    const strictWorkload = buildWorkload({ ...DEFAULT_STATE, ttftTargetMs: 1000, interactivityTarget: 50 });
    const a = recommend({ workload: strictWorkload, optimizeFor: "cost" });
    const diff = diffRecommendations(a, rDefault());
    const text = summarizeChanges(diff).map((s) => s.text).join(" | ");
    expect(text).toContain("a trustworthy cost comparison decided it");
    expect(text).not.toContain("a modeled cost comparison decided it");
  });

  it("on-demand behavior is UNCHANGED: reference hero, no indicative disclosure, reference comparator", () => {
    const r = rDefault();
    expect(r.decision.costComparator!.pricingQualification).toBe("reference");
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(r)} />);
    expect(html).toContain("Lowest modeled cost: API");
    expect(html).not.toContain("Indicative modeled cost");
    expect(html).not.toContain("indicative-pricing-disclosure");
    expect(html).not.toContain("planning scenario");
  });
});

describe("P1-UI3-2 — profile suspension for API-only models (active → suspended → restored)", () => {
  const applied = () => {
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, haPosture, computePreview(state, prov.origins, haPosture), {}));
    return { state, prov };
  };
  const render = (state: typeof DEFAULT_STATE, prov: ReturnType<typeof initialProvenance>, selfHostAvailable: boolean) =>
    renderToStaticMarkup(
      <PresetBar state={state} provenance={prov} selfHostAvailable={selfHostAvailable} onApply={() => {}} onUndo={() => {}} />
    );

  it("ACTIVE for a self-hostable model: normal chip, HA banner, Undo", () => {
    const { state, prov } = applied();
    const html = render(state, prov, true);
    expect(html).toContain("24×7 · high-availability posture");
    expect(html).not.toContain("inactive for API-only model");
    expect(html).toContain("Architecture, security, quota and compliance review are still required");
    expect(html).toContain('data-testid="preset-undo"');
  });

  it("SUSPENDED for an API-only model: explicit inactive chip; banner and Undo suppressed", () => {
    const { state, prov } = applied();
    const html = render(state, prov, false);
    // never simultaneously "not applicable" AND presented as active
    expect(html).toContain("24×7 · high-availability posture — inactive for API-only model");
    expect(html).not.toContain('data-testid="preset-banner-ha-posture"');
    expect(html).not.toContain("Architecture, security, quota and compliance review");
    expect(html).not.toContain('data-testid="preset-undo"');
    expect(html).toContain("preserved and re-apply when you switch back");
  });

  it("RESTORED when switching back: the SAME provenance renders active again (settings preserved)", () => {
    const { state, prov } = applied();
    render(state, prov, false); // suspend…
    const html = render(state, prov, true); // …and switch back — provenance untouched by the suspension
    expect(html).not.toContain("inactive for API-only model");
    expect(html).toContain("Architecture, security, quota and compliance review are still required");
    expect(html).toContain('data-testid="preset-undo"');
  });

  it("a family-A Undo stays available while only family-B is suspended", () => {
    let state = { ...DEFAULT_STATE };
    let prov = initialProvenance();
    const strict = RESPONSE_PRESETS.find((p) => p.id === "strict-conversational")!;
    ({ next: state, provenance: prov } = applyPresetWithProvenance(state, prov, strict, computePreview(state, prov.origins, strict), {}));
    const html = render(state, prov, false);
    expect(html).toContain('data-testid="preset-undo"'); // last apply was family A
  });
});

describe("P2-UI3-1/2 — operational assumptions visible at the result (Simple mode included)", () => {
  it("R1 default: operations row (70% · N+1 on · 730 h · On-Demand) + the universal N+1 caveat", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(rDefault())} />);
    expect(html).toContain('data-testid="operations-row"');
    expect(html).toContain("Utilization target:</span> 70%");
    expect(html).toContain("Spare serving replica (N+1):</span> on");
    expect(html).toContain("Operating hours:</span> 730 h/mo");
    expect(html).toContain("Purchasing:</span> On-Demand");
    expect(html).toContain(
      "N+1 covers one serving-replica loss only; it does not establish multi-AZ resilience, disaster recovery, security, quota readiness, or compliance."
    );
    expect(html).not.toContain('data-testid="active-window-disclosure"'); // 730 h — no active-window note
  });

  it("cost-optimized: purchasing reads as an indicative planning assumption", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(rCostOpt())} />);
    expect(html).toContain("Purchasing:</span> one-year Savings Plan (indicative planning assumption)");
    expect(html).toContain("Utilization target:</span> 85%");
  });

  it("business hours (220 h): persistent active-window-demand disclosure + not-established list (UI3-D1)", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, uptimeHours: 220 }), optimizeFor: "cost" });
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(r)} />);
    expect(html).toContain("Operating hours:</span> 220 h/mo");
    expect(html).toContain(
      "Monthly traffic is assumed to be served within the selected active hours, so the required active fleet may increase."
    );
    expect(html).toContain("Startup/drain/checkpoint time, accelerator availability, capacity reservations, quotas, and operational automation are not established by these settings.");
    // engine outcome preserved: 220 active hours CONCENTRATE demand — the fleet grows, never a fabricated saving
    const boxes = r.evaluations.find((e) => e.config.id === B200)!.fleet.boxes;
    expect(boxes).toBeGreaterThan(87);
  });

  it("N+1 off: no N+1 caveat (the caveat tracks the actual structured input)", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, haEnabled: false }), optimizeFor: "cost" });
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(r)} />);
    expect(html).toContain("Spare serving replica (N+1):</span> off");
    expect(html).not.toContain('data-testid="n1-caveat"');
  });

  it("API-only model: NO operations row — those settings do not shape the API recommendation", () => {
    const r = recommend({ workload: buildWorkload({ ...DEFAULT_STATE, modelId: "claude-opus-4-8" }), optimizeFor: "cost" });
    expect(r.decision.basis).toBe("self-host-unavailable");
    const html = renderToStaticMarkup(<DecisionSummary result={narrate(r)} />);
    expect(html).not.toContain('data-testid="operations-row"');
    expect(html).not.toContain('data-testid="n1-caveat"');
  });
});

describe("P2-UI3-3 — customer-facing labels; internal stage identifiers removed", () => {
  it("family headings carry no stage identifiers; the cost-optimized profile is renamed (UI3-D2)", () => {
    const html = renderToStaticMarkup(
      <PresetBar state={DEFAULT_STATE} provenance={initialProvenance()} selfHostAvailable={true} onApply={() => {}} onUndo={() => {}} />
    );
    expect(html).toContain(">Response experience<");
    expect(html).toContain(">Operational profile<");
    expect(html).not.toContain("Stage C");
    expect(html).not.toContain("Stage A/C");
    expect(html).toContain("Cost-optimized — illustrative 1-year commitment");
    expect(costOptimized.label).toBe("Cost-optimized — illustrative 1-year commitment");
    expect(costOptimized.description).toContain("planning scenario, not an AWS quote");
  });
});
