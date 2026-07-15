"use client";

// Levels 1-3 of the result hierarchy (docs/ux-v2/10-result-hierarchy.md), revised per UI HOLD-1
// P1-UI-1: the hero is a BOUNDED conclusion ("Lowest modeled cost: …"), never more authoritative than
// the visible assumptions. A prominent disclosure flags cross-model comparison; workload scale, the
// major token/context assumptions, both monthly costs, the absolute/percentage difference and the
// evidence state are all immediately visible. Badges live OUTSIDE headings (P2-UI-2). Every value maps
// to a structured field (docs/ux-v2/ui/REVIEW.md); the Δ and input-token sum are labeled presentation
// arithmetic over displayed structured values.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}
const num = (v: number) => new Intl.NumberFormat("en-US").format(v);

/** Bounded hero per decision.basis. Availability is now a FIRST-CLASS headless basis (P1-UI-4):
 *  `self-host-unavailable` (reason-coded, catalog fact) is distinct from `self-host-infeasible`
 *  (genuine technical failure) — the UI simply maps the structured basis. */
function hero(result: NarratedRecommendationResult): string {
  const { choice, basis } = result.decision;
  if (basis === "lower-cost") return choice === "api" ? "Lowest modeled cost: API" : "Lowest modeled cost: Self-host";
  if (basis === "comparison-unavailable") return "Directional cost result: undetermined";
  if (basis === "evidence-gap") return "API — no evidence-qualified self-host option";
  if (basis === "no-modeled-candidate") return "API — no modeled self-host configuration yet";
  if (basis === "sla") return "API — modeled self-host misses the latency SLA";
  if (basis === "self-host-unavailable") return "API — this model is API-only (self-host unavailable)";
  return "API — no modeled self-host configuration is technically feasible";
}

const CHOICE_STYLE: Record<string, string> = {
  api: "border-sky-400 bg-sky-50",
  "self-host": "border-emerald-400 bg-emerald-50",
  undetermined: "border-amber-400 bg-amber-50",
};

export function DecisionSummary({ result }: { result: NarratedRecommendationResult }) {
  const { decision, apiOption, bestSelfHost, effectiveWorkload: w } = result;
  const apiCost = apiOption.monthlyCost;
  const selfCost = bestSelfHost?.costMonthly ?? null;
  // Presentation arithmetic over the two displayed structured amounts (labeled as modeled difference).
  const delta = apiCost != null && selfCost != null ? selfCost - apiCost : null;
  const deltaPct = delta != null && apiCost != null && apiCost > 0 ? (delta / apiCost) * 100 : null;
  const crossModel = apiOption.modelId !== w.generation.llmModelId;
  const inputTok = w.queryTokens + w.generation.promptOverhead + w.retrieval.topN * w.chunking.chunkSize;

  return (
    <section aria-labelledby="decision-heading" data-testid="decision-summary" className={`rounded-lg border-2 p-4 ${CHOICE_STYLE[decision.choice]}`}>
      {/* Level 1 — bounded conclusion. Basis chip is a SIBLING of the heading (clean accessible name). */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="decision-heading" className="text-lg font-semibold text-slate-900">{hero(result)}</h2>
        <span className="rounded bg-white/70 border border-slate-300 px-2 py-0.5 text-xs text-slate-600" data-testid="decision-basis" aria-label={`Decision basis: ${decision.basis}`}>
          basis: {decision.basis}
        </span>
      </div>

      {/* P1-UI-1 — prominent cross-model disclosure, adjacent to the hero. */}
      {crossModel && (
        <p className="mt-2 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900" data-testid="cross-model-disclosure">
          Different models are being compared; capability and quality are not normalized.
        </p>
      )}

      {/* Level 2 — the deterministic why (narrate() rationale, verbatim; the headless layer now
          carries availability semantics natively — P1-UI-4 — so no UI clarification is needed). */}
      <p className="mt-2 text-sm text-slate-800" data-testid="decision-rationale">{decision.rationale}</p>

      {/* Level 3 — costs, modeled difference and evidence state, immediately visible. */}
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="cost-row">
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">API — {apiOption.modelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="api-monthly">{usd(apiCost)}/mo</dd>
        </div>
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Best self-host — {result.selfHostModelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="selfhost-monthly">
            {bestSelfHost ? `${usd(selfCost)}/mo` : decision.basis === "self-host-unavailable" ? "unavailable (API-only model)" : "none evidence-qualified"}
          </dd>
        </div>
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Modeled difference</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="cost-delta">
            {delta != null ? `${delta >= 0 ? "+" : "−"}${usd(Math.abs(delta))}/mo (${deltaPct!.toFixed(0)}% vs API)` : "n/a"}
          </dd>
        </div>
      </dl>

      {/* P1-UI-1 — the decision-driving assumptions, visible in BOTH modes (effectiveWorkload fields). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700" data-testid="assumptions-row">
        <span><span className="text-slate-500">Workload:</span> {num(w.traffic.queriesPerMonth)} questions/mo</span>
        <span>
          <span className="text-slate-500">Input/request:</span> {num(w.queryTokens)} query + {num(w.generation.promptOverhead)} prompt + {num(w.retrieval.topN)}×{num(w.chunking.chunkSize)} context = {num(inputTok)} tok
        </span>
        <span><span className="text-slate-500">Output:</span> {num(w.generation.outTokens)} tok</span>
        <span className="inline-flex items-center gap-1">
          <span className="text-slate-500">Evidence:</span>{" "}
          {bestSelfHost ? <ConfidenceChip confidence={bestSelfHost.confidence} /> : <span data-testid="evidence-none">no qualified self-host evidence</span>}
        </span>
      </div>

      <p className="mt-3 text-xs italic text-slate-500" data-testid="caption">{result.caption}</p>
    </section>
  );
}
