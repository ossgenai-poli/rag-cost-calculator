// ============================================================================
// sensitivity — ranks how much each lever actually moves the total, by
// perturbing one input at a time (+10%) and re-running the engine. This makes
// the "why didn't the total change?" question answerable: some levers barely
// move a generation-dominated cost, and this shows exactly which ones do.
// ============================================================================

import { calculate } from "./calc-engine";
import type { CalcInputs, PriceBook } from "./types";

export interface SensitivityRow {
  label: string;
  /** Fractional change in total for a +10% bump to this lever. */
  deltaPct: number;
}

const BUMP = 1.1; // +10%

export function computeSensitivity(inputs: CalcInputs, priceBook: PriceBook): SensitivityRow[] {
  const base = calculate({ ...inputs, ragMode: "A" }, priceBook).totalMonthly$;
  if (!(base > 0)) return [];

  const measure = (label: string, mutated: CalcInputs): SensitivityRow => {
    const t = calculate({ ...mutated, ragMode: "A" }, priceBook).totalMonthly$;
    return { label, deltaPct: (t - base) / base };
  };

  const rows: SensitivityRow[] = [
    measure("Queries / month", {
      ...inputs,
      traffic: { ...inputs.traffic, queriesPerMonth: inputs.traffic.queriesPerMonth * BUMP },
    }),
    measure("Output length", {
      ...inputs,
      generation: { ...inputs.generation, outTokens: inputs.generation.outTokens * BUMP },
    }),
    measure("Chunks sent to the LLM", {
      ...inputs,
      retrieval: { ...inputs.retrieval, topN: inputs.retrieval.topN * BUMP },
    }),
    measure("Chunk size", {
      ...inputs,
      chunking: { ...inputs.chunking, chunkSize: inputs.chunking.chunkSize * BUMP },
    }),
    measure("System prompt tokens", {
      ...inputs,
      generation: { ...inputs.generation, promptOverhead: inputs.generation.promptOverhead * BUMP },
    }),
    measure("Number of documents", {
      ...inputs,
      corpus: { ...inputs.corpus, numDocs: inputs.corpus.numDocs * BUMP },
    }),
    measure("User query length", { ...inputs, queryTokens: inputs.queryTokens * BUMP }),
  ];

  return rows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}
