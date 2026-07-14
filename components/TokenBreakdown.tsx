"use client";

import type { DisplayMetrics } from "@/lib/derived";

function n(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function usd(value: number, decimals = 4): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

interface TokenBreakdownProps {
  metrics: DisplayMetrics;
}

/**
 * Shows exactly how the per-query model token count is assembled. This makes it
 * obvious why Top N, chunk size, or output length move the cost.
 */
export function TokenBreakdown({ metrics }: TokenBreakdownProps) {
  const t = metrics.tokenConstruction;
  const rows = [
    { label: "User query", value: t.query, formula: "query length" },
    {
      label: "Retrieved context",
      value: t.retrievedContext,
      formula: "chunks sent to LLM × chunk size",
      emphasis: true,
    },
    { label: "System prompt & formatting", value: t.promptOverhead, formula: "prompt overhead" },
  ];

  return (
    <div className="panel p-4">
      <div className="mb-1 text-sm font-medium text-slate-300">
        Model tokens per query
      </div>
      <div className="mb-3 text-xs text-slate-500">
        {metrics.selfHosted
          ? `Self-hosted: generation is billed by GPU fleet time, not tokens — ~${usd(metrics.generationPerQuery)}/query at this volume. Token counts still set the required throughput.`
          : `API: generation is billed on these tokens — ${usd(metrics.generationPerQuery)} of LLM spend per query.`}
      </div>

      <div className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <span className="text-slate-400">
              {r.label}
              <span className="ml-2 text-[11px] text-slate-600">{r.formula}</span>
            </span>
            <span className={`tabular-nums ${r.emphasis ? "text-slate-100" : "text-slate-300"}`}>
              {n(r.value)}
            </span>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-3 border-t border-slate-800 pt-1.5">
          <span className="font-medium text-slate-300">Total input</span>
          <span className="font-semibold tabular-nums text-slate-100">{n(t.totalInput)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-400">Output (generated answer)</span>
          <span className="tabular-nums text-slate-300">{n(t.output)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-slate-700 pt-1.5">
          <span className="font-semibold text-slate-200">Total model tokens</span>
          <span className="text-base font-bold tabular-nums text-accent">{n(t.totalModel)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-800 pt-3 text-xs">
        <div>
          <div className="text-slate-500">Monthly input tokens</div>
          <div className="tabular-nums text-slate-300">{n(metrics.monthlyInputTokens)}</div>
        </div>
        <div>
          <div className="text-slate-500">Monthly output tokens</div>
          <div className="tabular-nums text-slate-300">{n(metrics.monthlyOutputTokens)}</div>
        </div>
        <div>
          <div className="text-slate-500">Vectors stored</div>
          <div className="tabular-nums text-slate-300" title="Corpus tokens ÷ effective chunk size">
            {n(metrics.numVectors)}
          </div>
        </div>
      </div>
    </div>
  );
}
