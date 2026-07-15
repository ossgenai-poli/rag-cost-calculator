// Compact customer impact summary derived DETERMINISTICALLY from the approved structured change-diff
// (P2-UI2-2, revised per iteration-2 HOLD-2). Summary slots are RESERVED BY CATEGORY — never "append
// everything and slice" — so the cap can never truncate a more material fact (P2-UI2-3):
//   1. decision change
//   2. aggregated SLA/evidence consequence
//   3. best-self-host removal/change
//   4. the most decision-relevant candidate's FLEET change
//   5. the most decision-relevant candidate's COST change
//   6. an evidence-state change or another material outcome
// A non-identical diff NEVER yields an empty summary (P2-UI2-4): a workload-assumptions-only diff gets a
// deterministic fallback sentence. Every item is a template over change codes and verbatim before/after
// values; per-candidate detail remains in the full technical audit.
import type { RecommendationChange, RecommendationDiff } from "@/lib/recommendation";

export interface SummaryItem {
  key: string;
  text: string;
}

const usd = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
    : "—";
const num = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-US").format(v) : "—";
const shortId = (id: string | null): string => (id ? id.split("·").slice(1).join(" · ") || id : "");
/** The instance segment of a canonical candidate id (model·instance·wXkvY). */
const instanceOf = (id: string | null): string | null => (id ? id.split("·")[1] ?? null : null);

/** Structured template per basis — used when the decision basis changes (never invented prose).
 *  `lower-cost` is handled in code (P1-UI3-1): its meaning depends on the comparator's structured
 *  pricing qualification — "trustworthy" ONLY for the reference on-demand book rate. */
const BASIS_MEANING: Record<string, string> = {
  "evidence-gap": "no SLA-compatible configuration has qualifying evidence",
  "no-modeled-candidate": "no self-host configuration is modeled for this model",
  "self-host-unavailable": "self-host weights are unavailable for this model",
  "self-host-infeasible": "no modeled self-host configuration is technically feasible",
  sla: "the modeled self-host configurations miss the SLA",
  "comparison-unavailable": "a trustworthy cost comparison is unavailable",
};

/** Change codes that represent a MODELED OUTCOME (vs input/provenance bookkeeping). */
const OUTCOME_CODES = new Set<RecommendationChange["code"]>([
  "decision-changed", "comparator-changed", "best-self-host-changed", "gate-changed", "rejection-changed",
  "rejection-details-changed", "confidence-changed", "fleet-changed", "fleet-equation-changed",
  "cost-changed", "candidate-added", "candidate-removed", "latency-changed", "api-model-changed",
]);

/** Derive the ≤6-item, slot-reserved impact summary. Pure and deterministic. */
export function summarizeChanges(diff: RecommendationDiff): SummaryItem[] {
  const items: SummaryItem[] = [];
  const find = (code: RecommendationChange["code"], field?: string) =>
    diff.changes.filter((c) => c.code === code && (field === undefined || c.field === field));

  // Slot 1 — decision change, with the structured meaning of the new basis.
  const dec = find("decision-changed", "decision")[0];
  if (dec) {
    const b = dec.before as { choice: string; basis: string };
    const a = dec.after as { choice: string; basis: string };
    let meaning = BASIS_MEANING[a.basis] ? ` — ${BASIS_MEANING[a.basis]}` : "";
    if (a.basis === "lower-cost") {
      // P1-UI3-1: read the comparator's STRUCTURED pricing qualification from the diff payload.
      // "trustworthy" is reserved for the reference on-demand book rate; anything else — indicative
      // planning factors, overrides, or an unreadable qualification — fails closed to "modeled".
      const q = (find("comparator-changed")[0]?.after as { pricingQualification?: string } | null | undefined)?.pricingQualification;
      meaning = q === "reference" ? " — a trustworthy cost comparison decided it" : " — a modeled cost comparison decided it";
    }
    items.push({ key: "decision", text: `Decision: ${b.choice} (${b.basis}) → ${a.choice} (${a.basis})${meaning}.` });
  }

  // Slot 2 — aggregated SLA consequence (one slot regardless of how many candidates flipped).
  const slaFails = find("rejection-changed").filter((c) => c.after === "sla-unmet-ttft-or-streaming");
  if (slaFails.length === 1) {
    items.push({ key: "sla", text: `${shortId(slaFails[0].candidateId)}: now fails the selected SLA (rejection: sla-unmet-ttft-or-streaming).` });
  } else if (slaFails.length > 1) {
    const instances = new Set(slaFails.map((c) => instanceOf(c.candidateId)));
    const subject = instances.size === 1 && instances.values().next().value
      ? `${slaFails.length === 2 ? "Both" : slaFails.length} modeled ${instances.values().next().value} configurations`
      : `${slaFails.length} modeled configurations`;
    items.push({ key: "sla", text: `${subject} now fail the selected SLA (rejection: sla-unmet-ttft-or-streaming).` });
  }

  // Slot 3 — best self-host removed / replaced / re-costed (same-id card → its cost movement).
  const bsh = find("best-self-host-changed")[0];
  const bshBefore = bsh?.before as { config?: { id?: string }; costMonthly?: number | null } | string | null | undefined;
  const bshAfter = bsh?.after as { config?: { id?: string }; costMonthly?: number | null } | string | null | undefined;
  const beforeId = typeof bshBefore === "string" ? bshBefore : bshBefore?.config?.id ?? null;
  const afterId = typeof bshAfter === "string" ? bshAfter : bshAfter?.config?.id ?? null;
  if (bsh) {
    if (bshAfter === null || afterId === null) {
      items.push({ key: "best-self-host", text: `Best self-host option removed (was ${shortId(beforeId)}).` });
    } else if (beforeId === afterId && typeof bshBefore === "object" && typeof bshAfter === "object") {
      items.push({ key: "best-self-host", text: `Best self-host option (${shortId(afterId)}): ${usd(bshBefore?.costMonthly)} → ${usd(bshAfter?.costMonthly)}/mo.` });
    } else {
      items.push({ key: "best-self-host", text: `Best self-host option: ${shortId(beforeId) || "none"} → ${shortId(afterId)}.` });
    }
  }

  // Slots 4-5 — the MOST DECISION-RELEVANT candidate's fleet + cost movement (one row each, reserved;
  // other candidates stay in the audit). Relevance: the previously/newly best candidate, else the first
  // changed candidate in deterministic diff order.
  const fleetRows = find("fleet-changed", "fleet.boxes");
  const costRows = find("cost-changed", "cost.selfHostMonthly");
  const relevantId =
    beforeId ?? afterId ?? fleetRows[0]?.candidateId ?? costRows[0]?.candidateId ?? null;
  const fleetRow = fleetRows.find((c) => c.candidateId === relevantId) ?? fleetRows[0];
  if (fleetRow) {
    items.push({ key: "fleet", text: `Fleet (${shortId(fleetRow.candidateId)}): ${num(fleetRow.before)} → ${num(fleetRow.after)} box(es).` });
  }
  const costRow = costRows.find((c) => c.candidateId === relevantId) ?? costRows[0];
  if (costRow) {
    items.push({ key: "cost", text: `Self-host cost (${shortId(costRow.candidateId)}): ${usd(costRow.before)} → ${usd(costRow.after)}/mo.` });
  }

  // Slot 6 — an evidence-state change, else the API cost movement, as another material outcome.
  const conf = find("confidence-changed", "effectiveConfidence")[0];
  if (conf) {
    items.push({ key: "confidence", text: `Evidence state (${shortId(conf.candidateId)}): ${String(conf.before)} → ${String(conf.after)}.` });
  } else {
    const apiCost = find("cost-changed", "apiOption.monthlyCost")[0];
    if (apiCost) items.push({ key: "api-cost", text: `API cost: ${usd(apiCost.before)} → ${usd(apiCost.after)}/mo.` });
  }

  // P2-UI2-4 — a non-identical diff must NEVER produce an empty summary. Workload-assumptions-only diffs
  // get the deterministic no-outcome sentence; any other outcome-less diff gets the generic fallback.
  if (items.length === 0 && diff.changes.length > 0) {
    const hasWorkload = diff.changes.some((c) => c.code === "effective-workload-changed" || c.code === "adjustments-changed");
    const hasOutcome = diff.changes.some((c) => OUTCOME_CODES.has(c.code));
    items.push({
      key: "no-outcome",
      text: hasWorkload && !hasOutcome
        ? "Workload assumptions changed; the modeled decision, qualification, fleet, and cost did not change."
        : "No material modeled outcome changed.",
    });
  }

  return items.slice(0, 6);
}
