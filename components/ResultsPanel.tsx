"use client";

import type { CalcInputs, CalcResult, PriceBook } from "@/lib/types";
import { deriveDisplayMetrics } from "@/lib/derived";
import { inputClampNotes } from "@/lib/calc-engine";
import { buildScenarios } from "@/lib/scenarios";
import { effectiveRequiredInstances } from "@/lib/grounding";
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
  /** EFFECTIVE (clamped) inputs — everything displayed derives from these (P1). */
  inputs: CalcInputs;
  /** Raw ENTERED inputs — used only for the clamp/audit warning. */
  enteredInputs?: CalcInputs;
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
  enteredInputs,
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
  const cap = crossover.capacity; // authoritative capacity + operating point + provenance
  const SOURCE_STYLE: Record<string, string> = {
    measured: "bg-emerald-500/15 text-emerald-300",
    proxy: "bg-teal-500/15 text-teal-300",
    extrapolated: "bg-amber-500/15 text-amber-300",
    heuristic: "bg-slate-500/20 text-slate-300",
  };
  const managedKb = resultA.managedKb;
  const grounding = resultA.grounding;
  const clampNotes = inputClampNotes(enteredInputs ?? inputs); // INPUT-020: entered vs effective
  const selectedModelLabel =
    priceBook.models.find((m) => m.id === inputs.generation.llmModelId)?.label ?? "This model";
  const hasGenVolume = crossover.monthlyGenTokens > 0;
  const isEfficient = crossover.verdict === "self-host efficient";

  // #25 reconcile: when InferenceX grounding is available it is the authoritative,
  // measured-at-SLA fleet requirement (max of throughput + memory floors). Use it
  // for the capacity callouts too, so the flat-nameplate estimate can never
  // contradict the grounded banner (e.g. grounded ≥15 vs flat ≥6 for one config).
  const effRequiredInstances = effectiveRequiredInstances(grounding, crossover.throughputInstances);

  // Human description of the ACTIVE scenario the headline numbers represent.
  const genModel = priceBook.models.find((m) => m.id === inputs.generation.llmModelId);
  const genModelName = genModel?.label?.replace(/\s*\(.*\)\s*$/, "") ?? inputs.generation.llmModelId;
  const scenarioLabel = metrics.selfHosted
    ? `Self-hosted ${genModelName} · ${crossover.boxes} × ${inputs.generation.gpuInstanceType}`
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

      {/* INPUT-020 transparency: disclose any input that was clamped for the calc. */}
      {clampNotes.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span aria-hidden className="mt-0.5 text-amber-400">⚠</span>
          <div className="text-amber-200/90">
            <span className="font-medium text-amber-300">Input(s) above the supported maximum — calculated at the cap:</span>{" "}
            {clampNotes
              .map((n) => `${n.field}: entered ${n.entered.toLocaleString()}, calculated as ${n.calculated.toLocaleString()}`)
              .join("; ")}
            .
          </div>
        </div>
      )}

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
              {/* P2: report the BINDING dimension headline. */}
              ~{formatPercent(crossover.bindingDim === "prefill" ? crossover.utilAvgPrefill : crossover.utilAvg)} at average{" "}
              <span className="text-sm font-normal text-slate-500">
                · {formatPercent(crossover.bindingDim === "prefill" ? crossover.utilPeakPrefill : crossover.utilPeak)} at peak ·{" "}
                <span className="text-slate-400">{crossover.bindingDim}-bound</span>
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {/* P2: show BOTH prefill and decode utilization + post-loss, labeled. */}
              Prefill (input): <span className="text-slate-200">{formatPercent(crossover.utilAvgPrefill)}</span> avg ·{" "}
              {formatPercent(crossover.utilPeakPrefill)} peak. Decode (output):{" "}
              <span className="text-slate-200">{formatPercent(crossover.utilAvg)}</span> avg ·{" "}
              {formatPercent(crossover.utilPeak)} peak.
              {Number.isFinite(crossover.utilPeakPostLoss) && (
                <span> After one serving-group loss: {formatPercent(crossover.utilPeakPostLoss)} peak.</span>
              )}
              {inputs.traffic.peakFactor > 1 ? ` (${inputs.traffic.peakFactor}× peak)` : ""}
              <span className="mt-1 block text-slate-300">
                Entered fleet: <span className="font-medium">{crossover.userInstances}</span> ·{" "}
                {crossover.feasible ? "Billed" : "Required"} fleet:{" "}
                <span className="font-medium">
                  {crossover.feasible ? crossover.boxes : crossover.requiredInstances}
                </span>
              </span>
              {crossover.autoSized && (
                <span className="mt-1 block text-amber-300">
                  Auto-sized from {crossover.userInstances} to{" "}
                  <span className="font-medium">{crossover.boxes}</span> to serve this workload — the
                  headline, scenarios, crossover, and exports all use {crossover.boxes}. Enter{" "}
                  {crossover.boxes} or more to remove this notice.
                </span>
              )}
              {!crossover.feasible && crossover.infeasibility.length > 0 && (
                <span className="mt-1 block text-rose-300">
                  <span className="font-medium">Infeasible — cost &amp; savings suppressed.</span>
                  {crossover.infeasibility.map((r) => (
                    <span key={r.code} className="mt-0.5 block">
                      • {r.message}
                    </span>
                  ))}
                </span>
              )}
              {crossover.strandedBoxes > 0 && (
                <span className="mt-1 block text-amber-300">
                  {crossover.strandedBoxes} box(es) are stranded — they don&apos;t complete a{" "}
                  {crossover.instancesPerReplica}-box serving group, so they add cost but no serving
                  capacity. Usable: {crossover.usableReplicas} replica(s).
                </span>
              )}
              {crossover.prefillBinds && (
                <span className="mt-1 block text-amber-300">
                  Fleet size is set by <span className="font-medium">prefill</span> (input tokens),
                  not decode — and prefill throughput is estimated, so this sizing is not a direct
                  measurement.
                </span>
              )}
              {crossover.utilPeakPostLoss > 1 && Number.isFinite(crossover.utilPeakPostLoss) && (
                <span className="mt-1 block text-amber-300">
                  After losing one serving group, peak utilization would be{" "}
                  {formatPercent(crossover.utilPeakPostLoss)} (&gt;100%) — N+1 does not fully cover peak.
                </span>
              )}
              {crossover.ownedCapacity && (
                <span className="mt-1 block text-amber-300">
                  GPU rate is $0 (owned / free capacity) — the self-hosted total excludes hardware
                  cost, so the savings vs API isn&apos;t a like-for-like comparison.
                </span>
              )}
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
            <div className="mt-1 text-xs text-slate-400">
              {crossover.verdict}.
              {crossover.verdictQualified &&
                ` (Qualified — based on ${crossover.capacity.source} capacity, not a direct measurement.)`}
            </div>
          </div>
        )}

        {/* Benchmark-grounded GPU-sizing check (self-hosted) */}
        {metrics.selfHosted && (
          grounding.available ? (
            <div
              className={`panel border-l-4 p-4 ${
                grounding.underProvisioned || grounding.slaAchievable === false
                  ? "border-rose-500"
                  : "border-emerald-500"
              }`}
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                Benchmark-grounded GPU sizing
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLE[cap.source]}`}>
                  InferenceX · {cap.source}
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-100">
                Needs ≥ {crossover.requiredInstances} instance{crossover.requiredInstances === 1 ? "" : "s"}
                <span className="text-sm font-normal text-slate-500">
                  {" "}({crossover.replicas} replica{crossover.replicas === 1 ? "" : "s"} × {crossover.instancesPerReplica} box
                  {crossover.instancesPerReplica === 1 ? "" : "es"}
                  {crossover.haReplicasAdded > 0 ? ", incl. N+1 HA" : ""})
                </span>
                {cap.slaAchievable === false && (
                  <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-xs font-medium text-rose-300">
                    SLA not met — infeasible
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Operating point: <span className="text-slate-200">{cap.chosenConcurrency} concurrent</span> →{" "}
                <span className="text-slate-200">{Math.round(cap.perGpuDecodeTokS)} tok/s/GPU</span>,{" "}
                <span className={cap.interactivityMet ? "text-slate-200" : "text-rose-300"}>
                  {Math.round(cap.achievedInteractivity)} tok/s/user
                </span>{" "}
                (target {grounding.interactivityTarget}),{" "}
                <span className={cap.ttftMet ? "text-slate-200" : "text-rose-300"}>
                  TTFT {cap.ttftS.toFixed(1)}s
                </span>{" "}
                (max {(inputs.generation.ttftTargetMs / 1000).toFixed(1)}s). Peak demand{" "}
                {Math.round(crossover.peakDecodeDemand).toLocaleString()} output tok/s ÷{" "}
                {Math.round(cap.perReplicaDecodeTokS).toLocaleString()} tok/s/replica →{" "}
                {crossover.throughputInstances} box(es) for throughput, {cap.memoryFloorBoxes} to fit weights.
                {cap.slaAchievable === false && (
                  <span className="mt-1 block text-rose-300">
                    ⚠ No benchmark point meets both the interactivity and TTFT targets under the concurrency
                    cap ({cap.maxConcurrency}). Not a valid self-host configuration — raise the TTFT budget,
                    lower interactivity, raise concurrency, or pick a faster GPU/precision.
                  </span>
                )}
                {cap.source === "extrapolated" && cap.extrapolationReasons.length > 0 && (
                  <span className="mt-1 block text-amber-300">
                    Extrapolated (not a direct measurement): {cap.extrapolationReasons.join("; ")}.
                  </span>
                )}
                {crossover.verdictQualified && (
                  <span className="mt-1 block text-amber-300">
                    ⚠ Self-host looks favorable, but this rests on <span className="font-medium">{cap.source}</span>{" "}
                    capacity — not a direct measurement of this exact configuration. Treat the recommendation as
                    qualified and validate on your own hardware before committing.
                  </span>
                )}
                {cap.note && <span className="mt-1 block text-slate-500">{cap.note}</span>}
                <span className="mt-1 block text-slate-500">
                  Benchmark: {cap.benchModelKey} · {cap.framework} · {cap.precisionUsed} · {cap.seqUsed} ·{" "}
                  {cap.gpusInConfig} GPUs measured. Weights {Math.round(cap.weightsGB)} GB (
                  {cap.weightPrecisionBits}-bit) + KV {Math.round(cap.kvCacheGB)} GB ({cap.kvPrecisionBits}-bit).
                </span>
              </div>
            </div>
          ) : (
            <div
              className={`panel border-l-4 p-4 ${
                crossover.verdictQualified ? "border-amber-500" : "border-slate-600"
              }`}
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                Benchmark-grounded GPU sizing
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLE[cap.source]}`}>
                  {cap.source}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{grounding.note}</div>
              {/* UX-015: a heuristic/estimated positive is NEVER shown unqualified. */}
              {crossover.verdictQualified && (
                <div className="mt-1 text-xs text-amber-300">
                  ⚠ Self-host looks favorable, but sizing rests on <span className="font-medium">{cap.source}</span>{" "}
                  throughput — <span className="font-medium">not validated</span> for this model/GPU. Run your own
                  benchmark before committing.
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Two build strategies — both now fully priced */}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-slate-300">Two ways to build this</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="panel p-4">
            <div className="text-sm font-medium text-slate-200">{activeProvider.selfBuiltName}</div>
            <div className="mb-2 text-xs text-slate-500">{activeProvider.selfBuiltDesc}</div>
            <FlashValue className="text-3xl font-bold text-slate-100">
              {usd(resultA.totalMonthly$)}
            </FlashValue>
            <div className="text-xs text-slate-500">per month · modeled cost (priced inputs)</div>
          </div>

          <div className="panel p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">{activeProvider.managedName}</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                verified pricing
              </span>
            </div>
            <div className="mb-2 text-xs text-slate-500">{activeProvider.managedDesc}</div>
            <div className="space-y-0.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-400">
                  Index storage <span className="text-slate-600">({inputs.managedKb.indexedDataGB} GB × $5)</span>
                </span>
                <span className="tabular-nums text-slate-300">{usd(managedKb.storageMonthly$, 2)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-400">
                  {inputs.managedKb.retrievalMode === "agentic" ? "Agentic retrieval" : "Standard retrieval"}
                </span>
                <span className="tabular-nums text-slate-300">{usd(managedKb.retrievalMonthly$, 2)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-500">Parsing · embeddings · reranking</span>
                <span className="text-slate-500">included</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-400">LLM generation (API)</span>
                <span className="tabular-nums text-slate-300">{usd(managedKb.generationMonthly$, 2)}</span>
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-slate-800 pt-2">
              <span className="text-sm font-medium text-slate-300">Total</span>
              <FlashValue className="text-2xl font-bold text-slate-100">{usd(managedKb.total$)}</FlashValue>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              AWS published rates (verified {formatDate(priceBook.managedKb.verifiedAt)}) — independent
              of the self-built vector store.
            </div>
          </div>
        </div>
      </div>

      {/* UX-017: non-production banner when serving redundancy is off */}
      {metrics.selfHosted && inputs.generation.haEnabled === false && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
          <span aria-hidden className="mt-0.5 text-rose-400">⚠</span>
          <div className="text-rose-200/90">
            <span className="font-medium text-rose-300">Non-production estimate — serving redundancy excluded.</span>{" "}
            Single replica: a replica loss drops serving capacity, and this models replica redundancy only,
            not AWS multi-AZ placement, Spot-interruption correlation, regional quota, or multi-region DR.
          </div>
        </div>
      )}

      {/* UX-016: what the modeled cost includes / excludes */}
      <details className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-300">
          What this modeled cost includes / excludes
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="text-slate-400">
            <span className="font-medium text-emerald-300">Included:</span> ingestion &amp; embeddings,
            OpenSearch Serverless, reranking, generation (API tokens or the GPU fleet incl. N+1 replicas),
            guardrails, query overhead, and the <span className="text-slate-300">Operations &amp; overhead</span>{" "}
            inputs you set.
          </div>
          <div className="text-slate-400">
            <span className="font-medium text-amber-300">Excluded unless added under Operations:</span>{" "}
            engineering/on-call FTEs, dev/staging GPU fleets, control-plane infra, EBS/FSx/model-artifact
            storage, cross-AZ networking, capacity reservations, support plans, migration/validation, model
            licensing/eval, multi-region DR. Zero Operations inputs are <span className="text-slate-300">your
            assumptions</span>, not evidence these costs are $0.
          </div>
        </div>
      </details>

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

      {/* Self-hosted fleet adequacy — flat-nameplate fallback. Suppressed when the
          benchmark-grounded banner is shown (#25): that banner is the authoritative
          under-provision signal, so this must not display a contradictory number. */}
      {inputs.generation.mode === "self-hosted" &&
        !grounding.available &&
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
