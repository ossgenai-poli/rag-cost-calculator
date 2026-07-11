"use client";

import type { CalcResult } from "@/lib/types";

function formatUSD(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

interface MetricCardsProps {
  result: CalcResult;
}

/** Headline metric cards for the currently active mode's CalcResult. */
export function MetricCards({ result }: MetricCardsProps) {
  const { vectorStore, perQuery, totalMonthly$, crossover, mode } = result;

  const cards = [
    {
      label: "Total",
      value: formatUSD(totalMonthly$),
      sub: "per month",
    },
    {
      label: "Per Query",
      value: formatUSD(perQuery.perQuery$, 4),
      sub: mode === "A" ? "self-built pipeline" : "Bedrock Knowledge Bases",
    },
    {
      label: "Vector Store",
      value: formatUSD(vectorStore.opensearchMonthly$),
      sub: `${vectorStore.searchOCU.toFixed(2)} search OCU · ${vectorStore.ramGB.toFixed(1)} GB RAM`,
    },
    {
      label: "Always-on Floor",
      value: formatUSD(vectorStore.opensearchFloor$),
      sub: "min OCU baseline, runs 24/7",
    },
    {
      label: "Monthly Gen Tokens",
      value: formatTokens(crossover.monthlyGenTokens),
      sub: "output tokens / month",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="panel p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            {c.label}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {c.value}
          </div>
          <div className="mt-1 text-xs text-slate-500">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
