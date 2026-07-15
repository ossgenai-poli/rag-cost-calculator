// Iteration-6 tests — alternative selection (doc 06 "Use this") + grouped technical audit (UI2-D3).
// Selection is a PRESENTATION FOCUS over the one structured sweep result: the invariant tests prove
// the decision, comparator, hero and narrative are untouched. Real engine output drives the
// single-eligible canonical behavior; a synthetic two-eligible fixture (narrate-test precedent)
// exercises the multi-candidate semantics the pinned catalog cannot yet produce live.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate, diffRecommendations } from "../../lib/recommendation";
import type { NarratedRecommendationResult } from "../../lib/recommendation";
import { resolveFocus, selectableIds } from "./focus";
import { relevantEvaluation, riskLines } from "./risks";
import { computeRanges } from "./ranges";
import { buildReport } from "./report";
import { DecisionSummary, heroLine } from "./DecisionSummary";
import { BestSelfHostCard } from "./BestSelfHostCard";
import { AlternativeCards } from "./AlternativeCards";
import { ChangesPanel } from "./ChangesPanel";
import { advisorStatesEqual } from "./presets";
import { buildWorkload, DEFAULT_STATE } from "../../app/advisor/page";

const B200 = "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16";
const rDefault = () => recommend({ workload: buildWorkload(DEFAULT_STATE), optimizeFor: "cost" });
const nDefault = () => narrate(rDefault());

/** Synthetic TWO-ELIGIBLE fixture: the real R1 result plus a cloned eligible candidate exposed as a
 *  lowest-cost alternative card (the pinned catalog legitimately yields one eligible config today —
 *  doc 06's worked example — so multi-candidate selection semantics are tested structurally). */
function twoEligible(): NarratedRecommendationResult {
  const n = nDefault();
  const best = n.evaluations.find((e) => e.config.id === B200)!;
  const altId = "deepseek-v4-pro-oss·synthetic-alt·w4kv16";
  const alt = {
    ...best,
    config: { ...best.config, id: altId, instanceType: "synthetic-alt.48xlarge", label: "synthetic-alt · INT4" },
    fleet: { ...best.fleet, boxes: 120, equation: "synthetic equation → 120 boxes" },
    cost: { ...best.cost, selfHostMonthly: 9_000_000 },
    servingFacts: { ...best.servingFacts, instanceType: "synthetic-alt.48xlarge", gpuSku: "B200" },
  };
  return {
    ...n,
    evaluations: [...n.evaluations, alt],
    alternatives: [{
      kind: "lowest-cost" as const, config: alt.config, costMonthly: 9_000_000,
      costDeltaVsBest: 9_000_000 - best.cost.selfHostMonthly!, confidence: alt.effectiveConfidence,
      bindingConstraint: "synthetic equation → 120 boxes", tradeoff: "synthetic tradeoff",
    }],
  };
}
const ALT_ID = "deepseek-v4-pro-oss·synthetic-alt·w4kv16";

describe("doc 06 selection — fail-closed focus resolution", () => {
  it("no selection → the ranked best; only the card set is selectable", () => {
    const n = nDefault();
    const f = resolveFocus(n, null);
    expect(f).toMatchObject({ active: false, suspended: false, isEngineBest: true });
    expect(f.evaluation!.config.id).toBe(B200);
    expect(selectableIds(n)).toEqual([B200]); // single eligible candidate today (doc 06 worked example)
  });
  it("selecting an eligible alternative activates it; selecting the best is active AND isEngineBest", () => {
    const n = twoEligible();
    expect(selectableIds(n)).toEqual([B200, ALT_ID]);
    const alt = resolveFocus(n, ALT_ID);
    expect(alt).toMatchObject({ active: true, suspended: false, isEngineBest: false });
    expect(alt.evaluation!.config.id).toBe(ALT_ID);
    expect(resolveFocus(n, B200)).toMatchObject({ active: true, isEngineBest: true });
  });
  it("rejected/ineligible/unknown ids can NEVER be focused — they suspend to the ranked best", () => {
    const n = nDefault();
    const heuristic = n.evaluations.find((e) => !e.recommendationEligible)!.config.id; // H100/H200 heuristic
    for (const id of [heuristic, "ghost·id·w4kv16"]) {
      const f = resolveFocus(n, id);
      expect(f).toMatchObject({ active: false, suspended: true, isEngineBest: true, selectedId: id });
      expect(f.evaluation!.config.id).toBe(B200); // fallback, never the ineligible id
    }
  });
});

describe("doc 06 INVARIANT — selection never changes the decision, comparator, hero or narrative", () => {
  it("focusing the synthetic alternative leaves every decision surface byte-identical", () => {
    const n = twoEligible();
    const before = JSON.stringify({ decision: n.decision, hero: heroLine(n), rationale: n.decision.rationale });
    const f = resolveFocus(n, ALT_ID);
    // resolution is pure — the structured result object is untouched
    const after = JSON.stringify({ decision: n.decision, hero: heroLine(n), rationale: n.decision.rationale });
    expect(after).toBe(before);
    // and the rendered decision block still shows the SAME hero/basis/rationale with the disclosure
    const html = renderToStaticMarkup(<DecisionSummary result={n} focus={f} />);
    expect(html).toMatch(/<h2[^>]*id="decision-heading"[^>]*>Lowest modeled cost: API<\/h2>/);
    expect(html).toContain("basis: lower-cost");
    // the narrated rationale verbatim (up to HTML entity escaping of the apostrophe)
    expect(html).toContain(n.decision.rationale.split("This compares the selected models")[0]);
    expect(html).toContain('data-testid="selection-disclosure"');
    expect(html).toContain("The decision above is unchanged: it derives from the cheapest comparison-qualified configuration");
    // the self-host COLUMN follows the focus, labeled as selected
    expect(html).toContain("Selected self-host — DeepSeek-V4-Pro (open weights)");
    expect(html).toContain("$9,000,000/mo");
  });
  it("selection changes journey state (Undo-unsafe) but NOT the engine inputs", () => {
    expect(advisorStatesEqual(DEFAULT_STATE, { ...DEFAULT_STATE, selectedCandidateId: B200 })).toBe(false);
    // the workload the engine sees is identical either way — selection is presentation-only
    expect(JSON.stringify(buildWorkload({ ...DEFAULT_STATE, selectedCandidateId: B200 }))).toBe(JSON.stringify(buildWorkload(DEFAULT_STATE)));
    const d = diffRecommendations(rDefault(), rDefault());
    expect(d.identical).toBe(true); // same structured result regardless of selection
  });
});

describe("doc 06 — the focus drives the self-host surfaces with explicit role wording", () => {
  it("BestSelfHostCard describes the selection ('customer-selected — not the optimization-ranked best')", () => {
    const n = twoEligible();
    const html = renderToStaticMarkup(<BestSelfHostCard result={n} focus={resolveFocus(n, ALT_ID)} onSelect={() => {}} />);
    expect(html).toContain("Your selected self-host option");
    expect(html).toContain("customer-selected — not the optimization-ranked best; the decision above is unchanged");
    expect(html).toContain("synthetic-alt · INT4");
    expect(html).toContain("120 box(es)");
    expect(html).toContain("synthetic equation → 120 boxes"); // ITS structured fleet equation
    expect(html).toContain('data-testid="selection-reset"');
  });
  it("a suspended selection is visibly flagged and the ranked best is shown", () => {
    const n = nDefault();
    const heuristic = n.evaluations.find((e) => !e.recommendationEligible)!.config.id;
    const html = renderToStaticMarkup(<BestSelfHostCard result={n} focus={resolveFocus(n, heuristic)} onSelect={() => {}} />);
    expect(html).toContain('data-testid="selection-suspended-note"');
    expect(html).toContain("not evidence-qualified under the current inputs — showing the recommended best");
    expect(html).toContain("Best self-host option"); // the fallback, normally labeled
  });
  it("alternatives carry Use this / Selected states + the decision-unchanged scope note; rejected options never do", () => {
    const n = twoEligible();
    const idle = renderToStaticMarkup(<AlternativeCards result={n} focus={resolveFocus(n, null)} onSelect={() => {}} />);
    expect(idle).toContain('data-testid="alt-use-lowest-cost"');
    expect(idle).toContain("the overall API-vs-self-host decision above is unchanged");
    const selected = renderToStaticMarkup(<AlternativeCards result={n} focus={resolveFocus(n, ALT_ID)} onSelect={() => {}} />);
    expect(selected).toContain('data-testid="alt-selected-lowest-cost"');
    expect(selected).not.toContain('data-testid="alt-use-lowest-cost"');
  });
  it("quota risk + range tracking follow the ACTIVE focus", () => {
    const n = twoEligible();
    expect(relevantEvaluation(n, ALT_ID)!.config.id).toBe(ALT_ID);
    const quota = riskLines(n, { focusId: ALT_ID }).find((l) => l.key === "quota-unverified")!;
    expect(quota.text).toContain("120 × synthetic-alt.48xlarge (B200)");
    // an INELIGIBLE focus id falls back to the ranked best (fail-closed)
    const heuristic = n.evaluations.find((e) => !e.recommendationEligible)!.config.id;
    expect(relevantEvaluation(n, heuristic)!.config.id).toBe(B200);
    // range tracking: with the real result (single eligible), focusing the best is a no-op band-wise
    const s = { ...DEFAULT_STATE, ranges: { volume: { low: 80_000_000, high: 480_000_000 } } };
    const withFocus = computeRanges(s, s.ranges, rDefault(), buildWorkload, B200)!;
    const without = computeRanges(s, s.ranges, rDefault(), buildWorkload)!;
    expect(JSON.stringify(withFocus)).toBe(JSON.stringify(without));
  });
  it("export: the approved §4 role lines are UNCHANGED; the customer selection is appended with its role", () => {
    const n = twoEligible();
    const md = buildReport(n, { focus: resolveFocus(n, ALT_ID) });
    expect(md).toContain("Recommended deployment: the Claude Fable 5 (Bedrock) API (managed service — no self-host fleet to provision).");
    expect(md).toContain("Best modeled self-host alternative — not the overall recommendation:");
    expect(md).toContain("Customer-selected self-host configuration — evidence-qualified, but not the optimization-ranked best; the overall recommendation above is unchanged:");
    expect(md).toContain("synthetic-alt.48xlarge (B200)");
    expect(md).toContain("$9,000,000/mo");
    expect(md.split("## 6. Risks & exclusions")[1]).toContain("120 × synthetic-alt.48xlarge (B200)"); // quota follows focus
    // no focus → byte-identical to the approved report
    expect(buildReport(n, { focus: resolveFocus(n, null) })).toBe(buildReport(n));
  });
});

describe("UI2-D3 — the complete technical audit, grouped result-level first then per candidate", () => {
  it("groups preserve every row and the deterministic order within each group", () => {
    const a = rDefault();
    const w = buildWorkload({ ...DEFAULT_STATE, ttftTargetMs: 1000, interactivityTarget: 50 });
    const b = recommend({ workload: w, optimizeFor: "cost" });
    const diff = diffRecommendations(a, b);
    const html = renderToStaticMarkup(<ChangesPanel diff={diff} />);
    expect(html).toContain(`View all ${diff.changes.length} technical changes`);
    const resultCount = diff.changes.filter((c) => !c.candidateId).length;
    expect(html).toContain(`Result-level (${resultCount})`);
    for (const id of new Set(diff.changes.map((c) => c.candidateId).filter(Boolean))) {
      const count = diff.changes.filter((c) => c.candidateId === id).length;
      expect(html).toContain(`data-testid="audit-group-${id}"`);
      expect(html).toContain(`${id} (${count})`);
    }
    // nothing dropped: every code chip renders as often as it appears
    const codes = html.match(/change-values/g) ?? [];
    expect(codes.length).toBe(diff.changes.length);
  });
});
