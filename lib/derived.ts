// ============================================================================
// derived — pure display-metric helpers computed on top of a CalcResult.
// No React, no I/O. Everything the results UI shows as a "number" is derived
// here so the labels can be verified against these formulas.
// ============================================================================

import type { CalcInputs, CalcResult, CostBreakdownLine } from "./types";

export interface TokenConstruction {
  query: number; // user query length
  retrievedContext: number; // topN * chunkSize (chunks sent to the LLM)
  promptOverhead: number; // system prompt + formatting tokens
  totalInput: number; // sum of the three above == perQuery.llmInputTok
  output: number; // generated answer tokens
  totalModel: number; // totalInput + output
}

export interface BreakdownRow {
  label: string;
  category: CostBreakdownLine["category"];
  monthly: number;
  share: number; // fraction of total (0..1)
}

export interface DisplayMetrics {
  totalMonthly: number;
  queries: number;
  hasTraffic: boolean; // queries > 0 — guards $0-per-query at zero traffic
  /** searchOCU is pinned at the min-OCU floor (RAM & load both below it). */
  vectorStoreFloored: boolean;
  /** Grand total ÷ queries — the honest "all-in" per-query cost. */
  costPerQuery: number;
  /** costPerQuery × 1000 — easier to compare than fractions of a cent. */
  costPer1000: number;
  annualized: number; // totalMonthly × 12

  /** LLM generation cost for a single query (input + output token spend). */
  generationPerQuery: number;

  monthlyLlmTokens: number; // input + output across the month
  monthlyInputTokens: number;
  monthlyOutputTokens: number;

  vectorStoreMonthly: number;
  opensearchFloor: number;
  /** Number of embedding vectors stored — corpus tokens ÷ effective chunk size. */
  numVectors: number;

  tokenConstruction: TokenConstruction;
  breakdown: BreakdownRow[];

  dominant: { label: string; monthly: number; share: number };

  /** Selected generation strategy — self-hosted bills the GPU fleet, not tokens. */
  selfHosted: boolean;
  /** Monthly generation cost for the ACTIVE mode (GPU fleet or API tokens). */
  generationMonthly: number;
}

/**
 * Everything the results view renders, derived from one mode's CalcResult and
 * the inputs that produced it. Pure: same inputs -> same numbers.
 */
export function deriveDisplayMetrics(result: CalcResult, inputs: CalcInputs): DisplayMetrics {
  const queries = inputs.traffic.queriesPerMonth;
  const total = result.totalMonthly$;
  const selfHosted = inputs.generation.mode === "self-hosted";

  const costPerQuery = queries > 0 ? total / queries : 0;

  // Active-mode generation cost: GPU fleet (self-hosted) or API tokens.
  const generationMonthly = selfHosted
    ? result.crossover.selfHostedMonthly$
    : result.perQuery.apiGen$ * queries;
  const generationPerQuery = queries > 0 ? generationMonthly / queries : 0;

  const monthlyInputTokens = result.perQuery.llmInputTok * queries;
  const monthlyOutputTokens = inputs.generation.outTokens * queries;

  const retrievedContext = inputs.retrieval.topN * inputs.chunking.chunkSize;
  const tokenConstruction: TokenConstruction = {
    query: inputs.queryTokens,
    retrievedContext,
    promptOverhead: inputs.generation.promptOverhead,
    totalInput: result.perQuery.llmInputTok,
    output: inputs.generation.outTokens,
    totalModel: result.perQuery.llmInputTok + inputs.generation.outTokens,
  };

  const breakdown: BreakdownRow[] = result.breakdown
    .map((line) => ({
      label: line.label,
      category: line.category,
      monthly: line.monthly$,
      share: total > 0 ? line.monthly$ / total : 0,
    }))
    .sort((a, b) => b.monthly - a.monthly);

  return {
    totalMonthly: total,
    queries,
    hasTraffic: queries > 0,
    vectorStoreFloored: result.vectorStore.searchOCU <= inputs.vectorStore.minOCU,
    costPerQuery,
    costPer1000: costPerQuery * 1000,
    annualized: total * 12,
    generationPerQuery,
    monthlyLlmTokens: result.crossover.monthlyGenTokens,
    monthlyInputTokens,
    monthlyOutputTokens,
    vectorStoreMonthly: result.vectorStore.opensearchMonthly$,
    opensearchFloor: result.vectorStore.opensearchFloor$,
    numVectors: result.ingestion.numVectors,
    tokenConstruction,
    breakdown,
    dominant: {
      label: result.dominantLever.label,
      monthly: result.dominantLever.monthly$,
      share: result.dominantLever.share,
    },
    selfHosted,
    generationMonthly,
  };
}
