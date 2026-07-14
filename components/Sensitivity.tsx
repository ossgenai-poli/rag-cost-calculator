"use client";

import type { SensitivityRow } from "@/lib/sensitivity";

interface SensitivityProps {
  rows: SensitivityRow[];
}

/** "What moves cost most" — each lever bumped +10%, ranked by impact on total. */
export function Sensitivity({ rows }: SensitivityProps) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.deltaPct)), 1e-9);

  return (
    <div className="panel p-4">
      <div className="mb-1 text-sm font-medium text-slate-300">What moves cost most</div>
      <div className="mb-3 text-xs text-slate-500">
        Effect on the monthly total of a +10% change to each lever, holding the rest fixed.
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const pct = r.deltaPct * 100;
          const width = (Math.abs(r.deltaPct) / max) * 100;
          const negligible = Math.abs(pct) < 0.05;
          return (
            <div key={r.label} className="flex items-center gap-3 text-sm">
              <div className="w-40 shrink-0 text-slate-400">{r.label}</div>
              <div className="relative h-4 flex-1 rounded bg-slate-900/60">
                {!r.atCap && (
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-accent/70"
                    style={{ width: `${Math.max(width, negligible ? 0 : 2)}%` }}
                  />
                )}
              </div>
              {/* P2-1: a lever at its supported maximum can't be bumped +10%, so we
                  label it instead of reporting a false 0%. */}
              <div
                className={`w-28 shrink-0 text-right text-xs tabular-nums ${
                  r.atCap ? "text-amber-400" : "text-slate-300"
                }`}
                title={r.atCap ? "This input is at its supported maximum — a +10% bump can't be applied." : undefined}
              >
                {r.atCap ? "at max (can't +10%)" : negligible ? "~0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
