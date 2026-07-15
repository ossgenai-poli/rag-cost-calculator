"use client";

// Rejected / excluded candidates (docs/ux-v2/06-recommendation-presentation.md card 4): every excluded
// candidate with its structured reason code — the specialist sees the search space, not just the winner.
// Collapsed by default; each row is result.rejected verbatim (code + message), never re-worded.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";

export function RejectedOptions({ result }: { result: NarratedRecommendationResult }) {
  if (result.rejected.length === 0) return null;
  return (
    <section aria-labelledby="rejected-heading" data-testid="rejected-options" className="rounded-lg border border-slate-200 bg-white p-4">
      <details>
        <summary id="rejected-heading" className="cursor-pointer text-base font-semibold text-slate-700">
          Rejected options ({result.rejected.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {result.rejected.map((r) => {
            const ev = result.evaluations.find((e) => e.config.id === r.config.id);
            return (
              <li key={r.config.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-sm" data-testid={`rejected-${r.config.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{r.config.label}</span>
                  {ev && <ConfidenceChip confidence={ev.effectiveConfidence} />}
                  <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700" data-testid="rejection-code">{r.code}</code>
                </div>
                <p className="mt-1 text-slate-600">{r.message}</p>
                {ev && (
                  <p className="mt-1 text-xs text-slate-500">
                    technically feasible: {String(ev.technicallyFeasible)} · SLA: {String(ev.slaQualified)} · evidence: {String(ev.evidenceQualified)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
