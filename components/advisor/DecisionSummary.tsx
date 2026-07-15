"use client";

// Levels 1-3 of the result hierarchy (docs/ux-v2/10-result-hierarchy.md): the DECISION first, then the
// deterministic why (narrated rationale), then the estimated costs. The API-vs-self-host decision is the
// primary outcome; a GPU configuration is NEVER shown here (it lives in the secondary BestSelfHostCard).
// Every value maps to a structured field — see docs/ux-v2/ui/REVIEW.md for the full mapping.
import type { NarratedRecommendationResult } from "@/lib/recommendation";

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

const CHOICE_HEADLINE: Record<string, string> = {
  api: "Use the API",
  "self-host": "Self-host",
  undetermined: "Undetermined — validate before deciding",
};
const CHOICE_STYLE: Record<string, string> = {
  api: "border-sky-400 bg-sky-50",
  "self-host": "border-emerald-400 bg-emerald-50",
  undetermined: "border-amber-400 bg-amber-50",
};

export function DecisionSummary({ result }: { result: NarratedRecommendationResult }) {
  const { decision, apiOption, bestSelfHost } = result;
  const selfHostCost = bestSelfHost?.costMonthly ?? null;
  return (
    <section aria-labelledby="decision-heading" data-testid="decision-summary" className={`rounded-lg border-2 p-4 ${CHOICE_STYLE[decision.choice]}`}>
      {/* Level 1 — the one-line verdict (decision.choice/basis) */}
      <h2 id="decision-heading" className="text-lg font-semibold text-slate-900">
        {CHOICE_HEADLINE[decision.choice]}
        <span className="ml-2 align-middle rounded bg-white/70 border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-600" data-testid="decision-basis">
          basis: {decision.basis}
        </span>
      </h2>
      {/* Level 2 — the deterministic why (narrate() rationale, verbatim; never authored in the component) */}
      <p className="mt-2 text-sm text-slate-800" data-testid="decision-rationale">{decision.rationale}</p>
      {/* Level 3 — estimated cost, both sides (apiOption.monthlyCost vs bestSelfHost.costMonthly) */}
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">API — {apiOption.modelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="api-monthly">{usd(apiOption.monthlyCost)}/mo</dd>
        </div>
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Best self-host — {result.selfHostModelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="selfhost-monthly">
            {bestSelfHost ? `${usd(selfHostCost)}/mo` : "none evidence-qualified"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs italic text-slate-500" data-testid="caption">{result.caption}</p>
    </section>
  );
}
