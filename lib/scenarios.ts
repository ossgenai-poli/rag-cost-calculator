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

  const total = result.totalMonthly$;
  const generationMonthly = result.perQuery.apiGen$ * queries;
  const infraNonGen = total - generationMonthly; // traffic + vector store + ingestion, minus LLM

  const per1000 = (monthly: number) => (queries > 0 ? (monthly / queries) * 1000 : 0);
  const diffOf = (monthly: number) => (total > 0 ? (monthly - total) / total : 0);

  // --- Baseline: Self-built + API ---
  const baseline: Scenario = {
    id: "self-built-api",
    label: "Self-built + API",
    monthly: total,
    per1000: per1000(total),
    diffPct: 0,
    difference: "Baseline",
    note: "OpenSearch Serverless + Bedrock model API",
    complete: true,
    highlight: true,
  };

  // --- Bedrock Knowledge Bases + API — managed pricing not verifiable ---
  const bedrockKb: Scenario = {
    id: "bedrock-kb-api",
    label: "Bedrock KB + API",
    monthly: null,
    per1000: null,
    diffPct: null,
    difference: "Pricing unavailable",
    note: "Managed KB charges not included — published pricing unverified",
    complete: false,
    highlight: false,
  };

  const hasVolume = cx.monthlyGenTokens > 0 && cx.selfHostedMonthly$ > 0;
  const tokensPerQuery = result.perQuery.llmInputTok + inputs.generation.outTokens;

  // --- Self-built + self-hosted GPU (full stack: infra + GPU generation) ---
  const gpuMonthly = infraNonGen + cx.selfHostedMonthly$;
  const selfHostedGpu: Scenario = hasVolume
    ? {
        id: "self-built-gpu",
        label: "Self-built + GPU",
        monthly: gpuMonthly,
        per1000: per1000(gpuMonthly),
        diffPct: diffOf(gpuMonthly),
        difference: formatDiff(diffOf(gpuMonthly)),
        note: `${cx.boxes} × ${inputs.generation.gpuInstanceType} at ${Math.round(
          inputs.generation.utilTarget * 100
        )}% target util`,
        complete: true,
        highlight: true,
      }
    : {
        id: "self-built-gpu",
        label: "Self-built + GPU",
        monthly: null,
        per1000: null,
        diffPct: null,
        difference: "No generation volume",
        note: "Add traffic to project GPU economics",
        complete: false,
        highlight: false,
      };

  // --- GPU at break-even traffic (generation economics only) ---
  const breakEvenQueries = tokensPerQuery > 0 ? cx.breakEvenTokens / tokensPerQuery : 0;
  const breakEvenPer1000 = breakEvenQueries > 0 ? (cx.gpuMonthly$ / breakEvenQueries) * 1000 : null;
  const gpuBreakEven: Scenario = hasVolume
    ? {
        id: "gpu-break-even",
        label: "GPU at break-even traffic",
        monthly: cx.gpuMonthly$, // one box, fixed
        per1000: breakEvenPer1000,
        diffPct: null,
        difference: "Break-even",
        note: `One box fully fed at ${cx.breakEvenTokens >= 1e9 ? (cx.breakEvenTokens / 1e9).toFixed(1) + "B" : (cx.breakEvenTokens / 1e6).toFixed(0) + "M"} tokens/mo (~${cx.equivalentQPS.toFixed(2)} QPS)`,
        complete: true,
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
