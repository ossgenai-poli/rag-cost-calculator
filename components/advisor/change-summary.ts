// Compact customer impact summary derived DETERMINISTICALLY from the approved structured change-diff
// (P2-UI2-2). Every item is a template over decision / gate / rejection / confidence / fleet / cost
// change codes and their verbatim before/after values — nothing is inferred from unstructured data.
// The complete reason-coded audit stays available (collapsed) in the ChangesPanel.
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

/** Structured template per basis — used when the decision basis changes (never invented prose). */
const BASIS_MEANING: Record<string, string> = {
  "lower-cost": "a trustworthy cost comparison decided it",
  "evidence-gap": "no SLA-compatible configuration has qualifying evidence",
  "no-modeled-candidate": "no self-host configuration is modeled for this model",
  "self-host-unavailable": "self-host weights are unavailable for this model",
  "self-host-infeasible": "no modeled self-host configuration is technically feasible",
  sla: "the modeled self-host configurations miss the SLA",
  "comparison-unavailable": "a trustworthy cost comparison is unavailable",
};

/** Derive a compact (≤6 item) impact summary, priority-ordered. Pure and deterministic. */
export function summarizeChanges(diff: RecommendationDiff): SummaryItem[] {
  const items: SummaryItem[] = [];
  const find = (code: RecommendationChange["code"], field?: string) =>
    diff.changes.filter((c) => c.code === code && (field === undefined || c.field === field));

  // 1. Decision basis/choice change — with the structured meaning of the new basis.
  const dec = find("decision-changed", "decision")[0];
  if (dec) {
    const b = dec.before as { choice: string; basis: string };
    const a = dec.after as { choice: string; basis: string };
    const meaning = BASIS_MEANING[a.basis] ? ` — ${BASIS_MEANING[a.basis]}` : "";
    items.push({ key: "decision", text: `Decision: ${b.choice} (${b.basis}) → ${a.choice} (${a.basis})${meaning}.` });
  }

  // 2. Per-candidate SLA gate failures (rejection-changed → sla-unmet…): the measured option misses
  //    the selected SLA.
  for (const c of find("rejection-changed")) {
    if (c.after === "sla-unmet-ttft-or-streaming") {
      items.push({ key: `sla-${c.candidateId}`, text: `${shortId(c.candidateId)}: now fails the selected SLA (rejection: sla-unmet-ttft-or-streaming).` });
    }
  }

  // 3. Best self-host option removed / replaced / re-costed. A same-id change means the CARD content
  //    changed — summarize its material cost movement, never a vacuous "X → X".
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

  // 4./5. Material fleet + cost changes — the BEST self-host candidate first, so the cap never
  //       truncates the most decision-relevant rows.
  const bestId = afterId ?? beforeId ?? null;
  const bestFirst = (a: RecommendationChange, b: RecommendationChange) =>
    (a.candidateId === bestId ? -1 : 0) - (b.candidateId === bestId ? -1 : 0);
  for (const c of [...find("fleet-changed", "fleet.boxes")].sort(bestFirst)) {
    items.push({ key: `fleet-${c.candidateId}`, text: `Fleet (${shortId(c.candidateId)}): ${num(c.before)} → ${num(c.after)} box(es).` });
  }
  for (const c of [...find("cost-changed", "cost.selfHostMonthly")].sort(bestFirst)) {
    items.push({ key: `cost-${c.candidateId}`, text: `Self-host cost (${shortId(c.candidateId)}): ${usd(c.before)} → ${usd(c.after)}/mo.` });
  }
  const apiCost = find("cost-changed", "apiOption.monthlyCost")[0];
  if (apiCost) items.push({ key: "api-cost", text: `API cost: ${usd(apiCost.before)} → ${usd(apiCost.after)}/mo.` });

  // 6. Evidence-state demotions (effectiveConfidence).
  for (const c of find("confidence-changed", "effectiveConfidence")) {
    items.push({ key: `conf-${c.candidateId}`, text: `Evidence state (${shortId(c.candidateId)}): ${String(c.before)} → ${String(c.after)}.` });
  }

  return items.slice(0, 6);
}
