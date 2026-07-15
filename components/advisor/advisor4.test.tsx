// Iteration-4 tests — level-6 "Risks & exclusions" (deterministic flag-driven checklist), level-3 cost
// framing (labeled presentation arithmetic), and the Stage-F deterministic export report reproducing
// the EXACT hierarchy order (10-result-hierarchy.md). No mocks — real recommend()/narrate().
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate } from "../../lib/recommendation";
import { riskLines } from "./risks";
import { buildReport } from "./report";
import { perQuery, DecisionSummary } from "./DecisionSummary";
import { RisksPanel } from "./RisksPanel";
import { ExportPanel } from "./ExportPanel";
import { buildWorkload, DEFAULT_STATE } from "../../app/advisor/page";

const nDefault = () => narrate(recommend({ workload: buildWorkload(DEFAULT_STATE), optimizeFor: "cost" }));
const nCostOpt = () =>
  narrate(recommend({ workload: buildWorkload({ ...DEFAULT_STATE, utilTargetPct: 85, purchasingModel: "savings-1yr" }), optimizeFor: "cost" }));
const keys = (r: ReturnType<typeof nDefault>) => riskLines(r).map((l) => l.key);

describe("risks & exclusions — deterministic checklist from ACTIVE structured flags (hierarchy §6)", () => {
  it("R1 default: the expected flags and ONLY those flags", () => {
    const r = nDefault();
    expect(keys(r)).toEqual([
      "planning-capacity", "n1-scope", "quota-unverified", "evidence-state", "ops-assumptions",
      "pinned-pricing", "cross-model",
    ]);
    const byKey = Object.fromEntries(riskLines(r).map((l) => [l.key, l.text]));
    expect(byKey["quota-unverified"]).toBe(
      "AWS quota and capacity availability for 87 × p6-b200.48xlarge (B200) are not verified by this calculator."
    );
    expect(byKey["evidence-state"]).toContain("Evidence is measured-scaled:");
    expect(byKey["n1-scope"]).toContain("serving-replica redundancy only");
  });
  it("flags follow the structured inputs: indicative purchasing, N+1 off, reduced hours", () => {
    expect(keys(nCostOpt())).toContain("indicative-purchasing");
    expect(keys(nDefault())).not.toContain("indicative-purchasing");
    const noHa = narrate(recommend({ workload: buildWorkload({ ...DEFAULT_STATE, haEnabled: false }), optimizeFor: "cost" }));
    expect(keys(noHa)).toContain("n1-off");
    expect(keys(noHa)).not.toContain("n1-scope");
    const bh = narrate(recommend({ workload: buildWorkload({ ...DEFAULT_STATE, uptimeHours: 220 }), optimizeFor: "cost" }));
    expect(keys(bh)).toContain("active-window");
    expect(keys(nDefault())).not.toContain("active-window");
  });
  it("API-only model: self-host capacity/architecture risks do NOT render (no invented risks)", () => {
    const r = narrate(recommend({ workload: buildWorkload({ ...DEFAULT_STATE, modelId: "claude-opus-4-8" }), optimizeFor: "cost" }));
    // Only the pricing-book line and the cross-model caveat (the API comparison model differs from the
    // selected workload model) — never capacity/quota/N+1 risks for a result with no self-host side.
    expect(keys(r)).toEqual(["pinned-pricing", "cross-model"]);
  });
  it("deterministic: identical input → byte-identical lines", () => {
    expect(JSON.stringify(riskLines(nDefault()))).toBe(JSON.stringify(riskLines(nDefault())));
  });
  it("RisksPanel renders every active line verbatim, keyed by flag", () => {
    const html = renderToStaticMarkup(<RisksPanel result={nDefault()} />);
    expect(html).toContain("Risks &amp; exclusions");
    for (const l of riskLines(nDefault())) {
      expect(html).toContain(`data-testid="risk-${l.key}"`);
    }
    expect(html).toContain("load-test the intended serving stack under production-shaped traffic");
  });
});

describe("level-3 cost framing — labeled presentation arithmetic over displayed structured values", () => {
  it("perQuery: 4-decimal rate; unavailable on missing/invalid inputs", () => {
    expect(perQuery(7_176_630, 200_000_000)).toBe("$0.0359/query");
    expect(perQuery(6_492_000, 200_000_000)).toBe("$0.0325/query");
    expect(perQuery(null, 200_000_000)).toBe("unavailable");
    expect(perQuery(100, 0)).toBe("unavailable");
  });
  it("DecisionSummary shows annual + per-query for both sides (R1)", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={nDefault()} />);
    expect(html).toContain("$77,904,000/yr"); // API 6,492,000 × 12
    expect(html).toContain("$0.0325/query");
    expect(html).toContain("$86,119,560/yr"); // self-host 7,176,630 × 12
    expect(html).toContain("$0.0359/query");
  });
});

describe("Stage-F export — deterministic report in the EXACT hierarchy order", () => {
  it("byte-identical for identical input; sections in fixed 1→7 order", () => {
    const a = buildReport(nDefault());
    const b = buildReport(nDefault());
    expect(a).toBe(b);
    const order = ["## 1. Recommendation", "## 2. Why", "## 3. Estimated cost", "## 4. Recommended architecture", "## 5. Confidence", "## 6. Risks & exclusions", "## 7. Advanced evidence"];
    let last = -1;
    for (const h of order) {
      const i = a.indexOf(h);
      expect(i, h).toBeGreaterThan(last);
      last = i;
    }
  });
  it("R1 content maps 1:1 to structured/narrated fields", () => {
    const r = nDefault();
    const md = buildReport(r);
    expect(md).toContain("**Lowest modeled cost: API** (basis: lower-cost)");
    expect(md).toContain(r.decision.rationale); // the why, verbatim
    expect(md).toContain("| API — Claude Fable 5 (Bedrock) | $6,492,000 | $77,904,000 | $0.0325/query |");
    expect(md).toContain("| Best self-host — DeepSeek-V4-Pro (open weights) | $7,176,630 | $86,119,560 | $0.0359/query |");
    const b200 = r.evaluations.find((e) => e.config.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!;
    expect(md).toContain(b200.fleet.equation); // the RELEVANT candidate's fleet equation, verbatim
    expect(md).toContain("87 boxes (prefill-bound)");
    expect(md).toContain("Evidence state: measured-scaled (engine: measured-scaled).");
    for (const l of riskLines(r)) expect(md).toContain(`- ${l.text}`); // §6 = the SAME shared lines
    expect(md).toContain("| deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16 | yes | yes | yes | 87 | $7,176,630 | measured-scaled |");
    expect(md).toContain("presentation arithmetic");
  });
  it("indicative case: the report carries the qualifier, the qualified narrative and the quote risk", () => {
    const md = buildReport(nCostOpt());
    expect(md).toContain("**Indicative modeled cost: Self-host**");
    expect(md).toContain("Under these assumptions, modeled self-host cost is lower");
    expect(md).toContain("obtain an AWS quote before committing");
    expect(md).toContain("savings-1yr purchasing ($113/hr on-demand base rate)");
  });
  it("API-only case: no self-host architecture is described; availability wording flows through", () => {
    const md = buildReport(narrate(recommend({ workload: buildWorkload({ ...DEFAULT_STATE, modelId: "claude-opus-4-8" }), optimizeFor: "cost" })));
    expect(md).toContain("No self-host configuration is described for this result.");
    expect(md).toContain("available through the API only");
    expect(md).not.toMatch(/technically\s+(in)?feasible/i);
  });
  it("ExportPanel previews the exact report and exposes copy/download controls", () => {
    const r = nDefault();
    const html = renderToStaticMarkup(<ExportPanel result={r} />);
    expect(html).toContain('data-testid="export-copy"');
    expect(html).toContain('data-testid="export-download"');
    expect(html).toContain("## 1. Recommendation"); // the preview is the real report
    expect(html).toContain("identical inputs produce an identical report");
  });
});
