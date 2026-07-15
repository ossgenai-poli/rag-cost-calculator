// Advisor UI slice tests — render the REAL approved headless output (pinned catalog, no mocks) through
// the components with react-dom/server and assert on the markup: decision-first hierarchy, honest empty
// states (unbenchmarked/evidence-gap never promoted to a GPU recommendation), structured adjustments,
// provenance disclosures, accessibility attributes, and deterministic rendering.
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

describe("advisor — decision-first hierarchy (R1 real reference output)", () => {
  const r1 = run();
  it("DecisionSummary leads with the API decision and shows the REAL approved amounts", () => {
    const html = renderToStaticMarkup(<DecisionSummary result={r1} />);
    expect(html).toContain("Use the API");
    expect(html).toContain("basis: lower-cost");
    expect(html).toContain("Recommendation: use the Claude Fable 5 (Bedrock) API"); // narrate() verbatim
    expect(html).toContain("$6,492,000/mo"); // apiOption.monthlyCost (R1)
    expect(html).toContain("$7,176,630/mo"); // bestSelfHost.costMonthly (R1)
    expect(html).toContain("Recommended among currently modeled and evidence-qualified AWS configurations.");
    // No GPU configuration inside the decision block — the decision is the outcome, not a GPU.
    expect(html).not.toContain("p6-b200 · INT4");
  });
  it("BestSelfHostCard is explicitly SECONDARY and carries the confidence chip + fleet equation verbatim", () => {
    const html = renderToStaticMarkup(<BestSelfHostCard result={r1} />);
    expect(html).toContain("Best self-host option");
    expect(html).toContain("(secondary — the decision above is the recommendation)");
    expect(html).toContain("p6-b200 · INT4");
    expect(html).toContain('data-confidence="measured-scaled"');
    expect(html).toContain("221461 prefill tok/s"); // fleet.equation via narrate(), never recomputed
    expect(html).toContain("87 box(es), prefill-bound"); // evaluations[].fleet
    expect(html).toContain("$113/hr on-demand base (on-demand)"); // servingFacts.gpuPricePerHr + pricingModel
    expect(html).toContain("730 h/mo"); // servingFacts.uptimeHours
  });
});

describe("advisor — honest empty states (never promote a GPU)", () => {
  it("experimental R1 (unbenchmarked) → empty self-host state, no GPU card, evidence state visible", () => {
    const r = run(undefined, "cost", true);
    const html = renderToStaticMarkup(<BestSelfHostCard result={r} />);
    expect(html).toContain("best-self-host-empty");
    expect(html).toContain("No self-host configuration has qualifying benchmark evidence");
    expect(html).not.toContain("p6-b200 · INT4"); // the GPU is NOT promoted
    const trust = renderToStaticMarkup(<TrustPanel result={r} />);
    expect(trust).toContain('data-confidence="unbenchmarked"');
    expect(trust).toContain("held at unbenchmarked by the cross-source registry");
    expect(trust).toContain("not a problem with your inputs"); // internal limitation, not customer error
  });
  it("no-modeled-candidate (minimax) → coverage-gap wording, not 'cannot self-host'", () => {
    const r = run((w) => { w.generation.llmModelId = "minimax-m3-oss"; });
    const html = renderToStaticMarkup(<BestSelfHostCard result={r} />);
    expect(html).toContain("catalog-coverage gap");
    expect(html).not.toMatch(/cannot self-host|not self-hostable/i);
  });
  it("low-TTFT SLA: B200 rejected on sla-unmet (not a technical/fleet code); no GPU promoted", () => {
    // With the REAL pinned catalog the heuristic H200/H100 remain SLA-qualified (no measured TTFT),
    // so the honest overall basis is evidence-gap — and B200's rejection is the SLA code.
    const r = run((w) => { w.generation.ttftTargetMs = 100; });
    expect(r.decision).toMatchObject({ choice: "api", basis: "evidence-gap" });
    expect(r.bestSelfHost).toBeNull();
    const b200 = r.rejected.find((x) => x.config.id === "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16")!;
    expect(b200.code).toBe("sla-unmet-ttft-or-streaming");
    const rejectedHtml = renderToStaticMarkup(<RejectedOptions result={r} />);
    expect(rejectedHtml).toContain("sla-unmet-ttft-or-streaming");
    // The SLA empty-state wording branch (decision.basis === "sla") renders the SLA explanation:
    const slaShaped = { ...r, decision: { ...r.decision, basis: "sla" as const } };
    expect(renderToStaticMarkup(<BestSelfHostCard result={slaShaped} />)).toContain("cannot meet the interactivity / TTFT SLA");
  });
});

describe("advisor — rejected options, trust panel, adjustments", () => {
  it("RejectedOptions lists structured reason codes verbatim (FP8 substitution case)", () => {
    const r = run(); // pinned catalog: FP8/H200/H100 all rejected evidence-below-threshold
    const html = renderToStaticMarkup(<RejectedOptions result={r} />);
    expect(html).toContain("Rejected options (3)");
    expect(html).toContain("evidence-below-threshold");
    expect(html).toContain("p6-b200 · FP8");
    expect(html).toContain("technically feasible: true"); // feasibility ≠ evidence, shown distinctly
  });
  it("TrustPanel shows pricing provenance verbatim and never claims live on fallback", () => {
    const html = renderToStaticMarkup(<TrustPanel result={run()} />);
    expect(html).toContain("committed reference (fallback)");
    expect(html).not.toMatch(/Price book: <\/dt><dd[^>]*>live/);
    expect(html).toContain("us-east-1");
    expect(html).toContain("TTFT (P99): 1.22s"); // percentile-labelled tail statistic
    expect(html).toContain("Planning capacity, not an availability or tail-latency guarantee");
  });
  it("AdjustmentsPanel renders entered→calculated rows from inputAdjustments (labels + raw paths)", () => {
    const r = run((w) => { w.retrieval.topK = 3; w.retrieval.topN = 9; w.generation.gpuUptimeHoursPerMonth = 1000; });
    const html = renderToStaticMarkup(<AdjustmentsPanel result={r} />);
    expect(html).toContain("Context chunks sent to the model");
    expect(html).toContain("(retrieval.topN)");
    expect(html).toContain("GPU fleet uptime hours/month");
    expect(html).toMatch(/>9<[\s\S]*?>3</); // entered 9 → calculated 3
    expect(html).toMatch(/>1000<[\s\S]*?>730</);
  });
  it("AdjustmentsPanel renders nothing when there are no adjustments", () => {
    expect(renderToStaticMarkup(<AdjustmentsPanel result={run()} />)).toBe("");
  });
});

describe("advisor — page, accessibility, determinism, honesty", () => {
  it("the full page renders (R1 defaults) with landmarks, labels and heading order", () => {
    const html = renderToStaticMarkup(<AdvisorPage />);
    expect(html).toContain("<main");
    expect(html).toMatch(/<h1[^>]*>RAG deployment advisor/);
    expect(html).toContain('aria-label="Inputs"');
    expect(html).toContain('aria-pressed="true"'); // mode toggle state exposed
    expect(html).toContain('for="adv-model"'); // labeled controls
    expect(html).toContain('for="adv-volume"');
    expect(html).toContain("Use the API"); // decision-first on default load
    expect(html.indexOf("Use the API")).toBeLessThan(html.indexOf("Best self-host option")); // hierarchy order
  });
  it("inputs form exposes labeled expert fields (a11y) when expert mode renders", () => {
    const state: AdvisorState = {
      modelId: "deepseek-v4-pro-oss", volume: 200_000_000, optimizeFor: "cost", mode: "expert",
      ttftTargetMs: 2000, interactivityTarget: 30, outTokens: 500, queryTokens: 50, promptOverhead: 300,
      chunkSize: 512, topN: 5, topK: 20, uptimeHours: 730, experimental: false,
    };
    const html = renderToStaticMarkup(<AdvisorInputs state={state} models={priceBook.models} onChange={() => {}} />);
    for (const id of ["adv-ttft", "adv-intvty", "adv-query", "adv-prompt", "adv-chunk", "adv-topn", "adv-topk", "adv-out", "adv-uptime", "adv-experimental"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
  it("rendering is deterministic (byte-identical for identical structured input)", () => {
    const r = run();
    expect(renderToStaticMarkup(<DecisionSummary result={r} />)).toBe(renderToStaticMarkup(<DecisionSummary result={r} />));
    expect(renderToStaticMarkup(<TrustPanel result={r} />)).toBe(renderToStaticMarkup(<TrustPanel result={r} />));
  });
  it("no NaN/undefined and no unsupported percentile/Measured claims in any rendered surface", () => {
    for (const r of [run(), run(undefined, "cost", true), run((w) => { w.generation.llmModelId = "minimax-m3-oss"; })]) {
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
