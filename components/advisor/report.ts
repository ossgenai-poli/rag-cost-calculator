// Stage-F export (10-result-hierarchy.md) — a PURE, deterministic Markdown report that reproduces the
// customer-ready hierarchy in its EXACT fixed order: 1 recommendation → 2 why → 3 cost →
// 4 architecture → 5 confidence → 6 risks & exclusions → 7 advanced evidence. Every line is a template
// over structured/narrated fields ("a reviewer who wasn't in the room reads it the same way"); the
// risks block is the SAME riskLines() the on-page panel renders, so page and export cannot diverge.
// Byte-identical output for identical input — no timestamps, no locale drift, no invented facts.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { heroLine, perQuery } from "./DecisionSummary";
import { riskLines, relevantEvaluation } from "./risks";

const usd = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
    : "unavailable";
const num = (v: number): string => new Intl.NumberFormat("en-US").format(v);

/** Build the deterministic Markdown report. Pure function of the narrated result. */
export function buildReport(r: NarratedRecommendationResult): string {
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

  // 1. Recommendation — the bounded one-line verdict with the evidence chip beside it.
  push("## 1. Recommendation");
  push(`**${heroLine(r)}** (basis: ${r.decision.basis})`);
  push(`Evidence: ${r.bestSelfHost ? r.bestSelfHost.confidence : "no qualified self-host evidence"}`);
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
  push("");

  // 4. Recommended architecture — model · instance · precision · fleet, equation verbatim.
  push("## 4. Recommended architecture");
  if (ev) {
    const sf = ev.servingFacts;
    push(`${r.selfHostModelLabel} · ${sf.instanceType} (${sf.gpuSku}) · ${sf.weightPrecision} weights / ${sf.kvPrecision} KV · ${ev.fleet.boxes} boxes (${ev.fleet.bindingDim}-bound).`);
    push(`Fleet equation: ${ev.fleet.equation}`);
    push(`Operations: ${Math.round(r.effectiveWorkload.generation.utilTarget * 100)}% utilization target · N+1 ${r.effectiveWorkload.generation.haEnabled ? "on" : "off"} · ${num(r.effectiveWorkload.generation.gpuUptimeHoursPerMonth)} h/mo · ${sf.gpuPricingModel} purchasing (${usd(sf.gpuPricePerHr)}/hr on-demand base rate).`);
  } else {
    push("No self-host configuration is described for this result.");
  }
  push("");

  // 5. Confidence — the exact ladder token + pricing provenance.
  push("## 5. Confidence");
  push(ev ? `Evidence state: ${ev.effectiveConfidence} (engine: ${ev.engineConfidence}).` : "No qualified self-host evidence.");
  push(`Pricing provenance: ${r.pricing.source} price book, as of ${r.pricing.asOf} (${r.pricing.region}); GPU price source: ${r.pricing.gpuPriceSource}.`);
  push("");

  // 6. Risks & exclusions — the SAME deterministic checklist the on-page panel renders.
  push("## 6. Risks & exclusions");
  for (const risk of riskLines(r)) push(`- ${risk.text}`);
  push("");

  // 7. Advanced evidence — the full sweep audit (collapsed on page; complete here).
  push("## 7. Advanced evidence");
  push("| Candidate | Feasible | SLA | Evidence | Boxes | Self-host $/mo | State |");
  push("|---|---|---|---|---|---|---|");
  for (const e of r.evaluations) {
    push(
      `| ${e.config.id} | ${e.technicallyFeasible ? "yes" : "no"} | ${e.slaQualified ? "yes" : "no"} | ${e.evidenceQualified ? "yes" : "no"} | ${e.fleet.boxes} | ${usd(e.cost.selfHostMonthly)} | ${e.effectiveConfidence} |`
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
