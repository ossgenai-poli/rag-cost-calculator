"use client";

// Small reusable, controlled form primitives shared by every input sub-panel.
// All of them are pure presentation — they hold no state of their own and
// simply forward a coerced value up via onChange.

import type { ReactNode } from "react";

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

// Parse a raw <input> string to a finite number, falling back to a safe
// default (min, or 0) instead of ever letting NaN reach the parent onChange.
function coerceNumber(raw: string, min?: number, max?: number): number {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n)) return min ?? 0;
  return clamp(n, min, max);
}

export function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="panel p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase">
          {props.title}
        </h3>
        {props.hint && <p className="text-xs text-slate-500 mt-0.5">{props.hint}</p>}
      </div>
      <div className="space-y-3">{props.children}</div>
    </div>
  );
}

export function FieldRow(props: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{props.children}</div>;
}

export function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string; // unit shown after the input, e.g. "tokens", "$/hr"
  hint?: string;
  disabled?: boolean;
}) {
  const { label, value, onChange, min, max, step, suffix, hint, disabled } = props;
  return (
    <label className="block">
      <span className="text-xs text-slate-400">
        {label}
        {suffix ? <span className="text-slate-600"> ({suffix})</span> : null}
      </span>
      <input
        type="number"
        className="mt-1 w-full rounded-md bg-slate-900/60 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        value={value}
        min={min}
        max={max}
        step={step ?? "any"}
        disabled={disabled}
        title={hint}
        onChange={(e) => onChange(coerceNumber(e.target.value, min, max))}
      />
      {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
    </label>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectGroup<T extends string> {
  label: string;
  options: SelectOption<T>[];
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectGroup<T>[];
  hint?: string;
  disabled?: boolean;
}) {
  const { label, value, onChange, options, groups, hint, disabled } = props;
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        className="mt-1 w-full rounded-md bg-slate-900/60 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        value={value}
        disabled={disabled}
        title={hint}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
    </label>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const { label, checked, onChange, hint, disabled } = props;
  return (
    <label
      className={`flex items-center justify-between gap-3 py-0.5 ${
        disabled ? "opacity-40" : "cursor-pointer"
      }`}
      title={hint}
    >
      <span className="text-xs text-slate-400">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
          checked ? "bg-accent" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute left-0.5 h-4 w-4 rounded-full bg-slate-100 transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

export function SliderField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  const { label, value, onChange, min, max, step, format, hint, disabled } = props;
  return (
    <label className="block">
      <span className="text-xs text-slate-400 flex justify-between">
        <span>{label}</span>
        <span className="text-slate-300 tabular-nums">
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range"
        className="mt-1 w-full accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
        value={value}
        min={min}
        max={max}
        step={step ?? 0.01}
        disabled={disabled}
        title={hint}
        onChange={(e) => onChange(coerceNumber(e.target.value, min, max))}
      />
      {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
    </label>
  );
}

export function SegmentedToggle<T extends string>(props: {
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div>
      {label && <span className="text-xs text-slate-400 block mb-1">{label}</span>}
      <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              value === o.value
                ? "bg-accent text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
