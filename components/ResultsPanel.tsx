"use client";

import type { CalcInputs, CalcResult, PriceBook } from "@/lib/types";
import { deriveDisplayMetrics } from "@/lib/derived";
import { buildScenarios } from "@/lib/scenarios";
import { computeSensitivity } from "@/lib/sensitivity";
import { activeProvider } from "@/lib/provider";
import { MetricCards } from "./MetricCards";
import { Sensitivity } from "./Sensitivity";
import { FlashValue } from "./FlashValue";
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
  const sensitivity = computeSensitivity(inputs, priceBook);

  const crossover = resultA.crossover;
  const hasGenVolume = crossover.monthlyGenTokens > 0;
  const isEfficient = crossover.verdict === "self-host efficient";

  // Human description of the ACTIVE scenario the headline numbers represent.
  const genModel = priceBook.models.find((m) => m.id === inputs.generation.llmModelId);
  const genModelName = genModel?.label?.replace(/\s*\(.*\)\s*$/, "") ?? inputs.generation.llmModelId;
  const scenarioLabel = metrics.selfHosted
    ? `Self-hosted ${genModelName} · ${inputs.generation.numInstances} × ${inputs.generation.gpuInstanceType}`
    : `${activeProvider.modelApi} API · ${genModelName}`;

  // Proxy-comparison disclosure: the API column uses a different model.
  const isProxyComparison =
    metrics.selfHosted &&
    !!inputs.generation.apiComparisonModelId &&
    inputs.generation.apiComparisonModelId !== inputs.generation.llmModelId;
  const compModelName =
    priceBook.models
      .find((m) => m.id === inputs.generation.apiComparisonModelId)
      ?.label?.replace(/\s*\(.*\)\s*$/, "") ?? inputs.generation.apiComparisonModelId;

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky summary strip — stays visible while editing inputs */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-b-lg border-b border-slate-800 bg-[#0b1220]/90 px-3 py-2 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <FlashValue className="text-lg font-bold text-slate-100">{usd(metrics.totalMonthly)}</FlashValue>
          <span className="text-xs text-slate-500">/month</span>
        </div>
        <div className="text-xs text-slate-400">
          {metrics.hasTraffic ? usd(metrics.costPer1000, 2) : "—"}{" "}
          <span className="text-slate-600">/ 1K queries</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            Pricing updated {formatDate(asOf)} · {activeProvider.label} {priceBook.region}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              stale ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
            }`}
            title={
              stale
                ? "Static deployment: the live AWS Pricing API isn't reachable, so committed reference prices are shown."
                : "Fetched live from the AWS Price List API."
            }
          >
            {stale ? "reference prices (not live)" : "live"}
          </span>
        </div>
      </div>

      {/* Selected scenario — what the headline numbers represent */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-accent">Selected scenario</span>
        <span className="font-medium text-slate-100">{scenarioLabel}</span>
        <span className="text-slate-500">· {metrics.queries.toLocaleString()} queries/mo</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
            metrics.selfHosted ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"
          }`}
        >
          {metrics.selfHosted ? "Self-hosted GPU" : "API"}
        </span>
      </div>

      {/* Headline metrics */}
      <MetricCards metrics={metrics} crossover={crossover} />

      {metrics.vectorStoreFloored && (
        <div className="-mt-3 flex items-start gap-2 px-1 text-xs text-slate-500">
          <span aria-hidden>ℹ</span>
          <span>
            {activeProvider.vectorStore} is at its minimum-{activeProvider.computeUnit} floor
            ({usd(metrics.opensearchFloor)}/mo). Corpus size and query load won&apos;t move the
            vector-store cost until the index or QPS outgrows the floor.
          </span>
        </div>
      )}

      {/* Dominant lever + utilization reality check */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel border-l-4 border-accent p-4">
          <div className="text-xs uppercase tracking-wide text-accent">Biggest cost driver</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {metrics.dominant.label} — {usd(metrics.dominant.monthly)} /mo (
            {formatPercent(metrics.dominant.share)} of total)
          </div>
        </div>

        {!hasGenVolume ? (
          <div className="panel border-l-4 border-slate-600 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Utilization reality check</div>
            <div className="mt-1 text-sm text-slate-400">
              No generation volume yet — utilization projection unavailable.
            </div>
          </div>
        ) : metrics.selfHosted ? (
          // Self-hosted: what utilization is the provisioned fleet ACTUALLY running?
          <div
            className={`panel border-l-4 p-4 ${
              crossover.realizedUtil < 0.1 ? "border-amber-500" : "border-emerald-500"
            }`}
          >
            <div
              className={`text-xs uppercase tracking-wide ${
                crossover.realizedUtil < 0.1 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              GPU utilization at this workload
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-100">
              ~{formatPercent(crossover.realizedUtil)} realized{" "}
              <span className="text-sm font-normal text-slate-500">
                (target {formatPercent(inputs.generation.utilTarget)})
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {crossover.realizedUtil < 0.1
                ? `The fleet is heavily underutilized — you're paying for ${crossover.boxes} instance(s) to serve a fraction of their decode capacity. An API is usually cheaper at this load.`
                : `Decode demand ≈ ${Math.round(metrics.monthlyOutputTokens / (730 * 3600)).toLocaleString()} output tok/s vs ${Math.round((crossover.boxes * crossover.capacity100) / (730 * 3600)).toLocaleString()} provisioned.`}
              {crossover.throughputInstances > crossover.boxes &&
                ` Capacity exceeded: needs ≥ ${crossover.throughputInstances} instances.`}
            </div>
          </div>
        ) : (
          // API mode: is self-hosting the same model even feasible?
          <div className={`panel border-l-4 p-4 ${isEfficient ? "border-emerald-500" : "border-amber-500"}`}>
            <div className={`text-xs uppercase tracking-wide ${isEfficient ? "text-emerald-400" : "text-amber-400"}`}>
              Self-hosting reality check
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-100">
              {crossover.breakEvenFeasible
                ? `${formatPercent(crossover.utilAtBreakEven)} fleet utilization needed to break even`
                : `break-even needs ${crossover.utilAtBreakEven.toFixed(1)}× the fleet's capacity — not achievable`}
            </div>
            <div className="mt-1 text-xs text-slate-400">{crossover.verdict}.</div>
          </div>
        )}
      </div>

      {/* Amber banner: an important price is estimated / unavailable */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <span aria-hidden className="mt-0.5 text-amber-400">⚠</span>
        <div className="text-amber-200/90">
          <span className="font-medium text-amber-300">Some figures are estimated or unavailable.</span>{" "}
          {activeProvider.managedService} managed pricing could not be verified, so any comparison
          involving it is marked incomplete rather than shown as a dollar figure.
        </div>
      </div>

      {/* Two build strategies — honest about unknown managed pricing */}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-slate-300">Two ways to build this</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="panel p-4">
            <div className="text-sm font-medium text-slate-200">{activeProvider.selfBuiltName}</div>
            <div className="mb-2 text-xs text-slate-500">{activeProvider.selfBuiltDesc}</div>
            <FlashValue className="text-3xl font-bold text-slate-100">
              {usd(resultA.totalMonthly$)}
            </FlashValue>
            <div className="text-xs text-slate-500">per month · fully priced</div>
          </div>

          <div className="panel border border-amber-500/30 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">{activeProvider.managedName}</span>
              <span
                className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                title="The engine currently models managed retrieval infra as identical to self-built; only the managed service fee is unknown."
              >
                not directly comparable
              </span>
            </div>
            <div className="mb-2 text-xs text-slate-500">{activeProvider.managedDesc}</div>
            <div className="space-y-1 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-400">
                  Known components{" "}
                  <span className="text-slate-600">(retrieval + embeddings + model API)</span>
                </span>
                <span className="font-semibold tabular-nums text-slate-100">
                  ≥ {usd(resultB.totalMonthly$)}<span className="text-xs font-normal text-slate-500">/mo</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-400">
                  + {activeProvider.managedServiceShort} service fee
                </span>
                <span className="text-amber-300">not published</span>
              </div>
            </div>
            <div className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-500">
              Reuses the self-built estimate for shared infra; the managed markup needs a vendor
              quote, so this can&apos;t be totaled.
            </div>
          </div>
        </div>
      </div>

      {isProxyComparison && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span aria-hidden className="mt-0.5 text-amber-400">⚠</span>
          <div className="text-amber-200/90">
            <span className="font-medium text-amber-300">Proxy comparison.</span> The API rows price{" "}
            <span className="text-amber-100">{compModelName}</span>, but you&apos;re self-hosting{" "}
            <span className="text-amber-100">{genModelName}</span> — a different model. Quality,
            context length, throughput, and output behavior may differ.
          </div>
        </div>
      )}

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

      {/* What moves cost most */}
      <Sensitivity rows={sensitivity} />

      {/* Self-hosted fleet adequacy */}
      {inputs.generation.mode === "self-hosted" &&
        crossover.throughputInstances > crossover.boxes && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span aria-hidden className="mt-0.5 text-amber-400">⚠</span>
            <div className="text-amber-200/90">
              <span className="font-medium text-amber-300">Under-provisioned for this load.</span> The
              {" "}{crossover.boxes}-instance fleet can serve about{" "}
              {Math.round((crossover.boxes / crossover.throughputInstances) * 100)}% of the traffic.
              Raise <span className="text-amber-100">Number of instances</span> to at least{" "}
              {crossover.throughputInstances} to keep up (currently billed for {crossover.boxes}).
            </div>
          </div>
        )}

      {/* Crossover economics */}
      <CrossoverChart crossover={resultA.crossover} />
    </div>
  );
}
