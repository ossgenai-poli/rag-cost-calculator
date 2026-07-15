"use client";

// Levels 4-5: the best EVIDENCE-QUALIFIED self-host configuration — always a SECONDARY option card,
// never the overall recommendation when the decision is "api" (approved sweep/narrative contract).
// Honest empty state: when bestSelfHost is null (evidence-gap / unbenchmarked / no-modeled-candidate),
// this renders the coverage explanation and NEVER promotes a GPU configuration.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";
import type { FocusResolution } from "./focus";

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export interface BestSelfHostCardProps {
  result: NarratedRecommendationResult;
  /** doc 06 selection focus (optional — without it the card shows the ranked best, as approved). */
  focus?: FocusResolution | null;
  onSelect?: (id: string | null) => void;
}

export function BestSelfHostCard({ result, focus, onSelect }: BestSelfHostCardProps) {
  const card = result.bestSelfHost;
  if (!card) {
    // Honest empty state — keyed off the STRUCTURED decision.basis; no GPU shown. Availability
    // (`self-host-unavailable`, a reason-coded catalog fact — P1-UI-4) is a DISTINCT state from
    // technical infeasibility.
    return (
      <section aria-labelledby="bsh-heading" data-testid="best-self-host-empty" className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <h2 id="bsh-heading" className="text-base font-semibold text-slate-700">Self-host option</h2>
        <p className="mt-1 text-sm text-slate-600" data-testid="bsh-empty-reason">
          {result.decision.basis === "self-host-unavailable"
            ? "This model is API-only; self-host weights are unavailable. Select an open-weight model to evaluate self-hosting."
            : result.decision.basis === "no-modeled-candidate"
              ? "No self-host configuration is currently modeled for this model — a catalog-coverage gap, not a technical limitation."
              : result.decision.basis === "self-host-infeasible"
                ? "No modeled self-host configuration is technically feasible for this workload."
                : result.decision.basis === "sla"
                  ? "The modeled self-host configurations cannot meet the interactivity / TTFT SLA."
                  : "No self-host configuration has qualifying benchmark evidence, so none can be recommended."}
        </p>
      </section>
    );
  }
  // doc 06 selection: the card describes the FOCUSED evaluation (the ranked best when no valid
  // selection). A customer selection never changes the decision above — only what this card, the
  // quota risk, the range tracking and the export architecture describe.
  const selectedNonBest = !!focus && focus.active && !focus.isEngineBest && !!focus.evaluation;
  const ev = selectedNonBest ? focus!.evaluation! : result.evaluations.find((e) => e.config.id === card.config.id);
  const sf = ev?.servingFacts;
  const monthly = selectedNonBest ? (ev?.cost.selfHostMonthly ?? null) : card.costMonthly;
  const confidence = selectedNonBest ? ev!.effectiveConfidence : card.confidence;
  const label = selectedNonBest ? ev!.config.label : card.config.label;
  return (
    <section aria-labelledby="bsh-heading" data-testid="best-self-host-card" className="rounded-lg border border-slate-300 bg-white p-4">
      {/* Annotation is a SIBLING of the heading so the accessible name stays clean (P2-UI-2). */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="bsh-heading" className="text-base font-semibold text-slate-800">
          {selectedNonBest ? "Your selected self-host option" : "Best self-host option"}
        </h2>
        <span className="text-xs font-normal text-slate-500">
          {selectedNonBest
            ? "customer-selected — not the optimization-ranked best; the decision above is unchanged"
            : "secondary — the decision above is the recommendation"}
        </span>
      </div>
      {focus?.suspended && (
        <p role="alert" data-testid="selection-suspended-note" className="mt-2 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
          Your selected configuration ({focus.selectedId}) is not evidence-qualified under the current inputs — showing the recommended best. Your selection is preserved and resumes if it re-qualifies.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Level 4 — architecture: config label + candidate servingFacts (never workload GPU fields) */}
        <span className="font-medium text-slate-900" data-testid="bsh-config">{label}</span>
        <ConfidenceChip confidence={confidence} />
        {onSelect && selectedNonBest && (
          <button type="button" data-testid="selection-reset" onClick={() => onSelect(null)} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
            Reset to recommended
          </button>
        )}
      </div>
      {sf && ev && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-3" data-testid="bsh-facts">
          <div><dt className="inline text-slate-500">Instance: </dt><dd className="inline">{sf.instanceType}</dd></div>
          <div><dt className="inline text-slate-500">Weights/KV: </dt><dd className="inline">{sf.weightPrecision} / {sf.kvPrecision}</dd></div>
          <div><dt className="inline text-slate-500">Fleet: </dt><dd className="inline">{ev.fleet.boxes} box(es), {ev.fleet.bindingDim}-bound</dd></div>
          <div><dt className="inline text-slate-500">GPU rate: </dt><dd className="inline">{usd(sf.gpuPricePerHr)}/hr on-demand base ({sf.gpuPricingModel})</dd></div>
          <div><dt className="inline text-slate-500">Uptime: </dt><dd className="inline">{sf.uptimeHours} h/mo</dd></div>
          <div><dt className="inline text-slate-500">Monthly: </dt><dd className="inline font-semibold">{usd(monthly)}</dd></div>
        </dl>
      )}
      {/* Level 4 expand — the reconciled fleet equation. For the ranked best it is narrate()'s text
          verbatim; a selected alternative shows ITS structured equation (same engine field). */}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-sky-700">Fleet sizing (reconciled equation)</summary>
        <p className="mt-1 rounded bg-slate-50 p-2 font-mono text-xs text-slate-700" data-testid="bsh-binding">
          {selectedNonBest ? ev!.fleet.equation : card.bindingConstraint}
        </p>
      </details>
      {!selectedNonBest && <p className="mt-2 text-sm text-slate-600" data-testid="bsh-tradeoff">{card.tradeoff}</p>}
    </section>
  );
}
