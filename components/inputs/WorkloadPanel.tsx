"use client";

import { useEffect, useState } from "react";
import type { CalcInputs, PriceBook } from "@/lib/types";
import { NumberField, Section, SegmentedToggle } from "./controls";

type TrafficMethod = "monthly" | "qps";

/**
 * Workload block: region, traffic, and the query/answer token lengths that
 * drive everything downstream. Traffic recalculates automatically — no Apply
 * button. In QPS mode the monthly figure becomes a read-only derived value.
 */
export function WorkloadPanel(props: {
  inputs: CalcInputs;
  onChange: (next: CalcInputs) => void;
  priceBook: PriceBook;
}) {
  const { inputs, onChange, priceBook } = props;
  const { traffic } = inputs;

  const [method, setMethod] = useState<TrafficMethod>("monthly");
  const [qps, setQps] = useState(1);
  const [hoursPerDay, setHoursPerDay] = useState(24);
  const [daysPerMonth, setDaysPerMonth] = useState(30);

  const derived = Math.round(qps * hoursPerDay * 3600 * daysPerMonth);

  // In QPS mode, push the derived monthly volume automatically, debounced so it
  // settles after the user pauses typing rather than on every keystroke.
  useEffect(() => {
    if (method !== "qps") return;
    const id = setTimeout(() => {
      if (traffic.queriesPerMonth !== derived) {
        onChange({ ...inputs, traffic: { ...traffic, queriesPerMonth: derived } });
      }
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, derived]);

  const fmtM = (n: number) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(3).replace(/\.?0+$/, "")}M` : n.toLocaleString();

  return (
    <Section title="Workload" hint="Traffic and per-query sizing. Updates as you type.">
      <label className="block">
        <span className="text-xs text-slate-400">Region</span>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={traffic.region}
            onChange={(e) => onChange({ ...inputs, traffic: { ...traffic, region: e.target.value } })}
          />
          {traffic.region !== priceBook.region && (
            <button
              type="button"
              className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
              onClick={() => onChange({ ...inputs, traffic: { ...traffic, region: priceBook.region } })}
              title={`Reset to price book default (${priceBook.region})`}
            >
              Use {priceBook.region}
            </button>
          )}
        </div>
      </label>

      <SegmentedToggle<TrafficMethod>
        label="Traffic input method"
        value={method}
        options={[
          { value: "monthly", label: "Monthly queries" },
          { value: "qps", label: "From QPS" },
        ]}
        onChange={setMethod}
      />

      {method === "monthly" ? (
        <NumberField
          label="Queries per month"
          value={traffic.queriesPerMonth}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...inputs, traffic: { ...traffic, queriesPerMonth: v } })}
        />
      ) : (
        <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5">
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="QPS" value={qps} min={0} step={0.1} onChange={setQps} />
            <NumberField label="Hours/day" value={hoursPerDay} min={0} max={24} step={1} onChange={setHoursPerDay} />
            <NumberField label="Days/mo" value={daysPerMonth} min={0} max={31} step={1} onChange={setDaysPerMonth} />
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
