// ============================================================================
// scenarios — the side-by-side generation-strategy comparison that is the
// calculator's central product experience. Derived purely from the Mode A
// (self-built) result + its crossover economics. A scenario is only marked
// `complete` when every number under it can be verified; otherwise it renders
// as "Pricing unavailable" rather than a misleading dollar figure.
// ============================================================================

import type { CalcInputs, CalcResult } from "./types";

export type ScenarioId =
  | "self-built-api"
  | "bedrock-kb-api"
  | "self-built-gpu"
  | "gpu-break-even";

export interface Scenario {
  id: ScenarioId;
  label: string;
  monthly: number | null; // null => incomplete / unavailable
  per1000: number | null;
  /** % difference of monthly vs the baseline scenario; null if not comparable. */
  diffPct: number | null;
  difference: string; // human tag: "Baseline", "+374%", "Pricing unavailable", "Break-even"
  note: string;
  complete: boolean;
  highlight: boolean; // safe to highlight (comparison is complete)
}

/**
 * Build the four canonical scenarios from the self-built (Mode A) result.
 * `result` MUST be the Mode A result so its crossover reflects real GPU
 * economics for the current inputs.
 */
export function buildScenarios(result: CalcResult, inputs: CalcInputs): Scenario[] {
  const queries = inputs.traffic.queriesPerMonth;
  const cx = result.crossover;
  const selfHostedMode = inputs.generation.mode === "self-hosted";

  // Compute infra + BOTH generation options from components, INDEPENDENT of the
  // selected mode — so "Self-built + API" is always the API cost and
  // "Self-built + GPU" is always the fleet cost, whatever mode is active.
  const infra =
    result.ingestion.embedIngestMonthly$ +
    result.vectorStore.opensearchMonthly$ +
    (result.perQuery.perQuery$ - result.perQuery.apiGen$) * queries;
  // Operations & overhead (networking + observability + overhead%) is a production
  // cost that applies to EVERY strategy — and the headline already includes it, so
  // each scenario must add its own share or the totals won't reconcile (P1-d). The
  // overhead % scales with that scenario's own base, so it's scenario-specific.
  const ops = inputs.ops;
  const opsOn = (base: number) =>
    base + ops.networkingMonthly$ + ops.observabilityMonthly$ + (ops.overheadPct / 100) * base;
  // "Self-built + API" uses the comparison model (defaults to the selected model).
  const apiGenMonthly = result.perQuery.apiComparisonGen$ * queries;
  const apiTotal = opsOn(infra + apiGenMonthly);

  const per1000 = (monthly: number) => (queries > 0 ? (monthly / queries) * 1000 : 0);
  const diffOf = (monthly: number) => (apiTotal > 0 ? (monthly - apiTotal) / apiTotal : 0);

  // --- Baseline: Self-built + API (the API comparison uses the selected model's hosted price) ---
  const baseline: Scenario = {
    id: "self-built-api",
    label: "Self-built + API",
    monthly: apiTotal,
    per1000: per1000(apiTotal),
    diffPct: 0,
    difference: "Baseline",
    note: "OpenSearch Serverless + selected model via hosted API",
    complete: true,
    highlight: !selfHostedMode, // highlighted when it's the selected scenario
  };

  // --- Bedrock Knowledge Bases + API — now priced from AWS's published rates ---
  const mkbTotal = opsOn(result.managedKb.total$);
  const bedrockKb: Scenario = {
    id: "bedrock-kb-api",
    label: "Bedrock KB + API",
    monthly: mkbTotal,
    per1000: per1000(mkbTotal),
    diffPct: diffOf(mkbTotal),
    difference: formatDiff(diffOf(mkbTotal)),
    note: `${inputs.managedKb.retrievalMode} retrieval + managed parsing/embed/rerank (incl.) + LLM`,
    complete: true,
    highlight: false,
  };

  // Gate on real generation volume and a real box cost — not on selfHostedMonthly$,
  // which the crossover zeroes for $0-priced models even when there IS volume.
  const hasVolume = cx.monthlyGenTokens > 0 && cx.gpuMonthly$ > 0;
  const tokensPerQuery = result.perQuery.llmInputTok + inputs.generation.outTokens;
  // One box minimum when there's volume but the crossover returned the zero result.
  // cx.boxes is already AUTO-SIZED to serve the load, so this fleet cost is feasible
  // — never the cheaper-but-inadequate figure from an under-provisioned fleet (P1-a).
  const selfHostedMonthly = cx.selfHostedMonthly$ > 0 ? cx.selfHostedMonthly$ : cx.gpuMonthly$;
  const sizingNote = cx.autoSized
    ? ` (auto-sized from ${cx.userInstances} to serve the load)`
    : "";

  // --- Self-built + self-hosted GPU (full stack: infra + GPU fleet) ---
  const gpuTotal = opsOn(infra + selfHostedMonthly);
  const selfHostedGpu: Scenario = !hasVolume
    ? {
        id: "self-built-gpu",
        label: "Self-built + GPU",
        monthly: null,
        per1000: null,
        diffPct: null,
        difference: "No generation volume",
        note: "Add traffic to project GPU economics",
        complete: false,
        highlight: false,
      }
    : !cx.feasible
      ? {
          // Auto-size is OFF and the entered fleet can't serve the load — suppress
          // the cost/savings rather than show an inadequate fleet as a valid option.
          id: "self-built-gpu",
          label: "Self-built + GPU",
          monthly: null,
          per1000: null,
          diffPct: null,
          difference: "Infeasible",
          note: `${cx.boxes} × ${inputs.generation.gpuInstanceType} can't serve this load — needs ≥ ${cx.requiredInstances}. Raise instances or enable auto-size.`,
          complete: false,
          highlight: selfHostedMode,
        }
      : {
          id: "self-built-gpu",
          label: "Self-built + GPU",
          monthly: gpuTotal,
          per1000: per1000(gpuTotal),
          diffPct: diffOf(gpuTotal),
          difference: formatDiff(diffOf(gpuTotal)),
          note: `${cx.boxes} × ${inputs.generation.gpuInstanceType} at ${Math.round(
            inputs.generation.utilTarget * 100
          )}% target util${sizingNote}`,
          complete: true,
          highlight: selfHostedMode, // highlighted when it's the selected scenario
        };

  // --- GPU at break-even traffic (the provisioned fleet's own break-even) ---
  const breakEvenQueries = tokensPerQuery > 0 ? cx.breakEvenTokens / tokensPerQuery : 0;
  const breakEvenFleet = opsOn(cx.selfHostedMonthly$); // production cost incl. ops, consistent with the others
  const breakEvenPer1000 =
    breakEvenQueries > 0 ? (breakEvenFleet / breakEvenQueries) * 1000 : null;
  const tokFmt = (t: number) =>
    t >= 1e9 ? `${(t / 1e9).toFixed(1)}B` : `${(t / 1e6).toFixed(0)}M`;
  const gpuBreakEven: Scenario = hasVolume
    ? {
        id: "gpu-break-even",
        label: "GPU at break-even traffic",
        // The fleet cost is fixed; per-1k is what it would be at break-even volume.
        monthly: breakEvenFleet,
        per1000: cx.breakEvenFeasible ? breakEvenPer1000 : null,
        diffPct: null,
        difference: cx.breakEvenFeasible ? "Break-even" : "Not achievable",
        note: cx.breakEvenFeasible
          ? `${cx.boxes}-instance fleet breaks even at ${tokFmt(cx.breakEvenTokens)} tokens/mo (~${cx.equivalentQPS.toFixed(2)} QPS)`
          : `Break-even (${tokFmt(cx.breakEvenTokens)} tok/mo) exceeds the ${cx.boxes}-instance fleet's decode capacity`,
        complete: cx.breakEvenFeasible,
        highlight: false, // informational reference, not a recommendation
      }
    : {
        id: "gpu-break-even",
        label: "GPU at break-even traffic",
        monthly: null,
        per1000: null,
        diffPct: null,
        difference: "—",
        note: "Add traffic to project break-even",
        complete: false,
        highlight: false,
      };

  return [baseline, bedrockKb, selfHostedGpu, gpuBreakEven];
}

function formatDiff(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
