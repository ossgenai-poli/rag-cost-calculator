"use client";

import {
  CartesianGrid,
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
  const { curve, breakEvenTokens, equivalentQPS, utilAtBreakEven, verdict } = crossover;
  const isEfficient = verdict === "self-host efficient";

  return (
    <div className="panel p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-3">
        API vs. self-hosted GPU crossover
      </h3>

      {curve.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">
          Not enough data to plot a crossover curve.
        </div>
      ) : (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis
                dataKey="tokens"
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={formatTokens}
              />
              <YAxis
                stroke="#94a3b8"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={formatDollars}
              />
              <Tooltip
                contentStyle={{ background: "#111a2e", border: "1px solid #1e293b", borderRadius: 8 }}
                labelStyle={{ color: "#e2e8f0" }}
                labelFormatter={(tokens: number) => `${formatTokens(tokens)} tokens/mo`}
                formatter={(value: number, name: string) => [formatDollars(value), name]}
              />
              <Legend wrapperStyle={{ color: "#e2e8f0", fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="api$"
                name="API (linear)"
                stroke="#38bdf8"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="stepAfter"
                dataKey="selfHosted$"
                name="Self-hosted (stepped)"
                stroke="#f59e0b"
                dot={false}
                strokeWidth={2}
              />
              {breakEvenTokens > 0 && (
                <ReferenceLine
                  x={breakEvenTokens}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                  label={{
                    value: "break-even",
                    position: "top",
                    fill: "#e2e8f0",
                    fontSize: 11,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-slate-500">Break-even tokens</div>
          <div className="text-slate-200">{formatTokens(breakEvenTokens)}</div>
        </div>
        <div>
          <div className="text-slate-500">Equivalent QPS</div>
          <div className="text-slate-200">{equivalentQPS.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500">Util at break-even</div>
          <div className="text-slate-200">{formatPercent(utilAtBreakEven)}</div>
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
