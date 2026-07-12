"use client";

import { useEffect } from "react";
import type { CalcInputs, PriceBook, TrafficMethod } from "@/lib/types";
import { activeProvider } from "@/lib/provider";
import { NumberField, Section, SegmentedToggle } from "./controls";

/**
 * Workload block: region, traffic, and the query/answer token lengths that
 * drive everything downstream. Traffic recalculates automatically — no Apply
 * button. In QPS mode the monthly figure is a read-only derived value, and the
 * method + QPS breakdown are persisted in inputs.traffic so a shared link
 * restores them.
 */
export function WorkloadPanel(props: {
  inputs: CalcInputs;
  onChange: (next: CalcInputs) => void;
  priceBook: PriceBook;
}) {
  const { inputs, onChange, priceBook } = props;
  const { traffic } = inputs;
  const { method, qps, hoursPerDay, daysPerMonth } = traffic;

  const derived = Math.round(qps * hoursPerDay * 3600 * daysPerMonth);

  const patchTraffic = (patch: Partial<CalcInputs["traffic"]>) =>
    onChange({ ...inputs, traffic: { ...traffic, ...patch } });

  // In QPS mode, push the derived monthly volume automatically, debounced so it
  // settles after the user pauses typing rather than on every keystroke.
  useEffect(() => {
    if (method !== "qps") return;
    const id = setTimeout(() => {
      if (traffic.queriesPerMonth !== derived) patchTraffic({ queriesPerMonth: derived });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, derived]);

  const fmtM = (n: number) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(3).replace(/\.?0+$/, "")}M` : n.toLocaleString();

  return (
    <Section title="Workload" hint="Traffic and per-query sizing. Updates as you type.">
      <div>
        <span className="text-xs text-slate-400">Pricing region</span>
        <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-1.5">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-300">
            {activeProvider.label}
          </span>
          <span className="text-sm text-slate-200">{priceBook.region}</span>
          <span className="ml-auto text-[11px] text-slate-500">multi-region coming</span>
        </div>
      </div>

      <SegmentedToggle<TrafficMethod>
        label="Traffic input method"
        value={method}
        options={[
          { value: "monthly", label: "Monthly queries" },
          { value: "qps", label: "From QPS" },
        ]}
        onChange={(v) => patchTraffic({ method: v })}
      />

      {method === "monthly" ? (
        <NumberField
          label="Queries per month"
          value={traffic.queriesPerMonth}
          min={0}
          step={1}
          onChange={(v) => patchTraffic({ queriesPerMonth: v })}
        />
      ) : (
        <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5">
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="QPS" value={qps} min={0} step={0.1} onChange={(v) => patchTraffic({ qps: v })} />
            <NumberField label="Hours/day" value={hoursPerDay} min={0} max={24} step={1} onChange={(v) => patchTraffic({ hoursPerDay: v })} />
            <NumberField label="Days/mo" value={daysPerMonth} min={0} max={31} step={1} onChange={(v) => patchTraffic({ daysPerMonth: v })} />
          </div>
          <div className="text-[11px] text-slate-400">
            {qps} QPS × {hoursPerDay} hours × {daysPerMonth} days ={" "}
            <span className="text-slate-200">{fmtM(derived)}</span> queries/month
          </div>
          <NumberField label="Queries per month (derived)" value={traffic.queriesPerMonth} disabled onChange={() => {}} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="User query length"
          suffix="tokens"
          value={inputs.queryTokens}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...inputs, queryTokens: v })}
        />
        <NumberField
          label="Output length"
          suffix="tokens/answer"
          value={inputs.generation.outTokens}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...inputs, generation: { ...inputs.generation, outTokens: v } })}
        />
      </div>
    </Section>
  );
}
