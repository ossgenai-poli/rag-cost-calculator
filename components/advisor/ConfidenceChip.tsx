"use client";

// Confidence ladder chip (docs/ux-v2/09-trust-provenance.md). Renders the EXACT structured
// effective-confidence token — never a re-worded category. `unbenchmarked` (the Phase-1 registry
// demotion floor) extends the Phase-0 ladder with a neutral dark chip (open UX decision UI-D2).
import type { EffectiveConfidence } from "@/lib/recommendation";

const CHIP: Record<EffectiveConfidence, { label: string; cls: string }> = {
  measured: { label: "Measured", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  "measured-scaled": { label: "Measured·scaled", cls: "bg-lime-100 text-lime-900 border-lime-300" },
  extrapolated: { label: "Extrapolated", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  proxy: { label: "Proxy", cls: "bg-sky-100 text-sky-900 border-sky-300" },
  heuristic: { label: "Heuristic", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  unbenchmarked: { label: "Unbenchmarked", cls: "bg-slate-700 text-slate-100 border-slate-600" },
};

export function ConfidenceChip({ confidence }: { confidence: EffectiveConfidence }) {
  const c = CHIP[confidence];
  return (
    <span
      data-testid="confidence-chip"
      data-confidence={confidence}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${c.cls}`}
      title={`Evidence state: ${confidence}`}
    >
      {c.label}
    </span>
  );
}
