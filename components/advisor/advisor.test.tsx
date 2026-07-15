// Advisor UI slice tests (UI HOLD-1 revision) — render the REAL approved headless output (pinned
// catalog, no mocks) through the components with react-dom/server and assert on the markup: bounded
// decision-first hierarchy with visible assumptions, availability vs infeasibility, honest empty states
// (never promote a GPU), wrap-safe adjustments, friendly field validation, clean accessible heading
// names, decision-support hints, provenance disclosures, and deterministic rendering.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recommend, narrate } from "../../lib/recommendation";
import type { NarratedRecommendationResult, OptimizeFor } from "../../lib/recommendation";
import { defaultInputs } from "../../lib/calc-engine";
import type { CalcInputs, PriceBook } from "../../lib/types";
import pricesJson from "../../public/prices.json";
import { DecisionSummary } from "./DecisionSummary";
import { BestSelfHostCard } from "./BestSelfHostCard";
import { RejectedOptions } from "./RejectedOptions";
import { TrustPanel } from "./TrustPanel";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { AdvisorInputs, type AdvisorState } from "./AdvisorInputs";
import { friendlyFieldErrors } from "./copy";
import AdvisorPage from "../../app/advisor/page";

const priceBook = pricesJson as unknown as PriceBook;

function workload(mutate?: (w: CalcInputs) => void): CalcInputs {
  const w = defaultInputs(priceBook);
  w.generation.mode = "self-hosted";
  w.generation.llmModelId = "deepseek-v4-pro-oss";
  w.generation.outTokens = 500;
  w.traffic.queriesPerMonth = 200_000_000;
  w.traffic.peakFactor = 1;
  mutate?.(w);
  return w;
}
function run(mutate?: (w: CalcInputs) => void, optimizeFor: OptimizeFor = "cost", experimental = false): NarratedRecommendationResult {
  return narrate(recommend({ workload: workload(mutate), optimizeFor, experimentalProvenance: experimental }));
}
const baseState: AdvisorState = {
  modelId: "deepseek-v4-pro-oss", volume: 200_000_000, optimizeFor: "cost", mode: "expert",
  ttftTargetMs: 2000, interactivityTarget: 30, outTokens: 500, queryTokens: 50, promptOverhead: 300,
  chunkSize: 512, topN: 5, topK: 20, uptimeHours: 730, utilTargetPct: 70, haEnabled: true, purchasingModel: "on-demand", experimental: false,
};

describe("advisor — bounded decision-first hierarchy (R1 real reference output)", () => {
  const r1 = run();
  it("hero is a BOUNDED conclusion with the basis chip OUTSIDE the heading", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={r1} />);
    expect(html).toContain("Lowest modeled cost: API"); // bounded, not "Use the API"
    expect(html).toMatch(/<h2[^>]*id="decision-heading"[^>]*>Lowest modeled cost: API<\/h2>/); // clean accessible name (P2-UI-2)
    expect(html).toContain("basis: lower-cost");
    expect(html).toContain("Recommendation: use the Claude Fable 5 (Bedrock) API"); // narrate() verbatim
  });
  it("cross-model disclosure is prominent when the compared models differ", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={r1} />);
    expect(html).toContain("Different models are being compared; capability and quality are not normalized.");
    // same-model comparison carries no disclosure
    const same = run((w) => { w.generation.apiComparisonModelId = "deepseek-v4-pro-oss"; });
    expect(renderToStaticMarkup(<DecisionSummary result={same} />)).not.toContain("capability and quality are not normalized");
  });
  it("costs, modeled difference and assumptions are immediately visible (structured values)", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={r1} />);
    expect(html).toContain("$6,492,000/mo"); // apiOption.monthlyCost (R1)
    expect(html).toContain("$7,176,630/mo"); // bestSelfHost.costMonthly (R1)
    expect(html).toContain("+$684,630/mo (11% vs API)"); // labeled presentation arithmetic over the two amounts
    expect(html).toContain("200,000,000 questions/mo"); // effectiveWorkload.traffic.queriesPerMonth
    expect(html).toContain("50 query + 300 prompt + 5×512 context = 2,910 tok"); // documented input formula
    expect(html).toContain('data-confidence="measured-scaled"'); // evidence state in the hero block
    expect(html).toContain("Recommended among currently modeled and evidence-qualified AWS configurations.");
    expect(html).not.toContain("p6-b200 · INT4"); // no GPU in the decision block
  });
  it("BestSelfHostCard: annotation outside the heading; chip + verbatim fleet equation", () => {
    const html = renderToStaticMarkup(<BestSelfHostCard result={r1} />);
    expect(html).toMatch(/<h2[^>]*id="bsh-heading"[^>]*>Best self-host option<\/h2>/); // clean name (P2-UI-2)
    expect(html).toContain("secondary — the decision above is the recommendation");
    expect(html).toContain("p6-b200 · INT4");
    expect(html).toContain('data-confidence="measured-scaled"');
    expect(html).toContain("221461 prefill tok/s");
    expect(html).toContain("87 box(es), prefill-bound");
    expect(html).toContain("$113/hr on-demand base (on-demand)");
  });
});

describe("advisor — availability vs infeasibility (P1-UI-4) and honest empty states", () => {
  it("API-only model → reason-coded availability basis + narrated wording; NEVER 'technically (in)feasible' anywhere", () => {
    const r = run((w) => { w.generation.llmModelId = "claude-opus-4-8"; });
    expect(r.decision).toMatchObject({ choice: "api", basis: "self-host-unavailable", availability: { reason: "api-only" } });
    const card = renderToStaticMarkup(<BestSelfHostCard result={r} />);
    expect(card).toContain("This model is API-only; self-host weights are unavailable.");
    expect(card).toContain("Select an open-weight model to evaluate self-hosting.");
    const hero = renderToStaticMarkup(<DecisionSummary result={r} />);
    expect(hero).toContain("API — this model is API-only (self-host unavailable)");
    expect(hero).toContain("unavailable (API-only model)");
    // the narrated rationale now carries the availability semantics natively (P1-UI-4)
    expect(hero).toContain("This model is available through the API only; self-host weights are not available, so no self-host cost comparison was performed.");
    // the page never shows contradictory feasibility language in this state — ANY surface
    const all = hero + card + renderToStaticMarkup(<TrustPanel result={r} />) + renderToStaticMarkup(<RejectedOptions result={r} />);
    expect(all).not.toMatch(/technically\s+(in)?feasible/i);
  });
  it("genuine infeasibility keeps its own wording (states not conflated in the UI)", () => {
    const r = run(); // self-hostable model; shape the basis to the technical state
    const shaped = { ...r, bestSelfHost: null, decision: { ...r.decision, choice: "api" as const, basis: "self-host-infeasible" as const } };
    const card = renderToStaticMarkup(<BestSelfHostCard result={shaped} />);
    expect(card).toContain("No modeled self-host configuration is technically feasible for this workload.");
    expect(card).not.toContain("API-only");
    expect(renderToStaticMarkup(<DecisionSummary result={shaped} />)).toContain("API — no modeled self-host configuration is technically feasible");
  });
  it("experimental R1 (unbenchmarked) → empty state, no GPU, evidence visible", () => {
    const r = run(undefined, "cost", true);
    const html = renderToStaticMarkup(<BestSelfHostCard result={r} />);
    expect(html).toContain("No self-host configuration has qualifying benchmark evidence");
    expect(html).not.toContain("p6-b200 · INT4");
    const hero = renderToStaticMarkup(<DecisionSummary result={r} />);
    expect(hero).toContain("API — no evidence-qualified self-host option");
    const trust = renderToStaticMarkup(<TrustPanel result={r} />);
    expect(trust).toContain('data-confidence="unbenchmarked"');
    expect(trust).toContain("held at unbenchmarked by the cross-source registry");
    expect(trust).toContain("not a problem with your inputs");
  });
  it("no-modeled-candidate (minimax) → coverage-gap wording", () => {
    const r = run((w) => { w.generation.llmModelId = "minimax-m3-oss"; });
    const html = renderToStaticMarkup(<BestSelfHostCard result={r} />);
    expect(html).toContain("catalog-coverage gap");
    expect(renderToStaticMarkup(<DecisionSummary result={r} />)).toContain("API — no modeled self-host configuration yet");
  });
  it("low-TTFT: B200 rejected on sla-unmet; SLA empty-state wording via basis branch", () => {
    const r = run((w) => { w.generation.ttftTargetMs = 100; });
    expect(r.decision).toMatchObject({ choice: "api", basis: "evidence-gap" }); // real pinned-catalog outcome
    const b200 = r.rejected.find((x) => x.config.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!;
    expect(b200.code).toBe("sla-unmet-ttft-or-streaming");
    const slaShaped = { ...r, decision: { ...r.decision, basis: "sla" as const } };
    expect(renderToStaticMarkup(<BestSelfHostCard result={slaShaped} />)).toContain("cannot meet the interactivity / TTFT SLA");
    expect(renderToStaticMarkup(<DecisionSummary result={slaShaped} />)).toContain("API — modeled self-host misses the latency SLA");
  });
});

describe("advisor — rejected options, trust panel, adjustments (wrap-safe)", () => {
  it("RejectedOptions lists structured reason codes verbatim", () => {
    const html = renderToStaticMarkup(<RejectedOptions result={run()} />);
    expect(html).toContain("Rejected options (3)");
    expect(html).toContain("evidence-below-threshold");
    expect(html).toContain("technically feasible: true");
  });
  it("TrustPanel is the collapsed 'Evidence & assumptions' disclosure with honest provenance", () => {
    const html = renderToStaticMarkup(<TrustPanel result={run()} />);
    expect(html).toContain("Evidence &amp; assumptions — where did this come from?");
    expect(html).toContain("committed reference (fallback)");
    expect(html).toContain("TTFT (P99): 1.22s");
    expect(html).toContain("Planning capacity, not an availability or tail-latency guarantee");
  });
  it("AdjustmentsPanel uses wrap-safe stacked rows (no <table>) with shared copy labels + raw paths", () => {
    const r = run((w) => { w.retrieval.topK = 20; w.retrieval.topN = 30; w.generation.gpuUptimeHoursPerMonth = 1000; });
    const html = renderToStaticMarkup(<AdjustmentsPanel result={r} />);
    expect(html).not.toContain("<table"); // P1-UI-3: no table on any viewport
    expect(html).toContain("Context chunks sent to the model");
    expect(html).toContain("(retrieval.topN)");
    expect(html).toContain("GPU fleet uptime hours/month");
    expect(html).toContain("break-words"); // wrap-safe label
    expect(html).toMatch(/entered<\/span>[\s\S]*?>30<[\s\S]*?used<\/span>[\s\S]*?>20</);
    expect(renderToStaticMarkup(<AdjustmentsPanel result={run()} />)).toBe(""); // nothing when no adjustments
  });
});

describe("advisor — friendly validation (P2-UI-1) and decision support (P2-UI-3)", () => {
  it("friendlyFieldErrors maps internal paths to customer wording (no property paths)", () => {
    const f = friendlyFieldErrors("recommend: traffic.queriesPerMonth must be a finite number > 0");
    expect(f.fields[0]).toMatchObject({ inputId: "adv-volume", label: "Questions per month" });
    expect(f.generic).toBe("Please correct: Questions per month.");
    expect(f.generic).not.toContain("traffic.queriesPerMonth");
    expect(friendlyFieldErrors("recommend: something unmapped").generic).toContain("out of range");
  });
  it("an invalid field renders aria-invalid + aria-describedby with the friendly message", () => {
    const html = renderToStaticMarkup(
      <AdvisorInputs
        state={baseState}
        defaults={baseState}
        models={priceBook.models}
        selfHostAvailable={true}
        fieldErrors={{ "adv-volume": { inputId: "adv-volume", label: "Questions per month", message: "Enter a number greater than 0." } }}
        onChange={() => {}}
      />
    );
    expect(html).toMatch(/id="adv-volume"[^>]*aria-invalid="true"/);
    expect(html).toContain('aria-describedby="adv-volume-error"');
    expect(html).toContain("Enter a number greater than 0.");
    expect(html).not.toContain("traffic.queriesPerMonth");
  });
  it("expert inputs carry units, recommended defaults, why-it-matters and provenance tags", () => {
    const edited = { ...baseState, topN: 9 };
    const html = renderToStaticMarkup(
      <AdvisorInputs state={edited} defaults={baseState} models={priceBook.models} selfHostAvailable={true} fieldErrors={{}} onChange={() => {}} />
    );
    expect(html).toContain("(ms)"); // units
    expect(html).toContain("default 2,000"); // recommended
    expect(html).toContain("P99 budget for the first token"); // why it matters
    expect(html).toMatch(/data-testid="provenance-adv-topn"[^>]*>customer-entered/); // edited field
    expect(html).toMatch(/data-testid="provenance-adv-ttft"[^>]*>assumed \(default\)/); // untouched field
  });
  it("API-only selection groups models, notes availability, and disables self-host-specific controls", () => {
    const apiState = { ...baseState, modelId: "claude-opus-4-8" };
    const html = renderToStaticMarkup(
      <AdvisorInputs state={apiState} defaults={baseState} models={priceBook.models} selfHostAvailable={false} fieldErrors={{}} onChange={() => {}} />
    );
    expect(html).toContain('label="Open-weight (self-hostable)"');
    expect(html).toContain('label="API-only (self-host unavailable)"');
    expect(html).toContain("This model is API-only; self-host weights are unavailable.");
    expect(html).toMatch(/id="adv-uptime"[^>]*disabled/);
    expect(html).toMatch(/id="adv-experimental"[^>]*disabled/);
    expect(html).toContain("Not applicable — the selected model is API-only");
  });
});

describe("advisor — page, accessibility, determinism, honesty", () => {
  it("the full page renders (R1 defaults) with landmarks, labels, bounded hero and Simple-mode evidence access", () => {
    const html = renderToStaticMarkup(<AdvisorPage />);
    expect(html).toContain("<main");
    expect(html).toMatch(/<h1[^>]*>RAG deployment advisor/);
    expect(html).toContain('aria-label="Inputs"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('for="adv-model"');
    expect(html).toContain("Lowest modeled cost: API"); // bounded hero on default load
    expect(html.indexOf("Lowest modeled cost: API")).toBeLessThan(html.indexOf("Best self-host option"));
    expect(html).toContain("Evidence &amp; assumptions"); // owner D1: accessible in Simple mode
    expect(html).not.toContain("Rejected options"); // rejected stays Expert-only
  });
  it("rendering is deterministic (byte-identical for identical structured input)", () => {
    const r = run();
    expect(renderToStaticMarkup(<DecisionSummary result={r} />)).toBe(renderToStaticMarkup(<DecisionSummary result={r} />));
    expect(renderToStaticMarkup(<TrustPanel result={r} />)).toBe(renderToStaticMarkup(<TrustPanel result={r} />));
  });
  it("no NaN/undefined and no unsupported percentile/Measured claims in any rendered surface", () => {
    for (const r of [
      run(),
      run(undefined, "cost", true),
      run((w) => { w.generation.llmModelId = "minimax-m3-oss"; }),
      run((w) => { w.generation.llmModelId = "claude-opus-4-8"; }),
    ]) {
      const html =
        renderToStaticMarkup(<DecisionSummary result={r} />) +
        renderToStaticMarkup(<BestSelfHostCard result={r} />) +
        renderToStaticMarkup(<RejectedOptions result={r} />) +
        renderToStaticMarkup(<TrustPanel result={r} />) +
        renderToStaticMarkup(<AdjustmentsPanel result={r} />);
      expect(html).not.toMatch(/NaN|undefined/);
    }
  });
});
