"use client";

// Level 6 of the result hierarchy (10-result-hierarchy.md §6): "Risks & exclusions" — a labeled block,
// visible in BOTH modes, rendering the deterministic flag-driven checklist from risks.ts verbatim
// (the exported report consumes the SAME lines, so page and export cannot diverge). Sits between the
// trust-adjacent panels and the advanced evidence, per the fixed hierarchy order.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { riskLines } from "./risks";

export function RisksPanel({ result }: { result: NarratedRecommendationResult }) {
  const lines = riskLines(result);
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="risks-heading" data-testid="risks-panel" className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="risks-heading" className="text-sm font-semibold text-slate-900">Risks &amp; exclusions</h2>
      <p className="mt-1 text-xs text-slate-500">
        What this estimate does not cover, and what to validate — assembled from the active modeling flags.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800">
        {lines.map((l) => (
          <li key={l.key} data-testid={`risk-${l.key}`}>{l.text}</li>
        ))}
      </ul>
    </section>
  );
}
