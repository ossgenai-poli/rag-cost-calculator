"use client";

import type { CrossoverResult } from "@/lib/types";
import type { DisplayMetrics } from "@/lib/derived";

function usd(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function tokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** Shorten the engine's category label to a plain-language driver name. */
function driverName(label: string): string {
  if (/generation/i.test(label)) return "LLM generation";
  if (/vector store/i.test(label)) return "Vector store";
  if (/ingestion/i.test(label)) return "Ingestion";
  if (/guardrail/i.test(label)) return "Guardrails";
  if (/query/i.test(label)) return "Query processing";
  return label;
}

interface MetricCardsProps {
  metrics: DisplayMetrics;
  crossover: CrossoverResult;
}

/**
 * Three primary cards carry the headline; everything else is a smaller
 * secondary metric so the summary has a clear visual hierarchy.
 */
export function MetricCards({ metrics, crossover }: MetricCardsProps) {
  const primary = [
    {
      label: "Estimated monthly cost",
      value: usd(metrics.totalMonthly),
      sub: `${usd(metrics.costPerQuery, 4)} per query`,
    },
    {
      label: "Total cost per 1,000 queries",
      value: usd(metrics.costPer1000, 2),
      sub: "easier to compare than $/query",
    },
    {
      label: "Largest cost driver",
      value: `${driverName(metrics.dominant.label)} · ${pct(metrics.dominant.share)}`,
      sub: `${usd(metrics.dominant.monthly)} /mo`,
      small: true,
    },
  ];

  const secondary = [
    { label: "Vector store", value: `${usd(metrics.vectorStoreMonthly, 2)}/mo` },
    { label: "Annualized cost", value: `${usd(metrics.annualized)}/yr` },
    { label: "Total LLM tokens", value: `${tokens(metrics.monthlyLlmTokens)}/mo` },
    { label: "GPU crossover", value: `${tokens(crossover.breakEvenTokens)} tok/mo` },
    { label: "Break-even sustained QPS", value: crossover.equivalentQPS.toFixed(2) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {primary.map((c) => (
          <div key={c.label} className="panel p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div>
            <div
              className={`mt-1 font-bold text-slate-100 ${
                c.small ? "text-xl" : "text-3xl"
              }`}
            >
              {c.value}
            </div>
            <div className="mt-1 text-xs text-slate-500">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="panel grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {secondary.map((c) => (
          <div key={c.label}>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-200 tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
