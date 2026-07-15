// Risks & exclusions (10-result-hierarchy.md §6) — a DETERMINISTIC checklist assembled from ACTIVE
// structured flags. Every line is a fixed template keyed by a structured condition; nothing is
// inferred, ranked, or freely authored, and a line renders ONLY while its flag is active. This module
// is the single source for the on-page RisksPanel AND the exported report (they can never diverge).
import type { NarratedRecommendationResult, CandidateEvaluation } from "@/lib/recommendation";

export interface RiskLine {
  /** Stable key naming the structured condition (also the test/data-testid handle). */
  key: string;
  text: string;
}

const usd = (v: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

/** The evaluation the architecture/quota lines describe: the customer's ACTIVE selection (doc 06 —
 *  only ever an eligible card candidate; the caller resolves it fail-closed via focus.ts), else the
 *  best self-host card's candidate, else the decision's cost comparator candidate. null ⇒ no
 *  self-host configuration is being described. */
export function relevantEvaluation(r: NarratedRecommendationResult, focusId?: string | null): CandidateEvaluation | null {
  if (focusId) {
    const focused = r.evaluations.find((e) => e.config.id === focusId);
    if (focused?.recommendationEligible) return focused; // never describe an ineligible focus
  }
  const id = r.bestSelfHost?.config.id ?? r.decision.costComparator?.selfHostCandidateId ?? null;
  return id ? (r.evaluations.find((e) => e.config.id === id) ?? null) : null;
}

/** Meaning templates per NON-measured evidence state — exact ladder tokens, fixed wording (P1-NARR-1
 *  discipline: never an invented category). */
const EVIDENCE_RISK: Record<string, string> = {
  "measured-scaled": "capacity is scaled from a benchmarked operating point to your sequence lengths, not measured at them.",
  extrapolated: "capacity is extrapolated from a related benchmarked configuration, not measured for this one.",
  proxy: "capacity comes from a proxy configuration, not this exact one.",
  heuristic: "capacity is a heuristic estimate — validate input throughput before relying on it.",
  unbenchmarked: "no qualified benchmark evidence backs this configuration.",
};

export interface RiskOptions {
  /** Labels of inputs the customer supplied as RANGES (doc 08) — adds the input-uncertainty line. */
  rangeLabels?: string[];
  /** Bound-scenario disclosures from rangeDisclosures() (P1-UI5-3): engine reconciliations at the
   *  bounds + tracked-candidate eligibility — carried into risks verbatim. */
  rangeNotes?: string[];
  /** The ACTIVE selection id (doc 06) — the quota/architecture lines describe the focused candidate. */
  focusId?: string | null;
}

/** Assemble the active risk/exclusion lines. Pure and deterministic; order is fixed. */
export function riskLines(r: NarratedRecommendationResult, opts?: RiskOptions): RiskLine[] {
  const lines: RiskLine[] = [];
  const ev = relevantEvaluation(r, opts?.focusId);
  const gen = r.effectiveWorkload.generation;

  // Self-host capacity/architecture risks only apply when a self-host configuration is described.
  if (ev) {
    lines.push({
      key: "planning-capacity",
      text: "This is planning capacity, not an availability or tail-latency guarantee. Before purchasing, load-test the intended serving stack under production-shaped traffic.",
    });
    lines.push(
      gen.haEnabled
        ? {
            key: "n1-scope",
            text: "N+1 is serving-replica redundancy only — it does not establish multi-AZ resilience, disaster recovery, security, quota readiness, or compliance.",
          }
        : {
            key: "n1-off",
            text: "No spare serving replica is modeled (N+1 is off) — any replica loss reduces capacity below the target.",
          }
    );
    lines.push({
      key: "quota-unverified",
      text: `AWS quota and capacity availability for ${ev.fleet.boxes} × ${ev.servingFacts.instanceType} (${ev.servingFacts.gpuSku}) are not verified by this calculator.`,
    });
    if (ev.pricingAssumption.qualification !== "reference") {
      lines.push({
        key: "indicative-purchasing",
        text: "Purchasing discounts are indicative planning factors, not quotes — obtain an AWS quote before committing.",
      });
    }
    const evidenceRisk = EVIDENCE_RISK[ev.effectiveConfidence];
    if (evidenceRisk) {
      lines.push({ key: "evidence-state", text: `Evidence is ${ev.effectiveConfidence}: ${evidenceRisk}` });
    }
    if (gen.gpuUptimeHoursPerMonth < 730) {
      lines.push({
        key: "active-window",
        text: "Monthly traffic is assumed to be served within the selected active hours; startup/drain/checkpoint time, accelerator availability, capacity reservations, quotas, and operational automation are not established by these settings.",
      });
    }
    // P2-UI4-2: defaults may never have been "entered" by the customer — the wording claims only
    // what is structurally known (the modeled values), not their per-field origin.
    lines.push({
      key: "ops-assumptions",
      text: `Modeled operational cost adders (default or customer-provided; not independently verified): networking ${usd(r.effectiveWorkload.ops.networkingMonthly$)}/mo · observability ${usd(r.effectiveWorkload.ops.observabilityMonthly$)}/mo · ${r.effectiveWorkload.ops.overheadPct}% overhead markup.`,
    });
  }

  if (opts?.rangeLabels && opts.rangeLabels.length > 0) {
    // P1-UI5-2: the risk line states exactly which scenarios were evaluated — never range stability.
    lines.push({
      key: "input-ranges",
      text: `Customer ranges, not firm values: ${opts.rangeLabels.join(", ")}. Results are shown at the base case; the band comes from re-running the engine at the all-low, base and all-high scenarios only — intermediate values and combinations were not exhaustively evaluated. Validate the real values before committing.`,
    });
    for (const [i, note] of (opts.rangeNotes ?? []).entries()) {
      lines.push({ key: `range-note-${i}`, text: note });
    }
  }
  if (r.pricing.source !== "live") {
    lines.push({
      key: "pinned-pricing",
      text: `Pricing uses the pinned reference price book (as of ${r.pricing.asOf}, ${r.pricing.region}), not live AWS pricing.`,
    });
  }
  if (r.apiOption.modelId !== gen.llmModelId) {
    lines.push({
      key: "cross-model",
      text: "The compared models differ; capability and quality equivalence are not established by this calculator.",
    });
  }
  return lines;
}
