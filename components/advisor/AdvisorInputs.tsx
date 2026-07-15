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
import type { ModelPrice } from "@/lib/types";
import type { OptimizeFor } from "@/lib/recommendation";
import { EXPERT_FIELD_HELP, type FieldError } from "./copy";

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
  experimental: boolean;
}

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
      <Num id="adv-volume" label="Questions per month" value={state.volume} min={1} error={err("adv-volume")} onCommit={(v) => set("volume", v)} />
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
            <Num id="adv-topn" label="Context chunks sent (Top N)" helpKey="topN" value={state.topN} defaultValue={defaults.topN} min={0} error={err("adv-topn")} onCommit={(v) => set("topN", v)} />
            <Num id="adv-topk" label="Chunks retrieved (Top K)" helpKey="topK" value={state.topK} defaultValue={defaults.topK} min={1} error={err("adv-topk")} onCommit={(v) => set("topK", v)} />
            <Num id="adv-out" label="Output tokens per answer" helpKey="outTokens" value={state.outTokens} defaultValue={defaults.outTokens} min={0} error={err("adv-out")} onCommit={(v) => set("outTokens", v)} />
            <Num id="adv-uptime" label="GPU fleet uptime" helpKey="uptimeHours" value={state.uptimeHours} defaultValue={defaults.uptimeHours} min={0} disabled={!selfHostAvailable} disabledNote={selfHostDisabledNote} error={err("adv-uptime")} onCommit={(v) => set("uptimeHours", v)} />
          </div>
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
