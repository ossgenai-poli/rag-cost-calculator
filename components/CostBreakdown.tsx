"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CostBreakdownLine } from "@/lib/types";
import type { BreakdownRow, DisplayMetrics } from "@/lib/derived";

const COLORS: Record<CostBreakdownLine["category"], string> = {
  generation: "#fbbf24",
  vectorstore: "#a78bfa",
  rerank: "#e879f9",
  query: "#34d399",
  ingestion: "#38bdf8",
  guardrails: "#f87171",
  ops: "#94a3b8",
};

function usd(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function usdShort(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

function share(fraction: number): string {
  if (fraction > 0 && fraction < 0.001) return "<0.1%";
  return `${(fraction * 100).toFixed(1)}%`;
}

interface CostBreakdownProps {
  metrics: DisplayMetrics;
}

/** Table + per-component bars. Generation dwarfs everything, so a toggle lets
 *  users exclude it and inspect the smaller RAG costs. */
export function CostBreakdown({ metrics }: CostBreakdownProps) {
  const [excludeGen, setExcludeGen] = useState(false);

  const rows: BreakdownRow[] = excludeGen
    ? metrics.breakdown.filter((r) => r.category !== "generation")
    : metrics.breakdown;

  const subtotal = rows.reduce((sum, r) => sum + r.monthly, 0);
  // When generation is excluded, re-base shares against the remaining subtotal.
  const displayShare = (r: BreakdownRow) =>
    excludeGen ? (subtotal > 0 ? r.monthly / subtotal : 0) : r.share;

  const chartData = rows.map((r) => ({
    name: r.label.replace(/\s*\(.*\)\s*/, ""),
    monthly: r.monthly,
    category: r.category,
    pct: displayShare(r),
  }));

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-300">Cost breakdown by component</div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            className="accent-accent"
            checked={excludeGen}
            onChange={(e) => setExcludeGen(e.target.checked)}
          />
          Exclude generation
        </label>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="pb-1.5 font-medium">Component</th>
              <th className="pb-1.5 text-right font-medium">Monthly cost</th>
              <th className="pb-1.5 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category} className="border-b border-slate-800/60">
                <td className="py-1.5">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COLORS[r.category] }} />
                  <span className="align-middle text-slate-300">{r.label}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-200">{usd(r.monthly)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">{share(displayShare(r))}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-1.5 font-medium text-slate-300">
                {excludeGen ? "Subtotal (excl. generation)" : "Total"}
              </td>
              <td className="pt-1.5 text-right font-semibold tabular-nums text-slate-100">{usd(subtotal)}</td>
              <td className="pt-1.5 text-right tabular-nums text-slate-500">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bars — value on the bar, $ + share on hover */}
      <div className="mt-4 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 44 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              stroke="#64748b"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "#1e293b55" }}
              contentStyle={{ background: "#111a2e", border: "1px solid #1e293b", borderRadius: 8 }}
              labelStyle={{ color: "#e2e8f0" }}
              formatter={(value: number, _n: string, entry: { payload?: { pct?: number } }) => [
                `${usd(value)} · ${share(entry?.payload?.pct ?? 0)}`,
                "Monthly",
              ]}
            />
            <Bar dataKey="monthly" radius={[0, 4, 4, 0]}>
              {chartData.map((d) => (
                <Cell key={d.category} fill={COLORS[d.category]} />
              ))}
              <LabelList
                dataKey="monthly"
                position="right"
                formatter={(v: number) => usdShort(v)}
                style={{ fill: "#94a3b8", fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
