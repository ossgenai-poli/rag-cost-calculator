"use client";

// Levels 4-5: the best EVIDENCE-QUALIFIED self-host configuration — always a SECONDARY option card,
// never the overall recommendation when the decision is "api" (approved sweep/narrative contract).
// Honest empty state: when bestSelfHost is null (evidence-gap / unbenchmarked / no-modeled-candidate),
// this renders the coverage explanation and NEVER promotes a GPU configuration.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export function BestSelfHostCard({ result }: { result: NarratedRecommendationResult }) {
  const card = result.bestSelfHost;
  if (!card) {
    // Honest empty state — sourced from decision.basis + the evaluations' evidence states; no GPU shown.
    return (
      <section aria-labelledby="bsh-heading" data-testid="best-self-host-empty" className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <h2 id="bsh-heading" className="text-base font-semibold text-slate-700">Self-host option</h2>
        <p className="mt-1 text-sm text-slate-600" data-testid="bsh-empty-reason">
          {result.decision.basis === "no-modeled-candidate"
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
  const ev = result.evaluations.find((e) => e.config.id === card.config.id);
  const sf = ev?.servingFacts;
  return (
    <section aria-labelledby="bsh-heading" data-testid="best-self-host-card" className="rounded-lg border border-slate-300 bg-white p-4">
      <h2 id="bsh-heading" className="text-base font-semibold text-slate-800">
        Best self-host option
        <span className="ml-2 text-xs font-normal text-slate-500">(secondary — the decision above is the recommendation)</span>
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Level 4 — architecture: config label + candidate servingFacts (never workload GPU fields) */}
        <span className="font-medium text-slate-900" data-testid="bsh-config">{card.config.label}</span>
        <ConfidenceChip confidence={card.confidence} />
      </div>
      {sf && ev && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-3" data-testid="bsh-facts">
          <div><dt className="inline text-slate-500">Instance: </dt><dd className="inline">{sf.instanceType}</dd></div>
          <div><dt className="inline text-slate-500">Weights/KV: </dt><dd className="inline">{sf.weightPrecision} / {sf.kvPrecision}</dd></div>
          <div><dt className="inline text-slate-500">Fleet: </dt><dd className="inline">{ev.fleet.boxes} box(es), {ev.fleet.bindingDim}-bound</dd></div>
          <div><dt className="inline text-slate-500">GPU rate: </dt><dd className="inline">{usd(sf.gpuPricePerHr)}/hr on-demand base ({sf.gpuPricingModel})</dd></div>
          <div><dt className="inline text-slate-500">Uptime: </dt><dd className="inline">{sf.uptimeHours} h/mo</dd></div>
          <div><dt className="inline text-slate-500">Monthly: </dt><dd className="inline font-semibold">{usd(card.costMonthly)}</dd></div>
        </dl>
      )}
      {/* Level 4 expand — the reconciled fleet equation, rendered VERBATIM from narrate() */}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-sky-700">Fleet sizing (reconciled equation)</summary>
        <p className="mt-1 rounded bg-slate-50 p-2 font-mono text-xs text-slate-700" data-testid="bsh-binding">{card.bindingConstraint}</p>
      </details>
      <p className="mt-2 text-sm text-slate-600" data-testid="bsh-tradeoff">{card.tradeoff}</p>
    </section>
  );
}
