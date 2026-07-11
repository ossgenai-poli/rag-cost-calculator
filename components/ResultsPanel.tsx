"use client";

import type { CalcInputs, CalcResult, PriceBook } from "@/lib/types";
import { deriveDisplayMetrics } from "@/lib/derived";
import { buildScenarios } from "@/lib/scenarios";
import { MetricCards } from "./MetricCards";
import { TokenBreakdown } from "./TokenBreakdown";
import { CostBreakdown } from "./CostBreakdown";
import { ScenarioComparison, type SavedRow } from "./ScenarioComparison";
import { CrossoverChart } from "./CrossoverChart";

function usd(value: number, decimals = 0): string {
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

/** "2026-07-11" -> "Jul 11, 2026" without any timezone drift. */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIdx = Number(m[2]) - 1;
  return `${months[monthIdx] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

export interface ResultsPanelProps {
  resultA: CalcResult;
  resultB: CalcResult;
  inputs: CalcInputs;
  priceBook: PriceBook;
  asOf: string;
  stale: boolean;
  saved: SavedRow[];
  onSaveCurrent: () => void;
  onRenameSaved: (id: string, name: string) => void;
  onDuplicateSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  onLoadSaved: (id: string) => void;
}

export function ResultsPanel({
  resultA,
  resultB,
  inputs,
  priceBook,
  asOf,
  stale,
  saved,
  onSaveCurrent,
  onRenameSaved,
  onDuplicateSaved,
  onDeleteSaved,
  onLoadSaved,
}: ResultsPanelProps) {
  const metrics = deriveDisplayMetrics(resultA, inputs);
  const scenarios = buildScenarios(resultA, inputs);

  const crossover = resultA.crossover;
  const hasGenVolume = crossover.monthlyGenTokens > 0;
  const isEfficient = crossover.verdict === "self-host efficient";

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky summary strip — stays visible while editing inputs */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-4 rounded-b-lg border-b border-slate-800 bg-[#0b1220]/90 px-3 py-2 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-100">{usd(metrics.totalMonthly)}</span>
          <span className="text-xs text-slate-500">/month</span>
        </div>
        <div className="text-xs text-slate-400">
          {usd(metrics.costPer1000, 2)} <span className="text-slate-600">/ 1K queries</span>
        </div>
        <div className="text-xs text-slate-500">
          Pricing updated {formatDate(asOf)} · AWS {priceBook.region}
          {stale && <span className="ml-2 text-sky-400">reference prices</span>}
        </div>
      </div>

      {/* Headline metrics */}
      <MetricCards metrics={metrics} crossover={crossover} />

      {/* Dominant lever + utilization reality check */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel border-l-4 border-accent p-4">
          <div className="text-xs uppercase tracking-wide text-accent">Biggest cost driver</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {metrics.dominant.label} — {usd(metrics.dominant.monthly)} /mo (
            {formatPercent(metrics.dominant.share)} of total)
          </div>
        </div>

        {hasGenVolume ? (
          <div className={`panel border-l-4 p-4 ${isEfficient ? "border-emerald-500" : "border-amber-500"}`}>
            <div className={`text-xs uppercase tracking-wide ${isEfficient ? "text-emerald-400" : "text-amber-400"}`}>
              Utilization reality check
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-100">
              {formatPercent(crossover.utilAtBreakEven)} required GPU utilization at break-even —{" "}
              {crossover.verdict}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              GPU idle time below break-even utilization means the API often wins in practice,
              even when self-hosting looks cheaper on paper.
            </div>
          </div>
        ) : (
          <div className="panel border-l-4 border-slate-600 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Utilization reality check</div>
            <div className="mt-1 text-sm text-slate-400">
              No generation volume yet — break-even projection unavailable.
            </div>
          </div>
        )}
      </div>

      {/* Amber banner: an important price is estimated / unavailable */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <span aria-hidden className="mt-0.5 text-amber-400">⚠</span>
        <div className="text-amber-200/90">
          <span className="font-medium text-amber-300">Some figures are estimated or unavailable.</span>{" "}
          Bedrock Knowledge Bases managed pricing could not be verified, so any comparison
          involving it is marked incomplete rather than shown as a dollar figure.
        </div>
      </div>

      {/* Mode A vs Mode B — honest about unknown managed pricing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <div className="text-sm font-medium text-slate-300">Mode A — Self-built</div>
          <div className="mt-2 text-3xl font-bold text-slate-100">{usd(resultA.totalMonthly$)}</div>
          <div className="text-xs text-slate-500">per month · fully priced</div>
        </div>
        <div className="panel border border-amber-500/30 p-4">
          <div className="text-sm font-medium text-slate-300">Mode B — Bedrock Knowledge Bases</div>
          <div className="mt-2 text-2xl font-bold text-amber-300">Pricing incomplete</div>
          <div className="mt-2 text-xs leading-relaxed text-slate-400">
            Estimated infrastructure subtotal: {usd(resultB.totalMonthly$)}/month. Bedrock
            Knowledge Bases managed charges are <span className="text-slate-300">not included</span>{" "}
            because published pricing could not be verified.
          </div>
        </div>
      </div>

      {/* Central comparison + saved scenarios */}
      <ScenarioComparison
        scenarios={scenarios}
        saved={saved}
        onSaveCurrent={onSaveCurrent}
        onRename={onRenameSaved}
        onDuplicate={onDuplicateSaved}
        onDelete={onDeleteSaved}
        onLoad={onLoadSaved}
      />

      {/* Token construction + cost breakdown */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TokenBreakdown metrics={metrics} />
        <CostBreakdown metrics={metrics} />
      </div>

      {/* Crossover economics */}
      <CrossoverChart crossover={resultA.crossover} />
    </div>
  );
}
