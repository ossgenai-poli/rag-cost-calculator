// ============================================================================
// sensitivity — ranks how much each lever actually moves the total, by
// perturbing one input at a time (+10%) and re-running the engine. This makes
// the "why didn't the total change?" question answerable: some levers barely
// move a generation-dominated cost, and this shows exactly which ones do.
// ============================================================================

import { calculate, INPUT_MAXIMA } from "./calc-engine";
import type { CalcInputs, PriceBook } from "./types";

export interface SensitivityRow {
  label: string;
  /** Fractional change in total for a +10% bump to this lever. 0 when atCap. */
  deltaPct: number;
  /** P2-1: the lever is at its supported maximum, so a +10% bump can't be applied —
   * the measured delta would be a FALSE 0%. Show "at cap", not a percentage. */
  atCap?: boolean;
}

const BUMP = 1.1; // +10%

export function computeSensitivity(inputs: CalcInputs, priceBook: PriceBook): SensitivityRow[] {
  const base = calculate({ ...inputs, ragMode: "A" }, priceBook).totalMonthly$;
  if (!(base > 0)) return [];

  // A lever is "at cap" if bumping it +10% would exceed the input maximum — the
  // engine clamps it back, so we must NOT report the resulting 0% as its response.
  const measure = (
    label: string,
    mutated: CalcInputs,
    bumpedValue?: number,
    cap?: number
  ): SensitivityRow => {
    const atCap = cap != null && bumpedValue != null && bumpedValue > cap;
    if (atCap) return { label, deltaPct: 0, atCap: true };
    const t = calculate({ ...mutated, ragMode: "A" }, priceBook).totalMonthly$;
    return { label, deltaPct: (t - base) / base };
  };

  const rows: SensitivityRow[] = [
    measure(
      "Queries / month",
      { ...inputs, traffic: { ...inputs.traffic, queriesPerMonth: inputs.traffic.queriesPerMonth * BUMP } },
      inputs.traffic.queriesPerMonth * BUMP,
      INPUT_MAXIMA.queriesPerMonth
    ),
    measure(
      "Output length",
      { ...inputs, generation: { ...inputs.generation, outTokens: inputs.generation.outTokens * BUMP } },
      inputs.generation.outTokens * BUMP,
      INPUT_MAXIMA.outTokens
    ),
    measure("Chunks sent to the LLM", {
      ...inputs,
      retrieval: { ...inputs.retrieval, topN: inputs.retrieval.topN * BUMP },
    }),
    measure("Chunk size", {
      ...inputs,
      chunking: { ...inputs.chunking, chunkSize: inputs.chunking.chunkSize * BUMP },
    }),
    measure(
      "System prompt tokens",
      { ...inputs, generation: { ...inputs.generation, promptOverhead: inputs.generation.promptOverhead * BUMP } },
      inputs.generation.promptOverhead * BUMP,
      INPUT_MAXIMA.promptOverhead
    ),
    measure(
      "Number of documents",
      { ...inputs, corpus: { ...inputs.corpus, numDocs: inputs.corpus.numDocs * BUMP } },
      inputs.corpus.numDocs * BUMP,
      INPUT_MAXIMA.numDocs
    ),
    measure(
      "User query length",
      { ...inputs, queryTokens: inputs.queryTokens * BUMP },
      inputs.queryTokens * BUMP,
      INPUT_MAXIMA.queryTokens
    ),
  ];

  // Rank by measured magnitude; capped levers sink to the bottom (unknown upward
  // response) but stay visible with their "at cap" label.
  return rows.sort((a, b) => {
    if (!!a.atCap !== !!b.atCap) return a.atCap ? 1 : -1;
    return Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
  });
}
