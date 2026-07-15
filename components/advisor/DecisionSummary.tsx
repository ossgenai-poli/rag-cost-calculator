"use client";

// Levels 1-3 of the result hierarchy (docs/ux-v2/10-result-hierarchy.md), revised per UI HOLD-1
// P1-UI-1: the hero is a BOUNDED conclusion ("Lowest modeled cost: …"), never more authoritative than
// the visible assumptions. A prominent disclosure flags cross-model comparison; workload scale, the
// major token/context assumptions, both monthly costs, the absolute/percentage difference and the
// evidence state are all immediately visible. Badges live OUTSIDE headings (P2-UI-2). Every value maps
// to a structured field (docs/ux-v2/ui/REVIEW.md); the Δ and input-token sum are labeled presentation
// arithmetic over displayed structured values.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { PURCHASING_MODEL_LABELS } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";

/** Per-query rate over displayed structured values — LABELED presentation arithmetic (4 decimals).
 *  Exported so the report builder (report.ts) frames cost identically. */
export function perQuery(monthly: number | null, queriesPerMonth: number): string {
  if (monthly == null || !Number.isFinite(monthly) || queriesPerMonth <= 0) return "unavailable";
  return `$${(monthly / queriesPerMonth).toFixed(4)}/query`;
}

function usd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}
const num = (v: number) => new Intl.NumberFormat("en-US").format(v);

/** Bounded hero per decision.basis. Availability is now a FIRST-CLASS headless basis (P1-UI-4):
 *  `self-host-unavailable` (reason-coded, catalog fact) is distinct from `self-host-infeasible`
 *  (genuine technical failure) — the UI simply maps the structured basis. Exported as the SINGLE
 *  level-1 verdict line, reused verbatim by the report builder (report.ts). */
export function heroLine(result: NarratedRecommendationResult): string {
  const { choice, basis } = result.decision;
  if (basis === "lower-cost") {
    // P1-UI3-1 / UI3-D3: a non-reference pricing qualification (indicative commitment/Spot planning
    // factor, or an override) is a DIRECTIONAL planning result — the hero itself carries the qualifier.
    const q = result.decision.costComparator?.pricingQualification;
    const lead = q && q !== "reference" ? "Indicative modeled cost" : "Lowest modeled cost";
    return choice === "api" ? `${lead}: API` : `${lead}: Self-host`;
  }
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

export function DecisionSummary({ result, rangesActive }: { result: NarratedRecommendationResult; rangesActive?: boolean }) {
  const { decision, apiOption, bestSelfHost, effectiveWorkload: w } = result;
  const apiCost = apiOption.monthlyCost;
  const selfCost = bestSelfHost?.costMonthly ?? null;
  // Presentation arithmetic over the two displayed structured amounts (labeled as modeled difference).
  const delta = apiCost != null && selfCost != null ? selfCost - apiCost : null;
  const deltaPct = delta != null && apiCost != null && apiCost > 0 ? (delta / apiCost) * 100 : null;
  const crossModel = apiOption.modelId !== w.generation.llmModelId;
  const inputTok = w.queryTokens + w.generation.promptOverhead + w.retrieval.topN * w.chunking.chunkSize;
  // P1-UI3-1 — the pricing qualification and assumption come ONLY from the structured output (the
  // persisted comparator + the comparator candidate's PricingAssumption); nothing is reconstructed here.
  const cmp = decision.basis === "lower-cost" ? decision.costComparator : undefined;
  const cmpEval = cmp ? result.evaluations.find((e) => e.config.id === cmp.selfHostCandidateId) : undefined;
  const indicative = !!cmp && cmp.pricingQualification !== "reference";
  const pa = cmpEval?.pricingAssumption;
  const gen = w.generation; // workload-only effective inputs (utilization, N+1, hours, purchasing)
  const opsVisible = result.evaluations.length > 0; // operations don't shape an API-only/no-candidate result

  return (
    <section aria-labelledby="decision-heading" data-testid="decision-summary" className={`rounded-lg border-2 p-4 ${CHOICE_STYLE[decision.choice]}`}>
      {/* Level 1 — bounded conclusion. Basis chip is a SIBLING of the heading (clean accessible name). */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="decision-heading" className="text-lg font-semibold text-slate-900">{heroLine(result)}</h2>
        <span className="rounded bg-white/70 border border-slate-300 px-2 py-0.5 text-xs text-slate-600" data-testid="decision-basis" aria-label={`Decision basis: ${decision.basis}`}>
          basis: {decision.basis}
        </span>
        {/* Doc 08: when any material fact is a range, the headline reads as "about" — the chip is a
            SIBLING of the heading (clean accessible name), and the band panel carries the recompute. */}
        {rangesActive && (
          <span className="rounded border border-sky-400 bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900" data-testid="range-chip">
            ≈ about — inputs include ranges; base case shown
          </span>
        )}
      </div>

      {/* P1-UI-1 — prominent cross-model disclosure, adjacent to the hero. */}
      {crossModel && (
        <p className="mt-2 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900" data-testid="cross-model-disclosure">
          Different models are being compared; capability and quality are not normalized.
        </p>
      )}

      {/* P1-UI3-1 — prominent indicative-pricing disclosure, adjacent to the hero, whenever a
          non-reference pricing assumption influenced the comparison. Exact discount/utilization come
          from the structured PricingAssumption + servingFacts of the comparator candidate. */}
      {indicative && (
        <div className="mt-2 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-amber-900" data-testid="indicative-pricing-disclosure">
          <p className="text-sm font-medium">
            {pa && pa.qualification !== "override" && cmpEval
              ? `This result assumes a ${pa.assumedDiscountPct}% ${PURCHASING_MODEL_LABELS[pa.purchasingModel]} discount and ${Math.round(cmpEval.servingFacts.utilTarget * 100)}% fleet utilization. It is a planning scenario, not an AWS quote.`
              : "This result rests on a non-reference pricing assumption. It is a planning scenario, not an AWS quote."}
          </p>
          {pa && pa.qualification !== "override" && (
            <p className="mt-1 text-xs" data-testid="pricing-assumption-equation">
              Pricing assumption: ${pa.onDemandBaseHourly.toFixed(2)}/GPU-hour on-demand base rate × (1 − {pa.assumedDiscountPct}%) = ${pa.modeledEffectiveHourly.toFixed(2)}/GPU-hour modeled planning rate — an assumption, not a quoted effective rate.
            </p>
          )}
        </div>
      )}

      {/* Level 2 — the deterministic why (narrate() rationale, verbatim; the headless layer now
          carries availability semantics natively — P1-UI-4 — so no UI clarification is needed). */}
      <p className="mt-2 text-sm text-slate-800" data-testid="decision-rationale">{decision.rationale}</p>

      {/* Level 3 — costs, modeled difference and evidence state, immediately visible. */}
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="cost-row">
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">API — {apiOption.modelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="api-monthly">{usd(apiCost)}/mo</dd>
          {apiCost != null && (
            <dd className="text-xs text-slate-600" data-testid="api-framing">
              {usd(apiCost * 12)}/yr · {perQuery(apiCost, w.traffic.queriesPerMonth)}
            </dd>
          )}
        </div>
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Best self-host — {result.selfHostModelLabel}</dt>
          <dd className="text-base font-semibold text-slate-900" data-testid="selfhost-monthly">
            {bestSelfHost ? `${usd(selfCost)}/mo` : decision.basis === "self-host-unavailable" ? "unavailable (API-only model)" : "none evidence-qualified"}
          </dd>
          {selfCost != null && (
            <dd className="text-xs text-slate-600" data-testid="selfhost-framing">
              {usd(selfCost * 12)}/yr · {perQuery(selfCost, w.traffic.queriesPerMonth)}
            </dd>
          )}
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

      {/* P2-UI3-1 — the OPERATIONAL assumptions driving the self-host side, visible in BOTH modes,
          sourced from the workload-only effective inputs (structured output; never a duplicated
          constant). Hidden when no self-host candidate was modeled — operations don't shape an
          API-only result (P1-UI3-2). */}
      {opsVisible && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700" data-testid="operations-row">
          <span><span className="text-slate-500">Utilization target:</span> {Math.round(gen.utilTarget * 100)}%</span>
          <span><span className="text-slate-500">Spare serving replica (N+1):</span> {gen.haEnabled ? "on" : "off"}</span>
          <span><span className="text-slate-500">Operating hours:</span> {num(gen.gpuUptimeHoursPerMonth)} h/mo</span>
          <span>
            <span className="text-slate-500">Purchasing:</span> {PURCHASING_MODEL_LABELS[gen.gpuPricingModel]}
            {gen.gpuPricingModel !== "on-demand" ? " (indicative planning assumption)" : ""}
          </span>
        </div>
      )}
      {/* P2-UI3-1 — the N+1 scope caveat for EVERY N+1-enabled state, in Simple mode too (never
          restricted to the HA-posture profile or Expert mode). */}
      {opsVisible && gen.haEnabled && (
        <p className="mt-1 text-xs text-slate-600" data-testid="n1-caveat">
          N+1 covers one serving-replica loss only; it does not establish multi-AZ resilience, disaster recovery, security, quota readiness, or compliance.
        </p>
      )}
      {/* P2-UI3-2 / UI3-D1 — persistent active-window disclosure whenever operating hours < 730. */}
      {opsVisible && gen.gpuUptimeHoursPerMonth < 730 && (
        <p className="mt-1 text-xs text-slate-600" data-testid="active-window-disclosure">
          Monthly traffic is assumed to be served within the selected active hours, so the required active fleet may increase. Startup/drain/checkpoint time, accelerator availability, capacity reservations, quotas, and operational automation are not established by these settings.
        </p>
      )}

      <p className="mt-3 text-xs italic text-slate-500" data-testid="caption">{result.caption}</p>
    </section>
  );
}
