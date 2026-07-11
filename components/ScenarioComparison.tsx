"use client";

import type { Scenario } from "@/lib/scenarios";

export interface SavedRow {
  id: string;
  name: string;
  monthly: number;
  per1000: number;
}

function usd(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

interface ScenarioComparisonProps {
  scenarios: Scenario[];
  saved: SavedRow[];
  onSaveCurrent: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onLoad: (id: string) => void;
}

/**
 * The comparison is the product: generation strategies side by side, plus the
 * user's own saved configurations. Only complete scenarios are highlighted so
 * an unpriced managed service never looks like a real, cheaper option.
 */
export function ScenarioComparison({
  scenarios,
  saved,
  onSaveCurrent,
  onRename,
  onDuplicate,
  onDelete,
  onLoad,
}: ScenarioComparisonProps) {
  const baseMonthly = saved[0]?.monthly ?? 0;

  return (
    <div className="panel p-4">
      <div className="mb-1 text-sm font-medium text-slate-300">Compare scenarios</div>
      <div className="mb-3 text-xs text-slate-500">
        Generation strategies for the current configuration. Highlighted rows have a
        complete, verifiable cost.
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="pb-1.5 font-medium">Scenario</th>
              <th className="pb-1.5 text-right font-medium">Monthly</th>
              <th className="pb-1.5 text-right font-medium">Per 1K queries</th>
              <th className="pb-1.5 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-slate-800/60 ${
                  s.highlight ? "bg-accent/5" : ""
                }`}
              >
                <td className="py-2">
                  <div className="text-slate-200">{s.label}</div>
                  <div className="text-[11px] text-slate-500">{s.note}</div>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {s.monthly === null ? (
                    <span className="text-amber-400">Incomplete</span>
                  ) : (
                    <span className="font-semibold text-slate-100">{usd(s.monthly)}</span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-300">
                  {s.per1000 === null ? "—" : usd(s.per1000, 2)}
                </td>
                <td className="py-2 text-right">
                  <span
                    className={
                      s.difference === "Baseline"
                        ? "text-slate-400"
                        : !s.complete
                          ? "text-amber-400"
                          : s.difference.startsWith("+")
                            ? "text-rose-400"
                            : s.difference.startsWith("-")
                              ? "text-emerald-400"
                              : "text-slate-300"
                    }
                  >
                    {s.difference}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Saved configurations */}
      <div className="mt-5 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-300">Saved configurations</div>
        <button
          type="button"
          onClick={onSaveCurrent}
          className="rounded bg-accent/20 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/30"
        >
          + Save current
        </button>
      </div>

      {saved.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Save the current configuration to compare snapshots like “Current production”,
          “Growth case”, or “Optimized case”.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-1.5 font-medium">Name</th>
                <th className="pb-1.5 text-right font-medium">Monthly</th>
                <th className="pb-1.5 text-right font-medium">Per 1K</th>
                <th className="pb-1.5 text-right font-medium">vs first</th>
                <th className="pb-1.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {saved.map((row, i) => {
                const diff = i === 0 || baseMonthly === 0 ? 0 : (row.monthly - baseMonthly) / baseMonthly;
                return (
                  <tr key={row.id} className="border-b border-slate-800/60">
                    <td className="py-1.5">
                      <input
                        value={row.name}
                        onChange={(e) => onRename(row.id, e.target.value)}
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-200 hover:border-slate-700 focus:border-accent focus:outline-none"
                        aria-label="Scenario name"
                      />
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-200">{usd(row.monthly)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{usd(row.per1000, 2)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">
                      {i === 0 ? "—" : `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(0)}%`}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1.5 text-[11px]">
                        <button type="button" onClick={() => onLoad(row.id)} className="text-slate-400 hover:text-accent" title="Load into calculator">
                          Load
                        </button>
                        <button type="button" onClick={() => onDuplicate(row.id)} className="text-slate-400 hover:text-slate-200" title="Duplicate">
                          Dupe
                        </button>
                        <button type="button" onClick={() => onDelete(row.id)} className="text-slate-400 hover:text-rose-400" title="Delete">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
