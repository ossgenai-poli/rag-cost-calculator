"use client";

// Structured entered-vs-calculated disclosures (result.inputAdjustments, verbatim values). Labels are
// presentation copy (docs/ux-v2/05-copy-deck.md wording); the raw field path stays visible so the row
// reconciles with the structured audit data. Renders nothing when there are no adjustments.
import type { NarratedRecommendationResult } from "@/lib/recommendation";

// UI copy-deck labels (open UX decision UI-D3: unify with narrate()'s label map in one copy deck).
const FIELD_LABELS: Record<string, string> = {
  "retrieval.topN": "Context chunks sent to the model",
  gpuUptimeHoursPerMonth: "GPU fleet uptime hours/month",
  "queries/month": "Queries per month",
  documents: "Documents",
  "tokens/doc": "Tokens per document",
  "output tokens": "Output tokens",
  "prompt overhead": "Prompt overhead",
  "max context": "Max context",
  "max concurrency": "Max concurrency",
  "overhead %": "Overhead %",
  "query tokens": "Query tokens",
};

export function AdjustmentsPanel({ result }: { result: NarratedRecommendationResult }) {
  if (result.inputAdjustments.length === 0) return null;
  return (
    <section aria-labelledby="adjustments-heading" data-testid="adjustments-panel" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 id="adjustments-heading" className="text-base font-semibold text-amber-900">Inputs adjusted for calculation</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-amber-800">
            <th scope="col" className="py-1 pr-2">Input</th>
            <th scope="col" className="py-1 pr-2">Entered</th>
            <th scope="col" className="py-1">Used in calculation</th>
          </tr>
        </thead>
        <tbody>
          {result.inputAdjustments.map((a) => (
            <tr key={a.field} className="border-t border-amber-200" data-testid={`adjustment-${a.field}`}>
              <td className="py-1 pr-2">
                {FIELD_LABELS[a.field] ?? a.field}
                <code className="ml-1 text-xs text-amber-700">({a.field})</code>
              </td>
              <td className="py-1 pr-2 font-mono">{a.entered}</td>
              <td className="py-1 font-mono font-semibold">{a.calculated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
