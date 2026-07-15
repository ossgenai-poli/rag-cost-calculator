"use client";

// Customer input journey (docs/ux-v2/01-journey-map.md Stages A-B), revised per UI HOLD-1:
// - numeric fields keep a local draft and COMMIT ON BLUR / Enter, so the last valid result stays on
//   screen while the customer types (P2-UI-1 / owner D6);
// - invalid fields get aria-invalid + aria-describedby with customer wording from the shared copy
//   contract (never internal property paths);
// - expert inputs carry units, recommended defaults, "why it matters" and an entered-vs-default
//   provenance tag (P2-UI-3);
// - API-only models are grouped and labeled "self-host unavailable", and self-host-specific controls
//   are disabled for them (P1-UI-2 / owner D4).
import { useEffect, useState } from "react";
import type { GpuPricingModel, ModelPrice } from "@/lib/types";
import type { OptimizeFor } from "@/lib/recommendation";
import { EXPERT_FIELD_HELP, type FieldError } from "./copy";
import { RANGE_PRESETS, rangeBoundsValid, type RangeBounds, type RangeField } from "./ranges";

export interface AdvisorState {
  modelId: string;
  volume: number;
  optimizeFor: OptimizeFor;
  mode: "simple" | "expert";
  ttftTargetMs: number;
  interactivityTarget: number;
  outTokens: number;
  queryTokens: number;
  promptOverhead: number;
  chunkSize: number;
  topN: number;
  topK: number;
  uptimeHours: number;
  // Iteration-3 structured journey-state contract (owner directive): utilization, redundancy/N+1 and
  // purchasing are REAL engine inputs (utilTarget, haEnabled, gpuPricingModel) — never
  // presentation-only preset state.
  utilTargetPct: number; // percent (0,100]; mapped to the engine's utilTarget fraction
  haEnabled: boolean; // N+1 serving-replica redundancy (NOT AZ/DR/compliance)
  purchasingModel: GpuPricingModel; // commitment model → indicative discount off on-demand
  experimental: boolean;
  /** Iteration-5 (doc 08): optional low/high customer RANGES per range-capable input. The base value
   *  stays in the plain field above and drives the headline; bands come from real engine recomputes
   *  at these bounds (never percentage extrapolation). */
  ranges: Partial<Record<RangeField, RangeBounds>>;
}

export const PURCHASING_OPTIONS: Array<{ value: GpuPricingModel; label: string }> = [
  { value: "on-demand", label: "On-demand" },
  { value: "reserved-1yr", label: "Reserved 1-yr (indicative)" },
  { value: "reserved-3yr", label: "Reserved 3-yr (indicative)" },
  { value: "savings-1yr", label: "Savings Plan 1-yr (indicative)" },
  { value: "spot", label: "Spot (indicative, interruptible)" },
];

const OPTIMIZE_LABELS: Record<OptimizeFor, string> = {
  cost: "Lowest cost",
  latency: "Lowest latency",
  confidence: "Strongest evidence",
  predictability: "Predictable spend",
};

interface NumProps {
  id: string;
  label: string;
  value: number;
  defaultValue?: number;
  helpKey?: keyof typeof EXPERT_FIELD_HELP;
  min?: number;
  disabled?: boolean;
  disabledNote?: string;
  error?: FieldError;
  onCommit: (v: number) => void;
}

/** Numeric field with a local draft: commits on blur or Enter (never per keystroke). */
function Num({ id, label, value, defaultValue, helpKey, min, disabled, disabledNote, error, onCommit }: NumProps) {
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => setDraft(Number.isFinite(value) ? String(value) : ""), [value]);
  const commit = () => onCommit(draft.trim() === "" ? NaN : Number(draft));
  const help = helpKey ? EXPERT_FIELD_HELP[helpKey] : undefined;
  const provenance = defaultValue !== undefined ? (value === defaultValue ? "assumed (default)" : "customer-entered") : undefined;
  const describedBy = [error ? `${id}-error` : null, help ? `${id}-help` : null, disabled && disabledNote ? `${id}-disabled` : null]
    .filter(Boolean)
    .join(" ") || undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
        {help && <span className="ml-1 font-normal text-slate-400">({help.unit})</span>}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        value={draft}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={`mt-0.5 w-full rounded border px-2 py-1 text-sm ${error ? "border-red-400 bg-red-50" : "border-slate-300"} ${disabled ? "bg-slate-100 text-slate-400" : ""}`}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-0.5 text-xs text-red-700" data-testid={`field-error-${id}`}>{error.message}</p>
      )}
      {help && (
        <p id={`${id}-help`} className="mt-0.5 text-xs text-slate-500">
          {help.recommended} · {help.why}
          {provenance && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase tracking-wide text-slate-500" data-testid={`provenance-${id}`}>{provenance}</span>}
        </p>
      )}
      {disabled && disabledNote && (
        <p id={`${id}-disabled`} className="mt-0.5 text-xs text-slate-400" data-testid={`disabled-note-${id}`}>{disabledNote}</p>
      )}
    </div>
  );
}

interface RangeControlProps {
  field: RangeField;
  base: number;
  range: RangeBounds | undefined;
  /** Commit a VALID pair, clear with null, or apply a preset (base + bounds together). */
  onSet: (bounds: RangeBounds | null) => void;
  onPreset: (base: number, bounds: RangeBounds) => void;
}

/** The "I'm not sure" affordance (doc 08): low/base/high where base stays in the main field and
 *  drives the headline; low/high commit ONLY as a valid pair (low < high, finite) — invalid pairs
 *  show an inline error and never reach the journey state. Typical presets fill a plausible
 *  low/base/high so a missing fact never blocks. */
function RangeControl({ field, base, range, onSet, onPreset }: RangeControlProps) {
  const [open, setOpen] = useState(!!range);
  const [lowDraft, setLowDraft] = useState<string>(range ? String(range.low) : "");
  const [highDraft, setHighDraft] = useState<string>(range ? String(range.high) : "");
  const [pairError, setPairError] = useState<string | null>(null);
  useEffect(() => {
    setOpen(!!range);
    setLowDraft(range ? String(range.low) : "");
    setHighDraft(range ? String(range.high) : "");
  }, [range]);

  const commitPair = (lowS: string, highS: string) => {
    if (lowS.trim() === "" || highS.trim() === "") return; // wait for both bounds
    const b = { low: Number(lowS), high: Number(highS) };
    if (rangeBoundsValid(field, b)) {
      setPairError(null);
      onSet(b);
    } else {
      setPairError("Enter numbers with low less than high (at or above the field minimum).");
    }
  };
  const clear = () => {
    setOpen(false);
    setLowDraft("");
    setHighDraft("");
    setPairError(null);
    onSet(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`range-toggle-${field}`}
        onClick={() => setOpen(true)}
        className="mt-0.5 text-xs text-sky-700 underline"
      >
        I’m not sure — use a range
      </button>
    );
  }
  return (
    <div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2" data-testid={`range-control-${field}`}>
      <p className="text-xs text-slate-600">
        Base <span className="font-mono">{new Intl.NumberFormat("en-US").format(base)}</span> drives the headline; the band is recomputed by running the engine at your bounds.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600">
          Low{" "}
          <input
            type="number"
            data-testid={`range-low-${field}`}
            value={lowDraft}
            onChange={(e) => setLowDraft(e.target.value)}
            onBlur={() => commitPair(lowDraft, highDraft)}
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
        </label>
        <label className="text-xs text-slate-600">
          High{" "}
          <input
            type="number"
            data-testid={`range-high-${field}`}
            value={highDraft}
            onChange={(e) => setHighDraft(e.target.value)}
            onBlur={() => commitPair(lowDraft, highDraft)}
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
        </label>
        <button type="button" data-testid={`range-clear-${field}`} onClick={clear} className="text-xs text-slate-500 underline">
          Use a single value
        </button>
      </div>
      {pairError && (
        <p role="alert" data-testid={`range-error-${field}`} className="mt-1 text-xs text-red-700">{pairError}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">Typical:</span>
        {RANGE_PRESETS[field].map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`range-preset-${field}-${p.id}`}
            title={`low ${p.low} · base ${p.base} · high ${p.high}`}
            onClick={() => { setPairError(null); onPreset(p.base, { low: p.low, high: p.high }); }}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface AdvisorInputsProps {
  state: AdvisorState;
  defaults: AdvisorState;
  models: ModelPrice[];
  selfHostAvailable: boolean; // false = the selected model is API-only (weights unavailable)
  fieldErrors: Record<string, FieldError>;
  onChange: (next: AdvisorState) => void;
}

export function AdvisorInputs({ state, defaults, models, selfHostAvailable, fieldErrors, onChange }: AdvisorInputsProps) {
  const set = <K extends keyof AdvisorState>(k: K, v: AdvisorState[K]) => onChange({ ...state, [k]: v });
  const setRange = (field: RangeField, bounds: RangeBounds | null) => {
    const ranges = { ...state.ranges };
    if (bounds) ranges[field] = bounds;
    else delete ranges[field];
    onChange({ ...state, ranges });
  };
  // A typical preset fills low/BASE/high together (doc 08: a missing fact falls back to a labeled
  // preset, never a hidden default) — the base lands in the plain field, labeled by provenance.
  const setRangePreset = (field: RangeField, base: number, bounds: RangeBounds) =>
    onChange({ ...state, [field]: base, ranges: { ...state.ranges, [field]: bounds } });
  const llms = models.filter((m) => m.kind === "llm");
  const openWeight = llms.filter((m) => m.selfHostable);
  const apiOnly = llms.filter((m) => !m.selfHostable);
  const err = (id: string) => fieldErrors[id];
  const selfHostDisabledNote = "Not applicable — the selected model is API-only (self-host unavailable).";
  return (
    <form aria-label="Workload inputs" data-testid="advisor-inputs" className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label htmlFor="adv-model" className="block text-xs font-medium text-slate-600">Model</label>
        <select
          id="adv-model"
          value={state.modelId}
          onChange={(e) => set("modelId", e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <optgroup label="Open-weight (self-hostable)">
            {openWeight.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </optgroup>
          <optgroup label="API-only (self-host unavailable)">
            {apiOnly.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </optgroup>
        </select>
        {!selfHostAvailable && (
          <p className="mt-0.5 text-xs text-amber-700" data-testid="api-only-note">
            This model is API-only; self-host weights are unavailable. Select an open-weight model to evaluate self-hosting.
          </p>
        )}
      </div>
      <div>
        <Num id="adv-volume" label="Questions per month" value={state.volume} min={1} error={err("adv-volume")} onCommit={(v) => set("volume", v)} />
        <RangeControl field="volume" base={state.volume} range={state.ranges.volume} onSet={(b) => setRange("volume", b)} onPreset={(base, b) => setRangePreset("volume", base, b)} />
      </div>
      <div>
        <label htmlFor="adv-optimize" className="block text-xs font-medium text-slate-600">Optimize for</label>
        <select
          id="adv-optimize"
          value={state.optimizeFor}
          onChange={(e) => set("optimizeFor", e.target.value as OptimizeFor)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(OPTIMIZE_LABELS) as OptimizeFor[]).map((k) => (
            <option key={k} value={k}>{OPTIMIZE_LABELS[k]}</option>
          ))}
        </select>
        <p className="mt-0.5 text-xs text-slate-500">Orders the self-host options; it never flips the API-vs-self-host decision.</p>
      </div>

      {state.mode === "expert" && (
        <fieldset className="space-y-3 rounded border border-slate-200 p-3" data-testid="expert-inputs">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Expert — SLA & workload shape</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Num id="adv-ttft" label="P99 TTFT target" helpKey="ttftTargetMs" value={state.ttftTargetMs} defaultValue={defaults.ttftTargetMs} min={1} error={err("adv-ttft")} onCommit={(v) => set("ttftTargetMs", v)} />
            <Num id="adv-intvty" label="Streaming target" helpKey="interactivityTarget" value={state.interactivityTarget} defaultValue={defaults.interactivityTarget} min={1} error={err("adv-intvty")} onCommit={(v) => set("interactivityTarget", v)} />
            <Num id="adv-query" label="User query tokens" helpKey="queryTokens" value={state.queryTokens} defaultValue={defaults.queryTokens} min={0} error={err("adv-query")} onCommit={(v) => set("queryTokens", v)} />
            <Num id="adv-prompt" label="Prompt overhead" helpKey="promptOverhead" value={state.promptOverhead} defaultValue={defaults.promptOverhead} min={0} error={err("adv-prompt")} onCommit={(v) => set("promptOverhead", v)} />
            <Num id="adv-chunk" label="Chunk size" helpKey="chunkSize" value={state.chunkSize} defaultValue={defaults.chunkSize} min={1} error={err("adv-chunk")} onCommit={(v) => set("chunkSize", v)} />
            <div>
              <Num id="adv-topn" label="Context chunks sent (Top N)" helpKey="topN" value={state.topN} defaultValue={defaults.topN} min={0} error={err("adv-topn")} onCommit={(v) => set("topN", v)} />
              <RangeControl field="topN" base={state.topN} range={state.ranges.topN} onSet={(b) => setRange("topN", b)} onPreset={(base, b) => setRangePreset("topN", base, b)} />
            </div>
            <Num id="adv-topk" label="Chunks retrieved (Top K)" helpKey="topK" value={state.topK} defaultValue={defaults.topK} min={1} error={err("adv-topk")} onCommit={(v) => set("topK", v)} />
            <div>
              <Num id="adv-out" label="Output tokens per answer" helpKey="outTokens" value={state.outTokens} defaultValue={defaults.outTokens} min={0} error={err("adv-out")} onCommit={(v) => set("outTokens", v)} />
              <RangeControl field="outTokens" base={state.outTokens} range={state.ranges.outTokens} onSet={(b) => setRange("outTokens", b)} onPreset={(base, b) => setRangePreset("outTokens", base, b)} />
            </div>
            <Num id="adv-uptime" label="GPU fleet uptime" helpKey="uptimeHours" value={state.uptimeHours} defaultValue={defaults.uptimeHours} min={0} disabled={!selfHostAvailable} disabledNote={selfHostDisabledNote} error={err("adv-uptime")} onCommit={(v) => set("uptimeHours", v)} />
          </div>

          {/* Iteration-3 journey-state contract: operations & purchasing are REAL engine inputs. */}
          <fieldset className="space-y-3 rounded border border-slate-200 p-3" data-testid="ops-inputs">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Operations & purchasing</legend>
            <Num id="adv-util" label="Utilization target" helpKey="utilTargetPct" value={state.utilTargetPct} defaultValue={defaults.utilTargetPct} min={1} disabled={!selfHostAvailable} disabledNote={selfHostDisabledNote} error={err("adv-util")} onCommit={(v) => set("utilTargetPct", v)} />
            <div className="flex items-start gap-2">
              <input
                id="adv-ha"
                type="checkbox"
                checked={state.haEnabled}
                disabled={!selfHostAvailable}
                aria-describedby="adv-ha-help"
                onChange={(e) => set("haEnabled", e.target.checked)}
              />
              <div>
                <label htmlFor="adv-ha" className="text-xs text-slate-600">Spare serving replica (N+1)</label>
                <p id="adv-ha-help" className="text-xs text-slate-500">
                  Serving-replica redundancy only — it does <em>not</em> establish multi-AZ resilience, disaster recovery, or compliance.
                  <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase tracking-wide text-slate-500" data-testid="provenance-adv-ha">
                    {state.haEnabled === defaults.haEnabled ? "assumed (default)" : "customer-entered"}
                  </span>
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="adv-purchasing" className="block text-xs font-medium text-slate-600">Purchasing model</label>
              <select
                id="adv-purchasing"
                value={state.purchasingModel}
                disabled={!selfHostAvailable}
                aria-describedby="adv-purchasing-help"
                onChange={(e) => set("purchasingModel", e.target.value as AdvisorState["purchasingModel"])}
                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {PURCHASING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p id="adv-purchasing-help" className="mt-0.5 text-xs text-slate-500">
                Commitment discounts are indicative — actual RI/Savings/Spot pricing varies with term and payment; get an AWS quote.
                <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase tracking-wide text-slate-500" data-testid="provenance-adv-purchasing">
                  {state.purchasingModel === defaults.purchasingModel ? "assumed (default)" : "customer-entered"}
                </span>
              </p>
            </div>
          </fieldset>
          <div className="flex items-start gap-2">
            <input
              id="adv-experimental"
              type="checkbox"
              checked={state.experimental}
              disabled={!selfHostAvailable}
              aria-describedby={!selfHostAvailable ? "adv-experimental-disabled" : undefined}
              onChange={(e) => set("experimental", e.target.checked)}
            />
            <div>
              <label htmlFor="adv-experimental" className="text-xs text-slate-600">
                Experimental cross-source evidence check (demote-only; may hold confidence at <em>unbenchmarked</em>)
              </label>
              {!selfHostAvailable && (
                <p id="adv-experimental-disabled" className="text-xs text-slate-400" data-testid="disabled-note-adv-experimental">{selfHostDisabledNote}</p>
              )}
            </div>
          </div>
        </fieldset>
      )}
    </form>
  );
}
