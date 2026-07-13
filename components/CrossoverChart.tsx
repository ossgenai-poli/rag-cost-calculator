"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CrossoverResult } from "@/lib/types";

interface CrossoverChartProps {
  crossover: CrossoverResult;
}

// 730 h/mo × 3600 s — matches the engine's SECONDS_PER_MONTH so QPS lines up.
const SECONDS_PER_MONTH = 730 * 3600;

type AxisKey = "tokens" | "queries" | "qps" | "inputTokens" | "outputTokens";

const AXES: Array<{ key: AxisKey; label: string; unit: string }> = [
  { key: "tokens", label: "LLM tokens", unit: "tokens/mo" },
  { key: "queries", label: "Queries", unit: "queries/mo" },
  { key: "qps", label: "QPS", unit: "sustained QPS" },
  { key: "inputTokens", label: "Input tok", unit: "input tokens/mo" },
  { key: "outputTokens", label: "Output tok", unit: "output tokens/mo" },
];

/** Convert a monthly-token x-value into the selected axis's units. */
function convert(tokens: number, axis: AxisKey, tokensPerQuery: number, outputFraction: number): number {
  switch (axis) {
    case "queries":
      return tokensPerQuery > 0 ? tokens / tokensPerQuery : 0;
    case "qps":
      return tokensPerQuery > 0 ? tokens / tokensPerQuery / SECONDS_PER_MONTH : 0;
    case "inputTokens":
      return tokens * (1 - outputFraction);
    case "outputTokens":
      return tokens * outputFraction;
    default:
      return tokens;
  }
}

function formatCount(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

function formatAxis(v: number, axis: AxisKey): string {
  return axis === "qps" ? v.toFixed(2) : formatCount(v);
}

function formatDollars(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** Break-even utilization can exceed a fleet's capacity; express that honestly. */
function formatBreakEvenUtil(u: number): string {
  return u <= 1 ? `${(u * 100).toFixed(0)}%` : `${u.toFixed(1)}× capacity`;
}

interface CurvePoint {
  x: number;
  api$: number;
  selfHosted$: number;
  util: number; // decode utilization the fixed fleet would run at this volume
}

/** Custom tooltip: dollar series plus the fleet size and its utilization here. */
function ChartTooltip({
  active,
  payload,
  axis,
  boxes,
}: {
  active?: boolean;
  payload?: Array<{ payload: CurvePoint }>;
  axis: AxisKey;
  boxes: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const axisMeta = AXES.find((a) => a.key === axis)!;
  const over = p.util > 1;
  return (
    <div className="rounded-lg border border-slate-700 bg-[#111a2e] px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-slate-200">
        {formatAxis(p.x, axis)} {axisMeta.unit}
      </div>
      <div className="flex items-center gap-2 text-sky-400">
        <span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> API {formatDollars(p.api$)}/mo
      </div>
      <div className="flex items-center gap-2 text-amber-400">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Self-hosted{" "}
        {formatDollars(p.selfHosted$)}/mo
      </div>
      <div className={`mt-1 ${over ? "text-rose-400" : "text-slate-400"}`}>
        {boxes}-instance fleet · {over ? `${p.util.toFixed(1)}× capacity` : `${formatPercent(p.util)} decode util`}
      </div>
    </div>
  );
}

export function CrossoverChart({ crossover }: CrossoverChartProps) {
  const {
    curve,
    breakEvenTokens,
    equivalentQPS,
    utilAtBreakEven,
    verdict,
    monthlyGenTokens,
    boxes,
    gpuMonthly$,
    capacity100,
    breakEvenFeasible,
    tokensPerQuery,
    outputFraction,
  } = crossover;
  const [axis, setAxis] = useState<AxisKey>("tokens");
  const isEfficient = verdict === "self-host efficient";
  const showWorkload = monthlyGenTokens > 0;
  const axisMeta = AXES.find((a) => a.key === axis)!;
  const fleetCapacity = boxes * capacity100;

  const data: CurvePoint[] = curve.map((p) => ({
    x: convert(p.tokens, axis, tokensPerQuery, outputFraction),
    api$: p.api$,
    selfHosted$: p.selfHosted$,
    util: fleetCapacity > 0 ? (p.tokens * outputFraction) / fleetCapacity : 0,
  }));

  const breakEvenX = convert(breakEvenTokens, axis, tokensPerQuery, outputFraction);
  const workloadX = convert(monthlyGenTokens, axis, tokensPerQuery, outputFraction);
  // A crossover only exists if break-even is achievable within the fleet's
  // physical decode capacity. Otherwise the API line never meets the flat fleet
  // line inside the feasible range — say so instead of implying a crossover.
  const hasFeasibleCrossover = breakEvenTokens > 0 && breakEvenFeasible;

  return (
    <div className="panel p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-300">API vs. self-hosted GPU crossover</h3>
        <div className="flex items-center gap-1" role="group" aria-label="X-axis unit">
          <span className="mr-1 text-[11px] text-slate-500">X:</span>
          {AXES.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAxis(a.key)}
              aria-pressed={axis === a.key}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                axis === a.key
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Your fixed GPU-fleet cost vs the API&apos;s linear cost.{" "}
        <span className="text-slate-600">
          X: {axisMeta.unit} · Y: monthly generation cost ($/mo)
        </span>
      </p>

      {curve.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">
          Not enough data to plot a crossover curve.
        </div>
      ) : (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 22, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis
                dataKey="x"
                type="number"
                domain={[0, "dataMax"]}
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={(v: number) => formatAxis(v, axis)}
                height={24}
              />
              <YAxis
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={formatDollars}
                width={56}
              />
              <Tooltip content={<ChartTooltip axis={axis} boxes={boxes} />} />
              <Legend wrapperStyle={{ color: "#e2e8f0", fontSize: 12 }} />
              <Line type="monotone" dataKey="api$" name="API (linear)" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="selfHosted$" name="Self-hosted (fixed fleet)" stroke="#f59e0b" dot={false} strokeWidth={2} />

              {hasFeasibleCrossover && breakEvenX > 0 && (
                <ReferenceLine x={breakEvenX} stroke="#e2e8f0" strokeDasharray="4 4">
                  <Label value="Break-even" position="top" style={{ fill: "#e2e8f0", fontSize: 11 }} />
                </ReferenceLine>
              )}

              {showWorkload && (
                <ReferenceLine x={workloadX} stroke="#34d399" strokeDasharray="2 2">
                  <Label value="Workload" position="insideTopRight" style={{ fill: "#34d399", fontSize: 11 }} />
                </ReferenceLine>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {curve.length > 0 && !hasFeasibleCrossover && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200/90">
          <span className="font-medium text-amber-200">No feasible crossover.</span>{" "}
          {breakEvenTokens <= 0
            ? "The API's blended price is $0 (or there's no generation volume), so there's no break-even to plot."
            : `Break-even (${formatCount(breakEvenTokens)} tokens/mo) is ${utilAtBreakEven.toFixed(
                1
              )}× the ${boxes}-instance fleet's decode capacity — it can't process enough to beat the hosted API, so the API stays cheaper across the fleet's whole feasible range.`}
        </div>
      )}

      {hasFeasibleCrossover && (
        <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5 text-xs text-slate-400">
          <span className="text-slate-300">
            Break-even: {formatCount(breakEvenTokens)} tokens/month
          </span>{" "}
          — where your {boxes}-instance fleet ({formatDollars(gpuMonthly$ * boxes)}/mo) matches the
          API&apos;s linear cost, ≈ {equivalentQPS.toFixed(2)} sustained QPS.
          <span className="mt-1 block text-slate-500">
            The fleet would need to run at ~{formatPercent(utilAtBreakEven)} utilization to break even
            — anything above that favors self-hosting.
          </span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-slate-500">Break-even tokens</div>
          <div className="text-slate-200 tabular-nums">{formatCount(breakEvenTokens)}/mo</div>
        </div>
        <div>
          <div className="text-slate-500">Equivalent QPS</div>
          <div className="text-slate-200 tabular-nums">{equivalentQPS.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500" title="Fleet utilization needed to reach break-even volume">Utilization to break even</div>
          <div className="text-slate-200 tabular-nums">{formatBreakEvenUtil(utilAtBreakEven)}</div>
        </div>
        <div>
          <div className="text-slate-500">Verdict</div>
          <div className={isEfficient ? "text-emerald-400" : "text-amber-400"}>{verdict}</div>
        </div>
      </div>
    </div>
  );
}

export default CrossoverChart;
