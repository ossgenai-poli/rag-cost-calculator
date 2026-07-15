"use client";

// Ranked alternatives (docs/ux-v2/06-recommendation-presentation.md cards 2-3): the best eligible
// option per axis, shown ONLY when the headless layer produced a DISTINCT candidate (exact same-id
// rule). With today's pinned catalog they legitimately collapse to "none" — an HONEST empty note, per
// the R1 worked example, never an invented alternative.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";
import type { FocusResolution } from "./focus";

const KIND_LABELS: Record<string, string> = {
  "lowest-cost": "Lowest-cost feasible alternative",
  "highest-confidence": "Highest-confidence alternative",
  "lowest-latency": "Lowest-latency alternative",
};

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export interface AlternativeCardsProps {
  result: NarratedRecommendationResult;
  /** doc 06 "Use this": selecting focuses a card across the self-host surfaces; the decision is
   *  unchanged. Optional — display-only without it. Only the eligible card set carries the action;
   *  rejected options never do. */
  focus?: FocusResolution | null;
  onSelect?: (id: string | null) => void;
}

export function AlternativeCards({ result, focus, onSelect }: AlternativeCardsProps) {
  if (!result.bestSelfHost) return null; // no primary self-host → alternatives are not meaningful
  if (result.alternatives.length === 0) {
    return (
      <section aria-labelledby="alt-heading" data-testid="alternatives-empty" className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        <h2 id="alt-heading" className="text-sm font-semibold text-slate-600">Alternatives</h2>
        <p className="mt-1 text-xs text-slate-500">
          None — the evidence-qualified option set currently contains a single distinct configuration
          (alternatives appear only when a genuinely different configuration qualifies).
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="alt-heading" data-testid="alternative-cards" className="rounded-lg border border-slate-300 bg-white p-4">
      <h2 id="alt-heading" className="text-base font-semibold text-slate-800">Alternatives</h2>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {result.alternatives.map((card) => (
          <li key={card.kind} className="rounded border border-slate-200 bg-slate-50 p-2" data-testid={`alt-${card.kind}`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">{KIND_LABELS[card.kind] ?? card.kind}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{card.config.label}</span>
              <ConfidenceChip confidence={card.confidence} />
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {usd(card.costMonthly)}/mo
              {card.costDeltaVsBest != null && card.costDeltaVsBest !== 0 && (
                <span className="ml-1 text-xs text-slate-500">
                  ({card.costDeltaVsBest > 0 ? "+" : "−"}{usd(Math.abs(card.costDeltaVsBest))} vs best)
                </span>
              )}
            </p>
            <p className="mt-1 break-words text-xs text-slate-600">{card.tradeoff}</p>
            {onSelect && (
              focus?.active && focus.selectedId === card.config.id ? (
                <p className="mt-1 text-xs font-medium text-emerald-700" data-testid={`alt-selected-${card.kind}`}>Selected ✓</p>
              ) : (
                <button
                  type="button"
                  data-testid={`alt-use-${card.kind}`}
                  aria-label={`Use ${card.config.label}`}
                  onClick={() => onSelect(card.config.id)}
                  className="mt-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Use this
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      {onSelect && (
        <p className="mt-2 text-xs text-slate-500" data-testid="selection-scope-note">
          Selecting focuses that configuration in the self-host card, risks and export — the overall API-vs-self-host decision above is unchanged (it derives from the cheapest comparison-qualified configuration).
        </p>
      )}
    </section>
  );
}
