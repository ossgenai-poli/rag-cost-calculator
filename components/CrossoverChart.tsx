"use client";

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

function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}K`;
  return `${Math.round(tokens)}`;
}

function formatDollars(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

export function CrossoverChart({ crossover }: CrossoverChartProps) {
  const {
    curve,
    breakEvenTokens,
    equivalentQPS,
    utilAtBreakEven,
    verdict,
    monthlyGenTokens,
  } = crossover;
  const isEfficient = verdict === "self-host efficient";
  const showWorkload = monthlyGenTokens > 0;

  return (
    <div className="panel p-4">
      <h3 className="mb-1 text-sm font-medium text-slate-300">API vs. self-hosted GPU crossover</h3>
      <p className="mb-3 text-xs text-slate-500">
        Where linear API pricing meets the stepped cost of a dedicated GPU box.
      </p>

      {curve.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">
          Not enough data to plot a crossover curve.
        </div>
      ) : (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ top: 8, right: 24, bottom: 28, left: 16 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis
                dataKey="tokens"
                type="number"
                domain={[0, "dataMax"]}
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={formatTokens}
                height={40}
              >
                <Label
                  value="Monthly LLM tokens"
                  position="insideBottom"
                  offset={-4}
                  style={{ fill: "#64748b", fontSize: 12 }}
                />
              </XAxis>
              <YAxis
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={formatDollars}
                width={64}
              >
                <Label
                  value="Monthly generation cost"
                  angle={-90}
                  position="insideLeft"
                  style={{ fill: "#64748b", fontSize: 12, textAnchor: "middle" }}
                />
              </YAxis>
              <Tooltip
                contentStyle={{ background: "#111a2e", border: "1px solid #1e293b", borderRadius: 8 }}
                labelStyle={{ color: "#e2e8f0" }}
                labelFormatter={(tokens: number) => `${formatTokens(tokens)} tokens/mo`}
                formatter={(value: number, name: string) => [formatDollars(value), name]}
              />
              <Legend wrapperStyle={{ color: "#e2e8f0", fontSize: 12 }} />
              <Line type="monotone" dataKey="api$" name="API (linear)" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <Line type="stepAfter" dataKey="selfHosted$" name="Self-hosted (stepped)" stroke="#f59e0b" dot={false} strokeWidth={2} />

              {breakEvenTokens > 0 && (
                <ReferenceLine x={breakEvenTokens} stroke="#e2e8f0" strokeDasharray="4 4">
                  <Label
                    value={`Break-even · ${formatTokens(breakEvenTokens)}`}
                    position="top"
                    style={{ fill: "#e2e8f0", fontSize: 11 }}
                  />
                </ReferenceLine>
              )}

              {showWorkload && (
                <ReferenceLine x={monthlyGenTokens} stroke="#34d399" strokeDasharray="2 2">
                  <Label
                    value={`Your workload · ${formatTokens(monthlyGenTokens)}`}
                    position="insideTopRight"
                    style={{ fill: "#34d399", fontSize: 11 }}
                  />
                </ReferenceLine>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {breakEvenTokens > 0 && (
        <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5 text-xs text-slate-400">
          <span className="text-slate-300">Break-even: {formatTokens(breakEvenTokens)} tokens/month</span>
          {" "}— equivalent to ~{equivalentQPS.toFixed(2)} sustained QPS, assuming{" "}
          {formatPercent(utilAtBreakEven)} realized GPU utilization at that point.
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-slate-500">Break-even tokens</div>
          <div className="text-slate-200 tabular-nums">{formatTokens(breakEvenTokens)}/mo</div>
        </div>
        <div>
          <div className="text-slate-500">Equivalent QPS</div>
          <div className="text-slate-200 tabular-nums">{equivalentQPS.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500" title="Util at break-even">Required realized GPU utilization</div>
          <div className="text-slate-200 tabular-nums">{formatPercent(utilAtBreakEven)}</div>
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
