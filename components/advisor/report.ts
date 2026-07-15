// Stage-F export (10-result-hierarchy.md) — a PURE, deterministic Markdown report that reproduces the
// customer-ready hierarchy in its EXACT fixed order: 1 recommendation → 2 why → 3 cost →
// 4 architecture → 5 confidence → 6 risks & exclusions → 7 advanced evidence. Every line is a template
// over structured/narrated fields ("a reviewer who wasn't in the room reads it the same way"); the
// risks block is the SAME riskLines() the on-page panel renders, so page and export cannot diverge.
// Byte-identical output for identical input — no timestamps, no locale drift, no invented facts.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { heroLine, perQuery } from "./DecisionSummary";
import { riskLines, relevantEvaluation } from "./risks";
import { decisionScenarioSentence, rangeDisclosures, RANGE_FIELD_LABELS, RANGE_FIELDS, type RangeComputation } from "./ranges";
import type { FocusResolution } from "./focus";

const usd = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
    : "unavailable";
const num = (v: number): string => new Intl.NumberFormat("en-US").format(v);

export interface ReportExtras {
  /** Active range recompute (doc 08) — adds the about-qualifier, the §3 band block and the §6 line. */
  ranges?: RangeComputation | null;
  /** doc 06 selection focus — appends the customer-selected configuration to §4 (the approved
   *  decision-role lines are UNCHANGED) and points the §6 quota line at the focused candidate. */
  focus?: FocusResolution | null;
}

/** Build the deterministic Markdown report. Pure function of the narrated result (+ the optional
 *  range recompute, itself a pure derivation of real engine runs). */
export function buildReport(r: NarratedRecommendationResult, extras?: ReportExtras): string {
  const ranges = extras?.ranges ?? null;
  const focus = extras?.focus ?? null;
  const selectedNonBest = !!focus && focus.active && !focus.isEngineBest && !!focus.evaluation;
  const ev = relevantEvaluation(r);
  const q = r.effectiveWorkload.traffic.queriesPerMonth;
  const apiCost = r.apiOption.monthlyCost;
  const selfCost = r.bestSelfHost?.costMonthly ?? null;
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push("# RAG deployment advisor — report");
  push("");
  push(`> ${r.caption}`);
  push("> Deterministic template over structured engine output; annual and per-query figures are presentation arithmetic over the displayed monthly amounts.");
  push("");

  // 1. Recommendation — the bounded one-line verdict. The token is SELF-HOST CAPACITY evidence
  // (P1-UI4-1): it qualifies the modeled self-host side, never the API recommendation itself.
  push("## 1. Recommendation");
  push(`**${heroLine(r)}** (basis: ${r.decision.basis})`);
  push(`Self-host capacity evidence: ${r.bestSelfHost ? r.bestSelfHost.confidence : "none qualified"}`);
  if (ranges) {
    push(`About, not exact — inputs include customer ranges (${ranges.fields.map((f) => RANGE_FIELD_LABELS[f]).join(", ")}); this report shows the base case, with the recomputed band in §3.`);
  }
  push("");

  // 2. Why — the deterministic narrated rationale (template over named fields).
  push("## 2. Why");
  push(r.decision.rationale);
  push("");

  // 3. Estimated cost — monthly · annual · per-query for both sides.
  push("## 3. Estimated cost");
  push(`| Option | Monthly | Annual (×12) | Per query (÷ ${num(q)}/mo) |`);
  push("|---|---|---|---|");
  push(`| API — ${r.apiOption.modelLabel} | ${usd(apiCost)} | ${usd(apiCost != null ? apiCost * 12 : null)} | ${perQuery(apiCost, q)} |`);
  push(`| Best self-host — ${r.selfHostModelLabel} | ${usd(selfCost)} | ${usd(selfCost != null ? selfCost * 12 : null)} | ${perQuery(selfCost, q)} |`);
  if (apiCost != null && selfCost != null) {
    const d = selfCost - apiCost;
    push(`Modeled difference: ${d >= 0 ? "+" : "−"}${usd(Math.abs(d))}/mo vs API (presentation arithmetic).`);
  }
  if (ranges) {
    const { band, largestEffect } = ranges;
    push("");
    push("Range view — combined envelope (every range input at its low / at its high; real engine recomputes, never percentage estimates):");
    push(`- Range coverage: ${ranges.fields.length} of ${RANGE_FIELDS.length} supported uncertainty inputs ${ranges.fields.length === 1 ? "uses" : "use"} a range. Evidence confidence is a separate channel and is unaffected.`);
    push(band.fleet ? `- Fleet: ${num(band.fleet.low)}–${num(band.fleet.high)} boxes (base ${num(band.fleet.base)})` : "- Fleet band unavailable at the range bounds (see the disclosures below).");
    push(band.selfHost ? `- Self-host: ${usd(band.selfHost.low)}–${usd(band.selfHost.high)}/mo (base ${usd(band.selfHost.base)})` : "- Self-host cost band unavailable at the range bounds (see the disclosures below).");
    push(band.api ? `- API: ${usd(band.api.low)}–${usd(band.api.high)}/mo (base ${usd(band.api.base)})` : "- API cost band unavailable at the range bounds.");
    // P1-UI5-2: the shared scenario sentence — never a range-stability claim.
    push(`- ${decisionScenarioSentence(band)}`);
    if (largestEffect) {
      push(`- Largest modeled range effect: ${RANGE_FIELD_LABELS[largestEffect.field]} (${num(largestEffect.bounds.low)}–${num(largestEffect.bounds.high)}) → fleet ${num(largestEffect.fleetLow)}–${num(largestEffect.fleetHigh)} boxes.`);
    }
    // P1-UI5-3: bound-scenario disclosures (engine reconciliations + tracked eligibility), verbatim.
    for (const note of rangeDisclosures(ranges)) push(`- ${note}`);
  }
  push("");

  // 4. Recommended deployment & architecture — the architecture's ROLE always matches decision.choice
  // (P1-UI4-1): an API recommendation names the API model as the recommended deployment and shows any
  // self-host card ONLY as a non-recommended modeled alternative; a self-host recommendation owns the
  // architecture; an undetermined decision recommends no deployment architecture at all.
  push("## 4. Recommended deployment & architecture");
  const selfHostArch = (roleLine: string) => {
    const sf = ev!.servingFacts;
    push(roleLine);
    push(`${r.selfHostModelLabel} · ${sf.instanceType} (${sf.gpuSku}) · ${sf.weightPrecision} weights / ${sf.kvPrecision} KV · ${ev!.fleet.boxes} boxes (${ev!.fleet.bindingDim}-bound).`);
    push(`Fleet equation: ${ev!.fleet.equation}`);
    push(`Operations: ${Math.round(r.effectiveWorkload.generation.utilTarget * 100)}% utilization target · N+1 ${r.effectiveWorkload.generation.haEnabled ? "on" : "off"} · ${num(r.effectiveWorkload.generation.gpuUptimeHoursPerMonth)} h/mo · ${sf.gpuPricingModel} purchasing (${usd(sf.gpuPricePerHr)}/hr on-demand base rate).`);
  };
  if (r.decision.choice === "api") {
    push(`Recommended deployment: the ${r.apiOption.modelLabel} API (managed service — no self-host fleet to provision).`);
    if (ev) {
      push("");
      selfHostArch("Best modeled self-host alternative — not the overall recommendation:");
    }
  } else if (r.decision.choice === "self-host") {
    if (ev) selfHostArch("Recommended self-host architecture:");
    else push("No self-host configuration is described for this result.");
  } else {
    push("No deployment architecture is recommended — the decision is undetermined. Any self-host configuration below is an evaluated option, not a recommendation.");
    if (ev) {
      push("");
      selfHostArch("Evaluated self-host option — not a recommendation:");
    }
  }
  // doc 06 — the customer's selection is APPENDED with its role stated explicitly; the decision-role
  // lines above are the approved wording, untouched by selection.
  if (selectedNonBest) {
    const fe = focus!.evaluation!;
    push("");
    push("Customer-selected self-host configuration — evidence-qualified, but not the optimization-ranked best; the overall recommendation above is unchanged:");
    push(`${r.selfHostModelLabel} · ${fe.servingFacts.instanceType} (${fe.servingFacts.gpuSku}) · ${fe.servingFacts.weightPrecision} weights / ${fe.servingFacts.kvPrecision} KV · ${fe.fleet.boxes} boxes (${fe.fleet.bindingDim}-bound) · ${usd(fe.cost.selfHostMonthly)}/mo.`);
    push(`Fleet equation: ${fe.fleet.equation}`);
  }
  push("");

  // 5. Confidence — the exact ladder token + pricing provenance.
  push("## 5. Confidence");
  push(ev ? `Self-host capacity evidence state: ${ev.effectiveConfidence} (engine: ${ev.engineConfidence}).` : "No qualified self-host evidence.");
  push(`Pricing provenance: ${r.pricing.source} price book, as of ${r.pricing.asOf} (${r.pricing.region}); GPU price source: ${r.pricing.gpuPriceSource}.`);
  push("");

  // 6. Risks & exclusions — the SAME deterministic checklist the on-page panel renders.
  push("## 6. Risks & exclusions");
  const rangeLabels = ranges ? ranges.fields.map((f) => RANGE_FIELD_LABELS[f]) : undefined;
  const rangeNotes = ranges ? rangeDisclosures(ranges) : undefined;
  const focusId = selectedNonBest ? focus!.selectedId : undefined;
  for (const risk of riskLines(r, { rangeLabels, rangeNotes, focusId })) push(`- ${risk.text}`);
  push("");

  // 7. Advanced evidence — the full sweep audit (collapsed on page; complete here). Rejected or
  // ineligible candidates' dollar amounts are AUDIT DIAGNOSTICS, never comparable alternatives
  // (P1-UI4-2): eligibility and comparison-input status are explicit columns, and ineligible amounts
  // are marked "diagnostic only — not used". Exactly ONE row — the persisted
  // decision.costComparator.selfHostCandidateId — can be the self-host comparison input.
  push("## 7. Advanced evidence");
  push("Rejected or ineligible candidates' modeled projections below are audit diagnostics; they did not influence the recommendation and are not cost-comparison inputs.");
  push("");
  push("| Candidate | Feasible | SLA | Evidence | Recommendation eligible | Used in decision comparison | Boxes | Modeled diagnostic cost $/mo | State |");
  push("|---|---|---|---|---|---|---|---|---|");
  for (const e of r.evaluations) {
    const isComparator = e.config.id === r.decision.costComparator?.selfHostCandidateId;
    const amount = usd(e.cost.selfHostMonthly);
    const costCell = e.recommendationEligible ? amount : `${amount} (diagnostic only — not used)`;
    push(
      `| ${e.config.id} | ${e.technicallyFeasible ? "yes" : "no"} | ${e.slaQualified ? "yes" : "no"} | ${e.evidenceQualified ? "yes" : "no"} | ${e.recommendationEligible ? "yes" : "no"} | ${isComparator ? "yes (self-host comparison input)" : "no"} | ${e.fleet.boxes} | ${costCell} | ${e.effectiveConfidence} |`
    );
  }
  if (r.rejected.length) {
    push("");
    push("Rejected:");
    for (const rej of r.rejected) push(`- ${rej.config.id}: ${rej.code} — ${rej.message}`);
  }
  if (r.inputAdjustments.length) {
    push("");
    push("Input adjustments (entered → calculated):");
    for (const a of r.inputAdjustments) push(`- ${a.field}: ${a.entered} → ${a.calculated}`);
  }
  push("");
  return lines.join("\n");
}
