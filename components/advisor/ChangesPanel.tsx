"use client";

// "What changed" — reason-coded change tracking rendered from the APPROVED structured change-diff
// (diffRecommendations over the previous vs current structured result). Structured-only: each row is a
// verbatim {code, field, before → after}; nothing is inferred from prose, and object-valued changes
// point to the structured audit rather than being summarized in invented language.
import type { RecommendationChange, RecommendationDiff } from "@/lib/recommendation";

const CODE_LABELS: Partial<Record<RecommendationChange["code"], string>> = {
  "decision-changed": "Decision",
  "comparator-changed": "Cost comparator",
  "api-model-changed": "API model",
  "best-self-host-changed": "Best self-host",
  "fleet-changed": "Fleet",
  "fleet-equation-changed": "Fleet equation",
  "cost-changed": "Cost",
  "confidence-changed": "Evidence state",
  "provenance-changed": "Provenance",
  "gate-changed": "Qualification gate",
  "rejection-changed": "Rejection reason",
  "rejection-details-changed": "Rejection details",
  "adjustments-changed": "Input adjustments",
  "effective-workload-changed": "Workload inputs",
  "pricing-changed": "Pricing provenance",
  "mode-changed": "Evidence mode",
  "candidate-added": "Configuration added",
  "candidate-removed": "Configuration removed",
  "latency-changed": "Latency",
  "serving-facts-changed": "Serving facts",
  "alternatives-changed": "Alternatives",
  "candidate-config-changed": "Configuration",
  "model-label-changed": "Model label",
  "api-option-changed": "API option",
  "control-comparison-changed": "Control comparison",
};

/** Render a change value: primitives verbatim; objects/arrays defer to the structured audit. */
function val(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "choice" in (v as object) && "basis" in (v as object)) {
    const d = v as { choice: string; basis: string };
    return `${d.choice} (${d.basis})`;
  }
  return "(structured value — see audit)";
}

export function ChangesPanel({ diff }: { diff: RecommendationDiff | null }) {
  if (!diff || diff.identical || diff.changes.length === 0) return null;
  return (
    <section aria-labelledby="changes-heading" data-testid="changes-panel" className="rounded-lg border border-sky-300 bg-sky-50 p-4">
      <h2 id="changes-heading" className="text-base font-semibold text-sky-900">
        What changed since your last input ({diff.changes.length})
      </h2>
      <ul className="mt-2 space-y-1 text-sm">
        {diff.changes.map((c, i) => (
          <li key={i} className="min-w-0 break-words" data-testid={`change-${c.code}`}>
            <code className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900">{c.code}</code>{" "}
            <span className="font-medium text-slate-800">{CODE_LABELS[c.code] ?? c.code}</span>
            {c.candidateId && <span className="text-xs text-slate-500"> · {c.candidateId}</span>}
            {c.field && <span className="text-xs text-slate-500"> · {c.field}</span>}
            <span className="ml-1 font-mono text-slate-700" data-testid="change-values">
              {val(c.before)} → {val(c.after)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Reason-coded from the structured results (deterministic change-diff); raw before/after values are
        preserved in the structured audit.
      </p>
    </section>
  );
}
