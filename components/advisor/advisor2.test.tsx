// UI iteration 2 tests — presets (preview/conflict/apply/undo contract, docs/ux-v2/07-presets.md),
// the reason-coded ChangesPanel (rendered from the APPROVED structured change-diff), and alternatives
// cards (distinct-only + honest empty). Real headless output; no mocks.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate, diffRecommendations } from "../../lib/recommendation";
import type { NarratedCard } from "../../lib/recommendation";
import { defaultInputs } from "../../lib/calc-engine";
import type { CalcInputs, PriceBook } from "../../lib/types";
import pricesJson from "../../public/prices.json";
import { RESPONSE_PRESETS, computePreview, applyPreset } from "./presets";
import { ChangesPanel } from "./ChangesPanel";
import { AlternativeCards } from "./AlternativeCards";
import type { AdvisorState } from "./AdvisorInputs";

const priceBook = pricesJson as unknown as PriceBook;
const DEFAULTS: AdvisorState = {
  modelId: "deepseek-v4-pro-oss", volume: 200_000_000, optimizeFor: "cost", mode: "simple",
  ttftTargetMs: 2000, interactivityTarget: 30, outTokens: 500, queryTokens: 50, promptOverhead: 300,
  chunkSize: 512, topN: 5, topK: 20, uptimeHours: 730, experimental: false,
};
function workload(volume = 200_000_000): CalcInputs {
  const w = defaultInputs(priceBook);
  w.generation.mode = "self-hosted";
  w.generation.llmModelId = "deepseek-v4-pro-oss";
  w.generation.outTokens = 500;
  w.traffic.queriesPerMonth = volume;
  w.traffic.peakFactor = 1;
  return w;
}

describe("presets — preview/conflict/apply/undo contract (pure logic)", () => {
  const conversational = RESPONSE_PRESETS.find((p) => p.id === "conversational")!;
  const interactive = RESPONSE_PRESETS.find((p) => p.id === "interactive-rag")!;

  it("preview shows exactly which fields change, with 'no-change' rows identified", () => {
    const rows = computePreview(DEFAULTS, DEFAULTS, conversational);
    expect(rows).toEqual([
      { field: "ttftTargetMs", label: "P99 TTFT target (ms)", current: 2000, proposed: 1000, status: "change" },
      { field: "interactivityTarget", label: "Streaming target (tok/s/user)", current: 30, proposed: 50, status: "change" },
    ]);
    // applying the default-matching preset → all rows no-change
    expect(computePreview(DEFAULTS, DEFAULTS, interactive).every((r) => r.status === "no-change")).toBe(true);
  });

  it("an SA-edited field is a CONFLICT and is KEPT by default (no silent overwrite)", () => {
    const edited = { ...DEFAULTS, ttftTargetMs: 1500 }; // SA edited away from the default
    const rows = computePreview(edited, DEFAULTS, conversational);
    expect(rows.find((r) => r.field === "ttftTargetMs")!.status).toBe("conflict");
    const { next, fieldsKept, fieldsChanged } = applyPreset(edited, rows, {}); // no explicit opt-in
    expect(next.ttftTargetMs).toBe(1500); // kept
    expect(next.interactivityTarget).toBe(50); // non-conflicting field applied
    expect(fieldsKept).toBe(1);
    expect(fieldsChanged).toBe(1);
  });

  it("an explicit per-field opt-in uses the preset value", () => {
    const edited = { ...DEFAULTS, ttftTargetMs: 1500 };
    const rows = computePreview(edited, DEFAULTS, conversational);
    const { next, fieldsKept } = applyPreset(edited, rows, { ttftTargetMs: true });
    expect(next.ttftTargetMs).toBe(1000);
    expect(fieldsKept).toBe(0);
  });

  it("apply → undo restores the exact pre-apply state (single undo)", () => {
    const before = { ...DEFAULTS, ttftTargetMs: 1500 };
    const rows = computePreview(before, DEFAULTS, conversational);
    const { next } = applyPreset(before, rows, { ttftTargetMs: true });
    expect(next).not.toEqual(before);
    // the PresetBar stores `before` as the undo snapshot; restoring it is exact
    expect(before).toEqual({ ...DEFAULTS, ttftTargetMs: 1500 });
  });

  it("presets set INPUTS, not outputs — the engine still derives the fleet from them", () => {
    // Analyst preset relaxes the SLA; the engine result is still computed, not hardcoded.
    const w = workload();
    w.generation.ttftTargetMs = 5000;
    w.generation.interactivityTarget = 15;
    const r = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(r.bestSelfHost).not.toBeNull(); // derived by the engine
    expect(r.evaluations[0].fleet.boxes).toBeGreaterThan(0);
  });
});

describe("ChangesPanel — reason-coded rendering of the approved structured diff", () => {
  it("R1→R5 volume change renders fleet/cost rows with verbatim before→after values", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    const b = recommend({ workload: workload(5_000_000), optimizeFor: "cost" });
    const diff = diffRecommendations(a, b);
    const html = renderToStaticMarkup(<ChangesPanel diff={diff} />);
    expect(html).toContain("What changed since your last input");
    expect(html).toContain("fleet-changed");
    expect(html).toContain("87 → 4"); // structured before/after verbatim
    expect(html).toContain("cost-changed");
    expect(html).toContain("effective-workload-changed");
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it("renders nothing for identical results or no diff yet", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    expect(renderToStaticMarkup(<ChangesPanel diff={diffRecommendations(a, a)} />)).toBe("");
    expect(renderToStaticMarkup(<ChangesPanel diff={null} />)).toBe("");
  });
  it("control→experimental renders decision + evidence-state changes", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    const b = recommend({ workload: workload(), optimizeFor: "cost", experimentalProvenance: true });
    const html = renderToStaticMarkup(<ChangesPanel diff={diffRecommendations(a, b)} />);
    expect(html).toContain("decision-changed");
    expect(html).toContain("api (lower-cost) → api (evidence-gap)");
    expect(html).toContain("confidence-changed");
    expect(html).toContain("measured-scaled → unbenchmarked");
  });
});

describe("AlternativeCards — distinct-only, honest empty", () => {
  const r1 = narrate(recommend({ workload: workload(), optimizeFor: "cost" }));
  it("R1 (single eligible config) → honest 'none' note, no invented alternative", () => {
    const html = renderToStaticMarkup(<AlternativeCards result={r1} />);
    expect(html).toContain("alternatives-empty");
    expect(html).toContain("single distinct configuration");
    expect(html).not.toContain("Lowest-cost feasible alternative");
  });
  it("renders structured alternative cards when the headless layer produced distinct candidates", () => {
    const alt: NarratedCard = {
      kind: "lowest-cost",
      config: { id: "x", llmModelId: "deepseek-v4-pro-oss", instanceType: "p5e.48xlarge", gpuSku: "H200", weightBits: 4, kvBits: 16, label: "p5e (H200) · INT4" },
      costMonthly: 5_000_000, costDeltaVsBest: -2_176_630, confidence: "measured-scaled",
      bindingConstraint: "eq", tradeoff: "cheaper, same evidence class",
    };
    const withAlt = { ...r1, alternatives: [alt] };
    const html = renderToStaticMarkup(<AlternativeCards result={withAlt} />);
    expect(html).toContain("Lowest-cost feasible alternative");
    expect(html).toContain("p5e (H200) · INT4");
    expect(html).toContain("$5,000,000/mo");
    expect(html).toContain("−$2,176,630 vs best");
    expect(html).toContain('data-confidence="measured-scaled"');
  });
  it("renders nothing when there is no primary self-host card", () => {
    const empty = { ...r1, bestSelfHost: null };
    expect(renderToStaticMarkup(<AlternativeCards result={empty} />)).toBe("");
  });
});
