"use client";

import { useState } from "react";
import type { PriceBook, TrafficInputs } from "@/lib/types";
import { NumberField, Section } from "./controls";

export function TrafficPanel(props: {
  traffic: TrafficInputs;
  onChange: (next: TrafficInputs) => void;
  priceBook: PriceBook;
}) {
  const { traffic, onChange, priceBook } = props;

  // Ancillary helper state only — never part of CalcInputs. Used to derive
  // queriesPerMonth, which is the only value that gets pushed via onChange.
  const [qps, setQps] = useState(1);
  const [hoursPerDay, setHoursPerDay] = useState(24);
  const [daysPerMonth, setDaysPerMonth] = useState(30);

  const helperQueriesPerMonth = Math.round(qps * hoursPerDay * 3600 * daysPerMonth);

  return (
    <Section title="Traffic">
      <NumberField
        label="Queries per month"
        value={traffic.queriesPerMonth}
        min={0}
        step={1}
        onChange={(v) => onChange({ ...traffic, queriesPerMonth: v })}
      />

      <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2.5 space-y-2">
        <span className="text-[11px] text-slate-500">
          Helper: derive queries/mo from QPS × hours/day × days/mo
        </span>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="QPS" value={qps} min={0} step={0.1} onChange={setQps} />
          <NumberField
            label="Hours/day"
            value={hoursPerDay}
            min={0}
            max={24}
            step={1}
            onChange={setHoursPerDay}
          />
          <NumberField
            label="Days/mo"
            value={daysPerMonth}
            min={0}
            max={31}
            step={1}
            onChange={setDaysPerMonth}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">
            = {helperQueriesPerMonth.toLocaleString()} queries/mo
          </span>
          <button
            type="button"
            className="rounded bg-accent/20 text-accent px-2 py-1 text-[11px] font-medium hover:bg-accent/30"
            onClick={() => onChange({ ...traffic, queriesPerMonth: helperQueriesPerMonth })}
          >
            Apply
          </button>
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400">Region</span>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            className="w-full rounded-md bg-slate-900/60 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            value={traffic.region}
            onChange={(e) => onChange({ ...traffic, region: e.target.value })}
          />
          {traffic.region !== priceBook.region && (
            <button
              type="button"
              className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
              onClick={() => onChange({ ...traffic, region: priceBook.region })}
              title={`Reset to price book default (${priceBook.region})`}
            >
              Use {priceBook.region}
            </button>
          )}
        </div>
      </label>
    </Section>
  );
}
