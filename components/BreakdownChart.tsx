"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalcResult, CostBreakdownLine } from "@/lib/types";

const CATEGORIES: Array<{
  key: CostBreakdownLine["category"];
  label: string;
  color: string;
}> = [
  { key: "ingestion", label: "Ingestion", color: "#38bdf8" },
  { key: "vectorstore", label: "Vector Store", color: "#a78bfa" },
  { key: "query", label: "Query", color: "#34d399" },
  { key: "generation", label: "Generation", color: "#fbbf24" },
  { key: "guardrails", label: "Guardrails", color: "#f87171" },
];

function aggregateByCategory(
  breakdown: CostBreakdownLine[]
): Record<CostBreakdownLine["category"], number> {
  const totals: Record<CostBreakdownLine["category"], number> = {
    ingestion: 0,
    vectorstore: 0,
    query: 0,
    generation: 0,
    guardrails: 0,
  };
  for (const line of breakdown) {
    totals[line.category] += line.monthly$;
  }
  return totals;
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

interface BreakdownChartProps {
  resultA: CalcResult;
  resultB: CalcResult;
}

/** Stacked horizontal bar comparing Mode A vs Mode B cost breakdown by category. */
export function BreakdownChart({ resultA, resultB }: BreakdownChartProps) {
  const data = [
    { name: "Mode A · Self-built", ...aggregateByCategory(resultA.breakdown) },
    { name: "Mode B · Bedrock KB", ...aggregateByCategory(resultB.breakdown) },
  ];

  return (
    <div className="panel p-4">
      <div className="mb-2 text-sm font-medium text-slate-300">
        Monthly cost breakdown by category
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatUSD}
              stroke="#64748b"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#64748b"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              width={130}
            />
            <Tooltip
              formatter={(value: number) => formatUSD(value)}
              contentStyle={{
                background: "#111a2e",
                border: "1px solid #1e293b",
                borderRadius: "0.5rem",
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
              formatter={(value: string) => value}
            />
            {CATEGORIES.map((cat) => (
              <Bar
                key={cat.key}
                dataKey={cat.key}
                name={cat.label}
                stackId="cost"
                fill={cat.color}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
