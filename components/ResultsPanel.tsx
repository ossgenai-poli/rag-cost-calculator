"use client";

import type { CalcResult, PriceBook } from "@/lib/types";
import { MetricCards } from "./MetricCards";
import { BreakdownChart } from "./BreakdownChart";
import { CrossoverChart } from "./CrossoverChart";

function formatUSD(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

interface ModeSummaryCardProps {
  result: CalcResult;
  label: string;
  estimated?: boolean;
}

function ModeSummaryCard({ result, label, estimated }: ModeSummaryCardProps) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-300">{label}</div>
        {estimated && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            some figures estimated
          </span>
        )}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-100">
        {formatUSD(result.totalMonthly$)}
      </div>
      <div className="text-xs text-slate-500">total / month</div>
    </div>
  );
}

export interface ResultsPanelProps {
  resultA: CalcResult;
  resultB: CalcResult;
  priceBook: PriceBook;
  asOf: string;
  stale: boolean;
}

/** Top-level results view. Consumes CalcResult output only — no cost recomputation. */
export function ResultsPanel({
  resultA,
  resultB,
  priceBook,
  asOf,
  stale,
}: ResultsPanelProps) {
  const delta = resultB.totalMonthly$ - resultA.totalMonthly$;
  const deltaPct =
    resultA.totalMonthly$ !== 0 ? (delta / resultA.totalMonthly$) * 100 : 0;

  const crossover = resultA.crossover;
  const hasGenVolume = crossover.monthlyGenTokens > 0;
  const isEfficient = crossover.verdict === "self-host efficient";

  return (
    <div className="flex flex-col gap-6">
      {/* Freshness line */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <span>Prices as of {asOf}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            stale
              ? "bg-amber-500/10 text-amber-400"
              : "bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {stale ? "stale / fallback" : "live"}
        </span>
        <span className="text-slate-600">·</span>
        <span>
          {priceBook.source} · {priceBook.region}
        </span>
      </div>

      {/* Headline metric cards for the active mode */}
      <MetricCards result={resultA} />

      {/* Dominant lever + utilization callouts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel border-l-4 border-accent p-4">
          <div className="text-xs uppercase tracking-wide text-accent">
            Biggest cost driver
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {resultA.dominantLever.label} —{" "}
            {formatUSD(resultA.dominantLever.monthly$)} /mo (
            {formatPercent(resultA.dominantLever.share)} of total)
          </div>
        </div>

        {hasGenVolume ? (
          <div
            className={`panel border-l-4 p-4 ${
              isEfficient ? "border-emerald-500" : "border-amber-500"
            }`}
          >
            <div
              className={`text-xs uppercase tracking-wide ${
                isEfficient ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              Utilization reality check
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-100">
              {formatPercent(crossover.utilAtBreakEven)} utilization at
              break-even — {crossover.verdict}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              GPU idle time below break-even utilization means the API often
              wins in practice, even when self-hosting looks cheaper on
              paper.
            </div>
          </div>
        ) : (
          <div className="panel border-l-4 border-slate-600 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Utilization reality check
            </div>
            <div className="mt-1 text-sm text-slate-400">
              No generation volume yet — break-even projection unavailable.
            </div>
          </div>
        )}
      </div>

      {/* Mode A vs Mode B side by side */}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-slate-300">
          Mode A vs Mode B
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ModeSummaryCard result={resultA} label="Mode A · Self-built" />
          <ModeSummaryCard
            result={resultB}
            label="Mode B · Bedrock Knowledge Bases"
            estimated
          />
        </div>
        <div className="panel p-3 text-sm text-slate-300">
          Mode B managed premium: {delta >= 0 ? "+" : "-"}
          {formatUSD(Math.abs(delta))} /mo ({delta >= 0 ? "+" : "-"}
          {Math.abs(deltaPct).toFixed(1)}%) — some Mode B figures are
          estimated pending Bedrock Knowledge Bases published pricing.
        </div>
        <BreakdownChart resultA={resultA} resultB={resultB} />
      </div>

      {/* Crossover economics */}
      <CrossoverChart crossover={resultA.crossover} />
    </div>
  );
}
