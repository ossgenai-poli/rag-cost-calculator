// UI iteration 2 tests (post-HOLD revision) — presets with EXPLICIT per-field origin tracking
// (default | manual | preset:<id>), accurate preview wording, safe undo; the compact structured change
// summary + collapsed audit; and alternatives cards. Real headless output; no mocks.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate, diffRecommendations } from "../../lib/recommendation";
import type { NarratedCard } from "../../lib/recommendation";
import { defaultInputs } from "../../lib/calc-engine";
import type { CalcInputs, PriceBook } from "../../lib/types";
import pricesJson from "../../public/prices.json";
import {
  RESPONSE_PRESETS, initialProvenance, changedPresetFields, registerManualEdit, computePreview,
  previewCounts, applyPresetWithProvenance, undoPreset,
} from "./presets";
import { summarizeChanges } from "./change-summary";
import { ChangesPanel } from "./ChangesPanel";
import { AlternativeCards } from "./AlternativeCards";
import type { AdvisorState } from "./AdvisorInputs";

const priceBook = pricesJson as unknown as PriceBook;
const DEFAULTS: AdvisorState = {
  modelId: "deepseek-v4-pro-oss", volume: 200_000_000, optimizeFor: "cost", mode: "simple",
  ttftTargetMs: 2000, interactivityTarget: 30, outTokens: 500, queryTokens: 50, promptOverhead: 300,
  chunkSize: 512, topN: 5, topK: 20, uptimeHours: 730, utilTargetPct: 70, haEnabled: true, purchasingModel: "on-demand", experimental: false, peakFactor: 1, ranges: {},
};
function workload(volume = 200_000_000, mutate?: (w: CalcInputs) => void): CalcInputs {
  const w = defaultInputs(priceBook);
  w.generation.mode = "self-hosted";
  w.generation.llmModelId = "deepseek-v4-pro-oss";
  w.generation.outTokens = 500;
  w.traffic.queriesPerMonth = volume;
  w.traffic.peakFactor = 1;
  mutate?.(w);
  return w;
}
const strict = RESPONSE_PRESETS.find((p) => p.id === "strict-conversational")!;
const analyst = RESPONSE_PRESETS.find((p) => p.id === "analyst")!;
const interactive = RESPONSE_PRESETS.find((p) => p.id === "interactive-rag")!;

describe("presets — owner positions (bundle set)", () => {
  it("Batch is REMOVED; Conversational is the explicitly strict target; RAG/Analyst retained", () => {
    expect(RESPONSE_PRESETS.map((p) => p.id)).toEqual(["strict-conversational", "interactive-rag", "analyst"]);
    expect(strict.label).toBe("Strict conversational target");
    expect(strict.description).toMatch(/aggressive customer target/i);
    expect(strict.description).toMatch(/not a universal recommendation/i);
    expect(RESPONSE_PRESETS.some((p) => /batch/i.test(p.id) || /batch/i.test(p.label))).toBe(false);
  });
});

describe("presets — explicit origin tracking (P1-UI2-1)", () => {
  it("preset→preset switching: fields written by a previous preset are NOT conflicts and switch normally", () => {
    // Apply Strict conversational from defaults…
    const rows1 = computePreview(DEFAULTS, initialProvenance().origins, strict);
    const applied = applyPresetWithProvenance(DEFAULTS, initialProvenance(), strict, rows1, {});
    expect(applied.next.ttftTargetMs).toBe(1000);
    expect(applied.provenance.origins.ttftTargetMs).toBe("preset:strict-conversational");
    // …then preview Analyst: preset-origin values are ordinary CHANGES, not conflicts (repro A fixed).
    const rows2 = computePreview(applied.next, applied.provenance.origins, analyst);
    expect(rows2.every((r) => r.status === "change")).toBe(true);
    const applied2 = applyPresetWithProvenance(applied.next, applied.provenance, analyst, rows2, {});
    expect(applied2.next.ttftTargetMs).toBe(5000); // switched without per-field opt-ins
    expect(applied2.next.interactivityTarget).toBe(15);
  });

  it("only MANUAL-origin fields create conflicts, and they default to KEEP", () => {
    const prov = registerManualEdit(initialProvenance(), ["ttftTargetMs"]);
    const state = { ...DEFAULTS, ttftTargetMs: 1500 };
    const rows = computePreview(state, prov.origins, strict);
    expect(rows.find((r) => r.field === "ttftTargetMs")!.status).toBe("conflict");
    expect(rows.find((r) => r.field === "interactivityTarget")!.status).toBe("change");
    const { next, provenance } = applyPresetWithProvenance(state, prov, strict, rows, {});
    expect(next.ttftTargetMs).toBe(1500); // kept
    expect(provenance.origins.ttftTargetMs).toBe("manual"); // kept field stays manual-origin
    expect(provenance.origins.interactivityTarget).toBe("preset:strict-conversational");
    expect(provenance.active.A).toMatchObject({ label: "Strict conversational target", fieldsKept: 1, modified: false });
  });

  it("preset→manual edit: chip becomes Modified and Undo is INVALIDATED (never overwrites later edits)", () => {
    const rows = computePreview(DEFAULTS, initialProvenance().origins, strict);
    const applied = applyPresetWithProvenance(DEFAULTS, initialProvenance(), strict, rows, {});
    expect(applied.provenance.undo).not.toBeNull(); // safe undo exists right after apply
    // SA manually edits a preset field afterwards…
    const after = { ...applied.next, ttftTargetMs: 1200 };
    const prov2 = registerManualEdit(applied.provenance, changedPresetFields(applied.next, after));
    expect(prov2.active.A).toMatchObject({ modified: true }); // "Modified from …"
    expect(prov2.undo).toBeNull(); // undo invalidated
    expect(undoPreset(prov2)).toBeNull(); // no path can restore over the manual edit
    expect(prov2.origins.ttftTargetMs).toBe("manual");
  });

  it("safe Undo (no later edits) restores the exact pre-apply state AND origins", () => {
    const prov0 = registerManualEdit(initialProvenance(), ["interactivityTarget"]);
    const state0 = { ...DEFAULTS, interactivityTarget: 20 };
    const rows = computePreview(state0, prov0.origins, strict);
    const applied = applyPresetWithProvenance(state0, prov0, strict, rows, { interactivityTarget: true });
    const restored = undoPreset(applied.provenance)!;
    expect(restored.state).toEqual(state0);
    expect(restored.provenance.origins).toEqual(prov0.origins); // provenance restored with state
    expect(restored.provenance.active).toEqual({ A: null, B: null });
    expect(restored.revertedLabel).toBe("Strict conversational target");
  });

  it("presets set INPUTS, not outputs — the engine still derives the fleet", () => {
    const w = workload(200_000_000, (x) => { x.generation.ttftTargetMs = 5000; x.generation.interactivityTarget = 15; });
    const r = narrate(recommend({ workload: w, optimizeFor: "cost" }));
    expect(r.bestSelfHost).not.toBeNull();
    expect(r.evaluations[0].fleet.boxes).toBeGreaterThan(0);
  });
});

describe("presets — accurate preview wording (P2-UI2-1)", () => {
  it("counts split proposed differences into selected vs kept under the current choices", () => {
    const prov = registerManualEdit(initialProvenance(), ["ttftTargetMs"]);
    const state = { ...DEFAULTS, ttftTargetMs: 1500 };
    const rows = computePreview(state, prov.origins, strict);
    expect(previewCounts(rows, {})).toEqual({ differences: 2, selected: 1, kept: 1 }); // conflict kept by default
    expect(previewCounts(rows, { ttftTargetMs: true })).toEqual({ differences: 2, selected: 2, kept: 0 });
    // preset matching current values → zero differences
    const rowsSame = computePreview(DEFAULTS, initialProvenance().origins, interactive);
    expect(previewCounts(rowsSame, {})).toEqual({ differences: 0, selected: 0, kept: 0 });
  });
});

describe("ChangesPanel — compact structured summary + collapsed audit (P2-UI2-2/3/4)", () => {
  it("canonical strict-conversational case: slot-reserved summary carries ALL required facts", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    const b = recommend({ workload: workload(200_000_000, (w) => { w.generation.ttftTargetMs = 1000; w.generation.interactivityTarget = 50; }), optimizeFor: "cost" });
    const diff = diffRecommendations(a, b);
    const summary = summarizeChanges(diff);
    const text = summary.map((s) => s.text).join(" | ");
    // P2-UI2-3 required canonical assertions:
    expect(text).toContain("Decision: api (lower-cost) → api (evidence-gap) — no SLA-compatible configuration has qualifying evidence.");
    expect(text).toContain("Both modeled p6-b200.48xlarge configurations now fail the selected SLA (rejection: sla-unmet-ttft-or-streaming)."); // aggregated — ONE slot
    expect(text).toContain("Best self-host option removed");
    expect(text).toContain("87 → 131 box(es)"); // the previously-best candidate's fleet movement
    expect(text).toContain("$7,176,630 → $10,806,190/mo"); // the material COST movement is never truncated
    expect(summary.length).toBeLessThanOrEqual(6);
    // no slot is wasted on a duplicate per-candidate fleet row (aggregation + reservation)
    expect(summary.filter((s) => s.key === "fleet").length).toBe(1);
    const html = renderToStaticMarkup(<ChangesPanel diff={diff} />);
    expect(html).toContain("changes-summary");
    expect(html).toContain(`View all ${diff.changes.length} technical changes`); // complete audit preserved, collapsed
    expect(html).toContain("decision-changed"); // raw reason-coded rows still present inside the audit
  });

  it("P2-UI2-4: a workload-assumptions-only diff renders a NON-EMPTY, non-invented summary", () => {
    // Analyst SLA (5000/15) → manual TTFT 4500: every candidate's outcome is unchanged; the diff carries
    // only the workload-input change.
    const a = recommend({ workload: workload(200_000_000, (w) => { w.generation.ttftTargetMs = 5000; w.generation.interactivityTarget = 15; }), optimizeFor: "cost" });
    const b = recommend({ workload: workload(200_000_000, (w) => { w.generation.ttftTargetMs = 4500; w.generation.interactivityTarget = 15; }), optimizeFor: "cost" });
    const diff = diffRecommendations(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.changes.every((c) => c.code === "effective-workload-changed")).toBe(true);
    const summary = summarizeChanges(diff);
    expect(summary).toEqual([
      { key: "no-outcome", text: "Workload assumptions changed; the modeled decision, qualification, fleet, and cost did not change." },
    ]);
    const text = summary.map((s) => s.text).join(" ");
    expect(text).not.toMatch(/Decision:|Fleet|cost \(|\$\d/); // nothing invented
    const html = renderToStaticMarkup(<ChangesPanel diff={diff} />);
    expect(html).toContain("Workload assumptions changed");
    expect(html).toContain("View all 1 technical changes"); // the raw change stays under the audit
    expect(html).toContain("effective-workload-changed");
  });
  it("R1→R5 volume change: summary carries fleet/cost facts; audit keeps verbatim values", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    const b = recommend({ workload: workload(5_000_000), optimizeFor: "cost" });
    const diff = diffRecommendations(a, b);
    const text = summarizeChanges(diff).map((s) => s.text).join(" | ");
    expect(text).toContain("87 → 4 box(es)");
    expect(text).toContain("$7,176,630 → $329,960/mo");
    const html = renderToStaticMarkup(<ChangesPanel diff={diff} />);
    expect(html).toContain("87 → 4");
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it("renders nothing for identical results or no diff yet", () => {
    const a = recommend({ workload: workload(), optimizeFor: "cost" });
    expect(renderToStaticMarkup(<ChangesPanel diff={diffRecommendations(a, a)} />)).toBe("");
    expect(renderToStaticMarkup(<ChangesPanel diff={null} />)).toBe("");
  });
});

describe("AlternativeCards — distinct-only, honest empty (approved in review; regression only)", () => {
  const r1 = narrate(recommend({ workload: workload(), optimizeFor: "cost" }));
  it("R1 → honest 'none' note; fixture renders structured cards; hidden without a primary", () => {
    expect(renderToStaticMarkup(<AlternativeCards result={r1} />)).toContain("single distinct configuration");
    const alt: NarratedCard = {
      kind: "lowest-cost",
      config: { id: "x", llmModelId: "deepseek-v4-pro-oss", instanceType: "p5e.48xlarge", gpuSku: "H200", weightBits: 4, kvBits: 16, label: "p5e (H200) · INT4" },
      costMonthly: 5_000_000, costDeltaVsBest: -2_176_630, confidence: "measured-scaled",
      bindingConstraint: "eq", tradeoff: "cheaper, same evidence class",
    };
    const html = renderToStaticMarkup(<AlternativeCards result={{ ...r1, alternatives: [alt] }} />);
    expect(html).toContain("Lowest-cost feasible alternative");
    expect(html).toContain("$5,000,000/mo");
    expect(renderToStaticMarkup(<AlternativeCards result={{ ...r1, bestSelfHost: null }} />)).toBe("");
  });
});
