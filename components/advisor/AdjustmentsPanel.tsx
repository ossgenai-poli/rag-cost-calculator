"use client";

// Structured entered-vs-calculated disclosures (result.inputAdjustments, verbatim values). Labels come
// from the shared UI copy contract (owner D3); the raw field path stays visible so each row reconciles
// with the structured audit data. Rendered as WRAP-SAFE stacked rows — no table — so narrow viewports
// (375px) never overflow horizontally (P1-UI-3). Renders nothing when there are no adjustments.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ADJUSTMENT_FIELD_LABELS } from "./copy";

export function AdjustmentsPanel({ result }: { result: NarratedRecommendationResult }) {
  if (result.inputAdjustments.length === 0) return null;
  return (
    <section aria-labelledby="adjustments-heading" data-testid="adjustments-panel" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 id="adjustments-heading" className="text-base font-semibold text-amber-900">Inputs adjusted for calculation</h2>
      <ul className="mt-2 space-y-2">
        {result.inputAdjustments.map((a) => (
          <li key={a.field} className="min-w-0 rounded border border-amber-200 bg-white/60 p-2 text-sm" data-testid={`adjustment-${a.field}`}>
            <p className="min-w-0 break-words font-medium text-amber-900">
              {ADJUSTMENT_FIELD_LABELS[a.field] ?? a.field}
              <code className="ml-1 break-all text-xs font-normal text-amber-700">({a.field})</code>
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-amber-900">
              <span className="text-amber-700">entered</span>
              <span data-testid="adjustment-entered">{a.entered}</span>
              <span aria-hidden="true">→</span>
              <span className="text-amber-700">used</span>
              <span className="font-semibold" data-testid="adjustment-calculated">{a.calculated}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
